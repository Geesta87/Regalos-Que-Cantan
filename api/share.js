// Vercel serverless function — personalized OG tags for shared songs.
//
// Why this exists: the site is a Vite SPA, so Vercel serves /200.html for
// every route. Facebook / WhatsApp / Twitter crawlers don't run JS, so
// when someone shares /song/<ids> the preview shows the generic site card.
//
// This endpoint:
//   - Crawler UA  → returns HTML with song-specific OG tags
//   - Human UA    → 302 redirects to /song/<ids> so they land on the real page
//
// The Facebook share button in SongPage.jsx points at /share/<ids> (rewritten
// to /api/share?ids=<ids> in vercel.json).

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6YnZhanVuZ3NocWNwdXNmaWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5NDM3MjAsImV4cCI6MjA4NDUxOTcyMH0.9cu9re38_Np3Q6xEcjGdEwctSiPAaaqo8W2c3HEx6k4';

const SITE_URL = 'https://www.regalosquecantan.com';
const DEFAULT_OG_IMAGE = `${SITE_URL}/images/og-image.jpg`;

const CRAWLER_UA = /facebookexternalhit|Facebot|Twitterbot|WhatsApp|LinkedInBot|Slackbot|TelegramBot|Discordbot|Pinterest|redditbot|SkypeUriPreview|Embedly|vkShare|W3C_Validator/i;

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeIds(raw) {
  // Accepts "uuid1,uuid2" — keeps only safe characters and caps to 5 ids
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map(s => s.trim())
    .filter(s => /^[a-zA-Z0-9-]{6,64}$/.test(s))
    .slice(0, 5);
}

function prettifyOccasion(occ) {
  if (!occ) return '';
  return String(occ).replace(/_/g, ' ');
}

function buildCopy(songs) {
  const first = songs[0] || {};
  const recipient = (first.recipient_name || '').trim();
  const sender = (first.sender_name || '').trim();
  const genre = (first.genre || '').trim();
  const occasion = prettifyOccasion(first.occasion);

  const isCombo = songs.length > 1;
  const titleBase = recipient
    ? (isCombo ? `🎵 ${songs.length} canciones para ${recipient}` : `🎵 Una canción para ${recipient}`)
    : (isCombo ? '🎵 Canciones personalizadas' : '🎵 Una canción personalizada');

  const descBits = [];
  if (sender) descBits.push(`De ${sender}`);
  if (genre) descBits.push(`Estilo ${genre}`);
  if (occasion) descBits.push(`Ocasión: ${occasion}`);
  const desc = descBits.length
    ? descBits.join(' · ') + ' · Escúchala completa en RegalosQueCantan.'
    : 'Una canción única creada con RegalosQueCantan. Escúchala completa.';

  return { title: titleBase, description: desc };
}

async function fetchSongs(ids) {
  if (!ids.length) return [];
  const inList = ids.map(encodeURIComponent).join(',');
  const url = `${SUPABASE_URL}/rest/v1/songs`
    + `?select=id,recipient_name,sender_name,genre,occasion,share_video_url`
    + `&id=in.(${inList})`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) return [];
  const rows = await res.json();
  // Preserve the order the user shared in
  const map = new Map(rows.map(r => [r.id, r]));
  return ids.map(id => map.get(id)).filter(Boolean);
}

function renderHtml({ songIdsCsv, title, description, canonical, videoUrl }) {
  const safeTitle = escapeHtml(title);
  const safeDesc = escapeHtml(description);
  const safeCanonical = escapeHtml(canonical);
  const songPath = `/song/${escapeHtml(songIdsCsv)}`;

  // When the song has an auto-rendered share video, announce it in OG so the
  // WhatsApp/Facebook preview card carries a play button — the link *looks*
  // like a video before it's even tapped.
  const videoTags = videoUrl ? `
<meta property="og:video" content="${escapeHtml(videoUrl)}" />
<meta property="og:video:secure_url" content="${escapeHtml(videoUrl)}" />
<meta property="og:video:type" content="video/mp4" />
<meta property="og:video:width" content="1280" />
<meta property="og:video:height" content="720" />` : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<title>${safeTitle}</title>
<meta name="description" content="${safeDesc}" />
<link rel="canonical" href="${safeCanonical}" />

<!-- Open Graph / Facebook -->
<meta property="og:type" content="${videoUrl ? 'video.other' : 'music.song'}" />
<meta property="og:url" content="${safeCanonical}" />
<meta property="og:title" content="${safeTitle}" />
<meta property="og:description" content="${safeDesc}" />
<meta property="og:image" content="${DEFAULT_OG_IMAGE}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:locale" content="es_MX" />
<meta property="og:site_name" content="RegalosQueCantan" />${videoTags}

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${safeTitle}" />
<meta name="twitter:description" content="${safeDesc}" />
<meta name="twitter:image" content="${DEFAULT_OG_IMAGE}" />

<!-- Real users get bounced to the actual song page immediately -->
<meta http-equiv="refresh" content="0; url=${songPath}" />
<script>window.location.replace(${JSON.stringify(songPath)});</script>
</head>
<body>
<p>Cargando tu canción… <a href="${songPath}">Haz click aquí si no se redirige.</a></p>
</body>
</html>`;
}

export default async function handler(req, res) {
  try {
    const ids = sanitizeIds(req.query.ids);
    if (!ids.length) {
      res.setHeader('Cache-Control', 'no-store');
      res.writeHead(302, { Location: '/' });
      return res.end();
    }
    const songIdsCsv = ids.join(',');
    const canonical = `${SITE_URL}/song/${songIdsCsv}`;
    const ua = req.headers['user-agent'] || '';
    const isCrawler = CRAWLER_UA.test(ua);

    // Real users: skip the OG render entirely and 302 to the SPA route.
    if (!isCrawler) {
      res.setHeader('Cache-Control', 'no-store');
      res.writeHead(302, { Location: `/song/${songIdsCsv}` });
      return res.end();
    }

    const songs = await fetchSongs(ids);
    const { title, description } = buildCopy(songs);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Allow Facebook/edge caches to keep the OG card warm; humans don't see this anyway.
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
    const videoUrl = songs.find(s => s.share_video_url)?.share_video_url || null;
    res.status(200).send(renderHtml({ songIdsCsv, title, description, canonical, videoUrl }));
  } catch (err) {
    // On failure, fall back to redirecting to the song page so the user still lands somewhere useful.
    const fallback = `/song/${sanitizeIds(req.query.ids).join(',')}`;
    res.setHeader('Cache-Control', 'no-store');
    res.writeHead(302, { Location: fallback });
    res.end();
  }
}
