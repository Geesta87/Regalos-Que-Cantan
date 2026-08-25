// supabase/functions/song-notify-me/index.ts
// "Text me when my song is ready" — called by GeneratingPage (anon key) after
// an abnormally long wait. Stores the customer's phone + consent timestamp on
// the order's song rows; poll-processing-songs sends ONE SMS with the
// payment-gated /listen link once every take completes.
//
// The phone goes in songs.sms_notify_phone (NOT whatsapp_phone) so the
// WhatsApp hot-lead pipeline is not triggered by this capture.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Normalize to E.164. US/MX customer base: 10 digits → +1; 11 starting with 1
// → +1...; 12 starting with 52 → +52...; an explicit + passes through if sane.
function normalizePhone(raw: string): string | null {
  const trimmed = (raw || '').trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+') && digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 12 && digits.startsWith('52')) return `+${digits}`;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const headers = { ...corsHeaders, 'Content-Type': 'application/json' };

  try {
    const body = await req.json().catch(() => ({}));
    const sessionId: string | null = body.sessionId || null;
    const songIds: string[] = Array.isArray(body.songIds) ? body.songIds.filter((s: any) => typeof s === 'string').slice(0, 4) : [];
    const phone = normalizePhone(body.phone || '');

    if (!phone) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid_phone' }), { headers, status: 400 });
    }
    if (!sessionId && songIds.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'missing_order' }), { headers, status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const stamp = { sms_notify_phone: phone, sms_notify_requested_at: new Date().toISOString() };
    // Only recent rows — this endpoint is anon-callable, so it must never be
    // usable to attach phones to arbitrary old orders.
    const freshCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    let updated = 0;
    if (sessionId) {
      const { data, error } = await supabase.from('songs').update(stamp)
        .eq('session_id', sessionId)
        .gt('created_at', freshCutoff)
        .select('id');
      if (error) throw new Error(error.message);
      updated += data?.length || 0;
    }
    if (updated === 0 && songIds.length > 0) {
      const { data, error } = await supabase.from('songs').update(stamp)
        .in('id', songIds)
        .gt('created_at', freshCutoff)
        .select('id');
      if (error) throw new Error(error.message);
      updated += data?.length || 0;
    }

    if (updated === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'order_not_found' }), { headers, status: 404 });
    }

    console.log(`[notify-me] ${updated} row(s) flagged for SMS notify (${phone.slice(0, 3)}***${phone.slice(-2)})`);
    return new Response(JSON.stringify({ ok: true, updated }), { headers, status: 200 });
  } catch (e: any) {
    console.error('song-notify-me error:', e.message);
    return new Response(JSON.stringify({ ok: false, error: 'server_error' }), { headers, status: 500 });
  }
});
