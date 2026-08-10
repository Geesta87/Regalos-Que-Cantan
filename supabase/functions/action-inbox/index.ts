// supabase/functions/action-inbox/index.ts
// ===========================================================================
// ACTION INBOX — the unified approval queue behind the admin home tab
// ===========================================================================
// READ-ONLY aggregator. Pulls every "waiting on the owner" item from the
// existing agent/pipeline tables into one ranked list:
//
//   - SEO campaign proposed tasks      (seo_plan_tasks.status = 'proposed')
//   - Chief of Staff staged actions    (cos_pending_actions.status = 'pending')
//   - CoS drafted emails               (email_queue.status = 'pending_approval')
//   - Fix Song candidates to release   (song_fix_requests.status = 'awaiting_approval')
//   - Animado likeness / final gates   (story_video_orders.state)
//   - Animado paid-but-no-photo stalls (chargeback risk — no auto-refund path)
//   - Paid songs not yet WhatsApp'd    (isPaidSong + whatsapp_phone + !whatsapp_sent_at)
//   - Paid songs stuck generating      (isPaidSong + no audio 30min after creation)
//   - Slideshow videos paid, no photos (video_orders)
//   - Recent hot leads (approximate)   (unpaid songs w/ phone, last 72h)
//
// CS reply drafts (SMS/WhatsApp) are deliberately NOT aggregated here —
// owner decision 2026-08-10: message review stays inside the SMS tab only.
//
// This function never mutates anything. Approvals are executed by the frontend
// calling the SAME existing endpoints the per-agent tabs already use
// (seo-coach approve_task, cos-assistant confirm_action, ...), so every
// approval path stays single-sourced and the per-agent tabs remain the
// source of truth for deep review.
//
// Admin-only (verify_jwt = true + admin_users gate, same as seo-coach).
// Deploy: supabase functions deploy action-inbox --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isPaidSong, PAID_FIELDS } from '../_shared/is-paid.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

type Item = {
  key: string;               // stable id for client-side dismissals
  source: string;            // which agent/pipeline produced it
  severity: 'critical' | 'high' | 'normal';
  title: string;
  detail: string;
  created_at: string | null;
  nav: string;               // dashboard tab this item lives in
  // When present, the card gets one-tap Approve/Reject wired to an EXISTING
  // endpoint. { fn, approve: {...body}, reject?: {...body} }
  approve?: Record<string, unknown>;
};

const hoursAgo = (iso: string | null | undefined) =>
  iso ? (Date.now() - new Date(iso).getTime()) / 36e5 : 0;
const short = (s: string | null | undefined, n = 140) =>
  (s || '').length > n ? `${(s || '').slice(0, n - 1)}…` : (s || '');

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    // --- Admin gate (same as seo-coach / ads-coach / cos-assistant) ---
    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: ud, error: ue } = await userClient.auth.getUser();
    if (ue || !ud?.user) return json({ success: false, error: 'Invalid session' }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin.from('admin_users').select('role').eq('user_id', ud.user.id).single();
    if (!roleRow || roleRow.role !== 'admin') return json({ success: false, error: 'Admins only' }, 403);

    // Every source is fetched in parallel; a failing source degrades to empty
    // rather than blanking the whole inbox (the card list must always load).
    const soft = async <T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> => {
      try { const { data, error } = await p; return error ? null : data; } catch { return null; }
    };

    const paidFilter = (q: any) => q
      .not('paid_at', 'is', null)
      .or('paid.eq.true,payment_status.eq.paid')
      .or('amount_paid.gt.0,stripe_payment_id.not.is.null,marked_paid_at.not.is.null');

    const [
      seoTasks, cosActions, cosEmails, fixReady,
      animado, pendingWa, stuckPaid, videosNoPhotos, hotLeads,
    ] = await Promise.all([
      soft(admin.from('seo_plan_tasks')
        .select('id, title, task_type, target_path, rationale, created_at')
        .eq('status', 'proposed').order('created_at', { ascending: false }).limit(15)),
      soft(admin.from('cos_pending_actions')
        .select('id, action_type, target_name, summary, created_at')
        .eq('status', 'pending').order('created_at', { ascending: false }).limit(15)),
      soft(admin.from('email_queue')
        .select('id, subject, reason, created_at')
        .eq('status', 'pending_approval').order('created_at', { ascending: false }).limit(10)),
      soft(admin.from('song_fix_requests')
        .select('id, customer_request, candidate_summary, created_at')
        .eq('status', 'awaiting_approval').order('created_at', { ascending: false }).limit(15)),
      soft(admin.from('story_video_orders')
        .select('id, state, created_at, updated_at, amount_cents, customer_phone, photo_reminder_count')
        .in('state', ['likeness_review', 'final_review', 'awaiting_photo'])
        .order('created_at', { ascending: true }).limit(30)),
      soft(paidFilter(admin.from('songs')
        .select(`id, recipient_name, sender_name, created_at, ${PAID_FIELDS}`)
        .not('whatsapp_phone', 'is', null).not('audio_url', 'is', null)
        .is('whatsapp_sent_at', null).is('admin_dismissed_at', null))
        .order('paid_at', { ascending: false }).limit(30)),
      soft(paidFilter(admin.from('songs')
        .select(`id, recipient_name, status, error_message, created_at, ${PAID_FIELDS}`)
        .is('audio_url', null)
        .lt('created_at', new Date(Date.now() - 30 * 60e3).toISOString()))
        .order('created_at', { ascending: false }).limit(20)),
      soft(admin.from('video_orders')
        .select('id, song_id, paid_at, amount_cents, photo_count, status, created_at')
        .eq('paid', true).or('photo_count.eq.0,photo_count.is.null')
        .is('video_url', null).not('admin_dismissed', 'is', true)
        .order('created_at', { ascending: false }).limit(300)),
      soft(admin.from('songs')
        .select('id, recipient_name, sender_name, genre, created_at')
        .is('paid_at', null).not('whatsapp_phone', 'is', null)
        .not('recipient_name', 'is', null).not('email', 'is', null)
        .is('whatsapp_sent_at', null).is('admin_dismissed_at', null)
        .gt('created_at', new Date(Date.now() - 72 * 36e5).toISOString())
        .order('created_at', { ascending: false }).limit(50)),
    ]);

    const items: Item[] = [];

    // --- Paid but stuck generating: the customer paid and has NOTHING. -----
    for (const s of (stuckPaid || []).filter((s: any) => isPaidSong(s))) {
      items.push({
        key: `stuck:${s.id}`, source: 'Order pipeline', severity: 'critical',
        title: `Paid song for ${s.recipient_name || 'customer'} has no audio (${Math.round(hoursAgo(s.created_at))}h)`,
        detail: `Status "${s.status || 'unknown'}"${s.error_message ? ` — ${short(s.error_message, 90)}` : ''}. Paid order with nothing to deliver; open Orders to retry or recover.`,
        created_at: s.created_at, nav: 'orders',
      });
    }

    // --- Animado paid-awaiting-photo (chargeback risk) + review gates. -----
    for (const o of animado || []) {
      const age = hoursAgo(o.created_at);
      if (o.state === 'awaiting_photo') {
        if (age < 48) continue; // reminder crons are still working on it
        items.push({
          key: `animado_photo:${o.id}`, source: 'Animado', severity: 'critical',
          title: `Animado order paid $${((o.amount_cents || 0) / 100).toFixed(0)} — no photo after ${Math.round(age / 24)}d`,
          detail: `${o.photo_reminder_count || 0} reminder(s) sent${o.customer_phone ? ` to ${o.customer_phone}` : ''}. No auto-refund exists for this state — decide: chase once more or refund before it becomes a chargeback.`,
          created_at: o.created_at, nav: 'animado',
        });
      } else {
        items.push({
          key: `animado_${o.state}:${o.id}`, source: 'Animado', severity: 'high',
          title: o.state === 'likeness_review' ? 'Animado: pick the cartoon likeness' : 'Animado: final video ready to approve',
          detail: o.state === 'likeness_review'
            ? 'Two likeness options are waiting — pick one so the build can start.'
            : 'Watch the finished video and approve to deliver it.',
          created_at: o.created_at, nav: 'animado',
        });
      }
    }

    // --- Paid songs waiting for WhatsApp delivery. -------------------------
    for (const s of (pendingWa || []).filter((s: any) => isPaidSong(s))) {
      items.push({
        key: `wa:${s.id}`, source: 'Delivery', severity: 'high',
        title: `Send ${s.recipient_name ? `${s.recipient_name}'s` : 'a'} paid song by WhatsApp`,
        detail: `Paid ${Math.round(hoursAgo(s.paid_at))}h ago, song is ready, WhatsApp never sent.`,
        created_at: s.paid_at, nav: 'pendingsend',
      });
    }

    // --- Fix Song candidates staged for release. ---------------------------
    for (const r of fixReady || []) {
      items.push({
        key: `fix:${r.id}`, source: 'Fix Song', severity: 'high',
        title: 'Fixed take ready — listen and release',
        detail: short(r.candidate_summary || r.customer_request, 180),
        created_at: r.created_at, nav: 'fixsong',
      });
    }

    // --- Slideshow videos paid but never got photos. -----------------------
    // Recent ones (2-30 days) are actionable chargeback risk → individual
    // cards. The months-old backlog (live check 2026-08-08: ~111 total) is one
    // roll-up card so it stays visible without drowning the inbox.
    const recentNoPhotos = (videosNoPhotos || []).filter((v: any) => {
      const h = hoursAgo(v.created_at); return h >= 48 && h <= 24 * 30;
    }).slice(0, 6);
    const backlogNoPhotos = (videosNoPhotos || []).filter((v: any) => hoursAgo(v.created_at) > 24 * 30).length;
    for (const v of recentNoPhotos) {
      items.push({
        key: `video_photos:${v.id}`, source: 'Video addon', severity: 'critical',
        title: `Slideshow paid $${((v.amount_cents || 0) / 100).toFixed(0)} — customer never uploaded photos (${Math.round(hoursAgo(v.created_at) / 24)}d)`,
        detail: 'Paid, zero photos, nothing delivered. Chase or refund before it disputes.',
        created_at: v.created_at, nav: 'videos',
      });
    }
    if (backlogNoPhotos > 0) {
      items.push({
        key: `video_backlog:${new Date().toISOString().slice(0, 10)}`, source: 'Video addon', severity: 'normal',
        title: `${backlogNoPhotos}+ month-old paid slideshows still have no photos`,
        detail: 'Long-standing fulfillment backlog (paid, never delivered). Decide a policy once: batch-chase, refund, or write off — then clear the list in Videos.',
        created_at: null, nav: 'videos',
      });
    }

    // --- SEO campaign tasks (one-tap approve via seo-coach). ---------------
    for (const t of seoTasks || []) {
      items.push({
        key: `seo:${t.id}`, source: 'SEO Coach', severity: 'normal',
        title: t.title || 'SEO task proposed',
        detail: `${t.target_path ? `${t.target_path} — ` : ''}${short(t.rationale, 180)}`,
        created_at: t.created_at, nav: 'seocoach',
        approve: {
          fn: 'seo-coach',
          approve: { action: 'approve_task', task_id: t.id },
          reject: { action: 'reject_task', task_id: t.id },
        },
      });
    }

    // --- Chief of Staff staged actions + drafted emails. -------------------
    for (const a of cosActions || []) {
      items.push({
        key: `cos:${a.id}`, source: 'Chief of Staff', severity: 'normal',
        title: `Sofía staged: ${a.target_name || a.action_type}`,
        detail: short(a.summary, 200),
        created_at: a.created_at, nav: 'chiefofstaff',
        approve: { fn: 'cos-assistant', approve: { action: 'confirm_action', id: a.id } },
      });
    }
    for (const e of cosEmails || []) {
      items.push({
        key: `cos_email:${e.id}`, source: 'Chief of Staff', severity: 'normal',
        title: `Email drafted: ${short(e.subject, 80)}`,
        detail: `${short(e.reason, 140)} Review and send from the Chief of Staff tab.`,
        created_at: e.created_at, nav: 'chiefofstaff',
      });
    }

    // --- Hot leads roll-up (single summary card, not one per lead). --------
    const leadCount = (hotLeads || []).length;
    if (leadCount > 0) {
      const newest = hotLeads![0];
      items.push({
        key: `hotleads:${new Date().toISOString().slice(0, 10)}`, source: 'Hot leads', severity: 'normal',
        title: `~${leadCount} recent lead${leadCount === 1 ? '' : 's'} with a phone number, not yet contacted`,
        detail: `Newest: song for ${newest.recipient_name || '—'} (${newest.genre || 'unknown genre'}), ${Math.round(hoursAgo(newest.created_at))}h ago. Open Hot Leads to work the list.`,
        created_at: newest.created_at, nav: 'hotleads',
      });
    }

    const rank = { critical: 0, high: 1, normal: 2 } as const;
    items.sort((a, b) => rank[a.severity] - rank[b.severity]
      || new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());

    return json({ success: true, items, generated_at: new Date().toISOString() });
  } catch (e: any) {
    return json({ success: false, error: String(e?.message || e) }, 500);
  }
});
