// Vercel serverless function — branded short link for SMS.
//
// /s/<code>  (rewritten to /api/s?code=<code> in vercel.json) looks up the
// song by its short_code and 302-redirects to the real song page. Keeps the
// SMS link short + on-brand (regalosquecantan.com/s/k7Qm2) instead of a long
// /success?song_id=<uuid>. On any miss/error it bounces to the homepage so the
// customer always lands somewhere valid.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6YnZhanVuZ3NocWNwdXNmaWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5NDM3MjAsImV4cCI6MjA4NDUxOTcyMH0.9cu9re38_Np3Q6xEcjGdEwctSiPAaaqo8W2c3HEx6k4';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const code = String(req.query.code || '').trim();
    // Codes are short alphanumerics; reject anything else outright.
    if (!/^[a-zA-Z0-9]{4,16}$/.test(code)) {
      res.writeHead(302, { Location: '/' });
      return res.end();
    }

    const url = `${SUPABASE_URL}/rest/v1/songs`
      + `?select=id&short_code=eq.${encodeURIComponent(code)}&limit=1`;
    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    const rows = r.ok ? await r.json() : [];
    const songId = rows[0] && rows[0].id;

    res.writeHead(302, { Location: songId ? `/success?song_id=${songId}` : '/' });
    return res.end();
  } catch (_err) {
    res.writeHead(302, { Location: '/' });
    return res.end();
  }
}
