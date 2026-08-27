// _shared/cloned-voice-delivery.ts
// ---------------------------------------------------------------------------
// Shared toolkit for finishing Clone Mi Voz songs. Used by BOTH:
//
//   - cloned-voice-status       (the frontend's 5s polling endpoint)
//   - poll-cloned-voice-songs   (the pg_cron sweeper that finishes songs
//                                after the customer closed the tab)
//
// Why shared: before 2026-08-27, rehosting + the status flip lived ONLY in
// cloned-voice-status, so a closed tab meant a paid song was never finished
// and its Suno CDN URLs expired (~14 days). Keeping the logic here means the
// two callers can never drift apart.
//
// What lives here:
//   - Kie record-info polling helpers (pollKieTask, mapKieTerminal)
//   - copyToPermanentStorage (Suno CDN -> our public cloned-voice-songs bucket)
//   - finalizeFullSongSuccess (rehost both variants + flip row to 'success')
//   - sendClonedVoiceDeliveryEmail  ("tu cancion esta lista", idempotent)
//   - sendClonedVoicePaidEmail      ("pago recibido", idempotent)
//
// Both emails are idempotent via an atomic column claim (set the *_sent_at
// column WHERE it IS NULL before sending; reset to NULL if SendGrid fails),
// so the browser poller and the cron sweeper can race freely.
// ---------------------------------------------------------------------------

import { renderEmail } from './email-shell.ts';
import { buildEmailParts } from './email.ts';
import { buildUnsubscribeHeaders } from './unsubscribe.ts';

const KIE_BASE_URL = Deno.env.get('KIE_BASE_URL') || 'https://api.kie.ai';
const KIE_API_KEY = Deno.env.get('KIE_API_KEY');
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const BASE_URL = Deno.env.get('BASE_URL') || 'https://regalosquecantan.com';
const SENDER_EMAIL = 'hola@regalosquecantan.com';
const SENDER_NAME = 'RegalosQueCantan';

export const PERMANENT_BUCKET = 'cloned-voice-songs';

// Customer-facing genre names for the email credits row. Slugs match
// src/components/clonamivoz/genres.js.
const GENRE_LABELS: Record<string, string> = {
  romantico: 'Romántico',
  balada: 'Balada',
  banda: 'Banda',
  corrido: 'Corrido',
  ranchera: 'Ranchera',
  mariachi: 'Mariachi',
  pop_ballad_en: 'Pop Ballad',
  country_en: 'Country',
  rnb_soul_en: 'R&B / Soul',
  acoustic_singer_en: 'Acoustic',
};

export function genreLabel(slug: string | null | undefined): string {
  return (slug && GENRE_LABELS[slug]) || 'Personalizado';
}

// ---------------------------------------------------------------------------
// Kie polling
// ---------------------------------------------------------------------------

export type SunoSong = {
  id?: string;
  audioId?: string;
  audioUrl?: string;
  streamAudioUrl?: string;
  duration?: number;
  title?: string;
  tags?: string;
};

export type RecordInfoResponse = {
  code: number;
  msg?: string;
  data?: {
    status?:
      | 'PENDING'
      | 'FIRST_SUCCESS'
      | 'TEXT_SUCCESS'
      | 'SUCCESS'
      | 'CREATE_TASK_FAILED'
      | 'GENERATE_AUDIO_FAILED'
      | 'CALLBACK_EXCEPTION'
      | 'SENSITIVE_WORD_ERROR';
    taskId?: string;
    errorCode?: number;
    errorMessage?: string;
    response?: { sunoData?: SunoSong[] };
    sunoData?: SunoSong[];
  };
};

export function mapKieTerminal(
  kieStatus: string | undefined
): 'success' | 'failed' | 'pending' {
  switch (kieStatus) {
    case 'SUCCESS':
      return 'success';
    case 'CREATE_TASK_FAILED':
    case 'GENERATE_AUDIO_FAILED':
    case 'CALLBACK_EXCEPTION':
    case 'SENSITIVE_WORD_ERROR':
      return 'failed';
    default:
      return 'pending';
  }
}

/**
 * Hit Kie's record-info for a taskId. Returns null on network failure so
 * the caller can keep the last-known DB state instead of crashing.
 */
export async function pollKieTask(taskId: string): Promise<RecordInfoResponse | null> {
  try {
    const resp = await fetch(
      `${KIE_BASE_URL}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${KIE_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return await resp.json();
  } catch (e) {
    console.error('[cloned-voice-delivery] Kie fetch failed:', e);
    return null;
  }
}

/** Extract the playable audio URLs out of a Kie SUCCESS payload. */
export function extractSunoUrls(kieData: RecordInfoResponse['data']): string[] {
  const songs: SunoSong[] = kieData?.response?.sunoData || kieData?.sunoData || [];
  return songs
    .map((s) => s.audioUrl || s.streamAudioUrl)
    .filter((u): u is string => typeof u === 'string' && u.length > 0);
}

// ---------------------------------------------------------------------------
// Permanent storage
// ---------------------------------------------------------------------------

/**
 * Download a single Suno MP3 and upload it to our permanent Storage bucket.
 * Returns the public URL we can serve forever, or null if the copy failed.
 */
export async function copyToPermanentStorage(
  supabase: any,
  sunoUrl: string,
  clonedVoiceSongId: string,
  variantLabel: string
): Promise<string | null> {
  try {
    const resp = await fetch(sunoUrl);
    if (!resp.ok) {
      console.warn(
        `[cloned-voice-delivery] Suno fetch returned ${resp.status} for ${variantLabel} of ${clonedVoiceSongId}`
      );
      return null;
    }
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (bytes.length === 0) {
      console.warn(
        `[cloned-voice-delivery] Suno returned empty body for ${variantLabel} of ${clonedVoiceSongId}`
      );
      return null;
    }

    const path = `${clonedVoiceSongId}/${variantLabel}.mp3`;

    const uploadRes = await supabase.storage
      .from(PERMANENT_BUCKET)
      .upload(path, bytes, { contentType: 'audio/mpeg', upsert: true });

    if (uploadRes.error) {
      console.error(
        `[cloned-voice-delivery] Storage upload failed for ${path}:`,
        uploadRes.error
      );
      return null;
    }

    const { data: publicData } = supabase.storage
      .from(PERMANENT_BUCKET)
      .getPublicUrl(path);
    return publicData?.publicUrl || null;
  } catch (e) {
    console.error(
      `[cloned-voice-delivery] Unexpected error copying ${variantLabel} of ${clonedVoiceSongId}:`,
      e
    );
    return null;
  }
}

/**
 * Full-song SUCCESS: copy every variant to permanent storage and flip the
 * row to 'success'. Partial rehost is OK (we keep whatever copied and the
 * sweeper retries the rest); zero-copy is also OK (suno_audio_urls are
 * saved so a later rehost retry can still work while the CDN URLs live).
 *
 * Returns the URLs the caller should surface to the customer (permanent
 * preferred, Suno fallback).
 */
export async function finalizeFullSongSuccess(
  supabase: any,
  clonedVoiceSongId: string,
  sunoUrls: string[]
): Promise<{ audioUrls: string[]; permanentUrls: string[] }> {
  const permanentUrls: string[] = [];
  for (let i = 0; i < sunoUrls.length; i++) {
    const permUrl = await copyToPermanentStorage(
      supabase,
      sunoUrls[i],
      clonedVoiceSongId,
      `v${i + 1}`
    );
    if (permUrl) permanentUrls.push(permUrl);
  }
  if (permanentUrls.length < sunoUrls.length) {
    console.warn(
      `[cloned-voice-delivery] Only copied ${permanentUrls.length}/${sunoUrls.length} variants for ${clonedVoiceSongId} into permanent storage`
    );
  }

  const { error: updateError } = await supabase
    .from('cloned_voice_songs')
    .update({
      status: 'success',
      suno_audio_urls: sunoUrls,
      permanent_audio_urls: permanentUrls.length > 0 ? permanentUrls : null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', clonedVoiceSongId);

  if (updateError) {
    console.error(
      `[cloned-voice-delivery] Failed to persist success for ${clonedVoiceSongId}:`,
      updateError
    );
  }

  return {
    audioUrls: permanentUrls.length > 0 ? permanentUrls : sunoUrls,
    permanentUrls,
  };
}

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

async function sendGridSend(
  to: string,
  subject: string,
  html: string,
  category: string,
  preheader: string
): Promise<boolean> {
  if (!SENDGRID_API_KEY) {
    console.warn('[cloned-voice-delivery] SENDGRID_API_KEY not set, skipping email');
    return false;
  }
  const { html: finalHtml, text: finalText } = buildEmailParts(html, preheader);
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: SENDER_EMAIL, name: SENDER_NAME },
      reply_to: { email: SENDER_EMAIL, name: SENDER_NAME },
      subject,
      // text/plain MUST come before text/html (RFC 2046 multipart/alternative).
      content: [
        { type: 'text/plain', value: finalText },
        { type: 'text/html', value: finalHtml },
      ],
      categories: [category, 'rqc', 'clonamivoz'],
      tracking_settings: {
        click_tracking: { enable: true, enable_text: false },
        open_tracking: { enable: true },
        subscription_tracking: { enable: false },
      },
      headers: await buildUnsubscribeHeaders(to),
    }),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error('[cloned-voice-delivery] SendGrid error:', response.status, errorText.slice(0, 300));
    return false;
  }
  console.log(`[cloned-voice-delivery] Email sent to ${to} | category: ${category}`);
  return true;
}

/**
 * Atomically claim an email column so only one caller sends. Returns true
 * if WE won the claim (caller must send, and reset the column on failure).
 */
async function claimEmailColumn(
  supabase: any,
  rowId: string,
  column: 'delivery_email_sent_at' | 'paid_email_sent_at'
): Promise<boolean> {
  const { data, error } = await supabase
    .from('cloned_voice_songs')
    .update({ [column]: new Date().toISOString() })
    .eq('id', rowId)
    .is(column, null)
    .select('id');
  if (error) {
    console.error(`[cloned-voice-delivery] Claim on ${column} failed for ${rowId}:`, error);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

async function releaseEmailColumn(
  supabase: any,
  rowId: string,
  column: 'delivery_email_sent_at' | 'paid_email_sent_at'
): Promise<void> {
  await supabase
    .from('cloned_voice_songs')
    .update({ [column]: null })
    .eq('id', rowId);
}

/** The durable "come back to your song" page link. The /clonamivoz page's
 *  ?paid=1&song_id= mount path polls the row and renders the finished song. */
export function songPageUrl(clonedVoiceSongId: string): string {
  return `${BASE_URL}/clonamivoz?paid=1&song_id=${clonedVoiceSongId}`;
}

/**
 * "Tu cancion esta lista" — sent exactly once, when a PAID full song reaches
 * 'success'. Row needs: id, customer_email, recipient_name, title,
 * genre_slug, permanent_audio_urls, suno_audio_urls.
 */
export async function sendClonedVoiceDeliveryEmail(supabase: any, row: any): Promise<boolean> {
  const to = (row.customer_email || '').trim();
  if (!to || !to.includes('@')) return false;

  const won = await claimEmailColumn(supabase, row.id, 'delivery_email_sent_at');
  if (!won) return false;

  const recipientName = row.recipient_name || 'tu ser querido';
  const songTitle = row.title || `Canción para ${recipientName}`;
  const urls: string[] =
    (row.permanent_audio_urls && row.permanent_audio_urls.length > 0)
      ? row.permanent_audio_urls
      : (row.suno_audio_urls || []);

  const downloadLinks = urls
    .map((u: string, i: number) => `<a href="${u}" style="color:#a8d6c2;text-decoration:underline;">Versi&oacute;n ${i + 1}</a>`)
    .join(' &middot; ');

  const html = renderEmail({
    palette: 'confirm',
    hero: 'vinyl',
    preheader: 'Tu canción cantada con tu propia voz ya está lista.',
    eyebrow: 'Cantada con tu voz',
    headline: `&iexcl;Tu canci&oacute;n para <span style="color:#8fe6b8;">${recipientName}</span> est&aacute; lista!`,
    sub: `&ldquo;${songTitle}&rdquo; ya est&aacute; terminada &mdash; cantada con tu propia voz. Esc&uacute;chala, desc&aacute;rgala y comp&aacute;rtela cuando quieras: tus enlaces no caducan.`,
    credits: [
      { label: 'Para', value: recipientName },
      { label: 'Estilo', value: genreLabel(row.genre_slug) },
      { label: 'Versiones', value: String(Math.max(urls.length, 1)) },
    ],
    ctaText: '&#9654;&nbsp;&nbsp;Escuchar mi canci&oacute;n&nbsp;&nbsp;&#8594;',
    ctaHref: songPageUrl(row.id),
    subcopy: downloadLinks
      ? `Descarga directa: ${downloadLinks}`
      : 'Guarda este correo — el enlace a tu canción es permanente.',
  });

  const ok = await sendGridSend(
    to,
    `🎤 Tu canción para ${recipientName} está lista — cantada con tu voz`,
    html,
    'clonamivoz_delivery',
    'Tu canción cantada con tu propia voz ya está lista.'
  );
  if (!ok) await releaseEmailColumn(supabase, row.id, 'delivery_email_sent_at');
  return ok;
}

/**
 * "Pago recibido" — sent exactly once, right after the Stripe webhook marks
 * the row paid. Reassures the customer their song is coming EVEN IF they
 * close the tab (the delivery email carries the final links).
 */
export async function sendClonedVoicePaidEmail(supabase: any, row: any): Promise<boolean> {
  const to = (row.customer_email || '').trim();
  if (!to || !to.includes('@')) return false;

  const won = await claimEmailColumn(supabase, row.id, 'paid_email_sent_at');
  if (!won) return false;

  const recipientName = row.recipient_name || 'tu ser querido';

  const html = renderEmail({
    palette: 'confirm',
    hero: 'progress',
    preheader: 'Pago recibido — tu canción se está creando ahora mismo.',
    eyebrow: 'Pago confirmado',
    headline: `Recibimos tu pago. Tu canci&oacute;n para <span style="color:#8fe6b8;">${recipientName}</span> ya se est&aacute; creando.`,
    sub: 'Normalmente tarda 3-5 minutos. Te enviaremos otro correo con tu canci&oacute;n terminada y sus enlaces de descarga permanentes &mdash; puedes cerrar la p&aacute;gina sin miedo.',
    credits: [
      { label: 'Para', value: recipientName },
      { label: 'Estilo', value: genreLabel(row.genre_slug) },
    ],
    ctaText: 'Ver el progreso&nbsp;&nbsp;&#8594;',
    ctaHref: songPageUrl(row.id),
    subcopy: '¿Dudas? Responde a este correo y te ayudamos.',
  });

  const ok = await sendGridSend(
    to,
    `✅ Pago recibido — tu canción para ${recipientName} está en camino`,
    html,
    'clonamivoz_purchase_confirmation',
    'Pago recibido — tu canción se está creando ahora mismo.'
  );
  if (!ok) await releaseEmailColumn(supabase, row.id, 'paid_email_sent_at');
  return ok;
}
