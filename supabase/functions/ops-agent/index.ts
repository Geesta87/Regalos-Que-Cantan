// supabase/functions/ops-agent/index.ts
// ===========================================================================
// OPS AGENT — the admin dashboard's customer-support & operations console
// ===========================================================================
// A chat agent that does what the owner has been doing by hand in Claude:
// order/payment lookups, video status WITH real storage verification, payment
// audits ("charged 3x — legit?"), reading a customer's WhatsApp/SMS history
// (including finding dropped requests), bulk problem-finding ("every paid
// order missing its video"), revenue/customer analytics, and drafting
// customer messages in Spanish.
//
// READS are free: run_sql goes through public.analyst_run_sql() (SELECT-only
// role, 8s timeout, 200-row cap — the agent physically cannot write), plus
// dedicated lookup/message/storage tools running under the service role.
//
// WRITES are approval-gated: propose_* tools stage a row in
// ops_pending_actions and the tab shows a Confirm/Cancel card. Only on the
// owner's Confirm does ops-agent execute — and every executor is either an
// EXISTING endpoint (admin-videos retry, recover-song send, test-karaoke,
// song-fix-queue create-intake) or a strictly whitelisted column update.
// Refunds are NEVER executed — the agent identifies the exact charge and the
// owner clicks refund in Stripe himself.
//
// admin_users gate (verify_jwt = true): both roles — admin AND assistant
// (Ivan) — may use this console. Other agent consoles stay admin-only.
// Deploy: supabase functions deploy ops-agent --project-ref yzbvajungshqcpusfiia
// Required secrets: ANTHROPIC_API_KEY. Optional: OPS_AGENT_MODEL.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isPaidSong, PAID_FIELDS } from '../_shared/is-paid.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('OPS_AGENT_MODEL') || 'claude-opus-5';
const SITE = 'https://www.regalosquecantan.com';

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clip = (s: unknown, n: number) => String(s ?? '').slice(0, n);

// ---------------------------------------------------------------------------
// Anthropic call with retry (mirrors business-analyst).
// ---------------------------------------------------------------------------
async function anthropicRaw(bodyObj: unknown): Promise<any> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const payload = JSON.stringify(bodyObj);
  const MAX = 4; let lastErr = '';
  for (let attempt = 1; attempt <= MAX; attempt++) {
    let res: Response;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: payload });
    } catch (netErr: any) {
      lastErr = `fetch failed: ${String(netErr?.message || netErr)}`;
      if (attempt < MAX) { await sleep(Math.min(8000, 2000 * 2 ** (attempt - 1))); continue; }
      throw new Error(`Anthropic ${lastErr}`);
    }
    if (res.ok) return await res.json();
    const body = (await res.text()).slice(0, 300);
    lastErr = `Anthropic ${res.status}: ${body}`;
    if ((res.status === 429 || res.status >= 500) && attempt < MAX) { await sleep(Math.min(8000, 2000 * 2 ** (attempt - 1))); continue; }
    throw new Error(lastErr);
  }
  throw new Error(lastErr || 'Anthropic call failed');
}
const textOf = (data: any) => (data?.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    name: 'run_sql',
    description: 'Run one read-only SQL query (SELECT/WITH only, single statement) against the live Postgres database. Hard limits: 8s timeout, 200 rows returned. ALWAYS aggregate in SQL (COUNT/SUM/GROUP BY) — never pull raw rows to count client-side. Use for payment audits, bulk problem-finding sweeps, analytics, and anything lookup_customer does not cover. Max 12 queries per message.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'The SQL. Single SELECT or WITH statement, no semicolons.' }, why: { type: 'string', description: 'One line: what this query establishes.' } }, required: ['query'] },
  },
  {
    name: 'lookup_customer',
    description: 'Look up a customer and ALL their orders in one call: every song (with real paid status computed the correct 3-clause way, amounts, delivery stamps, add-on flags) plus attached video orders, Animado story videos, upsell charges and fix requests. Accepts an email, a phone, a song id (from any song link/URL), a short code (/s/<code>), or a recipient name (name is fuzzy — never trust it alone). ALWAYS use this first for "who is this / what did they buy / did they pay" questions.',
    input_schema: { type: 'object', properties: {
      email: { type: 'string' },
      phone: { type: 'string', description: 'Any format; matched on last 10 digits.' },
      song_id: { type: 'string', description: 'UUID from a song link (song_id=… or /song/<uuid>).' },
      short_code: { type: 'string', description: 'From a /s/<code> link.' },
      recipient_name: { type: 'string', description: 'Last resort — matches strangers with the same name.' },
    } },
  },
  {
    name: 'get_messages',
    description: "Read a customer's WhatsApp/SMS conversation history from our inbox: every inbound and outbound message with direction, channel, status and timestamps. Use to see what a customer asked for, verify what we promised, and find DROPPED requests (an inbound ask with no outbound follow-up). Provide a phone (preferred) or an email (resolved to their phone via their orders).",
    input_schema: { type: 'object', properties: {
      phone: { type: 'string', description: 'Any format; matched on last 10 digits.' },
      email: { type: 'string', description: 'Used to find their phone if you have no phone.' },
      limit: { type: 'number', description: 'Messages to return, newest last. Default 50, max 120.' },
    } },
  },
  {
    name: 'check_file',
    description: 'Verify a media file ACTUALLY EXISTS and is non-empty at a URL (audio_url, video_url, karaoke_url…). Does a HEAD request and reports HTTP status, content-type and size. A video_orders row can say "completed" while the file is missing/0 bytes — always check before telling a customer their video is ready. Max 6 checks per message.',
    input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
  {
    name: 'propose_video_action',
    description: 'PROPOSE an action on a $9.99 slideshow video order. Does NOT execute — creates a Confirm/Cancel card for the owner. mode "retry_render": re-dispatch the render from the existing photos (for failed/stuck renders). mode "reset_for_reupload": wipe the photos and reset to pending so the CUSTOMER can upload new photos from their success page (for wrong/bad photos, or a redo with new pictures).',
    input_schema: { type: 'object', properties: {
      video_order_id: { type: 'string', description: 'The video_orders.id (NOT the song id).' },
      mode: { type: 'string', enum: ['retry_render', 'reset_for_reupload'] },
      reason: { type: 'string', description: 'One line: why (shown on the card).' },
    }, required: ['video_order_id', 'mode'] },
  },
  {
    name: 'propose_update_order',
    description: "PROPOSE fixing a song order's customer data — wrong/misspelled names, junk or mistyped email, wrong phone, or swapped recipient/sender (pass both fields swapped in one call). Does NOT execute — creates a Confirm/Cancel card showing old → new for each field. Only these columns can change: recipient_name, sender_name, email, whatsapp_phone. NOTE: this fixes the ORDER DATA only — it does not re-sing the song; if the sung lyrics contain the wrong name, ALSO propose_fix_song.",
    input_schema: { type: 'object', properties: {
      song_id: { type: 'string' },
      updates: { type: 'object', description: 'Only keys to change. Allowed: recipient_name, sender_name, email, whatsapp_phone.', properties: {
        recipient_name: { type: 'string' }, sender_name: { type: 'string' }, email: { type: 'string' }, whatsapp_phone: { type: 'string' },
      } },
      reason: { type: 'string' },
    }, required: ['song_id', 'updates'] },
  },
  {
    name: 'propose_resend_delivery',
    description: 'PROPOSE re-sending the "🎵 Aquí está tu canción" delivery email with the customer\'s paid song link(s). Does NOT execute — creates a Confirm/Cancel card. Only works for PAID orders. Optionally restrict to one purchase with group_key (their stripe_payment_id or stripe_session_id). If their email on file is wrong, propose_update_order FIRST, get it confirmed, then propose the resend.',
    input_schema: { type: 'object', properties: {
      email: { type: 'string', description: 'The email to send to (must be the email on the songs rows).' },
      group_key: { type: 'string', description: 'Optional: stripe_payment_id or stripe_session_id to resend just that purchase.' },
      reason: { type: 'string' },
    }, required: ['email'] },
  },
  {
    name: 'propose_retry_karaoke',
    description: 'PROPOSE re-running the instrumental (karaoke) extraction for a song whose karaoke_status is failed or stuck. Does NOT execute — creates a Confirm/Cancel card.',
    input_schema: { type: 'object', properties: { song_id: { type: 'string' }, reason: { type: 'string' } }, required: ['song_id'] },
  },
  {
    name: 'propose_fix_song',
    description: 'PROPOSE sending a song to the Fix Song queue (Ace) for lyric/wording corrections that need a RE-SING — wrong name sung, wrong date, wrong wording. Does NOT execute — creates a Confirm/Cancel card; on Confirm it files a fix-queue intake exactly like the "Send to Ace" button. Include the customer\'s request verbatim plus what specifically must change.',
    input_schema: { type: 'object', properties: {
      song_ids: { type: 'array', items: { type: 'string' }, description: '1-2 song ids to fix.' },
      confirmed_request: { type: 'string', description: 'What the customer wants fixed, specific: "the name is sung as Angela, must be Ángel" — include exact wrong → right wording.' },
      email: { type: 'string' }, phone: { type: 'string' }, customer_name: { type: 'string' },
    }, required: ['song_ids', 'confirmed_request'] },
  },
];

// ---------------------------------------------------------------------------
// System prompt — the ops landmines, learned in production. Keep in sync with
// business-analyst's rules (same database, same traps).
// ---------------------------------------------------------------------------
const OPS_SYSTEM = `You are the Ops Agent for "Regalos Que Cantan" (regalosquecantan.com), a US-Hispanic e-commerce brand selling personalized Spanish songs. You are the owner's customer-support and operations console inside the admin dashboard. The owner is NOT a programmer: answer in plain English, never show SQL or code unless asked. Customer-facing message drafts are in warm, natural Mexican-Spanish; everything you say TO the owner is English.

WHAT YOU DO: order/payment lookups; video status (verifying the file really exists in storage, not just the status flag); payment audits ("charged 3 times — legit?" with itemized timestamps); reading WhatsApp/SMS history including finding dropped customer requests; bulk problem-finding ("every paid order missing its video"); revenue/customer analytics; drafting customer messages in Spanish; and STAGING fixes (video retry/reset, order-data corrections, delivery-link resends, karaoke retries, fix-song intakes) that the owner confirms with one tap.

DATABASE MAP (read anything with run_sql; there are more tables — information_schema works):
- songs (~82k rows, +600/day): one row per generated song = one order line. id, created_at, email, recipient_name, sender_name, relationship, genre, sub_genre, occasion, details (customer's story), lyrics, status, error_message, provider, platform, version (1|2 — every order generates 2 versions), audio_url, short_code. Payment: paid, paid_at, payment_status, amount_paid (dollars), stripe_session_id, stripe_payment_id, marked_paid_at (manual Zelle/cash), payment_method. Delivery: whatsapp_phone, whatsapp_sent_at, email_sent_at, link_email_sent_at, download_count. Add-ons on the row: has_video_addon, karaoke_status/karaoke_url (instrumental), lyric_video_status/lyric_video_url, karaoke_video_status/karaoke_video_url. Fixes: fix_count, fixed_at. Attribution: utm_source/utm_medium/utm_campaign, affiliate_code, coupon_code.
- video_orders (~700): $9.99 photo-slideshow add-on. id, song_id, paid, paid_at, amount_cents, photo_count, photo_urls, status (pending=no photos yet → photos_uploaded → processing → completed | failed), video_url, error_message, render_attempts, shotstack_render_id (null = in-house renderer), admin_dismissed, updated_at. "Stuck" = processing/photos_uploaded untouched > 30 min.
- story_video_orders: Animado animated-video add-on. song_id, state (awaiting_photo, likeness_review, final_review, …), amount_cents, video_url, customer_phone, photo_reminder_count.
- upsell_charges: post-purchase one-tap charges. song_id, item ('animado'|'instrumental'|'gift'), amount_cents, status ('pending'|'paid'|'failed'|'needs_action'), stripe_payment_intent_id, buyer_email, error_message. A partial unique index forbids two non-failed rows per (song_id, item) — a "retry" is only legal after a hard 'failed'.
- sms_conversations (phone E.164, customer_name, channel 'sms'|'whatsapp', opted_out, unread, last_message_at) / sms_messages (conversation_id, direction 'inbound'|'outbound', body, status — 'draft' = unapproved AI draft the customer has NOT received, channel, ai_generated, created_at). Use the get_messages tool for a single customer's thread; use run_sql for cross-customer sweeps.
- song_fix_requests: the Fix Song queue. song_id, status (pending/in_progress/awaiting_approval/done/rejected), customer_request, auto_status.
- cloned_voice_songs / voice_samples: the $69 Clona Mi Voz tier.
- email_leads, email_logs/email_events (SendGrid), funnel_events (~640k, step-by-step funnel), reviews, coupons, affiliates.

NON-NEGOTIABLE ANALYSIS RULES — apply silently, every time:
1. PAID = all three: paid_at IS NOT NULL, AND (paid = true OR payment_status = 'paid'), AND (amount_paid > 0 OR stripe_payment_id IS NOT NULL OR marked_paid_at IS NOT NULL). Never paid=true alone. Manual Zelle/cash has amount_paid NULL on purpose — paid, but carries no amount. lookup_customer already computes is_paid correctly — trust it.
2. REVENUE / "how many purchases": two-pack bundles stamp the FULL bundle total on BOTH song rows sharing a stripe_session_id. Revenue = per DISTINCT stripe_session_id taking MAX(amount_paid); counting rows double-counts. Two rows sharing a session = ONE purchase of a 2-pack, NOT a double charge.
3. The live funnel is platform = 'es'. Other values are tests/other markets.
4. Phones live in whatsapp_phone. The phone_number column is always empty — never use it.
5. Aggregate in SQL — the 200-row cap silently truncates raw pulls. Timestamps are UTC.
6. ~61% of orders have no utm_source; attribution is a floor. Stripe's dashboard runs ~2% ahead of the DB.
7. An empty details field (15-20% of orders) predicts generic lyrics — check it FIRST on any lyric complaint.

PAYMENT AUDITS ("charged N times — are they legit?"):
- Pull EVERY charge across songs (per distinct stripe_session_id), video_orders, upsell_charges and story_video_orders for that email/customer, each with its timestamp, amount, and what it bought. Present an itemized timeline.
- Legit patterns: base song + video add-on + upsell = separate intentional charges; a 2-pack (rule 2); a second song ordered days later. Suspicious: identical amounts minutes apart with different session ids, or a re-pay for the SAME song.
- REFUNDS: you can NEVER execute a refund. Identify the exact charge — stripe_payment_id (or payment_intent), date, amount, what it was for — and tell the owner to click refund on that charge in Stripe.

VIDEO STATUS: never trust status='completed' alone — check_file the video_url and report the real size. If the file is missing/empty on a completed order, that's a broken delivery: propose_video_action retry_render.

DROPPED REQUESTS: when reading a thread, flag inbound customer asks that never got an outbound answer or action (e.g. a name-fix request nobody filed). Remember status='draft' outbound messages were NEVER received by the customer.

MESSAGE DRAFTING (Spanish): warm, human, concise; match WhatsApp/SMS tone; no corporate stiffness; never promise refunds or specific delivery times you can't verify; include the customer's actual link only if the order is PAID. You only DRAFT — the owner sends from the SMS tab. Song links: paid → ${SITE}/s/<short_code> (or ${SITE}/success?song_id=<id> if it has add-ons); unpaid → ${SITE}/listen?song_ids=<ids> (playback only, download locked).

ACTIONS ARE APPROVAL-GATED: propose_* tools do NOT execute — each creates a Confirm/Cancel card the owner must tap. After proposing, say it's staged and waiting for his Confirm; NEVER say it's done. When he replies "yes / do it / go ahead" right after you SUGGESTED an action in text, that means: make the propose_* call now. Batch related proposals in one turn when the fix needs several steps (e.g. fix the email THEN resend). Before proposing on the wrong target, verify ids with lookup_customer. propose_update_order fixes order DATA only; if the wrong name is SUNG in the audio, also propose_fix_song (re-sing).

HOW TO ANSWER: lead with the answer/finding in one or two sentences with real numbers, then supporting detail. Say what you checked in plain words. Never invent a number, id, or link — everything from a tool. If a query fails twice, say what you couldn't determine. FORMATTING: plain text only — no markdown (no **, no ##). Lists use "- " or "1.".`;

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------
const SONG_COLS =
  'id, created_at, email, recipient_name, sender_name, relationship, genre, occasion, status, error_message, ' +
  'provider, platform, version, audio_url, short_code, ' + PAID_FIELDS + ', payment_method, stripe_session_id, ' +
  'whatsapp_phone, whatsapp_sent_at, email_sent_at, link_email_sent_at, download_count, ' +
  'has_video_addon, karaoke_status, karaoke_url, lyric_video_status, lyric_video_url, karaoke_video_status, karaoke_video_url, ' +
  'fix_count, fixed_at, coupon_code, affiliate_code';

const last10 = (raw: unknown) => String(raw || '').replace(/\D/g, '').slice(-10);

async function lookupCustomer(admin: any, input: any): Promise<string> {
  const found = new Map<string, any>();
  const matchedBy: string[] = [];
  const absorb = (rows: any[], kind: string) => {
    let added = 0;
    for (const r of rows || []) if (!found.has(r.id)) { found.set(r.id, r); added++; }
    if (added && !matchedBy.includes(kind)) matchedBy.push(kind);
  };
  const q = () => admin.from('songs').select(SONG_COLS);

  const songId = clip(input.song_id, 60).trim();
  if (/^[0-9a-f-]{36}$/i.test(songId)) {
    const { data } = await q().eq('id', songId.toLowerCase()).limit(2);
    absorb(data, 'song_id');
  }
  const code = clip(input.short_code, 40).trim();
  if (code) { const { data } = await q().eq('short_code', code).limit(4); absorb(data, 'short_code'); }
  const email = clip(input.email, 120).trim().toLowerCase();
  if (email.includes('@')) { const { data } = await q().ilike('email', email).order('created_at', { ascending: false }).limit(12); absorb(data, 'email'); }
  const ph = last10(input.phone);
  if (ph.length === 10) {
    // whatsapp_phone is stored in mixed formats; match on the trailing 10 digits.
    const { data } = await q().like('whatsapp_phone', `%${ph}`).order('created_at', { ascending: false }).limit(12);
    absorb(data, 'phone');
  }
  const name = clip(input.recipient_name, 80).trim();
  if (name.length >= 3 && found.size === 0) {
    const { data } = await q().ilike('recipient_name', name).order('created_at', { ascending: false }).limit(6);
    absorb(data, 'recipient_name (LOW CONFIDENCE — names are not unique)');
  }

  if (!found.size) return JSON.stringify({ orders: [], matched_by: [], note: 'No orders found for those identifiers. Try another email/phone, or a song link from the conversation.' });

  const songs = [...found.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 12);
  const ids = songs.map((s) => s.id);
  const [videos, storyVideos, upsells, fixes] = await Promise.all([
    admin.from('video_orders').select('id, song_id, paid, paid_at, amount_cents, photo_count, status, video_url, error_message, render_attempts, created_at, updated_at').in('song_id', ids).order('created_at', { ascending: false }).limit(12).then((r: any) => r.data || []),
    admin.from('story_video_orders').select('id, song_id, state, amount_cents, video_url, created_at').in('song_id', ids).order('created_at', { ascending: false }).limit(12).then((r: any) => r.data || []).catch(() => []),
    admin.from('upsell_charges').select('id, song_id, item, amount_cents, status, stripe_payment_intent_id, buyer_email, error_message, created_at').in('song_id', ids).order('created_at', { ascending: false }).limit(12).then((r: any) => r.data || []).catch(() => []),
    admin.from('song_fix_requests').select('id, song_id, status, auto_status, customer_request, created_at').in('song_id', ids).order('created_at', { ascending: false }).limit(12).then((r: any) => r.data || []).catch(() => []),
  ]);

  const orders = songs.map((s) => ({
    ...s,
    is_paid: isPaidSong(s),
    paid_link: isPaidSong(s) ? (s.has_video_addon || s.karaoke_status || s.karaoke_video_status ? `${SITE}/success?song_id=${s.id}` : (s.short_code ? `${SITE}/s/${s.short_code}` : `${SITE}/success?song_id=${s.id}`)) : null,
  }));
  return JSON.stringify({
    matched_by: matchedBy,
    orders,
    video_orders: videos,
    story_video_orders: storyVideos,
    upsell_charges: upsells,
    fix_requests: fixes,
    note: 'is_paid is computed the correct 3-clause way (Zelle/manual marks count). Two song rows sharing a stripe_session_id are ONE purchase (2-pack) — amount_paid is the full bundle total on both. Rows also come in version pairs (v1/v2) for the same order.',
  }).slice(0, 24000);
}

async function getMessages(admin: any, input: any): Promise<string> {
  let ph = last10(input.phone);
  if (ph.length !== 10 && String(input.email || '').includes('@')) {
    const { data } = await admin.from('songs').select('whatsapp_phone').ilike('email', String(input.email).trim().toLowerCase()).not('whatsapp_phone', 'is', null).order('created_at', { ascending: false }).limit(1);
    ph = last10(data?.[0]?.whatsapp_phone);
  }
  if (ph.length !== 10) return 'No usable phone. Provide a phone number, or an email whose orders have a whatsapp_phone on file.';
  const { data: convos } = await admin.from('sms_conversations')
    .select('id, phone, customer_name, channel, opted_out, unread, last_message_at, created_at')
    .like('phone', `%${ph}`).order('last_message_at', { ascending: false }).limit(3);
  if (!convos?.length) return `No SMS/WhatsApp conversation found for a phone ending in ${ph}.`;
  const limit = Math.min(Math.max(Number(input.limit) || 50, 5), 120);
  const { data: msgs } = await admin.from('sms_messages')
    .select('conversation_id, direction, body, status, channel, ai_generated, needs_human, created_at')
    .in('conversation_id', convos.map((c: any) => c.id))
    .order('created_at', { ascending: false }).limit(limit);
  const messages = (msgs || []).reverse().map((m: any) => ({ ...m, body: clip(m.body, 600) }));
  return JSON.stringify({
    conversations: convos,
    messages,
    note: "Oldest first. direction=inbound is the CUSTOMER. status='draft' outbound = an unapproved AI draft the customer NEVER received.",
  }).slice(0, 24000);
}

async function checkFile(url: string): Promise<string> {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return 'Not a valid http(s) URL.';
  const probe = async (method: 'HEAD' | 'GET') => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      return await fetch(u, { method, headers: method === 'GET' ? { Range: 'bytes=0-0' } : {}, signal: ctrl.signal });
    } finally { clearTimeout(t); }
  };
  try {
    let res = await probe('HEAD');
    if (!res.ok && res.status !== 206) { try { res = await probe('GET'); } catch { /* keep HEAD result */ } }
    const len = res.headers.get('content-length');
    const range = res.headers.get('content-range'); // GET+Range: "bytes 0-0/12345"
    const total = range?.split('/')[1] || len;
    const bytes = total != null ? Number(total) : null;
    const exists = (res.ok || res.status === 206) && (bytes == null || bytes > 1024);
    return JSON.stringify({
      url: u, http_status: res.status, exists_and_nonempty: exists,
      content_type: res.headers.get('content-type'), size_bytes: bytes,
      size_human: bytes != null ? (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`) : 'unknown',
      note: exists ? 'File is really there.' : 'File is MISSING or empty — the status flag is lying. Treat this delivery as broken.',
    });
  } catch (e: any) {
    return JSON.stringify({ url: u, exists_and_nonempty: false, error: String(e?.message || e), note: 'Could not reach the file — treat as missing until verified.' });
  }
}

// ---------------------------------------------------------------------------
// Propose helpers — stage, never execute.
// ---------------------------------------------------------------------------
const UPDATABLE_COLS = ['recipient_name', 'sender_name', 'email', 'whatsapp_phone'];

async function stage(admin: any, pending: any[], row: any): Promise<string> {
  const { data, error } = await admin.from('ops_pending_actions').insert(row)
    .select('id, action_type, target_type, target_id, target_name, summary, status, created_at').single();
  if (error) return `Could not stage the action: ${error.message}`;
  pending.push(data);
  return `Staged: ${row.summary}. It's waiting for the owner's Confirm tap — NOTHING has changed yet.`;
}

async function proposeVideoAction(admin: any, input: any, pending: any[]): Promise<string> {
  const id = clip(input.video_order_id, 60).trim();
  const mode = input.mode === 'reset_for_reupload' ? 'reset_for_reupload' : 'retry_render';
  const { data: vo } = await admin.from('video_orders').select('id, song_id, paid, status, photo_count, video_url, error_message').eq('id', id).single();
  if (!vo) return `No video order with id ${id}. (Did you pass a song id? Use lookup_customer to get the video_orders.id.)`;
  const { data: song } = await admin.from('songs').select('recipient_name, email').eq('id', vo.song_id).single();
  const who = `${song?.recipient_name || 'customer'} (${song?.email || 'no email'})`;
  const reason = clip(input.reason, 200);
  const summary = mode === 'retry_render'
    ? `Retry the slideshow render for ${who} — order ${id.slice(0, 8)}, status ${vo.status}${vo.error_message ? `, last error: ${clip(vo.error_message, 80)}` : ''}${reason ? `. ${reason}` : ''}`
    : `Reset video order ${id.slice(0, 8)} for ${who} so they can re-upload photos (wipes ${vo.photo_count ?? 0} current photo(s))${reason ? `. ${reason}` : ''}`;
  return stage(admin, pending, { action_type: mode, target_type: 'video_order', target_id: id, target_name: who, params: { song_id: vo.song_id }, summary });
}

async function proposeUpdateOrder(admin: any, input: any, pending: any[]): Promise<string> {
  const id = clip(input.song_id, 60).trim();
  const { data: song } = await admin.from('songs').select('id, recipient_name, sender_name, email, whatsapp_phone').eq('id', id).single();
  if (!song) return `No song with id ${id}.`;
  const updates: Record<string, string> = {};
  for (const k of UPDATABLE_COLS) {
    const v = input.updates?.[k];
    if (typeof v === 'string' && v.trim() && v.trim() !== String((song as any)[k] || '')) updates[k] = v.trim().slice(0, 200);
  }
  if (!Object.keys(updates).length) return 'Nothing to change — every provided value matches what is already on the order (or no allowed field was given).';
  if (updates.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(updates.email)) return `"${updates.email}" does not look like a valid email.`;
  const diff = Object.entries(updates).map(([k, v]) => `${k}: "${(song as any)[k] || '(empty)'}" → "${v}"`).join('; ');
  const reason = clip(input.reason, 200);
  const summary = `Fix order data for ${song.recipient_name || id.slice(0, 8)} — ${diff}${reason ? `. ${reason}` : ''}`;
  return stage(admin, pending, { action_type: 'update_order', target_type: 'song', target_id: id, target_name: song.recipient_name || song.email || id.slice(0, 8), params: { updates }, summary });
}

async function proposeResendDelivery(admin: any, input: any, pending: any[]): Promise<string> {
  const email = clip(input.email, 120).trim().toLowerCase();
  if (!email.includes('@')) return 'A valid email is required.';
  const { data: rows } = await admin.from('songs').select('id, ' + PAID_FIELDS).ilike('email', email).limit(20);
  const paidCount = (rows || []).filter((r: any) => isPaidSong(r)).length;
  if (!paidCount) return `No PAID songs found for ${email} — the delivery email only covers paid orders. If they paid under a different email, fix the order email first (propose_update_order).`;
  const groupKey = clip(input.group_key, 120).trim() || null;
  const reason = clip(input.reason, 200);
  const summary = `Resend the delivery email ("Aquí está tu canción") to ${email}${groupKey ? ` for purchase ${groupKey.slice(0, 18)}…` : ` (${paidCount} paid song row(s))`}${reason ? `. ${reason}` : ''}`;
  return stage(admin, pending, { action_type: 'resend_delivery', target_type: 'customer', target_id: email, target_name: email, params: { email, group_key: groupKey }, summary });
}

async function proposeRetryKaraoke(admin: any, input: any, pending: any[]): Promise<string> {
  const id = clip(input.song_id, 60).trim();
  const { data: song } = await admin.from('songs').select('id, recipient_name, email, karaoke_status').eq('id', id).single();
  if (!song) return `No song with id ${id}.`;
  const reason = clip(input.reason, 200);
  const summary = `Retry the instrumental (karaoke) extraction for ${song.recipient_name || id.slice(0, 8)} (${song.email || 'no email'}) — current status: ${song.karaoke_status || 'none'}${reason ? `. ${reason}` : ''}`;
  return stage(admin, pending, { action_type: 'retry_karaoke', target_type: 'song', target_id: id, target_name: song.recipient_name || id.slice(0, 8), params: {}, summary });
}

async function proposeFixSong(admin: any, input: any, pending: any[]): Promise<string> {
  const songIds = (Array.isArray(input.song_ids) ? input.song_ids : []).map((s: unknown) => clip(s, 60).trim()).filter(Boolean).slice(0, 2);
  const confirmed = clip(input.confirmed_request, 1200).trim();
  if (!songIds.length) return 'At least one song id is required.';
  if (!confirmed) return 'confirmed_request is required — state exactly what must change (wrong → right).';
  const { data: song } = await admin.from('songs').select('id, recipient_name, email, whatsapp_phone').eq('id', songIds[0]).single();
  if (!song) return `No song with id ${songIds[0]}.`;
  const email = clip(input.email, 120).trim() || song.email || null;
  const phone = clip(input.phone, 40).trim() || song.whatsapp_phone || null;
  if (!email && !phone) return 'The fix queue needs an email or phone for the customer — none on the order and none provided.';
  const summary = `Send ${song.recipient_name || songIds[0].slice(0, 8)}'s song to the Fix Song queue: ${clip(confirmed, 160)}`;
  return stage(admin, pending, {
    action_type: 'fix_song_intake', target_type: 'song', target_id: songIds[0], target_name: song.recipient_name || email || songIds[0].slice(0, 8),
    params: { song_ids: songIds, confirmed_request: confirmed, email, phone, customer_name: clip(input.customer_name, 120).trim() || null }, summary,
  });
}

// ---------------------------------------------------------------------------
// Execute a confirmed action (only on the owner's Confirm tap).
// ---------------------------------------------------------------------------
async function executePendingAction(admin: any, authHeader: string, id: string): Promise<{ ok: boolean; result: string }> {
  const { data: a } = await admin.from('ops_pending_actions').select('*').eq('id', id).single();
  if (!a) return { ok: false, result: 'Action not found.' };
  if (a.status !== 'pending') return { ok: false, result: `Already ${a.status}.` };
  const fwd = (fn: string, body: any, headers: Record<string, string> = {}) =>
    fetch(`${SUPABASE_URL}/functions/v1/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authHeader, apikey: SUPABASE_ANON_KEY, ...headers }, body: JSON.stringify(body) });
  try {
    let result = '';
    if (a.action_type === 'retry_render') {
      // Same path as the Videos tab retry button — proven executor.
      const r = await (await fwd('admin-videos', { action: 'retry', id: a.target_id })).json();
      if (!r?.success) throw new Error(r?.error || 'admin-videos retry failed');
      result = `Render re-dispatched for video order ${String(a.target_id).slice(0, 8)} (renderer: ${r.renderer || 'unknown'}). Give it a few minutes, then verify the file.`;
    } else if (a.action_type === 'reset_for_reupload') {
      const { data: old } = await admin.from('video_orders').select('photo_count, status, video_url').eq('id', a.target_id).single();
      const { error } = await admin.from('video_orders').update({
        status: 'pending', photo_urls: null, photo_count: 0, video_url: null,
        shotstack_render_id: null, error_message: null, admin_dismissed: false,
        updated_at: new Date().toISOString(),
      }).eq('id', a.target_id);
      if (error) throw new Error(error.message);
      result = `Video order reset (was ${old?.status}, ${old?.photo_count ?? 0} photo(s)). The customer can now upload new photos at ${SITE}/success?song_id=${a.params?.song_id || ''} — send them that link.`;
    } else if (a.action_type === 'update_order') {
      const updates: Record<string, string> = {};
      for (const k of UPDATABLE_COLS) if (typeof a.params?.updates?.[k] === 'string') updates[k] = a.params.updates[k];
      if (!Object.keys(updates).length) throw new Error('No whitelisted fields in params.');
      const { data: old } = await admin.from('songs').select(UPDATABLE_COLS.join(', ')).eq('id', a.target_id).single();
      const { error } = await admin.from('songs').update(updates).eq('id', a.target_id);
      if (error) throw new Error(error.message);
      result = `Order updated: ${Object.entries(updates).map(([k, v]) => `${k} "${(old as any)?.[k] || '(empty)'}" → "${v}"`).join('; ')}.`;
    } else if (a.action_type === 'resend_delivery') {
      // Same shape as auto-send-paid-email: anon Bearer (gateway) + x-internal-auth
      // (skips only recover-song's per-IP rate limit).
      const res = await fetch(`${SUPABASE_URL}/functions/v1/recover-song`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'x-internal-auth': SERVICE_ROLE },
        body: JSON.stringify({ email: a.params?.email, action: 'send', which: 'paid', group_key: a.params?.group_key || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.emailSent) throw new Error(`recover-song ${res.status} emailSent=${data?.emailSent ?? 'false'}${data?.error ? ` (${data.error})` : ''}`);
      result = `Delivery email re-sent to ${a.params?.email}.`;
    } else if (a.action_type === 'retry_karaoke') {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/test-karaoke`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ songId: a.target_id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.vercel_response?.success) throw new Error(data?.vercel_response?.error || data?.error || `test-karaoke ${res.status}`);
      result = 'Karaoke extraction restarted — it usually lands in about a minute.';
    } else if (a.action_type === 'fix_song_intake') {
      const p = a.params || {};
      const r = await (await fwd('song-fix-queue', {
        action: 'create-intake', songs: p.song_ids, confirmed_request: p.confirmed_request,
        email: p.email || undefined, phone: p.phone || undefined, customer_name: p.customer_name || undefined,
      })).json();
      if (!r?.success) throw new Error(r?.error || 'create-intake failed');
      result = `Filed in the Fix Song queue (${(r.ids || []).length} request(s)) — it shows up in the Fix Song tab / for Ace.`;
    } else {
      return { ok: false, result: `Unknown action type ${a.action_type}.` };
    }
    await admin.from('ops_pending_actions').update({ status: 'done', result, confirmed_at: new Date().toISOString() }).eq('id', id);
    return { ok: true, result };
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 400);
    await admin.from('ops_pending_actions').update({ status: 'failed', result: msg, confirmed_at: new Date().toISOString() }).eq('id', id);
    return { ok: false, result: msg };
  }
}

// ---------------------------------------------------------------------------
async function runTool(admin: any, name: string, input: any, pending: any[], budgets: { sql: number; files: number }): Promise<string> {
  try {
    if (name === 'run_sql') {
      if (budgets.sql <= 0) return 'Query budget exhausted (12 max). Answer with what you have.';
      budgets.sql--;
      const { data: rows, error } = await admin.rpc('analyst_run_sql', { q: String(input?.query || '') });
      return error ? `SQL error: ${String((error as any).message || error).slice(0, 400)}` : JSON.stringify(rows).slice(0, 20000);
    }
    if (name === 'lookup_customer') return await lookupCustomer(admin, input || {});
    if (name === 'get_messages') return await getMessages(admin, input || {});
    if (name === 'check_file') {
      if (budgets.files <= 0) return 'File-check budget exhausted (6 max).';
      budgets.files--;
      return await checkFile(String(input?.url || ''));
    }
    if (name === 'propose_video_action') return await proposeVideoAction(admin, input || {}, pending);
    if (name === 'propose_update_order') return await proposeUpdateOrder(admin, input || {}, pending);
    if (name === 'propose_resend_delivery') return await proposeResendDelivery(admin, input || {}, pending);
    if (name === 'propose_retry_karaoke') return await proposeRetryKaraoke(admin, input || {}, pending);
    if (name === 'propose_fix_song') return await proposeFixSong(admin, input || {}, pending);
    return `Unknown tool ${name}`;
  } catch (e: any) {
    return `Tool failed: ${String(e?.message || e).slice(0, 300)}`;
  }
}

// ---------------------------------------------------------------------------
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    // --- Staff gate: any admin_users row (admin or assistant) ---
    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: ud, error: ue } = await userClient.auth.getUser();
    if (ue || !ud?.user) return json({ success: false, error: 'Invalid session' }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin.from('admin_users').select('role').eq('user_id', ud.user.id).single();
    if (!roleRow || !['admin', 'assistant'].includes(roleRow.role)) return json({ success: false, error: 'Staff only' }, 403);

    let body: any = {}; try { body = await req.json(); } catch { body = {}; }
    const action = body.action || 'chat';

    if (action === 'get') {
      const { data: pend } = await admin.from('ops_pending_actions')
        .select('id, action_type, target_type, target_id, target_name, summary, status, result, created_at')
        .eq('status', 'pending').order('created_at', { ascending: false }).limit(20);
      const { data: recent } = await admin.from('ops_pending_actions')
        .select('id, action_type, target_name, summary, status, result, confirmed_at')
        .in('status', ['done', 'failed']).order('confirmed_at', { ascending: false }).limit(8);
      return json({ success: true, pending_actions: pend || [], recent_actions: recent || [] });
    }

    if (action === 'confirm_action') {
      const id = String(body.id || body.task_id || '');
      if (!id) return json({ success: false, error: 'Missing id' }, 400);
      const { ok, result } = await executePendingAction(admin, authHeader, id);
      return json({ success: ok, id, result, status: ok ? 'done' : 'failed' });
    }
    if (action === 'cancel_action') {
      const id = String(body.id || body.task_id || '');
      if (!id) return json({ success: false, error: 'Missing id' }, 400);
      await admin.from('ops_pending_actions').update({ status: 'cancelled' }).eq('id', id).eq('status', 'pending');
      return json({ success: true, id, status: 'cancelled' });
    }

    if (action === 'chat') {
      const message = clip(body.message, 4000).trim();
      if (!message) return json({ success: false, error: 'Empty message.' }, 400);

      // Stateless server: short rolling history from the client, hard-capped.
      const history = Array.isArray(body.history) ? body.history.slice(-16) : [];
      const messages: any[] = [
        ...history
          .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
          .map((m: any) => ({ role: m.role, content: clip(m.content, 6000) })),
        { role: 'user', content: message },
      ];

      const today = new Date().toISOString().slice(0, 10);
      const system = `${OPS_SYSTEM}\n\nToday's date (UTC): ${today}.`;

      const pending: any[] = [];
      const budgets = { sql: 12, files: 6 };
      const trace: { tool: string; why?: string }[] = [];
      let finalText = '';
      for (let round = 0; round < 12; round++) {
        const data = await anthropicRaw({ model: MODEL, max_tokens: 3000, system, messages, tools: TOOLS });
        const content = data?.content || [];
        const text = textOf(data);
        if (text) finalText = text;
        const toolUses = content.filter((c: any) => c.type === 'tool_use');
        if (data?.stop_reason !== 'tool_use' || !toolUses.length) break;
        messages.push({ role: 'assistant', content });
        const results: any[] = [];
        for (const tu of toolUses) {
          trace.push({ tool: tu.name, why: tu.name === 'run_sql' ? clip(tu.input?.why, 120) : undefined });
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: await runTool(admin, tu.name, tu.input || {}, pending, budgets) });
        }
        messages.push({ role: 'user', content: results });
      }

      return json({
        success: true,
        answer: finalText || (pending.length ? 'Actions staged — confirm below.' : 'I could not produce an answer — try a narrower question.'),
        pending_actions: pending,
        trace,
      });
    }

    return json({ success: false, error: `Unknown action ${action}` }, 400);
  } catch (e: any) {
    console.error('ops-agent error:', e);
    return json({ success: false, error: String(e?.message || e) }, 500);
  }
});
