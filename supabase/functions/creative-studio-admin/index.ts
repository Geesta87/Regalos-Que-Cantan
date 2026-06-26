// supabase/functions/creative-studio-admin/index.ts
// ===========================================================================
// AGENT 2 — CREATIVE STUDIO (admin approval + auto-post)
// ===========================================================================
// Powers the dashboard's Creative Studio tab. Lists ready creatives and lets
// the owner APPROVE (→ auto-post via GHL) or REJECT them. This is the human
// gate: nothing reaches social until approved here.
//
// Auth: logged-in Supabase Auth session mapping to admin_users (same pattern as
// social-pipeline-config / admin-songs). Reads allowed for admin + assistant;
// approve/reject require role = 'admin'. verify_jwt = true (config.toml).
//
// Posting reuses the post-to-ghl approach (GHL Private Integration token,
// one scheduled post per connected account) and RESPECTS the
// social_pipeline_state pause switch — if posting is paused, approval is
// recorded but nothing publishes.
//
// Deploy: supabase functions deploy creative-studio-admin --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const GHL_API_TOKEN = Deno.env.get('GHL_API_TOKEN');
const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID');
const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';
const GHL_USER_ID = Deno.env.get('GHL_USER_ID') || 'FzWeDSE9qm2dyrKmh1hn';
const FEED_SCHEDULE_DELAY_SECONDS = 900; // 15 min, same buffer as post-to-ghl

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// ---------------------------------------------------------------------------
// GHL helpers (mirrors post-to-ghl)
// ---------------------------------------------------------------------------
async function ghlFetch(path: string, init: RequestInit = {}) {
  return fetch(`${GHL_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${GHL_API_TOKEN}`, Version: GHL_API_VERSION,
      Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers || {}),
    },
  });
}

async function listConnectedAccounts(): Promise<any[]> {
  const resp = await ghlFetch(`/social-media-posting/${GHL_LOCATION_ID}/accounts`, { method: 'GET' });
  if (!resp.ok) throw new Error(`GHL accounts ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  return (data?.results?.accounts || []).filter((a: any) => !a.isExpired && !a.deleted);
}

function extractGhlPostId(d: any): string | null {
  return d?.results?.post?._id || d?.results?.post?.id || d?.results?.posts?.[0]?._id
    || d?.results?._id || d?.post?._id || d?._id || d?.id || null;
}

async function ghlPost(accountId: string, caption: string, mediaUrl: string, kind: string, scheduleDate: string) {
  const payload: any = {
    accountIds: [accountId],
    userId: GHL_USER_ID,
    media: [{ url: mediaUrl, type: kind === 'video' ? 'video/mp4' : 'image/png' }],
    summary: caption,
    scheduleDate,
    type: 'post',
    status: 'scheduled',
  };
  const resp = await ghlFetch(`/social-media-posting/${GHL_LOCATION_ID}/posts`, { method: 'POST', body: JSON.stringify(payload) });
  if (!resp.ok) return { id: null, error: `${resp.status}: ${(await resp.text()).slice(0, 200)}` };
  return { id: extractGhlPostId(await resp.json()), error: null as string | null };
}

function fullCaption(c: any): string {
  const tags = Array.isArray(c.hashtags) && c.hashtags.length
    ? '\n\n' + c.hashtags.map((h: string) => `#${String(h).replace(/^#/, '')}`).join(' ')
    : '';
  return `${c.caption || c.headline || ''}${tags}`.trim();
}

// ---------------------------------------------------------------------------
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ success: false, error: 'Missing Authorization header' }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ success: false, error: 'Invalid session' }, 401);
    const userId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: roleRow, error: roleErr } = await admin.from('admin_users').select('role').eq('user_id', userId).single();
    if (roleErr || !roleRow) return json({ success: false, error: 'No dashboard access' }, 403);
    const role = roleRow.role as 'admin' | 'assistant';

    let body: any = {};
    if (req.method === 'POST') { try { body = await req.json(); } catch { body = {} } }
    const action = body.action || 'list';

    // ─── LIST (admin + assistant) ────────────────────────────────────────
    if (action === 'list') {
      const statuses = body.statuses || ['ready', 'generating', 'posted', 'approved'];
      const { data, error } = await admin
        .from('creative_queue')
        .select('id, batch_date, kind, intended_use, occasion, persuasion_angle, concept, headline, primary_text, caption, hashtags, score, status, media_url, error, ghl_post_id, created_at, posted_at')
        .in('status', statuses)
        .order('created_at', { ascending: false })
        .limit(body.limit || 60);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, role, creatives: data || [] });
    }

    // ─── Live promo box: read (admin + assistant) ────────────────────────
    if (action === 'get_config') {
      const { data: cfg } = await admin.from('creative_studio_config').select('promo_notes, style_notes').eq('id', 1).single();
      return json({ success: true, role, promo_notes: cfg?.promo_notes || '', style_notes: cfg?.style_notes || '' });
    }

    // ─── Live promo box: save (admin only) ───────────────────────────────
    if (action === 'save_promo') {
      if (role !== 'admin') return json({ success: false, error: 'Admins only' }, 403);
      const promo = String(body.promo_notes ?? '').slice(0, 2000);
      const { error } = await admin.from('creative_studio_config')
        .update({ promo_notes: promo, updated_at: new Date().toISOString() }).eq('id', 1);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, promo_notes: promo });
    }

    // ─── Mutations (admin only) ──────────────────────────────────────────
    if (role !== 'admin') return json({ success: false, error: 'Admins only' }, 403);
    if (!body.id) return json({ success: false, error: 'Missing id' }, 400);

    if (action === 'reject') {
      const { error } = await admin.from('creative_queue')
        .update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', body.id);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, id: body.id, status: 'rejected' });
    }

    // ─── Edit the copy before approving (admin only) ─────────────────────
    // Changes the TEXT that gets posted (caption/headline/body/hashtags). Does
    // NOT re-render the words baked into the image — for that use request_changes.
    if (action === 'update') {
      const patch: any = { updated_at: new Date().toISOString() };
      if (body.headline !== undefined) patch.headline = String(body.headline ?? '').slice(0, 300) || null;
      if (body.primary_text !== undefined) patch.primary_text = String(body.primary_text ?? '').slice(0, 2000) || null;
      if (body.caption !== undefined) patch.caption = String(body.caption ?? '').slice(0, 2200) || null;
      if (body.hashtags !== undefined) patch.hashtags = Array.isArray(body.hashtags)
        ? body.hashtags.map((h: string) => String(h).replace(/^#/, '').trim()).filter(Boolean).slice(0, 30)
        : null;
      const { data, error } = await admin.from('creative_queue')
        .update(patch).eq('id', body.id)
        .select('id, headline, primary_text, caption, hashtags').single();
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, id: body.id, creative: data });
    }

    // ─── Request a design change → redesign (admin only) ─────────────────
    // Forwards to creative-chat's deterministic tweak engine, which regenerates
    // the creative with the owner's instructions as a NEW queued version.
    if (action === 'request_changes') {
      const instr = String(body.change_instructions || '').trim();
      if (!instr) return json({ success: false, error: 'Describe what to change' }, 400);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/creative-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ action: 'tweak', creative_id: body.id, change_instructions: instr }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.success) return json({ success: false, error: out.error || `creative-chat ${res.status}` }, 502);
      return json({ success: true, id: body.id, note: out.message, generated: out.generated || [] });
    }

    if (action === 'approve') {
      const { data: c, error: cErr } = await admin.from('creative_queue').select('*').eq('id', body.id).single();
      if (cErr || !c) return json({ success: false, error: 'Creative not found' }, 404);
      if (c.status !== 'ready') return json({ success: false, error: `Not approvable (status=${c.status})` }, 409);
      if (!c.media_url) return json({ success: false, error: 'No media to post' }, 409);

      const approvedAt = new Date().toISOString();

      // Respect the pause switch — record approval but hold posting.
      const { data: state } = await admin.from('social_pipeline_state').select('enabled').eq('id', 1).single();
      const posting = Deno.env.get('SOCIAL_CLIPS_ENABLED') !== 'false' && (state ? !!state.enabled : true);
      if (!posting) {
        await admin.from('creative_queue').update({ status: 'approved', approved_at: approvedAt, updated_at: approvedAt }).eq('id', c.id);
        return json({ success: true, id: c.id, status: 'approved', posted: false, note: 'Posting is paused — approved but not published.' });
      }
      if (!GHL_API_TOKEN || !GHL_LOCATION_ID) return json({ success: false, error: 'GHL not configured' }, 500);

      // Post to every connected account (one scheduled feed post each).
      const accounts = await listConnectedAccounts();
      if (!accounts.length) return json({ success: false, error: 'No connected GHL accounts' }, 502);

      const caption = fullCaption(c);
      // Owner can schedule a specific time (body.schedule_date, ISO); GHL needs a
      // future time, so we floor at ~2 min out. Default = the 15-min buffer.
      const reqTs = body.schedule_date ? Date.parse(body.schedule_date) : NaN;
      const base = (Number.isFinite(reqTs) && reqTs > Date.now() + 120_000)
        ? reqTs : (Date.now() + FEED_SCHEDULE_DELAY_SECONDS * 1000);
      const results: Record<string, string | null> = {};
      let firstId: string | null = null;
      const errs: string[] = [];
      for (let i = 0; i < accounts.length; i++) {
        const scheduleDate = new Date(base + i * 30_000).toISOString();
        const r = await ghlPost(accounts[i].id, caption, c.media_url, c.kind, scheduleDate);
        results[accounts[i].platform] = r.id;
        if (r.id && !firstId) firstId = r.id;
        if (r.error) errs.push(`${accounts[i].platform}:${r.error}`);
      }

      if (!firstId) {
        await admin.from('creative_queue').update({ status: 'approved', approved_at: approvedAt, error: errs.join(' | ').slice(0, 500), updated_at: approvedAt }).eq('id', c.id);
        return json({ success: false, id: c.id, status: 'approved', posted: false, error: `All posts failed: ${errs.join(' | ')}` }, 502);
      }

      await admin.from('creative_queue').update({
        status: 'posted', approved_at: approvedAt, posted_at: new Date().toISOString(),
        ghl_post_id: firstId, error: errs.length ? errs.join(' | ').slice(0, 500) : null, updated_at: new Date().toISOString(),
      }).eq('id', c.id);

      await admin.from('agent_runs').insert({
        agent: 'creative-studio', status: 'ok', ok: true,
        summary: `Approved + posted creative ${c.id} (${c.kind})`, payload: { id: c.id, results },
        finished_at: new Date().toISOString(),
      }).then(() => {}, () => {});

      return json({ success: true, id: c.id, status: 'posted', posted: true, ghl_post_id: firstId, results });
    }

    return json({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error('creative-studio-admin error:', err);
    return json({ success: false, error: String((err as Error)?.message || err) }, 500);
  }
});
