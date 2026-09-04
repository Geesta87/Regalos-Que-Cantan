// supabase/functions/generate-likeness/index.ts
// Deploy with: supabase functions deploy generate-likeness --project-ref yzbvajungshqcpusfiia
//
// STAGE 1 of the story-video pipeline + entry to ADMIN GATE 1.
// Given { songId, recipient_photo_url }, creates a story_video_orders row, generates
// 2 Pixar-cartoon likeness options of the recipient via GPT Image 2 (OpenAI
// images/edits, reference-conditioned), persists them to the story-video-assets bucket,
// and sets state = 'likeness_review' so they appear in the admin "Needs Approval" tab.
// Admin then calls approve-likeness.
//
// Optional targeting inputs (2026-09-02, Alex el Chino 56b175ba: a 12-person family
// photo came back as two DIFFERENT random relatives because the prompt only said
// "the person in the reference photo"):
//   photo_url  — generate FROM this image (e.g. a crop of the recipient / couple)
//                without touching the order's recipient_photo_url, which the
//                storyboard still needs for the group scenes.
//   subject    — who to draw, replacing "the person in the reference photo"
//                (e.g. "the married Mexican couple in the reference photo").
//   extra      — appended to both prompts (wardrobe, framing, "exactly two people").
//
// Server-to-server (no Supabase JWT) -> verify_jwt = false (config.toml).
// Reads OPENAI_API_KEY + service-role key from its own env.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendSms } from '../_shared/send-sms.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const ALERT_SMS_TO = Deno.env.get('ALERT_SMS_TO');
const BUCKET = 'story-video-assets';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

// GPT Image 2 cartoonify (OpenAI images/edits with the photo as reference) -> PNG bytes.
// Fully-Pixar stylization with faithful likeness, replacing Kie nano-banana-edit.
// NOTE: OpenAI's safety system rejects "transform this person" phrasing; prompts must
// DESCRIBE a stylized portrait of "the person in the reference photo". Retries on a
// transient safety/format reject by softening the request.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function gptCartoonOnce(blob: Blob, prompt: string): Promise<Uint8Array | null> {
  const fd = new FormData();
  fd.append('model', 'gpt-image-2');
  fd.append('prompt', prompt.slice(0, 4000));
  fd.append('size', '1024x1536');
  fd.append('quality', 'medium');
  fd.append('n', '1');
  fd.append('image[]', blob, 'photo.png');
  const r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, body: fd });
  const txt = await r.text();
  let j: any; try { j = JSON.parse(txt); } catch { return null; }
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) { console.log(`  gptCartoon reject: ${j?.error?.message?.slice(0, 100) || r.status}`); return null; }
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
async function gptCartoon(blob: Blob, prompt: string): Promise<Uint8Array> {
  const softer = `${prompt} This is a wholesome, family-friendly stylized illustration.`;
  for (const p of [prompt, softer, softer]) {
    const out = await gptCartoonOnce(blob, p);
    if (out) return out;
    await sleep(2000);
  }
  throw new Error('OpenAI rejected the cartoonify after retries');
}

// OpenAI's images/edits endpoint refuses oversized source photos with "Invalid
// image file or mode for image 1" — NOT a safety block, so the softening retries
// can never recover it. 2026-08-16: Jose Angel's 5712x4284 / 5.6MB phone photo
// failed all 6 attempts and stranded the order, while every photo that has ever
// succeeded was <=12MP / <=3.6MB. Modern phones routinely shoot 24MP+, so shrink
// through Supabase Storage's transform endpoint before sending.
// resize=contain is REQUIRED: width alone does NOT preserve the aspect ratio
// (verified — a 4284x5712 photo came back 1400x5712, badly stretched).
const MAX_EDGE = 1600;
function sizedPhotoUrl(url: string): string | null {
  const marker = '/storage/v1/object/public/';
  const i = url.indexOf(marker);
  if (i === -1) return null; // not one of our storage urls — send it untouched
  // v=<now> defeats the CDN cache: a photo re-uploaded to the same path within
  // the cache window otherwise comes back as the OLD bytes (2026-09-04).
  return `${url.slice(0, i)}/storage/v1/render/image/public/${url.slice(i + marker.length)}` +
    `?width=${MAX_EDGE}&height=${MAX_EDGE}&resize=contain&quality=85&v=${Date.now()}`;
}
// Always returns something usable: falls back to the original photo whenever the
// transform is unavailable, so this can only ever help.
async function loadPhoto(photoUrl: string): Promise<Blob> {
  const sized = sizedPhotoUrl(photoUrl);
  if (sized) {
    try {
      const r = await fetch(sized);
      if (r.ok) {
        const b = await r.blob();
        if (b.size > 1000 && b.type.startsWith('image/')) {
          console.log(`  photo downscaled to <=${MAX_EDGE}px (${Math.round(b.size / 1024)}KB)`);
          return b;
        }
      }
      console.log(`  downscale unavailable (http ${r.status}) — using the original photo`);
    } catch (e) { console.log(`  downscale failed (${(e as Error).message}) — using the original photo`); }
  }
  const ref = await fetch(`${photoUrl}${photoUrl.includes('?') ? '&' : '?'}v=${Date.now()}`);
  if (!ref.ok) throw new Error(`ref fetch ${ref.status}`);
  return await ref.blob();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (code: number, o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, 'Content-Type': 'application/json' }, status: code });

  // hoisted so the catch can flag the order it belongs to
  let failOrderId: string | undefined;
  try {
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
    const { songId, recipient_photo_url, story_video_order_id, photo_url, subject, extra } = await req.json();
    const sourceUrl: string | undefined = (typeof photo_url === 'string' && photo_url.trim()) ? photo_url.trim() : recipient_photo_url;
    if (!sourceUrl) throw new Error('Missing recipient_photo_url');

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // create or reuse the order row
    let orderId = story_video_order_id as string | undefined;
    if (!orderId) {
      const { data, error } = await supabase.from('story_video_orders')
        .insert({ song_id: songId || null, recipient_photo_url: recipient_photo_url || sourceUrl, likeness_photo_url: sourceUrl, state: 'generating_likeness' })
        .select('id').single();
      if (error) throw new Error(`insert order: ${error.message}`);
      orderId = data.id;
    } else {
      // only overwrite the order's photo when the caller actually sent one;
      // always remember which photo the likeness comes from — the story builder
      // opens the video on it (morph_photo_url via story-build-context)
      await supabase.from('story_video_orders').update({
        state: 'generating_likeness', error: null,
        ...(recipient_photo_url ? { recipient_photo_url } : {}),
        likeness_photo_url: sourceUrl,
      }).eq('id', orderId);
    }
    failOrderId = orderId;

    // 2 likeness variations for the admin to choose from.
    // STRONG cartoon prompts that demand "3D CARTOON, NOT photorealistic" to force
    // true Pixar. GPT Image 2 stylizes fully and holds the likeness (verified 2026-06-26).
    const who = (typeof subject === 'string' && subject.trim()) ? subject.trim().slice(0, 600) : 'the person in the reference photo';
    const tail = (typeof extra === 'string' && extra.trim()) ? ` ${extra.trim().slice(0, 900)}` : '';
    const prompts = [
      `A warm Disney/Pixar-style 3D ANIMATED CARTOON character portrait of ${who}. Fully stylized 3D animation, NOT photorealistic. Big expressive eyes, smooth rounded stylized features, soft cel-like shading, the bright polished Pixar/Disney movie look (like Encanto/Coco). Faithful, recognizable likeness — same face shape, hair, beard, age and clothing. Soft warm lighting, simple cozy background.${tail}`,
      `A charming Disney/Pixar-style 3D ANIMATED CARTOON character portrait of ${who}: fully 3D-animated (not a photograph, not realistic), big expressive eyes, smooth rounded stylized features, warm gentle expression, the polished animated-movie look. Faithful, recognizable likeness — same hair, age and clothing. Soft golden light, simple warm background.${tail}`,
    ];
    // fetch (and shrink) the source photo ONCE, then style it twice
    const photo = await loadPhoto(sourceUrl);
    const optionBytes = await Promise.all(prompts.map((p) => gptCartoon(photo, p)));

    // persist both into our own storage
    const options: { url: string }[] = [];
    for (let i = 0; i < optionBytes.length; i++) {
      const bytes = optionBytes[i];
      const path = `${orderId}/likeness_${i}.png`;
      const up = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/png', upsert: true });
      if (up.error) throw new Error(`storage upload: ${up.error.message}`);
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      options.push({ url: pub.publicUrl });
    }

    await supabase.from('story_video_orders').update({ character_options: options, state: 'likeness_review', error: null }).eq('id', orderId);

    return json(200, { success: true, story_video_order_id: orderId, state: 'likeness_review', options });
  } catch (e: any) {
    console.error('generate-likeness error:', e.message);
    // NEVER leave a paid order silently stuck. Until 2026-08-16 a failure here
    // just returned 500: the row stayed in 'generating_likeness' with error=null,
    // the admin showed a spinner forever, and nothing recovers it (the
    // recover-stuck-story-builds cron only watches state='building'). Jose Angel's
    // order sat invisible for 40+ min. We now record the reason ON the order — the
    // Likeness tab renders it with a Redo button — and ping the owner.
    if (failOrderId) {
      const msg = `Likeness generation failed: ${e.message}`;
      try {
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
        await admin.from('story_video_orders').update({ error: msg }).eq('id', failOrderId);
      } catch (u: any) { console.error('  could not flag the order:', u?.message); }
      if (ALERT_SMS_TO) {
        try {
          await sendSms(ALERT_SMS_TO, `⚠️ Animado likeness failed (order ${failOrderId.slice(0, 8)}): ${e.message}. Open /admin → Animado → Likeness and press "Redo likeness".`);
        } catch (u: any) { console.error('  alert sms failed:', u?.message); }
      }
    }
    return json(500, { success: false, error: e.message });
  }
});
