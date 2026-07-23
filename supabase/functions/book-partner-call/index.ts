// supabase/functions/book-partner-call/index.ts
// ===========================================================================
// BOOK PARTNER CALL — public booking endpoint for /partners
// ===========================================================================
// The /partners page (AffiliateVSL) posts {name, phone, date, time} when a
// prospect schedules the no-commitment intro call. Stores the request in
// partner_call_bookings so it shows up in the admin dashboard's Recruit
// Partners → Scheduled Calls sub-tab; the page then opens WhatsApp so the
// owner also gets the direct message.
//
// Called from the public frontend with the Supabase anon key (a valid JWT),
// so verify_jwt stays TRUE — same pattern as create-checkout / recover-song.
// Deploy: supabase functions deploy book-partner-call --project-ref yzbvajungshqcpusfiia

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendSms } from '../_shared/send-sms.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ALERT_SMS_TO = Deno.env.get('ALERT_SMS_TO');
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// Must match the slots offered on the /partners page.
const ALLOWED_TIMES = ['10:00 AM', '11:00 AM', '12:00 PM', '2:00 PM', '4:00 PM', '5:00 PM', '6:00 PM'];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { success: false, error: 'POST only' });

  let body: any = {};
  try { body = await req.json(); } catch { return json(400, { success: false, error: 'Invalid JSON' }); }

  const name = String(body.name || '').trim().slice(0, 80);
  const phoneDigits = String(body.phone || '').replace(/\D/g, '');
  const date = String(body.date || '').trim(); // YYYY-MM-DD
  const time = String(body.time || '').trim();

  if (name.length < 2) return json(400, { success: false, error: 'Name required' });
  if (phoneDigits.length < 10 || phoneDigits.length > 15) return json(400, { success: false, error: 'Valid phone required' });
  if (!ALLOWED_TIMES.includes(time)) return json(400, { success: false, error: 'Invalid time slot' });

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(400, { success: false, error: 'Invalid date' });
  const picked = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(picked.getTime())) return json(400, { success: false, error: 'Invalid date' });
  const dow = picked.getUTCDay();
  if (dow === 0 || dow === 6) return json(400, { success: false, error: 'Weekdays only' });
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysOut = Math.round((picked.getTime() - todayUtc) / 86400000);
  if (daysOut < 0 || daysOut > 45) return json(400, { success: false, error: 'Date out of range' });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Idempotent: repeat submits of the same slot from the same phone don't
  // create duplicate rows (double-taps, back button, retries).
  const { data: existing } = await supabase.from('partner_call_bookings')
    .select('id').eq('phone', phoneDigits).eq('preferred_date', date).eq('preferred_time', time).limit(1).maybeSingle();
  if (existing) return json(200, { success: true, id: existing.id, duplicate: true });

  // Light abuse guard: one phone can't flood the queue.
  const dayAgo = new Date(Date.now() - 86400000).toISOString();
  const { count } = await supabase.from('partner_call_bookings')
    .select('id', { count: 'exact', head: true }).eq('phone', phoneDigits).gte('created_at', dayAgo);
  if ((count ?? 0) >= 5) return json(429, { success: false, error: 'Too many requests' });

  const { data, error } = await supabase.from('partner_call_bookings')
    .insert({ name, phone: phoneDigits, preferred_date: date, preferred_time: time, source: 'partners_page' })
    .select('id').single();
  if (error) return json(500, { success: false, error: error.message });

  // Owner heads-up SMS (same ALERT_SMS_TO pattern as media-buyer-intraday).
  // Best-effort: an SMS failure must never fail the booking.
  if (ALERT_SMS_TO) {
    const dateLabel = picked.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    try {
      const r = await sendSms(ALERT_SMS_TO, `📅 Nueva llamada de partner: ${name} — ${dateLabel}, ${time} (PT). Tel: ${phoneDigits}. Confírmala en el dashboard (Recruit Partners → Scheduled Calls).`);
      if (!r.ok) console.warn('booking alert SMS failed:', r.error);
    } catch (e) { console.warn('booking alert SMS failed:', e); }
  }

  return json(200, { success: true, id: data.id });
});
