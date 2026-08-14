// supabase/functions/generate-cuento/index.ts
// Deploy with: supabase functions deploy generate-cuento --project-ref yzbvajungshqcpusfiia
//
// Cuento Ilustrado — illustrated storybook of a song's own lyrics (test phase).
// Each page = one stanza of the customer's song, illustrated with identity-
// consistent characters (Character Studio recipe: nano-banana anchor →
// nano-banana-edit pages with the anchor as reference).
//
// Actions (single POST body {action, ...}):
//   find    {query}      admin — search paid-ish songs by recipient/email
//   list    {}           admin — 10 most recent cuentos with song names
//   generate{songId}     admin — plan stanzas+scenes with Claude, fire anchor
//   status  {cuentoId}   admin — poll Kie, rehost finished pages, advance state
//   public  {token}      anon  — sanitized book data for /cuento/:token
//
// Called ONLY from our own frontend (admin JWT or anon key) → verify_jwt = true
// stays ON at the gateway; the in-handler gate below additionally requires an
// admin_users row for everything except 'public'. No external callbacks: Kie
// jobs are POLLED via 'status' (no callBackUrl), same as character-studio.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const KIE_API_KEY = Deno.env.get('KIE_API_KEY');

const KIE = 'https://api.kie.ai/api/v1/jobs';
const BUCKET = 'cuentos';
const IMAGE_MODEL = 'google/nano-banana';
const IMAGE_EDIT_MODEL = 'google/nano-banana-edit';
const PLAN_MODEL = 'claude-opus-4-8';
const PLAN_FALLBACK = 'claude-sonnet-4-6';
const MAX_PAGES = 7; // stanza pages, plus the cover
const STUCK_MINUTES = 30;

// House rule: every image prompt states authentic Mexican/Latino people and
// keeps adults in the 30-40 range unless the story says otherwise.
const STYLE = 'Pixar-style 3D animated storybook illustration, warm cinematic palette of terracotta, marigold and deep teal. Authentic Mexican/Latino people. No text, no words, no letters anywhere in the image.';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (obj: unknown, code = 200) =>
  new Response(JSON.stringify(obj), { status: code, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function shareToken(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Kie helpers (character-studio pattern)
// ---------------------------------------------------------------------------
async function kieCreate(model: string, input: Record<string, unknown>): Promise<string> {
  const r = await fetch(`${KIE}/createTask`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input }),
  });
  const j = await r.json().catch(() => ({}));
  const id = j?.data?.taskId || j?.taskId;
  if (!id) throw new Error(`Kie createTask failed (${r.status}): ${JSON.stringify(j).slice(0, 200)}`);
  return id;
}

async function kieStatus(taskId: string): Promise<{ state: string; url?: string; failMsg?: string }> {
  const r = await fetch(`${KIE}/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${KIE_API_KEY}` },
  });
  const info = await r.json().catch(() => ({}));
  const state = info?.data?.state || 'unknown';
  if (state === 'success') {
    const result = JSON.parse(info.data.resultJson || '{}');
    return { state, url: (result.resultUrls || [])[0] };
  }
  if (state === 'fail' || info?.data?.failCode) {
    return { state: 'fail', failMsg: info?.data?.failMsg || 'unknown Kie failure' };
  }
  return { state };
}

// Kie result URLs expire — rehost into our public bucket immediately.
async function rehost(admin: any, kieUrl: string, path: string): Promise<string> {
  const media = await fetch(kieUrl);
  if (!media.ok) throw new Error(`media fetch ${media.status}`);
  const bytes = new Uint8Array(await media.arrayBuffer());
  const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/png', upsert: true });
  if (up.error) throw up.error;
  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  return pub.publicUrl;
}

// ---------------------------------------------------------------------------
// Claude plan: split the lyrics into stanzas + write one scene per stanza
// ---------------------------------------------------------------------------
const PLAN_TOOL = {
  name: 'submit_cuento_plan',
  description: 'Submit the storybook plan built from the song lyrics.',
  input_schema: {
    type: 'object',
    properties: {
      character_sheet: {
        type: 'string',
        description: 'Reusable visual description (in English) of the main character(s): age, skin tone, hair, clothing. Authentic Mexican/Latino people. Adults 30-40 unless the story clearly says otherwise (e.g. a song for a child or grandmother).',
      },
      cover_scene: { type: 'string', description: 'Scene description (English) for the book cover: the main character(s) in an emblematic moment of the story. No text in the image.' },
      title: { type: 'string', description: 'Short book title in Spanish, e.g. "Nuestra Canción" or using the recipient name.' },
      pages: {
        type: 'array',
        description: `${MAX_PAGES} pages maximum. Each page pairs one stanza of the ORIGINAL lyrics (verbatim, minus section tags) with an illustration scene.`,
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The stanza text VERBATIM from the lyrics (Spanish), without [Verso]/[Coro] style tags. 2-6 lines. Never rewrite or summarize the lyrics.' },
            scene: { type: 'string', description: 'Illustration scene in English matching this stanza\'s THEME (not just the genre). Concrete setting, action, emotion. The characters from the character sheet. No text in the image.' },
          },
          required: ['text', 'scene'],
        },
      },
    },
    required: ['character_sheet', 'cover_scene', 'title', 'pages'],
  },
};

async function planCuento(song: any): Promise<any> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const user = [
    `Song lyrics (Spanish):\n${String(song.lyrics || '').slice(0, 6000)}`,
    `Recipient: ${song.recipient_name || 'unknown'} · From: ${song.sender_name || 'unknown'} · Occasion: ${song.occasion || 'unknown'} · Genre: ${song.genre || 'unknown'}`,
    song.details ? `Customer's story details (context only — the page TEXT must come from the lyrics):\n${String(song.details).slice(0, 2000)}` : '',
    `Build an illustrated storybook plan: pick the ${MAX_PAGES} most narrative stanzas (keep story order, always include the emotional climax and the closing stanza), pair each with a scene. If the song addresses a mother/child/friend rather than a couple, reflect that in the character sheet — never assume romance.`,
  ].filter(Boolean).join('\n\n');

  for (let attempt = 1; attempt <= 2; attempt++) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: attempt === 2 ? PLAN_FALLBACK : PLAN_MODEL,
        max_tokens: 3000,
        tools: [PLAN_TOOL],
        tool_choice: { type: 'tool', name: 'submit_cuento_plan' },
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!resp.ok) continue;
    const data = await resp.json();
    const block = (data?.content || []).find((b: any) => b?.type === 'tool_use' && b.name === 'submit_cuento_plan');
    if (block?.input?.pages?.length) return block.input;
  }
  throw new Error('Claude plan failed after 2 attempts');
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');

    // ── Public read: no admin gate, token is the credential ────────────────
    if (action === 'public') {
      const token = String(body.token || '').trim();
      if (!token || token.length < 12) return json({ success: false, error: 'Cuento no encontrado' }, 404);
      const { data: c } = await admin.from('cuentos')
        .select('id, status, stanzas, cover_url, page_urls, dedication, song_id, kie_tasks')
        .eq('share_token', token).maybeSingle();
      if (!c || c.status !== 'ready') return json({ success: false, error: 'Cuento no encontrado' }, 404);
      const { data: song } = await admin.from('songs')
        .select('audio_url, recipient_name, sender_name').eq('id', c.song_id).single();
      return json({
        success: true,
        cuento: {
          title: (c.kie_tasks as any)?.title || 'Nuestra Canción',
          stanzas: c.stanzas, cover_url: c.cover_url, page_urls: c.page_urls,
          dedication: c.dedication || null,
          audio_url: song?.audio_url || null,
          recipient_name: song?.recipient_name || '', sender_name: song?.sender_name || '',
        },
      });
    }

    // ── Admin gate (fix-song-section pattern): service-role key OR a logged-
    // in admin_users session. Everything below spends credits or reads PII.
    const authHeader = req.headers.get('Authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (bearer !== SERVICE_KEY) {
      if (!bearer) return json({ success: false, error: 'Missing Authorization header' }, 401);
      const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData?.user) return json({ success: false, error: 'Invalid session — sign in to the admin dashboard again.' }, 401);
      const { data: roleRow } = await admin.from('admin_users').select('role').eq('user_id', userData.user.id).single();
      if (!roleRow) return json({ success: false, error: 'No admin access' }, 403);
    }

    if (!KIE_API_KEY) throw new Error('KIE_API_KEY not set');

    // ── find: search songs to test with ────────────────────────────────────
    if (action === 'find') {
      const q = String(body.query || '').trim().replace(/[,()%]/g, '');
      if (q.length < 2) return json({ success: false, error: 'Query too short' });
      const { data: rows, error } = await admin.from('songs')
        .select('id, recipient_name, sender_name, email, genre, occasion, created_at, audio_url, lyrics')
        .or(`recipient_name.ilike.%${q}%,email.ilike.%${q}%`)
        .not('audio_url', 'is', null).not('lyrics', 'is', null)
        .order('created_at', { ascending: false }).limit(10);
      if (error) throw error;
      return json({
        success: true,
        songs: (rows || []).map((s: any) => ({
          id: s.id, recipient_name: s.recipient_name, sender_name: s.sender_name,
          email: s.email, genre: s.genre, occasion: s.occasion, created_at: s.created_at,
        })),
      });
    }

    // ── list: recent cuentos ───────────────────────────────────────────────
    if (action === 'list') {
      const { data: rows } = await admin.from('cuentos')
        .select('id, song_id, status, share_token, cover_url, page_urls, stanzas, error, created_at, kie_tasks')
        .order('created_at', { ascending: false }).limit(10);
      const songIds = [...new Set((rows || []).map((r: any) => r.song_id))];
      const { data: songRows } = songIds.length
        ? await admin.from('songs').select('id, recipient_name, email').in('id', songIds)
        : { data: [] };
      const names = new Map((songRows || []).map((s: any) => [s.id, s]));
      return json({
        success: true,
        cuentos: (rows || []).map((r: any) => ({
          id: r.id, status: r.status, share_token: r.share_token, cover_url: r.cover_url,
          pages_done: (r.page_urls || []).filter(Boolean).length, pages_total: (r.stanzas || []).length,
          title: (r.kie_tasks as any)?.title || null, error: r.error, created_at: r.created_at,
          recipient_name: names.get(r.song_id)?.recipient_name || '?', email: names.get(r.song_id)?.email || '',
        })),
      });
    }

    // ── generate: plan + fire the anchor (cover) ───────────────────────────
    if (action === 'generate') {
      const songId = String(body.songId || '');
      if (!songId) return json({ success: false, error: 'Missing songId' });
      const { data: song, error: songErr } = await admin.from('songs')
        .select('id, lyrics, details, audio_url, recipient_name, sender_name, occasion, genre')
        .eq('id', songId).single();
      if (songErr || !song) return json({ success: false, error: 'Song not found' });
      if (!song.lyrics || !song.audio_url) return json({ success: false, error: 'Song has no lyrics or audio yet' });

      const plan = await planCuento(song);
      const pages = (plan.pages || []).slice(0, MAX_PAGES);
      const coverPrompt = `${STYLE} Storybook cover art. Characters: ${plan.character_sheet} Scene: ${plan.cover_scene} Soft empty space at the top of the frame.`;
      const anchorTask = await kieCreate(IMAGE_MODEL, { prompt: coverPrompt, aspect_ratio: '3:4', output_format: 'png' });

      const { data: row, error: insErr } = await admin.from('cuentos').insert({
        song_id: song.id, status: 'generating', share_token: shareToken(),
        character_sheet: plan.character_sheet,
        stanzas: pages.map((p: any, i: number) => ({ n: i + 1, text: p.text, scene: p.scene })),
        kie_tasks: { anchor: anchorTask, pages: {}, retries: {}, title: plan.title || 'Nuestra Canción' },
        page_urls: pages.map(() => null),
      }).select().single();
      if (insErr) throw insErr;
      return json({ success: true, cuento: { id: row.id, status: row.status, share_token: row.share_token } });
    }

    // ── status: poll Kie, rehost, advance the state machine ────────────────
    if (action === 'status') {
      const cuentoId = String(body.cuentoId || '');
      if (!cuentoId) return json({ success: false, error: 'Missing cuentoId' });
      const { data: c } = await admin.from('cuentos').select('*').eq('id', cuentoId).single();
      if (!c) return json({ success: false, error: 'Cuento not found' });

      const tasks = (c.kie_tasks || {}) as any;
      const stanzas = (c.stanzas || []) as any[];
      let pageUrls = [...((c.page_urls || []) as (string | null)[])];
      let coverUrl = c.cover_url as string | null;
      let status = c.status as string;
      let error: string | null = c.error;
      const touch = { updated_at: new Date().toISOString() };

      const ageMin = (Date.now() - new Date(c.created_at).getTime()) / 60000;

      if (status === 'generating') {
        // 1) Anchor first: when the cover lands, rehost it and fire the pages
        //    off it (the cover IS the identity reference for every page).
        if (!coverUrl && tasks.anchor) {
          const st = await kieStatus(tasks.anchor);
          if (st.state === 'success' && st.url) {
            coverUrl = await rehost(admin, st.url, `${c.id}/cover.png`);
            for (let i = 0; i < stanzas.length; i++) {
              const prompt = `Keep the EXACT same characters and art style as the reference image. ${STYLE} Characters: ${c.character_sheet} Scene: ${stanzas[i].scene}`;
              tasks.pages[String(i)] = await kieCreate(IMAGE_EDIT_MODEL, {
                prompt, image_urls: [coverUrl], aspect_ratio: '3:4', output_format: 'png',
              });
            }
          } else if (st.state === 'fail') {
            status = 'failed'; error = `cover: ${st.failMsg}`;
          }
        } else if (coverUrl) {
          // 2) Pages: rehost each as it lands; one free retry per page (Kie
          //    failures cost 0 credits).
          for (let i = 0; i < stanzas.length; i++) {
            if (pageUrls[i]) continue;
            const tid = tasks.pages[String(i)];
            if (!tid) continue;
            const st = await kieStatus(tid);
            if (st.state === 'success' && st.url) {
              pageUrls[i] = await rehost(admin, st.url, `${c.id}/page${i + 1}.png`);
            } else if (st.state === 'fail') {
              const tries = Number(tasks.retries[String(i)] || 0);
              if (tries < 2) {
                tasks.retries[String(i)] = tries + 1;
                const prompt = `Keep the EXACT same characters and art style as the reference image. ${STYLE} Characters: ${c.character_sheet} Scene: ${stanzas[i].scene}`;
                tasks.pages[String(i)] = await kieCreate(IMAGE_EDIT_MODEL, {
                  prompt, image_urls: [coverUrl], aspect_ratio: '3:4', output_format: 'png',
                });
              } else {
                status = 'failed'; error = `page ${i + 1}: ${st.failMsg}`;
              }
            }
          }
          if (status === 'generating' && pageUrls.length && pageUrls.every(Boolean)) status = 'ready';
        }
        if (status === 'generating' && ageMin > STUCK_MINUTES) { status = 'failed'; error = `stuck > ${STUCK_MINUTES}m`; }
        await admin.from('cuentos').update({
          ...touch, status, error, cover_url: coverUrl, page_urls: pageUrls, kie_tasks: tasks,
        }).eq('id', c.id);
      }

      return json({
        success: true,
        cuento: {
          id: c.id, status, error, share_token: c.share_token, cover_url: coverUrl,
          pages_done: pageUrls.filter(Boolean).length, pages_total: stanzas.length,
          title: tasks.title || null,
        },
      });
    }

    return json({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (e: any) {
    console.error('generate-cuento error:', e);
    return json({ success: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});
