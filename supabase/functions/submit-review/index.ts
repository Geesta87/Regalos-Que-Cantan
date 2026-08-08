// supabase/functions/submit-review/index.ts
// ===========================================================================
// PUBLIC review capture — a customer rates their song 1-5 (+ optional comment).
// Called from the /calificar page with the anon key (no user account exists).
// Validates that the song is real and PAID before accepting; one review per
// song (DB unique constraint). Approved reviews become the REAL star ratings
// shown in Google results (prerender reads the aggregate at build time) —
// replacing the fabricated ratings we removed in July with honest ones.
//
// Deploy: supabase functions deploy submit-review --project-ref yzbvajungshqcpusfiia
// (config.toml pins verify_jwt = false — customers have no JWT.)
// ===========================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    let body: any = {}; try { body = await req.json(); } catch { body = {}; }
    const songId = String(body.song_id || '').trim();
    const rating = Number(body.rating);
    const comment = String(body.comment || '').trim().slice(0, 600);
    const name = String(body.name || '').trim().slice(0, 60);

    if (!/^[0-9a-f-]{36}$/i.test(songId)) return json({ success: false, error: 'invalid song' }, 400);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return json({ success: false, error: 'rating must be 1-5' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: song } = await admin.from('songs').select('id, paid').eq('id', songId).maybeSingle();
    if (!song) return json({ success: false, error: 'song not found' }, 404);
    if (!song.paid) return json({ success: false, error: 'only purchased songs can be reviewed' }, 403);

    const { error } = await admin.from('song_reviews').insert({
      song_id: songId, rating, comment: comment || null, reviewer_name: name || null,
    });
    if (error) {
      if (String(error.code) === '23505') return json({ success: false, error: 'already_reviewed' }, 200);
      throw error;
    }
    return json({ success: true });
  } catch (e: any) {
    return json({ success: false, error: String(e?.message || e).slice(0, 200) }, 500);
  }
});
