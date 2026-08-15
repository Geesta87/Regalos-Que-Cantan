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

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

const KIE = 'https://api.kie.ai/api/v1/jobs';
const BUCKET = 'cuentos';
const IMAGE_MODEL = 'google/nano-banana';
const IMAGE_EDIT_MODEL = 'google/nano-banana-edit';
const VIDEO_MODEL = 'bytedance/seedance-2';
const PLAN_MODEL = 'claude-opus-4-8';
const PLAN_FALLBACK = 'claude-sonnet-4-6';
const MAX_PAGES = 10; // stanza pages (incl. up to 2 quiet art-only), plus the cover
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
async function rehost(admin: any, kieUrl: string, path: string, contentType = 'image/png'): Promise<string> {
  const media = await fetch(kieUrl);
  if (!media.ok) throw new Error(`media fetch ${media.status}`);
  const bytes = new Uint8Array(await media.arrayBuffer());
  const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (up.error) throw up.error;
  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  return pub.publicUrl;
}

async function uploadBytes(admin: any, bytes: Uint8Array, path: string, contentType: string): Promise<string> {
  const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (up.error) throw up.error;
  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  return pub.publicUrl;
}

// ---------------------------------------------------------------------------
// Likeness: real photo → Pixar-style character portrait. gpt-image-2, the
// PROVEN Animado recipe (generate-likeness, verified 2026-06-26) — Kie's
// nano-banana-edit cannot change art style (the CENZO lesson), so the style
// jump happens here and nano-banana-edit then keeps THESE characters across
// pages. OpenAI rejects "transform this person" phrasing: DESCRIBE a stylized
// portrait of "the person in the reference photo" and retry softer on rejects.
// ---------------------------------------------------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LIKENESS_PROMPT =
  'A warm Disney/Pixar-style 3D ANIMATED CARTOON character portrait of the person(s) in the reference photo. Fully stylized 3D animation, NOT photorealistic. Big expressive eyes, smooth rounded stylized features, soft cel-like shading, the bright polished Pixar/Disney movie look (like Encanto/Coco). Faithful, recognizable likeness — same face shape, hair, age and clothing. Soft warm lighting, simple cozy background.';

async function gptCartoonOnce(blob: Blob, prompt: string): Promise<Uint8Array | null> {
  const fd = new FormData();
  fd.append('model', 'gpt-image-2');
  fd.append('prompt', prompt.slice(0, 4000));
  fd.append('size', '1024x1536');
  fd.append('quality', 'medium');
  fd.append('n', '1');
  fd.append('image[]', blob, 'photo.png');
  const r = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, body: fd,
  });
  const txt = await r.text();
  let j: any; try { j = JSON.parse(txt); } catch { return null; }
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) { console.log(`gptCartoon reject: ${j?.error?.message?.slice(0, 100) || r.status}`); return null; }
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function gptCartoon(photoUrl: string): Promise<Uint8Array> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
  const ref = await fetch(photoUrl);
  if (!ref.ok) throw new Error(`ref fetch ${ref.status}`);
  const blob = await ref.blob();
  const softer = `${LIKENESS_PROMPT} This is a wholesome, family-friendly stylized illustration.`;
  for (const p of [LIKENESS_PROMPT, softer, softer]) {
    const out = await gptCartoonOnce(blob, p);
    if (out) return out;
    await sleep(2000);
  }
  throw new Error('OpenAI rejected the likeness after retries');
}

// ---------------------------------------------------------------------------
// Stanza timings — when each page's stanza starts being SUNG, so the reader
// can turn pages in sync with the song. Kie's get-timestamped-lyrics ALIGNS
// the submitted sheet (fine for TIMING, never proof of wording — house rule).
// Missing task/audio ids, purged sources, or failed matches all degrade to
// null → the reader falls back to even pacing. Never blocks generation.
// ---------------------------------------------------------------------------
const normWord = (w: string) =>
  String(w || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]/g, '');

// Returns per-stanza {startS, lines:[{text, startS}]} — line-level so the
// reader can highlight each lyric line the moment it is sung (karaoke).
async function stanzaTimings(
  song: any,
  stanzas: { text: string }[],
): Promise<{ startS: number | null; lines: { text: string; startS: number | null }[] }[]> {
  const fallback = stanzas.map((st) => ({
    startS: null,
    lines: String(st.text).split(/\n+/).map((t) => t.trim()).filter(Boolean).map((t) => ({ text: t, startS: null })),
  }));
  try {
    const audioId = (song.kie_payload as any)?.id;
    if (!song.kie_task_id || !audioId) return fallback;
    const r = await fetch('https://api.kie.ai/api/v1/generate/get-timestamped-lyrics', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: song.kie_task_id, audioId }),
    });
    const j = await r.json().catch(() => ({}));
    const aligned = j?.data?.alignedWords || j?.data?.aligned_words || [];
    // One atom per sung word; section tags ("[Coro]") never match normWord.
    const atoms = aligned
      .map((w: any) => ({
        n: normWord(w.word),
        s: Number(w.startS ?? w.start_s ?? w.start),
      }))
      .filter((a: any) => a.n && Number.isFinite(a.s));
    if (atoms.length < 10) return fallback;

    let cursor = 0; // search forward only, so a repeated chorus maps in order
    const findLine = (text: string): number | null => {
      const tokens = text.split(/\s+/).map(normWord).filter(Boolean).slice(0, 5);
      if (tokens.length < 2) return null;
      for (let i = cursor; i <= atoms.length - tokens.length; i++) {
        let ok = true;
        for (let k = 0; k < tokens.length; k++) {
          if (atoms[i + k].n !== tokens[k]) { ok = false; break; }
        }
        if (ok) { cursor = i + tokens.length; return atoms[i].s; }
      }
      return null;
    };
    return fallback.map((st) => {
      const lines = st.lines.map((ln) => ({ text: ln.text, startS: findLine(ln.text) }));
      const first = lines.find((l) => l.startS !== null);
      return { startS: first ? first.startS : null, lines };
    });
  } catch {
    return fallback;
  }
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
      climax_index: { type: 'integer', description: '0-based index into pages of the emotional CLIMAX page (the moment that would make the recipient cry). Never a quiet page.' },
      pages: {
        type: 'array',
        description: `8-${MAX_PAGES} pages. Each page pairs one stanza of the ORIGINAL lyrics (verbatim, minus section tags) with an illustration scene. Include 1-2 QUIET pages (text = "" — art only, like the wordless spreads in real picture books) at natural musical pauses; never the first or last page.`,
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The stanza text VERBATIM from the lyrics (Spanish), without [Verso]/[Coro] style tags, one sung line per text line. 2-6 lines — or an EMPTY string for a quiet art-only page. Never rewrite or summarize the lyrics.' },
            scene: { type: 'string', description: 'Illustration scene in English matching this stanza\'s THEME (not just the genre). Concrete setting, action, emotion. The characters from the character sheet. No text in the image.' },
          },
          required: ['text', 'scene'],
        },
      },
    },
    required: ['character_sheet', 'cover_scene', 'title', 'climax_index', 'pages'],
  },
};

async function planCuento(song: any, hasPhotos: boolean): Promise<any> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const user = [
    `Song lyrics (Spanish):\n${String(song.lyrics || '').slice(0, 6000)}`,
    `Recipient: ${song.recipient_name || 'unknown'} · From: ${song.sender_name || 'unknown'} · Occasion: ${song.occasion || 'unknown'} · Genre: ${song.genre || 'unknown'}`,
    song.details ? `Customer's story details (context only — the page TEXT must come from the lyrics):\n${String(song.details).slice(0, 2000)}` : '',
    `Build an illustrated storybook plan: pick the 8-${MAX_PAGES} most narrative stanzas (keep story order, always include the emotional climax and the closing stanza), pair each with a scene, add 1-2 quiet art-only pages at natural pauses, and mark the climax page. If the song addresses a mother/child/friend rather than a couple, reflect that in the character sheet — never assume romance.`,
    hasPhotos
      ? 'The characters will be built from the customers\' REAL PHOTOS (already stylized as Pixar characters). The character sheet should describe wardrobe, mood and pairing only — facial features, hair and age come from the reference images, so do not invent them.'
      : '',
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
        .select('id, status, stanzas, cover_url, page_urls, dedication, song_id, kie_tasks, page_videos, real_photo_url')
        .eq('share_token', token).maybeSingle();
      if (!c || c.status !== 'ready') return json({ success: false, error: 'Cuento no encontrado' }, 404);
      const { data: song } = await admin.from('songs')
        .select('audio_url, recipient_name, sender_name').eq('id', c.song_id).single();
      return json({
        success: true,
        cuento: {
          title: (c.kie_tasks as any)?.title || 'Nuestra Canción',
          stanzas: c.stanzas, cover_url: c.cover_url, page_urls: c.page_urls,
          page_videos: c.page_videos || {}, real_photo_url: c.real_photo_url || null,
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
        .select('id, song_id, status, share_token, cover_url, page_urls, stanzas, error, created_at, kie_tasks, page_videos, tier')
        .order('created_at', { ascending: false }).limit(10);
      const songIds = [...new Set((rows || []).map((r: any) => r.song_id))];
      const { data: songRows } = songIds.length
        ? await admin.from('songs').select('id, recipient_name, email').in('id', songIds)
        : { data: [] };
      const names = new Map((songRows || []).map((s: any) => [s.id, s]));
      return json({
        success: true,
        cuentos: (rows || []).map((r: any) => ({
          id: r.id, status: r.status, share_token: r.share_token, cover_url: r.cover_url, tier: r.tier,
          pages_done: (r.page_urls || []).filter(Boolean).length, pages_total: (r.stanzas || []).length,
          videos_done: Object.keys(r.page_videos || {}).length,
          videos_total: Object.keys((r.kie_tasks as any)?.videos || {}).length,
          title: (r.kie_tasks as any)?.title || null, error: r.error, created_at: r.created_at,
          recipient_name: names.get(r.song_id)?.recipient_name || '?', email: names.get(r.song_id)?.email || '',
        })),
      });
    }

    // ── upload-ref: admin uploads a photo (base64) for likeness / final page ─
    if (action === 'upload-ref') {
      const b64 = String(body.b64 || '').replace(/^data:[^,]+,/, '');
      if (!b64 || b64.length > 8_000_000) return json({ success: false, error: 'Missing or oversized image' });
      const contentType = /^data:(image\/(?:jpeg|png|webp))/.exec(String(body.b64 || ''))?.[1] || 'image/jpeg';
      const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const url = await uploadBytes(admin, bytes, `refs/${shareToken()}.${ext}`, contentType);
      return json({ success: true, url });
    }

    // ── generate: plan + likeness (optional) + fire the anchor (cover) ─────
    if (action === 'generate') {
      const songId = String(body.songId || '');
      if (!songId) return json({ success: false, error: 'Missing songId' });
      const photoUrls: string[] = Array.isArray(body.photoUrls) ? body.photoUrls.slice(0, 2).map(String) : [];
      const realPhotoUrl = body.realPhotoUrl ? String(body.realPhotoUrl) : null;
      const { data: song, error: songErr } = await admin.from('songs')
        .select('id, lyrics, details, audio_url, recipient_name, sender_name, occasion, genre, kie_task_id, kie_payload')
        .eq('id', songId).single();
      if (songErr || !song) return json({ success: false, error: 'Song not found' });
      if (!song.lyrics || !song.audio_url) return json({ success: false, error: 'Song has no lyrics or audio yet' });

      const plan = await planCuento(song, photoUrls.length > 0);
      const pages = (plan.pages || []).slice(0, MAX_PAGES);
      const timings = await stanzaTimings(song, pages);
      const refToken = shareToken();

      // Likeness tier: real photos → Pixar cast portraits (gpt-image-2), which
      // then serve as identity references for the cover render.
      const castUrls: string[] = [];
      for (let i = 0; i < photoUrls.length; i++) {
        const bytes = await gptCartoon(photoUrls[i]);
        castUrls.push(await uploadBytes(admin, bytes, `refs/${refToken}_cast${i}.png`, 'image/png'));
      }

      const coverPrompt = castUrls.length
        ? `Keep the EXACT same character(s) from the reference image(s) — same faces, hair, age, features. ${STYLE} Storybook cover art. ${plan.character_sheet} Scene: ${plan.cover_scene} Soft empty space at the top of the frame.`
        : `${STYLE} Storybook cover art. Characters: ${plan.character_sheet} Scene: ${plan.cover_scene} Soft empty space at the top of the frame.`;
      const anchorTask = castUrls.length
        ? await kieCreate(IMAGE_EDIT_MODEL, { prompt: coverPrompt, image_urls: castUrls, aspect_ratio: '3:4', output_format: 'png' })
        : await kieCreate(IMAGE_MODEL, { prompt: coverPrompt, aspect_ratio: '3:4', output_format: 'png' });

      const { data: row, error: insErr } = await admin.from('cuentos').insert({
        song_id: song.id, status: 'generating', share_token: shareToken(),
        tier: castUrls.length ? 'likeness' : 'standard',
        character_sheet: plan.character_sheet,
        stanzas: pages.map((p: any, i: number) => ({
          n: i + 1, text: p.text, scene: p.scene,
          startS: timings[i]?.startS ?? null, lines: timings[i]?.lines ?? [],
        })),
        kie_tasks: {
          anchor: anchorTask, pages: {}, retries: {}, videos: {},
          title: plan.title || 'Nuestra Canción',
          climax: Number.isInteger(plan.climax_index) ? plan.climax_index : null,
          cast: castUrls,
        },
        page_urls: pages.map(() => null),
        real_photo_url: realPhotoUrl,
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
          if (status === 'generating' && pageUrls.length && pageUrls.every(Boolean)) {
            status = 'ready';
            // Book is complete — now breathe life into the key pages: seedance
            // loops (first frame = last frame, the Ace/CENZO trick) for the
            // cover and the climax page. Progressive enhancement: the book is
            // already 'ready'; videos slot in when they land.
            const videoPrompt = 'Subtle gentle cinematic motion: the characters breathe and sway softly, hair and clothing move slightly, light shimmers, background elements drift gently. Keep the exact same scene, characters and art style. Seamless calm loop, no camera cuts.';
            try {
              if (coverUrl && !tasks.videos.cover) {
                tasks.videos.cover = await kieCreate(VIDEO_MODEL, {
                  prompt: videoPrompt, first_frame_url: coverUrl, last_frame_url: coverUrl,
                  resolution: '720p', aspect_ratio: '3:4', duration: 5, generate_audio: false,
                });
              }
              const ci = Number.isInteger(tasks.climax) ? tasks.climax : null;
              if (ci !== null && pageUrls[ci] && !tasks.videos[String(ci)]) {
                tasks.videos[String(ci)] = await kieCreate(VIDEO_MODEL, {
                  prompt: videoPrompt, first_frame_url: pageUrls[ci], last_frame_url: pageUrls[ci],
                  resolution: '720p', aspect_ratio: '3:4', duration: 5, generate_audio: false,
                });
              }
            } catch (e) { console.log('video fire failed (non-fatal):', String(e).slice(0, 120)); }
          }
        }
        if (status === 'generating' && ageMin > STUCK_MINUTES) { status = 'failed'; error = `stuck > ${STUCK_MINUTES}m`; }
        await admin.from('cuentos').update({
          ...touch, status, error, cover_url: coverUrl, page_urls: pageUrls, kie_tasks: tasks,
        }).eq('id', c.id);
      }

      // Video phase: after 'ready', keep collecting finished seedance loops.
      let pageVideos = { ...((c.page_videos || {}) as Record<string, string>) };
      if (status === 'ready') {
        let changed = false;
        for (const [key, tid] of Object.entries(tasks.videos || {})) {
          if (!tid || pageVideos[key]) continue;
          try {
            const st = await kieStatus(String(tid));
            if (st.state === 'success' && st.url) {
              pageVideos[key] = await rehost(admin, st.url, `${c.id}/video_${key}.mp4`, 'video/mp4');
              changed = true;
            } else if (st.state === 'fail') {
              delete tasks.videos[key]; // videos are a bonus — drop quietly
              changed = true;
            }
          } catch { /* next poll */ }
        }
        if (changed) {
          await admin.from('cuentos').update({ ...touch, page_videos: pageVideos, kie_tasks: tasks }).eq('id', c.id);
        }
      }

      return json({
        success: true,
        cuento: {
          id: c.id, status, error, share_token: c.share_token, cover_url: coverUrl,
          pages_done: pageUrls.filter(Boolean).length, pages_total: stanzas.length,
          videos_done: Object.keys(pageVideos).length,
          videos_total: Object.keys(tasks.videos || {}).length,
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
