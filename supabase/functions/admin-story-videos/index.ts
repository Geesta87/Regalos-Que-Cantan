// supabase/functions/admin-story-videos/index.ts
// Deploy with: supabase functions deploy admin-story-videos --project-ref yzbvajungshqcpusfiia
//
// Powers the admin "Needs Approval" tab for the animated story-video pipeline.
// Auth: verify_jwt = true (default). Dashboard posts with the logged-in admin's JWT;
// we verify the user is in admin_users (matches admin-cloned-voice-songs pattern).
// Actions:
//   { action:'list' }                          -> rows in likeness_review / final_review / … / deleted
//   { action:'approve_likeness', id, index }   -> set approved char + state='building' (+ trigger build)
//   { action:'reject_likeness',  id }          -> state='awaiting_photo'
//   { action:'redo_likeness',    id }          -> regenerate the 2 options from the same photo
//   { action:'delete_order',     id }          -> soft-delete: state='deleted' (Deleted sub-tab)
//   { action:'restore_order',    id }          -> undo a delete, back to the state it came from
//   { action:'approve_final',    id }          -> deliver email + state='delivered'
//   { action:'reject_final',     id }          -> state='building', clear video (rebuild)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STORY_RENDERER_URL = Deno.env.get('STORY_RENDERER_URL'); // Cloud Run /build base (rqc-story-builder)
// STORY_RENDER_TOKEN is the story-builder's own shared secret — deliberately NOT
// RENDER_TOKEN, which belongs to rqc-video-renderer (slideshow pipeline).
const RENDER_TOKEN = Deno.env.get('STORY_RENDER_TOKEN') || Deno.env.get('RENDER_TOKEN');
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const COPILOT_MODEL = Deno.env.get('STORY_COPILOT_MODEL') || 'claude-sonnet-5';
// same stylization suffix the build engine appends — a revised scene must match its siblings
const PIXAR = ' Render as warm, fully-stylized Pixar-style 3D animation (not photorealistic), faithful to the character in the reference. Depict exactly the people described — do NOT duplicate anyone or add unrelated people.';

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

    const { action, id, index, reason, image_id, new_prompt, question, history } = await req.json();

    if (action === 'list') {
      // States returned to the admin UI, which groups them into:
      //   likeness tab   -> likeness_review (pending) + approved history (has
      //                     approved_character_url: building/final_review/delivered)
      //   final-video tab -> building | final_review | delivered (3 sub-tabs) + failed
      //   deleted tab     -> deleted (soft-deleted, restorable)
      // 'delivered' is capped (order by updated_at desc, limit) so the completed
      // history can't grow the payload unbounded.
      const { data: rows, error } = await admin.from('story_video_orders')
        .select('id, state, recipient_photo_url, character_options, approved_character_url, approved_character_at, video_url, storyboard, cast_tags, created_at, updated_at, build_started_at, delivered_at, final_approved_at, deleted_at, deleted_from_state, error, song_id')
        // generating_likeness included so a redo/regenerate shows as "Regenerating…"
        // in the Likeness tab instead of silently vanishing until it's done.
        .in('state', ['generating_likeness', 'likeness_review', 'final_review', 'building', 'failed', 'delivered', 'deleted'])
        .order('updated_at', { ascending: false }).limit(300);
      if (error) throw error;
      // attach recipient name + genre. NOTE: the storyboard (with its assumptions)
      // lives on the ORDER, not the song — the songs table has no storyboard column,
      // so we read assumptions from r.storyboard here (fixes blank names too: the old
      // songs.select included the non-existent 'storyboard' column, erroring the query).
      const songIds = [...new Set((rows || []).map((r: any) => r.song_id).filter(Boolean))];
      const names: Record<string, string> = {};
      if (songIds.length) {
        const { data: songs } = await admin.from('songs').select('id, recipient_name, genre_name').in('id', songIds);
        (songs || []).forEach((s: any) => {
          names[s.id] = `${s.recipient_name || ''}${s.genre_name ? ' · ' + s.genre_name : ''}`;
        });
      }
      // customer-facing share link (vercel.json rewrites /animado/:id -> the mp4)
      const out = (rows || []).map((r: any) => {
        const a = r.storyboard?.assumptions;
        return {
          ...r,
          recipient: names[r.song_id] || '—',
          assumptions: Array.isArray(a) ? a : [],
          share_url: r.state === 'delivered' || r.video_url ? `https://regalosquecantan.com/animado/${r.id}` : null,
        };
      });
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
        approved_character_url: opts[i].url, approved_character_by: userData.user.email, approved_character_at: new Date().toISOString(), state: 'building', build_started_at: new Date().toISOString(),
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
    // Redo the 2 cartoon likeness options from the SAME photo (admin didn't like
    // them, but the photo is fine — no need to bother the customer). Re-runs
    // generate-likeness on the existing recipient_photo_url. State -> generating_
    // likeness, then back to likeness_review with fresh options.
    if (action === 'redo_likeness') {
      const { data: full } = await admin.from('story_video_orders')
        .select('song_id, recipient_photo_url, state').eq('id', id).single();
      if (!full?.recipient_photo_url) return json({ success: false, error: 'no photo on this order to redo from' }, 400);
      await admin.from('story_video_orders').update({ state: 'generating_likeness', character_options: null }).eq('id', id);
      const kick = fetch(`${SUPABASE_URL}/functions/v1/generate-likeness`, {
        method: 'POST', headers: { Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId: full.song_id, recipient_photo_url: full.recipient_photo_url, story_video_order_id: id }),
      }).catch((e) => console.error('redo_likeness kick failed:', e.message));
      // @ts-ignore EdgeRuntime is provided by the platform
      if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(kick);
      return json({ success: true, state: 'generating_likeness' });
    }
    // Soft-delete: the X button on the Animado tab. The row (and its uploaded
    // photos) is kept and moves to the Deleted sub-tab; deleted_from_state
    // remembers where it was so restore puts it right back.
    if (action === 'delete_order') {
      if (order.state === 'deleted') return json({ success: true, state: 'deleted' });
      await admin.from('story_video_orders').update({
        state: 'deleted', deleted_at: new Date().toISOString(), deleted_by: userData.user.email, deleted_from_state: order.state,
      }).eq('id', id);
      return json({ success: true, state: 'deleted' });
    }
    if (action === 'restore_order') {
      if (order.state !== 'deleted') return json({ success: false, error: `state is ${order.state}` }, 400);
      const { data: full } = await admin.from('story_video_orders').select('deleted_from_state').eq('id', id).single();
      const back = full?.deleted_from_state || 'likeness_review';
      await admin.from('story_video_orders').update({ state: back, deleted_at: null, deleted_by: null, deleted_from_state: null }).eq('id', id);
      return json({ success: true, state: back });
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
      await admin.from('story_video_orders').update({ state: 'building', video_url: null, build_started_at: new Date().toISOString() }).eq('id', id);
      if (STORY_RENDERER_URL) fetch(`${STORY_RENDERER_URL}/build`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-render-token': RENDER_TOKEN || '' }, body: JSON.stringify({ order_id: id }) }).catch(() => {});
      return json({ success: true, state: 'building' });
    }
    // ---- scene-level review + revise (Final Video tab) ----

    // Full order detail: every scene in song order with its visual context +
    // persisted asset, plus the song facts the storyboard was built from.
    if (action === 'detail') {
      const { data: full } = await admin.from('story_video_orders')
        .select('id, state, song_id, video_url, recipient_photo_url, approved_character_url, storyboard, scene_assets, morph_asset, cast_tags, error, updated_at')
        .eq('id', id).single();
      if (!full) return json({ success: false, error: 'order not found' }, 404);
      const { data: song } = await admin.from('songs')
        .select('recipient_name, sender_name, relationship, occasion, genre_name, details, lyrics')
        .eq('id', full.song_id).single();
      return json({ success: true, order: full, song: song || null });
    }

    // Revise ONE scene's visual context: saves the new prompt on every scene entry
    // sharing that image_id, then regenerates the image in the BACKGROUND (GPT
    // Image 2 via test-gpt-image). A hero scene's motion clip is cleared so the
    // next re-render animates the NEW image (one Seedance call). UI polls detail.
    if (action === 'revise_scene') {
      if (!image_id || !new_prompt?.trim()) return json({ success: false, error: 'Missing image_id / new_prompt' }, 400);
      const { data: full } = await admin.from('story_video_orders')
        .select('id, state, storyboard, scene_assets, approved_character_url').eq('id', id).single();
      if (!full?.storyboard?.scenes) return json({ success: false, error: 'order has no storyboard' }, 400);
      if (!['final_review', 'building', 'failed'].includes(full.state)) return json({ success: false, error: `state is ${full.state}` }, 400);
      const scenes = full.storyboard.scenes as any[];
      if (!scenes.some((s) => s.image_id === image_id)) return json({ success: false, error: `no scene ${image_id}` }, 400);
      const isHero = scenes.some((s) => s.image_id === image_id && s.hero);

      // 1. persist the new context + mark the scene as revising (UI polls on this)
      const storyboard = { ...full.storyboard, scenes: scenes.map((s) => s.image_id === image_id ? { ...s, visual_prompt: new_prompt.trim() } : s) };
      const assets = (full.scene_assets || []).map((a: any) =>
        a.image_id === image_id ? { ...a, revising: true } : a);
      if (!assets.some((a: any) => a.image_id === image_id)) assets.push({ image_id, image_url: null, motion_url: null, revising: true });
      await admin.from('story_video_orders').update({ storyboard, scene_assets: assets }).eq('id', id);

      // 2. regenerate the image in the background; UI sees revising:false when done.
      // OpenAI's safety system rejects ~1/3 of family-scene attempts at random
      // (verified 2026-07-14: same prompt fails then passes), so ONE attempt used
      // to mean frequent spurious "retry failed". Retry up to 3x, appending a
      // softening suffix from the 2nd attempt on — the same recipe that recovers
      // rejected scenes during full builds.
      const SOFTEN = ' Gentle, wholesome family-friendly stylized illustration.';
      const regen = async () => {
        let newUrl: string | null = null;
        for (let attempt = 0; attempt < 3 && !newUrl; attempt++) {
          try {
            const prompt = new_prompt.trim() + (attempt >= 1 ? SOFTEN : '') + PIXAR;
            const r = await fetch(`${SUPABASE_URL}/functions/v1/test-gpt-image`, {
              method: 'POST', headers: { Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE, 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt, image_urls: [full.approved_character_url], size: '1024x1536', quality: 'medium' }),
            });
            const j = await r.json();
            newUrl = j.url || null;
            if (!newUrl) console.error(`revise_scene gpt-image try${attempt}:`, JSON.stringify(j).slice(0, 200));
          } catch (e) { console.error(`revise_scene regen try${attempt} error:`, (e as Error).message); }
        }
        const { data: cur } = await admin.from('story_video_orders').select('scene_assets').eq('id', id).single();
        const updated = (cur?.scene_assets || []).map((a: any) => a.image_id === image_id
          ? { image_id, image_url: newUrl || a.image_url, motion_url: newUrl && isHero ? null : a.motion_url, revising: false, revise_failed: !newUrl }
          : a);
        await admin.from('story_video_orders').update({ scene_assets: updated }).eq('id', id);
      };
      // @ts-ignore EdgeRuntime is provided by the platform
      if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(regen()); else regen();
      return json({ success: true, revising: image_id, hero: isHero });
    }

    // Re-render the final video reusing every persisted asset (only revised heroes
    // re-animate). state -> building, video cleared, story-builder pinged.
    if (action === 'rerender') {
      await admin.from('story_video_orders').update({ state: 'building', video_url: null, build_started_at: new Date().toISOString() }).eq('id', id);
      if (STORY_RENDERER_URL) fetch(`${STORY_RENDERER_URL}/build`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-render-token': RENDER_TOKEN || '' }, body: JSON.stringify({ order_id: id }) }).catch(() => {});
      return json({ success: true, state: 'building', triggered: !!STORY_RENDERER_URL });
    }

    // Ask-AI copilot: answers grounded in the song's lyrics, the customer's order
    // details, and the storyboard — so the admin can verify scene accuracy.
    if (action === 'copilot') {
      if (!question?.trim()) return json({ success: false, error: 'Missing question' }, 400);
      if (!ANTHROPIC_API_KEY) return json({ success: false, error: 'ANTHROPIC_API_KEY not set' }, 500);
      const { data: full } = await admin.from('story_video_orders')
        .select('song_id, state, storyboard, scene_assets, cast_tags').eq('id', id).single();
      if (!full) return json({ success: false, error: 'order not found' }, 404);
      const { data: song } = await admin.from('songs')
        .select('recipient_name, sender_name, relationship, occasion, genre_name, details, lyrics')
        .eq('id', full.song_id).single();
      const sys = [
        'You are the quality-control copilot for an animated story-video the admin is reviewing before sending it to a paying customer.',
        'Ground every answer ONLY in the facts below. If the storyboard depicts something the customer never stated (people, gender, ages, places, objects), call it out plainly as a likely inaccuracy. Answer in English, concise and direct.',
        '',
        `CUSTOMER ORDER FACTS:\n- Recipient: ${song?.recipient_name || '?'}\n- From (sender): ${song?.sender_name || '?'}\n- Relationship: ${song?.relationship || '?'}\n- Occasion: ${song?.occasion || '?'}\n- Genre: ${song?.genre_name || '?'}\n- Customer's own words (story/details): ${song?.details || '(none provided)'}`,
        '',
        `SONG LYRICS:\n${song?.lyrics || '(none)'}`,
        '',
        `STORYBOARD (scenes in song order; "hero" scenes are animated):\n${JSON.stringify((full.storyboard?.scenes || []).map((s: any) => ({ image_id: s.image_id, anchor: s.anchor, visual: s.visual_prompt, hero: s.hero })), null, 0)}`,
        '',
        `AI'S FLAGGED ASSUMPTIONS (details it guessed, not stated by the customer):\n${JSON.stringify(full.storyboard?.assumptions || [])}`,
        '',
        // Customer-confirmed cast (the "who is who" questionnaire on multi-person
        // photos) — authoritative identities; anything on screen that contradicts
        // a confirmed name/role/description is an inaccuracy.
        `CUSTOMER-CONFIRMED CAST (authoritative — confirmed by the customer at photo upload):\n${Array.isArray(full.cast_tags) && full.cast_tags.length ? JSON.stringify(full.cast_tags) : '(none — single-person photo or questionnaire skipped)'}`,
      ].join('\n');
      const msgs = [...(Array.isArray(history) ? history.slice(-8) : []), { role: 'user', content: question.trim() }];
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: COPILOT_MODEL, max_tokens: 800, system: sys, messages: msgs }),
      });
      const jr = await r.json();
      if (jr.error) return json({ success: false, error: jr.error.message || 'copilot failed' }, 500);
      const answer = (jr.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
      return json({ success: true, answer });
    }

    return json({ success: false, error: 'unknown action' }, 400);
  } catch (e: any) {
    console.error('admin-story-videos error:', e.message);
    return json({ success: false, error: e.message }, 500);
  }
});
