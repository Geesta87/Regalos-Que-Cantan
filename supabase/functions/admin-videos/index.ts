// supabase/functions/admin-videos/index.ts
// Deploy with: supabase functions deploy admin-videos --project-ref yzbvajungshqcpusfiia
//
// Powers the admin "Videos" tab for the $9.99 photo-slideshow video product.
// Lets the owner: see every paid video (with a copyable link to give a customer),
// surface PROBLEM videos (failed / stuck rendering), search by name/email, and
// RETRY a problem video (re-dispatches through generate-video → in-house renderer).
//
// Auth: verify_jwt = true (admin JWT). We verify the user is in admin_users
// (matches admin-story-videos / admin-cloned-voice-songs). Service-role for data.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

// "stuck" = processing/photos_uploaded with no video for over this long
const STUCK_MIN = 30;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (o: unknown, code = 200) => new Response(JSON.stringify(o), { headers: { ...cors, 'Content-Type': 'application/json' }, status: code });
  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader) return json({ success: false, error: 'Missing Authorization' }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: ue } = await userClient.auth.getUser();
    if (ue || !userData?.user) return json({ success: false, error: 'Invalid session' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin.from('admin_users').select('role').eq('user_id', userData.user.id).single();
    if (!roleRow) return json({ success: false, error: 'Not authorized' }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'list';

    // attach recipient name + email from the songs table to a set of orders
    const withSong = async (rows: any[]) => {
      const ids = [...new Set(rows.map((r) => r.song_id).filter(Boolean))];
      const map: Record<string, any> = {};
      if (ids.length) {
        const { data: songs } = await admin.from('songs').select('id, recipient_name, sender_name, email').in('id', ids);
        (songs || []).forEach((s: any) => { map[s.id] = s; });
      }
      return rows.map((r) => ({
        id: r.id, song_id: r.song_id, status: r.status, video_url: r.video_url,
        photo_count: r.photo_count, error_message: r.error_message,
        created_at: r.created_at, updated_at: r.updated_at,
        // Which engine produced it: in-house renders never set a Shotstack id.
        renderer: r.shotstack_render_id ? 'shotstack' : 'inhouse',
        recipient_name: map[r.song_id]?.recipient_name || '—',
        sender_name: map[r.song_id]?.sender_name || '',
        email: map[r.song_id]?.email || '',
      }));
    };

    if (action === 'list') {
      // counts by status (paid)
      const statuses = ['completed', 'processing', 'photos_uploaded', 'pending', 'failed'];
      const counts: Record<string, number> = {};
      for (const st of statuses) {
        const { count } = await admin.from('video_orders').select('id', { count: 'exact', head: true }).eq('paid', true).eq('status', st);
        counts[st] = count ?? 0;
      }

      // PROBLEMS: failed, or stuck (processing/photos_uploaded) older than STUCK_MIN
      const stuckCutoff = new Date(Date.now() - STUCK_MIN * 60 * 1000).toISOString();
      const { data: failed } = await admin.from('video_orders')
        .select('id, song_id, status, video_url, photo_count, error_message, created_at, updated_at, shotstack_render_id')
        .eq('paid', true).eq('status', 'failed').eq('admin_dismissed', false).order('updated_at', { ascending: false }).limit(50);
      const { data: stuck } = await admin.from('video_orders')
        .select('id, song_id, status, video_url, photo_count, error_message, created_at, updated_at, shotstack_render_id')
        .eq('paid', true).in('status', ['processing', 'photos_uploaded']).eq('admin_dismissed', false).lt('updated_at', stuckCutoff)
        .order('updated_at', { ascending: false }).limit(50);
      const problems = await withSong([...(failed || []), ...(stuck || [])]);

      // recent completed (for quick "give the customer their link")
      const { data: recent } = await admin.from('video_orders')
        .select('id, song_id, status, video_url, photo_count, error_message, created_at, updated_at, shotstack_render_id')
        .eq('paid', true).eq('status', 'completed').not('video_url', 'is', null)
        .order('updated_at', { ascending: false }).limit(40);
      const completed = await withSong(recent || []);

      return json({ success: true, role: roleRow.role, counts, problems, completed });
    }

    if (action === 'search') {
      const q = String(body.q || '').trim();
      if (!q) return json({ success: true, results: [] });
      // find matching songs first, then their video orders
      const { data: songs } = await admin.from('songs')
        .select('id').or(`recipient_name.ilike.%${q}%,sender_name.ilike.%${q}%,email.ilike.%${q}%`).limit(40);
      const songIds = (songs || []).map((s: any) => s.id);
      if (!songIds.length) return json({ success: true, results: [] });
      const { data: rows } = await admin.from('video_orders')
        .select('id, song_id, status, video_url, photo_count, error_message, created_at, updated_at, shotstack_render_id')
        .eq('paid', true).in('song_id', songIds).order('updated_at', { ascending: false }).limit(40);
      return json({ success: true, results: await withSong(rows || []) });
    }

    if (action === 'dismiss') {
      const id = body.id;
      if (!id) return json({ success: false, error: 'Missing id' }, 400);
      await admin.from('video_orders').update({ admin_dismissed: true }).eq('id', id);
      return json({ success: true });
    }

    if (action === 'retry') {
      const id = body.id;
      if (!id) return json({ success: false, error: 'Missing id' }, 400);
      // reset so generate-video will re-render it through the in-house renderer
      await admin.from('video_orders').update({ status: 'photos_uploaded', shotstack_render_id: null, error_message: null }).eq('id', id);
      const r = await fetch(`${SUPABASE_URL}/functions/v1/generate-video`, {
        method: 'POST', headers: { Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoOrderId: id }),
      });
      const rj = await r.json().catch(() => ({}));
      if (!rj.success) return json({ success: false, error: rj.error || 'retry dispatch failed' });
      return json({ success: true, renderer: rj.renderer || 'shotstack', status: rj.status });
    }

    return json({ success: false, error: 'unknown action' }, 400);
  } catch (e: any) {
    console.error('admin-videos error:', e.message);
    return json({ success: false, error: e.message }, 500);
  }
});
