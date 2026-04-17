// supabase/functions/resend-purchase-emails/index.ts
// One-off recovery function after the 2026-04-17 stripe-webhook outage.
//
// Sends a short "here's your song link, in case you missed it" email to every
// customer who paid since 2026-04-16 00:00 UTC. Idempotent: uses funnel_events
// rows of step = 'purchase_link_resend_sent' to avoid double-sends if invoked
// more than once.
//
// Auth: caller must send Authorization: Bearer <service role key>. The function
// rejects anything else.
//
// Invoke preview (dry run) — returns the list without sending:
//   curl -sX POST 'https://yzbvajungshqcpusfiia.supabase.co/functions/v1/resend-purchase-emails?dry=1' \
//     -H 'Authorization: Bearer <SERVICE_ROLE_KEY>'
//
// Invoke for real:
//   curl -sX POST 'https://yzbvajungshqcpusfiia.supabase.co/functions/v1/resend-purchase-emails' \
//     -H 'Authorization: Bearer <SERVICE_ROLE_KEY>'

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY')!;

const SENDER_EMAIL = 'hola@regalosquecantan.com';
const SENDER_NAME = 'RegalosQueCantan';
const SITE_URL = 'https://regalosquecantan.com';
const CUTOFF_ISO = '2026-04-16T00:00:00Z';

// Skip internal / test accounts so we don't spam ourselves.
const SKIP_EMAILS = new Set<string>([
  'gerardoyouth@yahoo.com',
  'gerardo@regalosquecantan.com',
]);

function buildHtml(firstName: string, recipientName: string, listenUrl: string): string {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#1a0e08;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#1a0e08;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#1a0e08;">
  <tr><td style="background:linear-gradient(180deg,#2a1408 0%,#1a0e08 100%);padding:48px 30px 28px;text-align:center;">
    <p style="color:#ff6b35;font-size:40px;margin:0 0 12px;">&#127925;</p>
    <h1 style="color:#ffffff;font-size:26px;margin:0 0 10px;font-weight:700;">Hola ${firstName},</h1>
    <p style="color:#c9b99a;font-size:15px;margin:0 0 12px;line-height:1.6;">Queremos asegurarnos de que recibiste tu canci&oacute;n para <strong style="color:#ffd23f;">${recipientName}</strong>.</p>
    <p style="color:#c9b99a;font-size:14px;margin:0;line-height:1.6;">Algunos correos se retrasaron hoy por un problema t&eacute;cnico. Por si no viste el original, aqu&iacute; tienes tu enlace directo:</p>
  </td></tr>
  <tr><td style="background-color:#1a0e08;padding:16px 30px 28px;text-align:center;">
    <a href="${listenUrl}" style="display:inline-block;background:linear-gradient(135deg,#ff6b35 0%,#ff8c42 100%);color:#ffffff;padding:18px 44px;border-radius:50px;text-decoration:none;font-weight:800;font-size:18px;box-shadow:0 4px 20px rgba(255,107,53,0.4);">
      &#127911; Escuchar y descargar mi canci&oacute;n
    </a>
    <p style="color:#a67c52;font-size:13px;margin:20px 0 0;">Si ya la recibiste, puedes ignorar este correo &mdash; es solo un respaldo.</p>
  </td></tr>
  <tr><td style="height:3px;background:linear-gradient(90deg,#ff6b35,#ffd23f,#ff2e88);font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr><td style="background-color:#1a0e08;padding:26px 30px;text-align:center;">
    <p style="color:#c9b99a;font-size:14px;margin:0 0 6px;">Gracias por confiar en nosotros.</p>
    <p style="color:#a67c52;font-size:12px;margin:0;"><a href="mailto:hola@regalosquecantan.com" style="color:#ff6b35;font-weight:600;">hola@regalosquecantan.com</a></p>
    <p style="color:#4a2c1a;font-size:11px;margin:10px 0 0;">&copy; 2026 Regalos Que Cantan</p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SENDGRID_API_KEY}`,
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: SENDER_EMAIL, name: SENDER_NAME },
      reply_to: { email: SENDER_EMAIL, name: SENDER_NAME },
      subject,
      content: [{ type: 'text/html', value: html }],
      categories: ['purchase_link_resend', 'rqc'],
      tracking_settings: {
        click_tracking: { enable: true, enable_text: false },
        open_tracking: { enable: true },
        subscription_tracking: { enable: false },
      },
      headers: {
        'List-Unsubscribe': '<mailto:hola@regalosquecantan.com?subject=unsubscribe>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SendGrid ${response.status}: ${text}`);
  }
}

serve(async (req) => {
  // Service-role bearer JWT required (must have role=service_role claim).
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('not a JWT');
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.role !== 'service_role') throw new Error('need service_role');
  } catch {
    return new Response(JSON.stringify({ error: 'service_role JWT required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry') === '1';

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Pull every paid song since cutoff.
  const { data: rows, error: rowsErr } = await supabase
    .from('songs')
    .select('id, email, recipient_name, sender_name, audio_url, paid_at')
    .eq('paid', true)
    .gte('paid_at', CUTOFF_ISO)
    .not('email', 'is', null)
    .not('audio_url', 'is', null)
    .order('paid_at', { ascending: false });

  if (rowsErr) {
    return new Response(JSON.stringify({ error: rowsErr.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Dedupe by email (keep most recent = first, since ordered DESC).
  const byEmail = new Map<string, any>();
  for (const row of rows || []) {
    const key = (row.email || '').trim().toLowerCase();
    if (!key) continue;
    if (SKIP_EMAILS.has(key)) continue;
    if (!byEmail.has(key)) byEmail.set(key, row);
  }

  // Idempotency: who has already received this resend?
  const { data: alreadyRows } = await supabase
    .from('funnel_events')
    .select('metadata')
    .eq('step', 'purchase_link_resend_sent');
  const alreadySent = new Set<string>();
  for (const r of alreadyRows || []) {
    const em = String((r.metadata as any)?.email || '').toLowerCase();
    if (em) alreadySent.add(em);
  }

  const recipients = Array.from(byEmail.values()).filter(
    (r) => !alreadySent.has(r.email.toLowerCase())
  );

  if (dryRun) {
    return new Response(
      JSON.stringify(
        {
          dry_run: true,
          cutoff_utc: CUTOFF_ISO,
          total_rows_in_window: rows?.length ?? 0,
          unique_candidates: byEmail.size,
          already_sent: alreadySent.size,
          will_send: recipients.length,
          skipped_internal: Array.from(SKIP_EMAILS),
          recipients: recipients.map((r) => ({
            email: r.email,
            recipient_name: r.recipient_name,
            sender_name: r.sender_name,
            song_id: r.id,
            listen_url: `${SITE_URL}/listen?song_id=${r.id}`,
          })),
        },
        null,
        2
      ),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Real send.
  const results: { email: string; ok: boolean; error?: string }[] = [];
  for (const r of recipients) {
    const firstName = ((r.sender_name || '').split(' ')[0] || 'Amigo').trim();
    const recipientName = (r.recipient_name || 'tu ser querido').trim();
    const listenUrl = `${SITE_URL}/listen?song_id=${r.id}`;
    const subject = `🎵 Tu canción de RegalosQueCantan — aquí está tu enlace por si no lo viste`;

    try {
      await sendEmail(r.email, subject, buildHtml(firstName, recipientName, listenUrl));
      await supabase.from('funnel_events').insert([
        {
          step: 'purchase_link_resend_sent',
          metadata: {
            email: r.email,
            song_id: r.id,
            sent_at: new Date().toISOString(),
          },
        },
      ]);
      results.push({ email: r.email, ok: true });
    } catch (e) {
      results.push({ email: r.email, ok: false, error: (e as Error).message });
    }
  }

  return new Response(
    JSON.stringify(
      {
        sent_count: results.filter((r) => r.ok).length,
        failed_count: results.filter((r) => !r.ok).length,
        results,
      },
      null,
      2
    ),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
