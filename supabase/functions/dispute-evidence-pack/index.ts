// supabase/functions/dispute-evidence-pack/index.ts
//
// One-click dispute evidence assembler (chargeback defense, 2026-08-19).
//
// Actions (POST JSON, `action` defaults to 'pack'):
//   list    → every mirrored dispute + current blocked_emails state + order
//             counts, for the admin Disputes tab.
//   pack    → { email } or { dispute_id } → markdown evidence pack built
//             from everything the database knows about that customer:
//   unblock → { email } deletes the blocked_emails row (a mistaken dispute).
//   block   → { email } re-adds it (tagged MANUAL).
//   email   → { email, subject, text, recipient_name?, reply_to?, bcc? } sends a
//             plain outreach email to the customer from hola@ via SendGrid and
//             logs it in email_logs (email_type 'dispute_outreach') so it shows
//             in the dispute box's communications and in the pack.
//
// The pack pulls:
//   - songs (order records, IPs, delivery timestamps, download counts)
//   - lyric_submissions (the customer's own submitted story / custom lyrics)
//   - song_access_log (page views, plays, downloads — proof of consumption)
//   - sms_conversations + sms_messages (full thread with Twilio SIDs)
//   - email_events (SendGrid deliveries / opens / clicks, iPhone vs proxy split)
//   - disputes (the mirrored Stripe dispute row, if the webhook captured it)
//
// Output is the raw material for Stripe's "Counter dispute" form, in its
// field order: product description, access activity log, and the numbered
// additional-information argument list are all drafted from live data. A
// human still reviews and pastes — this function never touches Stripe.
//
// Auth: same model as admin-songs — requires a valid Supabase Auth JWT
// (verify_jwt stays true/default) AND the caller must exist in admin_users.
// The service-role key is also accepted (server-to-server / operator runs),
// mirroring fix-song-section.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY') || '';
const SENDER_EMAIL = 'hola@regalosquecantan.com';

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(ts: string | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

type SongLite = { id: string; whatsapp_phone: string | null };

type PmDetails = { type?: string; klarna?: { reason_code?: string }; paypal?: { reason_code?: string }; card?: { network_reason_code?: string } };
function paymentRail(raw: unknown): { payment_method: string; pm_reason_code: string | null } {
  const pm = ((raw as { payment_method_details?: PmDetails } | null)?.payment_method_details) || {};
  const type = pm.type || 'card';
  const code = pm.klarna?.reason_code || pm.paypal?.reason_code || null;
  return { payment_method: type, pm_reason_code: code };
}
type Msg = {
  created_at: string; direction: string; channel: string; body: string | null; twilio_sid: string | null;
  status: string | null; media_type: string | null; ai_generated: boolean | null; phone: string;
};
type SentEmail = {
  created_at: string; email_type: string | null; subject: string | null; status: string | null;
  opened_at: string | null; clicked_at: string | null;
};

// Every communication we have with this customer: the full SMS + WhatsApp
// threads (matched by every phone on their orders AND by order id, so a thread
// started from the inbox on a song still counts) plus every email we sent
// them. Shared by the Disputes tab (`list`) and the evidence pack (`pack`).
// deno-lint-ignore no-explicit-any
async function gatherComms(supabase: any, email: string, songs: SongLite[]): Promise<{ messages: Msg[]; emails: SentEmail[]; phones: string[] }> {
  const songIds = songs.map((s) => s.id);
  const phones = [...new Set(
    songs.map((s) => (s.whatsapp_phone || '').replace(/\D/g, '')).filter((p) => p.length >= 10).map((p) => p.slice(-10)),
  )];
  const convs = new Map<string, { id: string; phone: string; channel: string | null }>();
  for (const p of phones) {
    const { data } = await supabase.from('sms_conversations').select('id, phone, channel').like('phone', `%${p}`);
    for (const c of (data || [])) convs.set(c.id, c);
  }
  if (songIds.length) {
    const { data } = await supabase.from('sms_conversations').select('id, phone, channel').in('order_id', songIds);
    for (const c of (data || [])) convs.set(c.id, c);
  }
  let messages: Msg[] = [];
  for (const c of convs.values()) {
    const { data: msgs } = await supabase.from('sms_messages')
      .select('created_at, direction, channel, body, twilio_sid, status, media_type, ai_generated')
      .eq('conversation_id', c.id).order('created_at').limit(500);
    messages = messages.concat((msgs || []).map((m: Omit<Msg, 'phone'>) => ({ ...m, channel: m.channel || c.channel || 'sms', phone: c.phone })));
  }
  messages.sort((a, b) => a.created_at.localeCompare(b.created_at));

  const [songEmails, txEmails] = await Promise.all([
    supabase.from('email_logs').select('created_at, email_type, subject, status, opened_at, clicked_at').ilike('email', email).order('created_at').limit(200),
    supabase.from('email_log').select('created_at, email_type, subject, status, opened_at, clicked_at').ilike('to_email', email).order('created_at').limit(200),
  ]);
  const emails: SentEmail[] = [...(songEmails.data || []), ...(txEmails.data || [])]
    .sort((a: SentEmail, b: SentEmail) => String(a.created_at).localeCompare(String(b.created_at)));

  return { messages, emails, phones: [...convs.values()].map((c) => c.phone) };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // ── Admin gate (mirrors admin-songs) ──────────────────────────────────
    const authHeader = req.headers.get('authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    let actor = { id: 'service-role', email: 'service-role' };
    if (jwt !== SUPABASE_SERVICE_ROLE_KEY) {
      const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const { data: userData, error: userErr } = await anonClient.auth.getUser(jwt);
      if (userErr || !userData?.user) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401,
        });
      }
      const { data: adminRow } = await supabase
        .from('admin_users')
        .select('role')
        .eq('user_id', userData.user.id)
        .maybeSingle();
      if (!adminRow) {
        return new Response(JSON.stringify({ error: 'forbidden' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403,
        });
      }
      actor = { id: userData.user.id, email: userData.user.email || userData.user.id };
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'pack');
    const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status,
    });

    // ── action: list ──────────────────────────────────────────────────────
    if (action === 'list') {
      const { data: rows, error: listErr } = await supabase.from('disputes')
        .select('id, stripe_dispute_id, charge_id, payment_intent_id, amount_cents, currency, reason, network_reason_code, status, customer_email, customer_name, evidence_due_by, auto_blocked, outcome, opened_at, closed_at, updated_at, raw')
        .order('opened_at', { ascending: false }).limit(200);
      if (listErr) return json({ error: listErr.message }, 500);
      const emails = [...new Set((rows || []).map((r) => (r.customer_email || '').toLowerCase()).filter(Boolean))];
      const blockedSet = new Set<string>();
      const orders = new Map<string, { total: number; paid: number }>();
      const commsByEmail = new Map<string, { messages: Msg[]; emails: SentEmail[]; phones: string[] }>();
      const firstNames = new Map<string, string>();
      if (emails.length) {
        const { data: blocked } = await supabase.from('blocked_emails').select('email').in('email', emails);
        for (const b of (blocked || [])) blockedSet.add(String(b.email).toLowerCase());
        for (const e of emails) {
          const { data: songRows } = await supabase.from('songs').select('id, amount_paid, whatsapp_phone, sender_name').ilike('email', e).order('created_at', { ascending: false }).limit(500);
          const senderName = ((songRows || []).find((r) => r.sender_name)?.sender_name || '') as string;
          firstNames.set(e, senderName.trim().split(/\s+/)[0] || '');
          const total = (songRows || []).length;
          const paid = (songRows || []).filter((r) => Number(r.amount_paid) > 0).length;
          orders.set(e, { total, paid });
          commsByEmail.set(e, await gatherComms(supabase, e, (songRows || []) as SongLite[]));
        }
      }
      const disputes = (rows || []).map((r) => {
        const raw = (r.raw || {}) as { evidence_details?: { has_evidence?: boolean; submission_count?: number; past_due?: boolean } };
        const e = (r.customer_email || '').toLowerCase();
        const o = orders.get(e);
        const { raw: _raw, ...rest } = r;
        const comms = commsByEmail.get(e);
        return {
          ...rest,
          messages: comms?.messages || [],
          emails_sent: comms?.emails || [],
          phones: comms?.phones || [],
          customer_first_name: firstNames.get(e) || null,
          blocked: blockedSet.has(e),
          evidence_submitted: !!(raw.evidence_details?.submission_count && raw.evidence_details.submission_count > 0),
          ...paymentRail(r.raw),
          orders_total: o ? o.total : null,
          orders_paid: o ? o.paid : null,
        };
      });
      return json({ ok: true, disputes });
    }

    // ── action: unblock / block ───────────────────────────────────────────
    if (action === 'unblock' || action === 'block') {
      const target = String(body.email || '').toLowerCase().trim();
      if (!target.includes('@')) return json({ error: 'email required' }, 400);
      if (action === 'unblock') {
        const { error: delErr } = await supabase.from('blocked_emails').delete().ilike('email', target);
        if (delErr) return json({ error: delErr.message }, 500);
      } else {
        const { error: upErr } = await supabase.from('blocked_emails').upsert(
          { email: target, reason: `MANUAL: blocked from the Disputes tab by ${actor.email}${body.dispute_id ? ` (dispute ${body.dispute_id})` : ''}` },
          { onConflict: 'email', ignoreDuplicates: true },
        );
        if (upErr) return json({ error: upErr.message }, 500);
      }
      return json({ ok: true, email: target, blocked: action === 'block' });
    }

    // ── action: email — outreach to the disputing customer ───────────────
    if (action === 'email') {
      const to = String(body.email || '').toLowerCase().trim();
      const subject = String(body.subject || '').trim();
      const text = String(body.text || '').trim();
      if (!to.includes('@') || !subject || !text) return json({ error: 'email, subject and text required' }, 400);
      if (!SENDGRID_API_KEY) return json({ error: 'SENDGRID_API_KEY not configured' }, 500);
      // Replies go to hola@ unless the caller says otherwise; the acting admin
      // (or an explicit bcc) gets a copy so the thread is never lost.
      const replyTo = String(body.reply_to || SENDER_EMAIL).toLowerCase().trim();
      const bcc = String(body.bcc || (actor.email.includes('@') ? actor.email : '')).toLowerCase().trim();
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1f2937;max-width:600px">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
      const personalization: Record<string, unknown> = { to: [{ email: to }] };
      if (bcc && bcc !== to) personalization.bcc = [{ email: bcc }];
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SENDGRID_API_KEY}` },
        body: JSON.stringify({
          personalizations: [personalization],
          from: { email: SENDER_EMAIL, name: 'Regalos Que Cantan' },
          reply_to: { email: replyTo },
          subject,
          content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
          categories: ['dispute_outreach'],
          custom_args: body.dispute_id ? { dispute_id: String(body.dispute_id) } : undefined,
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error('[dispute-evidence-pack] sendgrid failed:', res.status, errText.slice(0, 300));
        return json({ error: `SendGrid ${res.status}: ${errText.slice(0, 200)}` }, 502);
      }
      const sgId = res.headers.get('x-message-id');
      const { error: logErr } = await supabase.from('email_logs').insert({
        email: to, recipient_name: body.recipient_name || null, email_type: 'dispute_outreach',
        subject, status: 'sent', resend_id: sgId,
      });
      if (logErr) console.error('[dispute-evidence-pack] email_logs insert failed:', logErr.message);
      return json({ ok: true, to, reply_to: replyTo, bcc: bcc || null, sendgrid_message_id: sgId, sent_by: actor.email });
    }

    // ── action: pack (default) ────────────────────────────────────────────
    let email = String(body.email || '').toLowerCase().trim();
    if ((!email || !email.includes('@')) && body.dispute_id) {
      const { data: d } = await supabase.from('disputes').select('customer_email').eq('stripe_dispute_id', String(body.dispute_id)).maybeSingle();
      email = String(d?.customer_email || '').toLowerCase().trim();
    }
    if (!email || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'email required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
      });
    }

    // ── Gather everything ─────────────────────────────────────────────────
    const [songsQ, lyricsQ, disputesQ, emailAggQ] = await Promise.all([
      supabase.from('songs')
        .select('id, created_at, status, occasion, genre, sender_name, recipient_name, relationship, amount_paid, stripe_session_id, client_ip, whatsapp_phone, email_sent_at, song_sms_sent_at, whatsapp_sent_at, download_count, details, lyrics')
        .ilike('email', email).order('created_at'),
      supabase.from('lyric_submissions')
        .select('created_at, sender_name, recipient_name, occasion, genre, used_custom_lyrics, submitted_details, submitted_lyrics, songwriter_notes')
        .ilike('email', email).order('created_at'),
      supabase.from('disputes')
        .select('*').ilike('customer_email', email).order('created_at', { ascending: false }),
      supabase.from('email_events').select('event, ts, ip, user_agent, url')
        .ilike('email', email).order('ts').limit(2000),
    ]);

    const songs = songsQ.data || [];
    const songIds = songs.map((s: { id: string }) => s.id);

    // Every SMS / WhatsApp thread and every email we sent — same gatherer the
    // Disputes tab uses, so the pack and the tab never disagree.
    const comms = await gatherComms(supabase, email, songs as SongLite[]);
    const messages: Record<string, unknown>[] = comms.messages as unknown as Record<string, unknown>[];

    // Consumption log — the new proof-of-consumption trail.
    let accessLog: Record<string, unknown>[] = [];
    if (songIds.length) {
      const { data: acc } = await supabase.from('song_access_log')
        .select('song_id, action, ip, user_agent, created_at')
        .in('song_id', songIds).order('created_at').limit(2000);
      accessLog = acc || [];
    }

    // Email engagement, counted honestly: Google's link-scanner clicks carry a
    // desktop-Chrome UA on Google IPs — split them out, quote only real ones.
    const emailEvents = emailAggQ.data || [];
    const delivered = emailEvents.filter((e: { event: string }) => e.event === 'delivered');
    const opens = emailEvents.filter((e: { event: string }) => e.event === 'open');
    const clicks = emailEvents.filter((e: { event: string }) => e.event === 'click');
    const isCustomerUa = (ua: string | null) => !!ua && /iPhone|Android|Mobile/i.test(ua);
    const realClicks = clicks.filter((e: { user_agent: string | null }) => isCustomerUa(e.user_agent));

    // ── Render markdown ───────────────────────────────────────────────────
    const L: string[] = [];
    L.push(`# Dispute evidence pack — ${email}`);
    L.push(`Generated ${fmt(new Date().toISOString())} from the RQC database. Review before pasting into Stripe.`);
    L.push('');

    for (const d of (disputesQ.data || [])) {
      const dd = d as Record<string, unknown>;
      L.push(`## Stripe dispute on file`);
      L.push(`- **${dd.stripe_dispute_id}** — $${((dd.amount_cents as number) / 100).toFixed(2)} ${String(dd.currency || '').toUpperCase()} · reason ${dd.reason}${dd.network_reason_code ? ` (network code ${dd.network_reason_code})` : ''} · status ${dd.status}`);
      L.push(`- Charge ${dd.charge_id} · PI ${dd.payment_intent_id} · evidence due ${fmt(dd.evidence_due_by as string)} · auto-blocked: ${dd.auto_blocked ? 'yes' : 'no'}`);
      const rail = paymentRail(dd.raw);
      if (rail.payment_method !== 'card') {
        L.push(`- **Paid with ${rail.payment_method.toUpperCase()}** — the provider's own reason code is \`${rail.pm_reason_code || 'n/a'}\`. Stripe's "${dd.reason}" label is a translation; argue against the provider's code.`);
      }
      L.push('');
    }

    L.push(`## Orders (${songs.length} song rows)`);
    for (const s of songs) {
      const r = s as Record<string, unknown>;
      L.push(`### Song ${r.id}`);
      L.push(`- Created ${fmt(r.created_at as string)} · status ${r.status} · ${r.occasion}/${r.genre}`);
      L.push(`- FROM "${r.sender_name}" TO "${r.recipient_name}"${r.relationship ? ` · relationship "${r.relationship}"` : ''}`);
      L.push(`- Paid: ${r.amount_paid ? `$${r.amount_paid} (session ${r.stripe_session_id})` : 'no (free preview order)'}`);
      L.push(`- Order IP ${r.client_ip || '—'} · phone ${r.whatsapp_phone || '—'}`);
      L.push(`- Delivered: email ${fmt(r.email_sent_at as string)} · SMS ${fmt(r.song_sms_sent_at as string)} · WhatsApp ${fmt(r.whatsapp_sent_at as string)} · downloads ${r.download_count ?? 0}`);
      if (r.details) L.push(`- Submitted story: "${String(r.details).slice(0, 600)}"`);
      if (r.lyrics) L.push(`- Delivered lyrics (excerpt): "${String(r.lyrics).replace(/\n+/g, ' / ').slice(0, 400)}"`);
      L.push('');
    }

    if ((lyricsQ.data || []).length) {
      L.push(`## Lyric submissions (${lyricsQ.data!.length})`);
      for (const ls of lyricsQ.data!) {
        const r = ls as Record<string, unknown>;
        L.push(`- ${fmt(r.created_at as string)} · FROM "${r.sender_name}" TO "${r.recipient_name}" · ${r.occasion}/${r.genre} · custom lyrics: ${r.used_custom_lyrics ? 'YES' : 'no'}`);
        if (r.submitted_details) L.push(`  - Story: "${String(r.submitted_details).slice(0, 600)}"`);
        if (r.submitted_lyrics) L.push(`  - Customer's own lyrics: "${String(r.submitted_lyrics).slice(0, 600)}"`);
        if (r.songwriter_notes) L.push(`  - Note: "${String(r.songwriter_notes).slice(0, 300)}"`);
      }
      L.push('');
    }

    L.push(`## Messages (${messages.length} — Twilio-verifiable)`);
    for (const m of messages) {
      const r = m as Record<string, unknown>;
      L.push(`- ${fmt(r.created_at as string)} · ${r.direction === 'inbound' ? '**FROM CUSTOMER**' : 'from us'} · ${r.channel} · ${r.phone}`);
      L.push(`  - "${String(r.body || '').slice(0, 300)}"`);
      L.push(`  - Twilio ${r.twilio_sid || '—'} · status ${r.status}`);
    }
    L.push('');

    L.push(`## Emails we sent (${comms.emails.length})`);
    for (const e of comms.emails) {
      L.push(`- ${fmt(e.created_at)} · ${e.email_type || 'email'} · "${(e.subject || '').slice(0, 120)}" · ${e.status || '—'}${e.opened_at ? ` · opened ${fmt(e.opened_at)}` : ''}${e.clicked_at ? ` · clicked ${fmt(e.clicked_at)}` : ''}`);
    }
    L.push('');

    L.push(`## Email engagement (SendGrid)`);
    L.push(`- Delivered ${delivered.length} · opens ${opens.length} · clicks ${clicks.length} total, of which **${realClicks.length} from the customer's own device** (the rest are Google's link-scanner — quote only the real number)`);
    if (delivered.length) L.push(`- First delivery ${fmt((delivered[0] as { ts: string }).ts)} · last ${fmt((delivered[delivered.length - 1] as { ts: string }).ts)}`);
    for (const c of realClicks.slice(0, 40)) {
      const r = c as Record<string, unknown>;
      L.push(`- CLICK ${fmt(r.ts as string)} · IP ${r.ip} · ${String(r.url || '').slice(0, 110)}`);
    }
    L.push('');

    L.push(`## Consumption log (song_access_log — proof the product was taken)`);
    if (accessLog.length === 0) {
      L.push(`- (empty — this order predates the tracking added 2026-08-19, or the customer pages were never opened)`);
    }
    for (const a of accessLog) {
      const r = a as Record<string, unknown>;
      L.push(`- ${fmt(r.created_at as string)} · **${String(r.action).toUpperCase()}** · song ${String(r.song_id).slice(0, 8)}… · IP ${r.ip} · ${String(r.user_agent || '').slice(0, 80)}`);
    }
    L.push('');

    L.push(`## Reminders for the Stripe form`);
    L.push(`- Why you should win: "The purchase was made by the rightful account owner" · type: Digital product or service`);
    L.push(`- Uploads: Exhibit A = communications · signature slot stays EMPTY · Exhibit C = receipt · Exhibit B = Other evidence`);
    L.push(`- Never attach a refund/cancellation policy to a fraud-coded dispute`);
    L.push(`- AVS/CVC: cite ONLY if the charge was a keyed card with cvc_check/postal pass (never on Link/Google Pay)`);
    L.push(`- The preview is a 40-second window of the real finished song — say "a real preview of the finished song (voice, lyrics, music)", never "heard in full"`);
    const rails = (disputesQ.data || []).map((d) => paymentRail((d as { raw?: unknown }).raw));
    if (rails.some((r) => r.payment_method === 'klarna')) {
      L.push('');
      L.push(`## Klarna dispute — what changes`);
      L.push(`- Klarna decides this, not the card network, and it leans toward its shopper. The allegation is the Klarna code above (e.g. \`return\` = "I returned it / want my money back"), not identity.`);
      L.push(`- Identity arguments are pointless — Klarna already verified the buyer. Lead with: nothing to return (digital), delivered fast, consumed (plays/downloads), no refund request or promise anywhere in the thread.`);
      L.push(`- DO attach the refund policy here ("personalized digital songs are non-refundable once delivered" from the Terms of Service). This is not a fraud-coded dispute.`);
      L.push(`- Quote the customer's own submitted story next to the delivered lyrics — it proves the product was exactly what was ordered.`);
    }

    return new Response(JSON.stringify({ ok: true, email, markdown: L.join('\n') }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
    });
  } catch (e) {
    console.error('[dispute-evidence-pack] error:', e instanceof Error ? e.message : e);
    return new Response(JSON.stringify({ error: 'internal' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
    });
  }
});
