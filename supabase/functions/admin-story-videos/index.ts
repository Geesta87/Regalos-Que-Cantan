// supabase/functions/admin-story-videos/index.ts
// Deploy with: supabase functions deploy admin-story-videos --project-ref yzbvajungshqcpusfiia
//
// Powers the admin "Needs Approval" tab for the animated story-video pipeline.
// Auth: verify_jwt = true (default). Dashboard posts with the logged-in admin's JWT;
// we verify the user is in admin_users (matches admin-cloned-voice-songs pattern).
// Actions:
//   { action:'list' }                          -> rows in likeness_review / final_review
//   { action:'approve_likeness', id, index }   -> set approved char + state='building' (+ trigger build)
//   { action:'reject_likeness',  id }          -> state='awaiting_photo'
//   { action:'approve_final',    id }          -> state='delivered' (+ deliver email TODO)
//   { action:'reject_final',     id }          -> state='building', clear video (rebuild)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STORY_RENDERER_URL = Deno.env.get('STORY_RENDERER_URL'); // Cloud Run /build base (optional until deployed)
const RENDER_TOKEN = Deno.env.get('RENDER_TOKEN');

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

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

    const { action, id, index, reason } = await req.json();

    if (action === 'list') {
      const { data: rows, error } = await admin.from('story_video_orders')
        .select('id, state, recipient_photo_url, character_options, approved_character_url, video_url, created_at, song_id')
        .in('state', ['likeness_review', 'final_review']).order('created_at', { ascending: true });
      if (error) throw error;
      // attach recipient name
      const songIds = [...new Set((rows || []).map((r: any) => r.song_id).filter(Boolean))];
      const names: Record<string, string> = {};
      const assumptionsBySong: Record<string, any[]> = {};
      if (songIds.length) {
        const { data: songs } = await admin.from('songs').select('id, recipient_name, genre_name, storyboard').in('id', songIds);
        (songs || []).forEach((s: any) => {
          names[s.id] = `${s.recipient_name || ''}${s.genre_name ? ' · ' + s.genre_name : ''}`;
          const a = s.storyboard?.assumptions;
          if (Array.isArray(a) && a.length) assumptionsBySong[s.id] = a;
        });
      }
      const out = (rows || []).map((r: any) => ({ ...r, recipient: names[r.song_id] || '—', assumptions: assumptionsBySong[r.song_id] || [] }));
      return json({ success: true, role: roleRow.role, count: out.length, orders: out });
    }

    if (!id) return json({ success: false, error: 'Missing id' }, 400);
    const { data: order } = await admin.from('story_video_orders').select('id, state, character_options').eq('id', id).single();
    if (!order) return json({ success: false, error: 'order not found' }, 404);

    if (action === 'approve_likeness') {
      if (order.state !== 'likeness_review') return json({ success: false, error: `state is ${order.state}` }, 400);
      const opts = order.character_options as { url: string }[];
      const i = Number(index);
      if (!opts?.[i]) return json({ success: false, error: 'invalid index' }, 400);
      await admin.from('story_video_orders').update({
        approved_character_url: opts[i].url, approved_character_by: userData.user.email, approved_character_at: new Date().toISOString(), state: 'building',
      }).eq('id', id);
      // trigger the Cloud Run build if configured (else it waits for the renderer/cron)
      if (STORY_RENDERER_URL) {
        fetch(`${STORY_RENDERER_URL}/build`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-render-token': RENDER_TOKEN || '' }, body: JSON.stringify({ order_id: id }) }).catch(() => {});
      }
      return json({ success: true, state: 'building', triggered: !!STORY_RENDERER_URL });
    }
    if (action === 'reject_likeness') {
      await admin.from('story_video_orders').update({ state: 'awaiting_photo', character_options: null, photo_reminder_at: null }).eq('id', id);
      // ask the customer for a better photo (SendGrid, fire-and-forget)
      fetch(`${SUPABASE_URL}/functions/v1/animado-notify`, {
        method: 'POST', headers: { Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'redo', order_id: id, reason: reason || null }),
      }).catch(() => {});
      return json({ success: true, state: 'awaiting_photo' });
    }
    if (action === 'approve_final') {
      if (order.state !== 'final_review') return json({ success: false, error: `state is ${order.state}` }, 400);
      await admin.from('story_video_orders').update({ final_approved: true, final_approved_by: userData.user.email, final_approved_at: new Date().toISOString() }).eq('id', id);
      // email the customer their video + mark delivered
      const d = await fetch(`${SUPABASE_URL}/functions/v1/deliver-story-video`, {
        method: 'POST', headers: { Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ story_video_order_id: id }),
      });
      const dj = await d.json().catch(() => ({}));
      if (!dj.success) return json({ success: true, state: 'final_review', warning: `aprobado pero el envío falló: ${dj.error || 'desconocido'}` });
      return json({ success: true, state: 'delivered', delivered_to: dj.delivered_to });
    }
    if (action === 'reject_final') {
      await admin.from('story_video_orders').update({ state: 'building', video_url: null }).eq('id', id);
      if (STORY_RENDERER_URL) fetch(`${STORY_RENDERER_URL}/build`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-render-token': RENDER_TOKEN || '' }, body: JSON.stringify({ order_id: id }) }).catch(() => {});
      return json({ success: true, state: 'building' });
    }
    return json({ success: false, error: 'unknown action' }, 400);
  } catch (e: any) {
    console.error('admin-story-videos error:', e.message);
    return json({ success: false, error: e.message }, 500);
  }
});
