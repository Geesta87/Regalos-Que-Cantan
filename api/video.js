// Vercel serverless function — serve video download via regalosquecantan.com URL.
// Usage: /api/video?song_id=<uuid>
// Looks up the video_url for that song and redirects to the MP4 file.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6YnZhanVuZ3NocWNwdXNmaWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5NDM3MjAsImV4cCI6MjA4NDUxOTcyMH0.9cu9re38_Np3Q6xEcjGdEwctSiPAaaqo8W2c3HEx6k4';

export default async function handler(req, res) {
  const { song_id } = req.query;

  if (!song_id) {
    return res.status(400).send('Missing song_id');
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/video_orders?song_id=eq.${song_id}&paid=eq.true&status=eq.completed&select=video_url&order=created_at.desc&limit=1`,
    {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    }
  );

  if (!response.ok) {
    return res.status(502).send('Error fetching video');
  }

  const data = await response.json();
  const videoUrl = data?.[0]?.video_url;

  if (!videoUrl) {
    return res.status(404).send('Video not found');
  }

  res.setHeader('Content-Disposition', 'attachment; filename="regalosquecantan.mp4"');
  res.redirect(302, videoUrl);
}
