// supabase/functions/generate-video/index.ts
// Deploy with: supabase functions deploy generate-video

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SHOTSTACK_API_KEY = Deno.env.get('SHOTSTACK_API_KEY')!;
const SHOTSTACK_API_URL = Deno.env.get('SHOTSTACK_API_URL') || 'https://api.shotstack.io/edit/stage';

const MONTSERRAT_FONT_URL = 'https://fonts.gstatic.com/s/montserrat/v25/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCtr6Hw5aXo.woff2';

// ── HEIC detection + conversion (shared by both the in-house and Shotstack paths) ──
// iPhone photos frequently arrive MISLABELED — a .jpeg/.png/.webp extension (and
// matching content-type) but real HEIC bytes inside. ffmpeg in the in-house renderer
// can't decode HEIC and the whole render dies silently, so we must detect by the
// file's actual magic bytes (ISO-BMFF "ftyp" box + a HEIF brand), not the extension,
// and convert to genuine WebP via Supabase's render endpoint before the renderer sees it.
const HEIF_BRAND_SET = ['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'];
async function isHeicUrl(u: string): Promise<boolean> {
  if (/\.(heic|heif)$/i.test(u.split('?')[0])) return true;
  try {
    const res = await fetch(u, { headers: { Range: 'bytes=0-23' } });
    if (!res.ok) return false;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length < 12) return false;
    if (String.fromCharCode(buf[4], buf[5], buf[6], buf[7]) !== 'ftyp') return false;
    const brand = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]).toLowerCase();
    return HEIF_BRAND_SET.includes(brand);
  } catch { return false; }
}
// Normalize photos to a renderer-safe input BEFORE the in-house ffmpeg renderer
// sees them. The renderer's ffmpeg decodes JPEG/PNG/WebP/BMP/TIFF natively (even
// mislabeled — it reads by content), but it CANNOT decode HEIC (no HEIF demuxer),
// its per-photo "-loop 1" command conflicts with the GIF demuxer, and a giant
// image can spike memory. So for any upload that is HEIC (by magic bytes), an
// uncommon/exotic format, or oversized, we route it through Supabase's image
// transform endpoint → a dimension-capped standard WebP, then re-host it. Normal
// JPEG/PNG/WebP within size pass straight through (fast path, no extra work).
// Any failure falls back to the original URL — normalization never blocks a render.
const SAFE_PASSTHROUGH_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);
const MAX_PASSTHROUGH_BYTES = 9_000_000; // >~9MB: downscale to keep the renderer well under memory limits
const NORMALIZE_MAXDIM = 2880;           // renderer renders at 2160px wide → 2880 source = no visible loss
async function normalizePhotoUrls(supabase: any, supabaseUrl: string, urls: string[]): Promise<string[]> {
  return await Promise.all(urls.map(async (url, idx) => {
    try {
      const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
      let bytes = 0, ctype = '';
      try {
        const h = await fetch(url, { method: 'HEAD' });
        bytes = parseInt(h.headers.get('content-length') || '0', 10);
        ctype = (h.headers.get('content-type') || '').toLowerCase();
      } catch { /* HEAD failed — magic-byte check below still guards HEIC */ }

      const heic = await isHeicUrl(url);
      const exotic = !SAFE_PASSTHROUGH_EXT.has(ext) || (!!ctype && !/(jpeg|jpg|png|webp)/.test(ctype));
      const huge = bytes > MAX_PASSTHROUGH_BYTES;
      if (!heic && !exotic && !huge) return url; // fast path — already safe & sane

      const renderUrl = url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')
        + `?width=${NORMALIZE_MAXDIM}&height=${NORMALIZE_MAXDIM}&resize=contain&format=webp&quality=90`;
      const res = await fetch(renderUrl);
      if (!res.ok) throw new Error(`transform ${res.status}`);
      const buffer = await res.arrayBuffer();
      const objectPath = new URL(url).pathname.slice('/storage/v1/object/public/video-photos/'.length);
      const normPath = objectPath.replace(/\.[^./]+$/, '') + '.norm.webp';
      const { error } = await supabase.storage.from('video-photos').upload(normPath, buffer, { contentType: 'image/webp', upsert: true });
      if (error) { console.warn('[generate-video] normalize upload failed:', url, error.message); return url; }
      const out = `${supabaseUrl}/storage/v1/object/public/video-photos/${normPath}`;
      console.log(`[generate-video] normalized photo ${idx} (${heic ? 'heic ' : ''}${huge ? `huge:${bytes} ` : ''}${exotic ? `exotic:${ext || ctype}` : ''}): ${out}`);
      return out;
    } catch (e) {
      console.warn('[generate-video] normalize failed (using original):', url, (e as Error).message);
      return url; // never block the render
    }
  }));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { videoOrderId, aspectRatio = '9:16', songDuration = null, videoFilter = null, messageUrl = null, messageDuration = null } = await req.json();

    if (!videoOrderId) {
      throw new Error('Missing videoOrderId');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get video order with photo URLs
    const { data: videoOrder, error: orderError } = await supabase
      .from('video_orders')
      .select('*')
      .eq('id', videoOrderId)
      .single();

    if (orderError || !videoOrder) {
      throw new Error('Video order not found');
    }

    if (!videoOrder.paid) {
      throw new Error('Video order not paid');
    }

    if (videoOrder.status !== 'photos_uploaded') {
      throw new Error(`Invalid status: ${videoOrder.status}. Expected photos_uploaded`);
    }

    const photoUrls: string[] = videoOrder.photo_urls || [];
    if (photoUrls.length < 3) {
      throw new Error('Need at least 3 photos');
    }

    // Get song details for text overlays and audio
    const { data: song, error: songError } = await supabase
      .from('songs')
      .select('audio_url, recipient_name, sender_name, occasion, genre')
      .eq('id', videoOrder.song_id)
      .single();

    if (songError || !song || !song.audio_url) {
      throw new Error('Song not found or missing audio');
    }

    // Use filter from request body, fallback to DB value, then default
    const filter = videoFilter || videoOrder.video_filter || 'boost';

    // Get message URL from request or DB
    const personalMessageUrl = messageUrl || videoOrder.message_url || null;

    // ---- IN-HOUSE RENDERER SWITCH ----
    // VIDEO_RENDERER defaults to 'shotstack' (no behavior change). Set the
    // Supabase secret VIDEO_RENDERER=inhouse to route renders to our own
    // Cloud Run FFmpeg service instead. The service renders in the background
    // and calls inhouse-video-callback on completion (mirrors Shotstack's
    // video-callback). Flip back to 'shotstack' for instant rollback.
    const VIDEO_RENDERER = Deno.env.get('VIDEO_RENDERER') || 'shotstack';
    if (VIDEO_RENDERER === 'inhouse') {
      const RENDERER_URL = Deno.env.get('INHOUSE_RENDERER_URL');
      const RENDER_TOKEN = Deno.env.get('RENDER_TOKEN') || '';
      if (!RENDERER_URL) throw new Error('INHOUSE_RENDERER_URL not configured');

      // Normalize any HEIC / exotic-format / oversized photos to a capped WebP
      // before the renderer sees them (ffmpeg can't decode HEIC, the GIF demuxer
      // fights the renderer's -loop flag, and giant images spike memory). Normal
      // JPEG/PNG/WebP pass straight through.
      const safePhotoUrls = await normalizePhotoUrls(supabase, SUPABASE_URL, photoUrls);

      const payload = {
        videoOrderId,
        song_id: videoOrder.song_id,
        photo_urls: safePhotoUrls,
        audio_url: song.audio_url,
        message_url: personalMessageUrl,
        aspect_ratio: aspectRatio,
        video_filter: filter,
        recipient_name: song.recipient_name,
        sender_name: song.sender_name,
      };

      // Fire-and-forget. The in-house Cloud Run service holds the connection for
      // the whole ~6-min render (so Cloud Run scales one render per instance), so
      // we must NOT await it — the edge function would time out. EdgeRuntime
      // .waitUntil keeps this worker alive just long enough to send the request;
      // the render then runs to completion on Cloud Run regardless of our
      // disconnect, and inhouse-video-callback marks the order completed.
      const fire = fetch(`${RENDERER_URL}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-render-token': RENDER_TOKEN },
        body: JSON.stringify(payload),
      })
        .then((r) => console.log(`[generate-video] in-house render finished: ${r.status}`))
        .catch((e) => console.error('[generate-video] in-house dispatch/render error:', e.message));
      try {
        // @ts-ignore — EdgeRuntime is provided by the Supabase edge runtime
        EdgeRuntime.waitUntil(fire);
      } catch (_) { /* runtime without waitUntil — fetch still dispatched */ }

      await supabase
        .from('video_orders')
        .update({
          status: 'processing',
          video_filter: filter,
          aspect_ratio: aspectRatio,
          updated_at: new Date().toISOString(),
        })
        .eq('id', videoOrderId);

      console.log(`[generate-video] dispatched to in-house renderer: ${videoOrderId}`);
      return new Response(
        JSON.stringify({ success: true, videoOrderId, status: 'processing', renderer: 'inhouse' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      );
    }

    // Resolve actual song duration. Caller may pass it (SuccessPage probes the
    // audio element), but manual re-triggers and edge cases won't. If missing,
    // probe the audio file's Content-Length and estimate from 128 kbps bitrate.
    // This ensures we never cut the song short at the hardcoded 210s fallback.
    let resolvedSongDuration = songDuration;
    if (!resolvedSongDuration) {
      try {
        const headRes = await fetch(song.audio_url, { method: 'HEAD' });
        const contentLength = parseInt(headRes.headers.get('content-length') || '0', 10);
        if (contentLength > 0) {
          // Mureka outputs at 192 kbps = 24 000 bytes/sec (confirmed by file analysis).
          // Using 128 kbps (16 000) caused a 1.5× overestimate — videos ran 2+ minutes
          // longer than the audio. Add 1 second buffer so the last note isn't clipped.
          resolvedSongDuration = Math.ceil(contentLength / 24000) + 1;
          console.log(`Probed audio duration: ${contentLength} bytes → ${resolvedSongDuration}s (at 192kbps)`);
        }
      } catch (e) {
        console.warn('Could not probe audio duration:', e);
      }
    }

    // ---- VOICE MESSAGE FORMAT RESOLUTION ----
    // Shotstack audio asset supported formats: mp3, m4a, wav, flac, aac, ogg, opus, wma
    // Browsers produce different formats depending on platform:
    //   iPhone Safari (audio mode)  → audio/mp4  (.mp4) — copy bytes to .m4a (same container)
    //   Chrome Android (audio mode) → audio/mp4 or audio/ogg — both handled natively
    //   Firefox (audio mode)        → audio/ogg  (.ogg) — supported directly
    //   Chrome (audio mode, old)    → audio/webm (.webm) — NOT supported by Shotstack;
    //                                  graceful degradation: show last photo, skip voice track
    //   Any video mode file         → type:'video' with transcode (handled below separately)
    const SHOTSTACK_AUDIO_EXTS = new Set(['mp3', 'm4a', 'wav', 'flac', 'aac', 'ogg', 'opus', 'wma']);

    let isAudioOnlyMessage = false;
    let resolvedMessageUrl = personalMessageUrl; // URL Shotstack will use for audio (null = skip audio)
    if (personalMessageUrl) {
      try {
        const headRes = await fetch(personalMessageUrl, { method: 'HEAD' });
        const ct = headRes.headers.get('content-type') || '';
        if (ct.startsWith('audio/') || ct === 'audio/mp4' || ct === 'audio/webm') {
          isAudioOnlyMessage = true;
          const urlExt = personalMessageUrl.split('?')[0].split('.').pop()?.toLowerCase() || '';
          console.log('[generate-video] Audio-only message detected (content-type:', ct, 'ext:', urlExt, ')');

          if (SHOTSTACK_AUDIO_EXTS.has(urlExt)) {
            // Already a supported extension (ogg, m4a, mp3, etc.) — use directly
            resolvedMessageUrl = personalMessageUrl;
            console.log('[generate-video] Audio format supported directly:', urlExt);
          } else if (urlExt === 'mp4') {
            // iPhone Safari records voice as audio/mp4 (AAC in MPEG-4 container).
            // Shotstack hangs indefinitely when asked to fetch audio/mp4 or .m4a files,
            // but accepts the same bytes when stored as audio/mpeg (.mp3) — confirmed
            // through production testing (2026-05-31). Re-upload with .mp3 extension
            // and audio/mpeg content-type so Shotstack processes it without hanging.
            try {
              const bucketPrefix = '/storage/v1/object/public/video-photos/';
              const objectPath = new URL(personalMessageUrl).pathname.slice(bucketPrefix.length);
              const mp3Path = objectPath.replace(/\.mp4$/, '.mp3');
              const dlRes = await fetch(personalMessageUrl);
              const buffer = await dlRes.arrayBuffer();
              const { error: uploadErr } = await supabase.storage
                .from('video-photos')
                .upload(mp3Path, buffer, { contentType: 'audio/mpeg', upsert: true });
              if (uploadErr) {
                console.warn('[generate-video] .mp4→.mp3 upload failed:', uploadErr.message, '— skipping voice audio');
                resolvedMessageUrl = null;
              } else {
                resolvedMessageUrl = `${SUPABASE_URL}/storage/v1/object/public/video-photos/${mp3Path}`;
                console.log('[generate-video] .mp4→.mp3 (Shotstack compat):', resolvedMessageUrl);
              }
            } catch (copyErr) {
              console.warn('[generate-video] .mp4→.mp3 copy failed:', copyErr, '— skipping voice audio');
              resolvedMessageUrl = null;
            }
          } else {
            // webm or other unsupported format — Shotstack cannot play this as audio
            // Graceful degradation: the message section still shows the last photo +
            // "Un mensaje de …" overlay, but the voice track is omitted.
            console.warn(`[generate-video] Unsupported audio format .${urlExt} — message visual will show but voice track is skipped`);
            resolvedMessageUrl = null;
          }
        }
      } catch (e) {
        console.warn('[generate-video] Could not HEAD-check message URL:', e);
      }
    }

    // Resolve actual message video duration when not supplied by the caller.
    // The SuccessPage passes it via the request body (measured from the <video> element),
    // but manual re-triggers and cron-based re-renders never pass it — those used to
    // silently default to 15 s, cutting off any message longer than 15 s.
    // Fix: probe the real duration from Shotstack's probe API so re-renders are always accurate.
    let resolvedMessageDuration = messageDuration;
    if (personalMessageUrl && !resolvedMessageDuration) {
      try {
        const encodedSrc = encodeURIComponent(personalMessageUrl);
        const probeRes = await fetch(`${SHOTSTACK_API_URL}/probe/${encodedSrc}`, {
          headers: { 'x-api-key': SHOTSTACK_API_KEY },
        });
        if (probeRes.ok) {
          const probeData = await probeRes.json();
          const dur = probeData?.response?.metadata?.format?.duration;
          if (dur) {
            // Keep float precision — do NOT round up. Math.ceil (e.g. 30.21 → 31)
            // padded the message clip ~0.8s past the real footage, which made
            // Shotstack freeze the last video frame while audio continued.
            resolvedMessageDuration = parseFloat(dur);
            console.log(`Probed message video duration: ${dur}s → using ${resolvedMessageDuration}s`);
          }
        }
      } catch (e) {
        console.warn('Could not probe message video duration:', e);
      }
    }

    // Convert any HEIC/HEIF photos to WebP before building the timeline.
    // Shotstack can't decode HEIC and fails the whole render with "unsupported
    // format". iPhone photos frequently arrive MISLABELED — a .jpeg/.webp/.png
    // extension (and matching content-type) but real HEIC bytes inside — so we
    // can't trust the extension. Detect HEIC by the file's actual magic bytes
    // (ISO-BMFF "ftyp" box + a HEIF brand) as well as the extension, then run it
    // through Supabase's render endpoint (which decodes by content) and re-upload
    // as a genuine .webp so the URL Shotstack receives is both valid and supported.
    const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'];
    const looksLikeHeic = async (u: string): Promise<boolean> => {
      if (/\.(heic|heif)$/i.test(u)) return true;
      try {
        // Cheap: only the first 24 bytes are needed to read the ftyp brand.
        const res = await fetch(u, { headers: { Range: 'bytes=0-23' } });
        if (!res.ok) return false;
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.length < 12) return false;
        const box = String.fromCharCode(buf[4], buf[5], buf[6], buf[7]);
        if (box !== 'ftyp') return false;
        const brand = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]).toLowerCase();
        return HEIF_BRANDS.includes(brand);
      } catch (_) {
        return false;
      }
    };

    const resolvedPhotoUrls = await Promise.all(
      photoUrls.map(async (url) => {
        if (!(await looksLikeHeic(url))) return url;
        try {
          // Supabase render endpoint decodes HEIC (by content) → WebP on the fly
          const renderUrl = url.replace(
            '/storage/v1/object/public/',
            '/storage/v1/render/image/public/',
          ) + '?format=webp';

          const res = await fetch(renderUrl);
          if (!res.ok) throw new Error(`Render fetch ${res.status}`);
          const buffer = await res.arrayBuffer();

          // Write to a FRESH .webp object name. Using a new name (rather than
          // overwriting the original, which may carry a misleading extension)
          // guarantees Shotstack sees a .webp URL backed by real WebP bytes.
          const bucketPrefix = '/storage/v1/object/public/video-photos/';
          const objectPath = new URL(url).pathname.slice(bucketPrefix.length);
          const webpPath = objectPath.replace(/\.[^./]+$/, '') + '.heicfix.webp';

          const { error: uploadErr } = await supabase.storage
            .from('video-photos')
            .upload(webpPath, buffer, { contentType: 'image/webp', upsert: true });

          if (uploadErr) {
            console.warn(`[generate-video] WebP upload failed for ${url}:`, uploadErr.message);
            return url;
          }

          const webpUrl = `${SUPABASE_URL}/storage/v1/object/public/video-photos/${webpPath}`;
          console.log(`[generate-video] HEIC→WebP: ${url} → ${webpUrl}`);
          return webpUrl;
        } catch (e) {
          console.warn(`[generate-video] HEIC→WebP conversion failed for ${url}:`, e);
          return url;
        }
      })
    );

    // Build Shotstack timeline with filter + text overlays + optional message.
    // personalMessageUrl = original URL; controls whether the message SECTION is shown.
    // resolvedMessageUrl  = converted/renamed URL for the audio asset (null = skip audio
    //                       but still show last-photo + "Un mensaje de" visual section).
    const timeline = buildShotstackTimeline(
      resolvedPhotoUrls,
      song,
      aspectRatio,
      resolvedSongDuration,
      filter,
      personalMessageUrl,   // show/hide message section
      resolvedMessageUrl,   // actual audio URL for Shotstack (may be null)
      resolvedMessageDuration,
      isAudioOnlyMessage
    );

    console.log('Shotstack timeline:', JSON.stringify(timeline, null, 2));

    // Submit render to Shotstack
    const renderResponse = await fetch(`${SHOTSTACK_API_URL}/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': SHOTSTACK_API_KEY,
      },
      body: JSON.stringify(timeline),
    });

    if (!renderResponse.ok) {
      const errorText = await renderResponse.text();
      console.error('Shotstack error:', errorText);
      throw new Error(`Shotstack render failed: ${renderResponse.status} — ${errorText.substring(0, 500)}`);
    }

    const renderData = await renderResponse.json();
    const renderId = renderData.response?.id;

    if (!renderId) {
      throw new Error('No render ID returned from Shotstack');
    }

    // Update video order with render ID and status
    await supabase
      .from('video_orders')
      .update({
        status: 'processing',
        shotstack_render_id: renderId,
        aspect_ratio: aspectRatio,
        video_filter: filter,
        updated_at: new Date().toISOString(),
      })
      .eq('id', videoOrderId);

    return new Response(
      JSON.stringify({
        success: true,
        videoOrderId,
        renderId,
        status: 'processing',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Generate video error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});

// Build Shotstack JSON timeline with filter + text overlays + optional personal message.
//   personalMessageUrl — original URL; controls whether the message section is rendered.
//   resolvedAudioUrl   — the converted/renamed URL for the audio asset.
//                        May be null (webm / unsupported): show visual section but skip audio clip.
function buildShotstackTimeline(
  photoUrls: string[],
  song: { audio_url: string; recipient_name: string; sender_name: string; occasion: string; genre: string },
  aspectRatio: string,
  songDuration: number | null,
  videoFilter: string,
  personalMessageUrl: string | null = null,
  resolvedAudioUrl: string | null = null,
  msgDuration: number | null = null,
  isAudioOnlyMessage: boolean = false
) {
  const photoCount = photoUrls.length;
  const transitionDuration = 0.5;
  const overlayDuration = 3; // text overlay duration in seconds

  // Photos fill the entire video — no separate title card gaps
  const targetDuration = songDuration
    ? Math.max(30, songDuration)
    : 210; // fallback ~3.5 min

  console.log(`Song duration: ${songDuration}s, target: ${targetDuration}s, photos: ${photoCount}, filter: ${videoFilter}`);

  // Calculate per-photo time to fill the song
  const rawPhotoTime = (targetDuration + (photoCount - 1) * transitionDuration) / photoCount;
  const photoDisplayTime = Math.min(60, Math.max(8, rawPhotoTime));

  // Actual total duration based on photo timing
  const totalDuration = photoCount * photoDisplayTime - (photoCount - 1) * transitionDuration;

  // Resolution / canvas dimensions per aspect ratio.
  // 4:5 is the default — wider than 9:16 so photos aren't squeezed thin,
  // still portrait-friendly for mobile / Instagram.
  const dimensionMap: Record<string, { resolution: string; width: number; height: number }> = {
    '4:5':  { resolution: 'hd', width: 1080, height: 1350 },
    '9:16': { resolution: 'sd', width: 576,  height: 1024 },
    '1:1':  { resolution: 'hd', width: 1080, height: 1080 },
    '16:9': { resolution: 'hd', width: 1280, height: 720  },
  };
  const dims = dimensionMap[aspectRatio] ?? dimensionMap['4:5'];
  const { resolution, width, height } = dims;
  // fontSize scale: 4:5 and 9:16 are portrait-ish, 16:9 is landscape
  const isPortrait = aspectRatio !== '16:9';

  // Ken Burns: slide-only effects — no zoomIn / zoomOut so photos don't feel
  // cropped / blown up. Slide still gives motion without sacrificing framing.
  const effects = ['slideLeft', 'slideRight', 'slideUp', 'slideDown'];

  // ---- TRACK 2 (bottom): Photo clips with filter ----
  const photoClips = photoUrls.map((url, index) => {
    const start = index * (photoDisplayTime - transitionDuration);
    return {
      asset: {
        type: 'image',
        src: url, // HEIC already converted to WebP before buildShotstackTimeline is called
      },
      start,
      length: photoDisplayTime,
      effect: effects[index % effects.length],
      filter: videoFilter,
      transition: {
        in: 'fade',
        out: 'fade',
      },
      fit: 'crop',
    };
  });

  // ---- TRACK 1 (top): Text overlays ----
  const fontFace = `@font-face { font-family: 'Montserrat'; src: url('${MONTSERRAT_FONT_URL}') format('woff2'); }`;

  const openingOverlay = {
    asset: {
      type: 'html',
      html: `<p>Para: ${song.recipient_name}</p>`,
      css: `${fontFace} p { font-family: 'Montserrat', sans-serif; color: #ffffff; font-size: ${isPortrait ? 42 : 48}px; font-weight: 700; text-align: center; text-shadow: 0 2px 12px rgba(0,0,0,0.6); padding: 20px; }`,
      width,
      height,
    },
    start: 0,
    length: overlayDuration,
    transition: {
      in: 'fade',
      out: 'fade',
    },
  };

  const closingOverlay = {
    asset: {
      type: 'html',
      html: `<p>Hecho con amor &#x1F495;<br><span class="brand">regalosquecantan.com</span></p>`,
      css: `${fontFace} p { font-family: 'Montserrat', sans-serif; color: #ffffff; font-size: ${isPortrait ? 28 : 32}px; font-weight: 600; text-align: center; text-shadow: 0 2px 12px rgba(0,0,0,0.6); padding: 20px; } .brand { font-size: ${isPortrait ? 18 : 22}px; font-weight: 400; opacity: 0.8; }`,
      width,
      height,
    },
    start: Math.max(0, totalDuration - overlayDuration),
    length: overlayDuration,
    transition: {
      in: 'fade',
      out: 'fade',
    },
  };

  // ---- PERSONAL MESSAGE CLIP (optional) ----
  // Appended after the photo slideshow. Song fades out, message plays with its own audio.
  //
  // Audio-only messages extend a STILL photo for the message duration, so a +2s buffer
  // is safe (and avoids clipping the last words). Video messages must play their NATURAL
  // length: padding a video clip past its real duration makes Shotstack freeze the last
  // frame, and because iPhone recordings carry an audio track slightly longer than the
  // video track, the audio keeps playing over the frozen frame — the "video freezes but
  // audio continues" bug. So no buffer for video messages.
  const baseMsgDuration = msgDuration && msgDuration > 0 ? msgDuration : 15;
  const messageDuration = isAudioOnlyMessage ? baseMsgDuration + 2 : baseMsgDuration;
  const tracks = [];
  const messageClips = [];

  if (personalMessageUrl) {
    console.log('Adding personal message to timeline:', personalMessageUrl, '→ audio:', resolvedAudioUrl ?? '(skipped)', 'duration:', messageDuration, 'audioOnly:', isAudioOnlyMessage);

    if (isAudioOnlyMessage) {
      // iPhone / Safari audio-only recording: no video stream available.
      // Show the last photo extended for the message duration, and play the
      // voice as an audio clip. The "Un mensaje de …" text overlay still shows.
      const lastPhoto = photoUrls[photoUrls.length - 1];
      messageClips.push({
        asset: { type: 'image', src: lastPhoto },
        start: totalDuration,
        length: messageDuration,
        effect: 'zoomIn',
        transition: { in: 'fade' },
      });
    } else {
      // Full video message — customer's face appears on screen
      messageClips.push({
        asset: {
          type: 'video',
          src: personalMessageUrl,
          volume: 1,
          trim: 0,
          transcode: true,
        },
        start: totalDuration,
        length: messageDuration,
        fit: 'crop',
        transition: { in: 'fade' },
      });
    }

    // "Un mensaje de [sender]" text overlay — shown for both video and audio-only
    messageClips.push({
      asset: {
        type: 'html',
        html: `<p>Un mensaje de ${song.sender_name || 'alguien especial'} &#x1F495;</p>`,
        css: `${fontFace} p { font-family: 'Montserrat', sans-serif; color: #ffffff; font-size: ${isPortrait ? 22 : 26}px; font-weight: 600; text-align: center; text-shadow: 0 2px 12px rgba(0,0,0,0.8); padding: 20px; background: linear-gradient(0deg, rgba(0,0,0,0.6), transparent); }`,
        width,
        height: Math.round(height * 0.2),
      },
      start: totalDuration,
      length: 4,
      transition: { in: 'fade', out: 'fade' },
      position: 'bottom',
    });

    // Move closing overlay to after the message
    closingOverlay.start = totalDuration + messageDuration - overlayDuration;
  }

  // Build tracks
  tracks.push(
    // Track 1 (top): text overlays
    { clips: [openingOverlay, closingOverlay] },
    // Track 2: photo slideshow
    { clips: photoClips },
  );

  // Track 3: personal message (if exists)
  if (messageClips.length > 0) {
    tracks.splice(1, 0, { clips: messageClips });
  }

  // If personal message exists, use audio track instead of soundtrack
  // so the song fades out before the message plays
  if (personalMessageUrl) {
    const audioClips: any[] = [{
      asset: {
        type: 'audio',
        src: song.audio_url,
        volume: 1,
        effect: 'fadeOut',
      },
      start: 0,
      length: totalDuration,
    }];

    // For audio-only messages, add the voice to the audio track when a
    // Shotstack-compatible URL is available (m4a, ogg, mp3 …).
    // resolvedAudioUrl is null when the browser produced an unsupported format
    // (e.g. webm) — in that case we skip the audio clip but the visual section
    // (last photo + "Un mensaje de" overlay) was already added above.
    if (isAudioOnlyMessage && resolvedAudioUrl) {
      audioClips.push({
        asset: {
          type: 'audio',
          src: resolvedAudioUrl,
          volume: 1,
        },
        start: totalDuration,
        length: messageDuration,
      });
    }

    tracks.push({ clips: audioClips });
  }

  const timelineObj: any = { tracks };

  // Only use soundtrack when there's no personal message
  if (!personalMessageUrl) {
    timelineObj.soundtrack = {
      src: song.audio_url,
      effect: 'fadeOut',
    };
  }

  return {
    timeline: timelineObj,
    output: {
      format: 'mp4',
      resolution,
      aspectRatio,
      fps: 30,
    },
    callback: `${SUPABASE_URL}/functions/v1/video-callback`,
  };
}
