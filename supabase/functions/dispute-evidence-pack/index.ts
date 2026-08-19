// supabase/functions/dispute-evidence-pack/index.ts
//
// One-click dispute evidence assembler (chargeback defense, 2026-08-19).
//
// POST { email: string, dispute_id?: string } → markdown evidence pack built
// from everything the database knows about that customer:
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

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function fmt(ts: string | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // ── Admin gate (mirrors admin-songs) ──────────────────────────────────
    const authHeader = req.headers.get('authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: userData, error: userErr } = await anonClient.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401,
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
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

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || '').toLowerCase().trim();
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
    const phones = [...new Set(songs.map((s: { whatsapp_phone: string | null }) => (s.whatsapp_phone || '').replace(/\D/g, '')).filter((p: string) => p.length >= 10))];

    // SMS/WhatsApp threads for every phone on file (match with or without +1).
    let messages: Record<string, unknown>[] = [];
    for (const p of phones) {
      const { data: convs } = await supabase.from('sms_conversations').select('id, phone').like('phone', `%${p}`);
      for (const c of (convs || [])) {
        const { data: msgs } = await supabase.from('sms_messages')
          .select('created_at, direction, channel, body, twilio_sid, status')
          .eq('conversation_id', (c as { id: string }).id).order('created_at');
        messages = messages.concat((msgs || []).map((m: Record<string, unknown>) => ({ ...m, phone: (c as { phone: string }).phone })));
      }
    }

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
