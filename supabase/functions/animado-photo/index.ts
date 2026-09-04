// supabase/functions/animado-photo/index.ts
// Deploy with: supabase functions deploy animado-photo --project-ref yzbvajungshqcpusfiia
//
// Customer photo upload for the Animado pipeline, used by the success page.
//   { action:'sign',    story_video_order_id, which:'main'|'family' }
//        -> a signed PUT url to upload that photo into story-video-assets/{orderId}/source-<which>.jpg
//   { action:'analyze', story_video_order_id, has_family, which? }
//        which:'main'|'family' analyzes THAT photo (the new one-screen upload runs
//        it once per photo). Every person comes back with a normalized FACE box
//        {x,y,w,h} so the customer can TAP who is who instead of reading prose.
//        -> Claude vision inventories everyone in the just-uploaded photo and proposes
//           a cast (physical description + a guessed role/name per person) for the
//           customer to CONFIRM. This is the Stage-3 "who is who" step: cast lock stops
//           being an AI guess and becomes customer-confirmed ground truth.
//   { action:'questions', story_video_order_id, force? }
//        -> "ASK THE SONG": Claude reads the customer's story + the finished lyrics
//           and returns up to 3 short questions (Spanish) about the concrete blanks
//           the storyboard would otherwise have to INVENT (place they met, their
//           trade, an object/team/pet/dish). Cached on the order (detail_questions);
//           force:true regenerates. Different for every song — the questions quote
//           the customer's own lines. Falls back to [] so the frontend can use its
//           per-relationship templates.
//   { action:'attach',  story_video_order_id, has_family, cast?, answers? }
//        -> sets the order's recipient_photo_url (the family photo when present, since it
//           captures everyone; otherwise the main photo), stores the confirmed `cast` on
//           the order (cast_tags), moves it to generating_likeness, and kicks off
//           generate-likeness (the 2 cartoon options) + generate-storyboard.
//           Also texts the owner (ALERT_SMS_TO) — a paid customer's photo just landed,
//           so a likeness is about to need review in the Animado tab.
//
// verify_jwt = false (called from the browser with the anon key; the order id is the
// only thing needed and the work it triggers is bounded + admin-reviewed).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendSms } from '../_shared/send-sms.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const CAST_MODEL = Deno.env.get('STORY_CAST_MODEL') || 'claude-sonnet-5';
// Owner's cell for the "photo just came in" heads-up (same secret health-check uses).
const ALERT_SMS_TO = Deno.env.get('ALERT_SMS_TO');
const BUCKET = 'story-video-assets';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

// role options the customer picks from (kept in sync with the frontend dropdown)
const ROLES = ['recipient', 'sender', 'spouse', 'daughter', 'son', 'mother', 'father', 'grandmother', 'grandfather', 'sibling', 'friend', 'other'];

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (c: number, o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, 'Content-Type': 'application/json' }, status: c });
  try {
    const { action, story_video_order_id, which, has_family, phone, ext: rawExt, cast: castInput, answers: answersInput, force, likeness: likenessInput, names_override: namesInput } = await req.json();
    if (!story_video_order_id) throw new Error('Missing story_video_order_id');
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: order } = await supabase.from('story_video_orders')
      .select('id, song_id, state').eq('id', story_video_order_id).single();
    if (!order) throw new Error('order not found');

    if (action === 'sign') {
      // 'main'/'family' are the customer slots; any other sanitized slot is allowed
      // for admin tooling (e.g. style-explorer uploads), always scoped to this order's folder.
      const slot = String(which || 'main').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'main';
      const ext = String(rawExt || 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'jpg';
      const path = `${story_video_order_id}/source-${slot}.${ext}`;
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
      if (error) throw new Error(`sign: ${error.message}`);
      return json(200, { success: true, signed_url: data.signedUrl, path });
    }

    const pub = (slot: string) => supabase.storage.from(BUCKET).getPublicUrl(`${story_video_order_id}/source-${slot}.jpg`).data.publicUrl;

    if (action === 'analyze') {
      // Propose the cast from the just-uploaded photo for the customer to confirm.
      // Best-effort: if anything fails, return an empty cast so the frontend can
      // still let them proceed (attach with no cast falls back to the AI guess).
      if (!ANTHROPIC_API_KEY) return json(200, { success: true, cast: [], quality: { usable: true, issues: [] }, skipped: 'no ANTHROPIC_API_KEY' });
      // CACHE-BUST (2026-09-04, Fernando 26e7a9d7): the customer replaced both
      // photos 18 min after the first upload; analyze re-ran 10 s later but the
      // public URL served the CDN's cached FIRST photo, so the confirmed cast
      // described a baptism that was no longer on the order. Same path + new
      // bytes = stale read unless the URL changes.
      const slot = which === 'main' || which === 'family' ? which : (has_family ? 'family' : 'main');
      // The resize endpoint applies the phone's EXIF rotation, so the boxes the
      // model returns line up with what the browser shows the customer.
      const photoUrl = `${pub(slot).replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')}?width=1600&height=1600&resize=contain&quality=85&v=${Date.now()}`;
      const { data: song } = order.song_id
        ? await supabase.from('songs').select('recipient_name, sender_name, relationship').eq('id', order.song_id).single()
        : { data: null };
      const ctx = song
        ? `Story context — RECIPIENT (the person the song is FOR): ${song.recipient_name || '?'}; SENDER (who ordered it): ${song.sender_name || '?'}; RELATIONSHIP: ${song.relationship || '?'}. Use this to guess each person's role, but the customer will confirm.`
        : 'No story context available.';
      const TOOL = {
        name: 'emit_analysis', description: 'Report the photo quality and every person visible in the photo.',
        input_schema: {
          type: 'object',
          properties: {
            photo_quality: {
              type: 'object',
              description: 'Judge whether this photo is good enough to build a faithful animated likeness FROM. A poor photo produces a poor video, so flag it BEFORE we build.',
              properties: {
                usable: { type: 'boolean', description: 'false if the customer should really upload a better photo (blurry, dark, faces tiny/far, faces turned away or covered by sunglasses/hats, heavy filter). true if faces are reasonably clear and well-lit.' },
                issues: { type: 'array', items: { type: 'string' }, description: 'short customer-friendly reasons when usable is false, e.g. "la foto está borrosa", "el rostro se ve muy lejos", "está muy oscura", "lentes de sol tapan los ojos". Empty when usable.' },
              }, required: ['usable', 'issues'],
            },
            people: {
              type: 'array',
              description: 'one entry per DISTINCT human person visible (ignore pets, background strangers)',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string', description: 'short slug, e.g. "man_gray_hair"' },
                  description: { type: 'string', description: 'physical descriptor a stranger could use to pick them out: apparent age/gender, hair color+length, clothing color+type' },
                  guess_role: { type: 'string', enum: ROLES, description: 'best guess at their role from the story context' },
                  guess_name: { type: 'string', description: 'their name if inferable from the story context, else empty' },
                  box: {
                    type: 'object',
                    description: 'bounding box of this person\'s FACE as fractions of the image (0-1): x = left edge, y = top edge, w = width, h = height. Tight around the face, from hairline to chin.',
                    properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
                    required: ['x', 'y', 'w', 'h'],
                  },
                }, required: ['key', 'description', 'guess_role', 'box'],
              },
            },
          }, required: ['photo_quality', 'people'],
        },
      };
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({
            model: CAST_MODEL, max_tokens: 1500, tools: [TOOL], tool_choice: { type: 'tool', name: 'emit_analysis' },
            messages: [{ role: 'user', content: [
              { type: 'image', source: { type: 'url', url: photoUrl } },
              { type: 'text', text: `First judge the photo quality (is it clear and well-lit enough to make a faithful animated likeness?), then list every person so the customer can confirm who is who. Write any quality issues in Spanish. ${ctx}` },
            ] }],
          }),
        });
        if (!r.ok) return json(200, { success: true, cast: [], quality: { usable: true, issues: [] }, skipped: `anthropic ${r.status}: ${(await r.text()).slice(0, 200)}` });
        const data = await r.json();
        const tu = Array.isArray(data.content) ? data.content.find((c: any) => c.type === 'tool_use') : null;
        // Some models double-encode the tool input (people arrives as a JSON string,
        // sometimes nested as {"people":[...]}). Parse tu.input to an object first.
        const parseObj = (v: any): any => {
          let x = v;
          for (let i = 0; i < 3; i++) {
            if (x && typeof x === 'object' && !Array.isArray(x)) return x;
            if (typeof x === 'string') { try { x = JSON.parse(x); } catch { return {}; } continue; }
            return {};
          }
          return (x && typeof x === 'object') ? x : {};
        };
        const unwrapArr = (v: any): any[] => {
          let x = v;
          for (let i = 0; i < 3; i++) {
            if (Array.isArray(x)) return x;
            if (typeof x === 'string') { try { x = JSON.parse(x); } catch { return []; } continue; }
            if (x && typeof x === 'object' && 'people' in x) { x = x.people; continue; }
            return [];
          }
          return Array.isArray(x) ? x : [];
        };
        const input = parseObj(tu?.input);
        const peopleRaw = unwrapArr(input.people ?? tu?.input);
        const clamp01 = (v: any) => Math.max(0, Math.min(1, Number(v)));
        const boxOf = (b: any) => {
          const bb = parseObj(b);
          const x = clamp01(bb.x), y = clamp01(bb.y), w = clamp01(bb.w), h = clamp01(bb.h);
          return [x, y, w, h].every((n) => Number.isFinite(n)) && w > 0.005 && h > 0.005 ? { x, y, w, h } : null;
        };
        const people = peopleRaw.map((p: any, i: number) => ({
          key: String(p.key || `person_${i + 1}`).slice(0, 40),
          description: String(p.description || '').slice(0, 300),
          role: ROLES.includes(p.guess_role) ? p.guess_role : 'other',
          name: String(p.guess_name || '').slice(0, 60),
          in_photo: true,
          box: boxOf(p.box),
        })).filter((p: any) => p.description || p.key);
        // photo-quality verdict — default usable:true (fail-open, never block on
        // missing/garbled data; only block when the model explicitly says unusable).
        const pq = parseObj(input.photo_quality);
        const quality = {
          usable: pq.usable === false ? false : true,
          issues: Array.isArray(pq.issues) ? pq.issues.slice(0, 4).map((s: any) => String(s).slice(0, 120)) : [],
        };
        return json(200, { success: true, cast: people, quality });
      } catch (e: any) {
        return json(200, { success: true, cast: [], quality: { usable: true, issues: [] }, skipped: e.message });
      }
    }

    if (action === 'questions') {
      const { data: cached } = await supabase.from('story_video_orders').select('detail_questions').eq('id', story_video_order_id).single();
      if (!force && Array.isArray(cached?.detail_questions) && cached.detail_questions.length) {
        return json(200, { success: true, questions: cached.detail_questions, cached: true });
      }
      if (!ANTHROPIC_API_KEY || !order.song_id) return json(200, { success: true, questions: [], skipped: !order.song_id ? 'no song' : 'no ANTHROPIC_API_KEY' });
      const { data: song } = await supabase.from('songs')
        .select('recipient_name, sender_name, relationship, relationship_custom, occasion, occasion_custom, details, lyrics')
        .eq('id', order.song_id).single();
      if (!song) return json(200, { success: true, questions: [], skipped: 'song not found' });
      const rel = song.relationship_custom || song.relationship || '?';
      const occ = song.occasion_custom || song.occasion || '?';
      const TOOL = {
        name: 'emit_questions',
        description: 'Up to 3 short questions (Spanish) about the concrete blanks in this song.',
        input_schema: {
          type: 'object',
          properties: {
            questions: {
              type: 'array', maxItems: 3,
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'short slug, e.g. "trabajo", "lugar_conocieron", "equipo"' },
                  gap: { type: 'string', description: 'what the illustrator would have to invent without this answer (English, for the admin)' },
                  text: { type: 'string', description: 'the question in Spanish, ≤120 chars, tú form to the buyer, names the recipient, quotes/paraphrases the specific line so they see we read their song' },
                  hint: { type: 'string', description: 'example answer in Spanish starting with "Ej." ≤70 chars' },
                }, required: ['id', 'gap', 'text', 'hint'],
              },
            },
          }, required: ['questions'],
        },
      };
      const brief =
        `We are about to illustrate this personalized song as a short animated film. The illustrator may NOT invent an occupation, place, object, pet, food, team or hobby the customer did not state — anything unstated becomes a generic scene (a café nobody named, a neutral workplace, a random party). Find the 3 most important CONCRETE blanks: things the story or lyrics refer to but do not specify visually. Turn each into ONE short question in Spanish.

Rules: address the buyer (${song.sender_name || 'the buyer'}) in tú form; refer to the recipient by name (${song.recipient_name || '?'}); quote or paraphrase the specific line ("La canción dice que llevan 18 años trabajando juntos. ¿En qué trabajan?"); never ask something the story already answers; prefer questions whose answers become a picture (place, trade, object, team, pet, dish, hobby, vehicle); no medical, financial or sensitive questions; if the recipient IS the buyer use tú/tu throughout; for a memorial keep a gentle tone and past tense; keep each question ≤120 characters and each hint ≤70 starting with "Ej.". Return fewer than 3 when the story is already specific; return 0 only if nothing visual is missing.

RECIPIENT: ${song.recipient_name || '?'}
BUYER / SENDER: ${song.sender_name || '?'}
RELATIONSHIP: ${rel}
OCCASION: ${occ}

CUSTOMER'S STORY (their own words):
${(song.details || '(empty — the customer wrote nothing; ask the three most useful visual questions for this relationship and occasion)').slice(0, 3000)}

LYRICS:
${(song.lyrics || '').slice(0, 4000)}`;
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({
            model: CAST_MODEL, max_tokens: 900, tools: [TOOL], tool_choice: { type: 'tool', name: 'emit_questions' },
            messages: [{ role: 'user', content: brief }],
          }),
        });
        if (!r.ok) return json(200, { success: true, questions: [], skipped: `anthropic ${r.status}: ${(await r.text()).slice(0, 200)}` });
        const data = await r.json();
        const tu = Array.isArray(data.content) ? data.content.find((c: any) => c.type === 'tool_use') : null;
        // The model double-encodes the tool input (questions arrives as a JSON
        // STRING wrapping {"questions":[...]}, same quirk the analyze action
        // guards against) — unwrap up to 3 levels until we hold the array.
        let list: any = tu?.input;
        for (let i = 0; i < 4 && !Array.isArray(list); i++) {
          if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = []; } continue; }
          if (list && typeof list === 'object' && 'questions' in list) { list = list.questions; continue; }
          list = [];
        }
        console.log(`ask-the-song: ${Array.isArray(list) ? list.length : 0} question(s) for order ${story_video_order_id.slice(0, 8)}`);
        const seen = new Set<string>();
        const questions = (Array.isArray(list) ? list : [])
          .map((q: any, i: number) => ({
            id: String(q.id || `q${i + 1}`).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24) || `q${i + 1}`,
            gap: String(q.gap || '').slice(0, 160),
            text: String(q.text || '').trim().slice(0, 140),
            hint: String(q.hint || '').trim().slice(0, 80),
          }))
          .filter((q: any) => q.text && !seen.has(q.id) && seen.add(q.id))
          .slice(0, 3);
        await supabase.from('story_video_orders').update({ detail_questions: questions }).eq('id', story_video_order_id);
        return json(200, { success: true, questions, cached: false });
      } catch (e: any) {
        return json(200, { success: true, questions: [], skipped: e.message });
      }
    }

    if (action === 'attach') {
      const mainUrl = pub('main');
      const primaryUrl = has_family ? pub('family') : mainUrl;

      // Only a genuine awaiting_photo -> generating_likeness transition counts as
      // "the customer's photo just landed": a double-submitted attach (state already
      // generating_likeness) or an admin redo must not re-text the owner.
      const wasAwaitingPhoto = order.state === 'awaiting_photo';

      // sanitize the customer-confirmed cast (Stage 3). Stored as authoritative
      // ground truth that generate-storyboard prefers over its own vision guess.
      const cleanCast = Array.isArray(castInput)
        ? castInput.filter((c: any) => c && (c.role || c.name || c.description))
            .slice(0, 12)
            .map((c: any) => ({
              key: String(c.key || '').slice(0, 40),
              description: String(c.description || '').slice(0, 300),
              role: ROLES.includes(c.role) ? c.role : 'other',
              name: String(c.name || '').slice(0, 60),
              in_photo: c.in_photo === false ? false : true,
              ...(c.box && Number.isFinite(Number(c.box.x)) ? { box: { x: +c.box.x, y: +c.box.y, w: +c.box.w, h: +c.box.h } } : {}),
            }))
        : null;

      // "¿Al revés?" — the customer flipped para/de on the upload screen. Video
      // only; the song row is never touched.
      const cleanNames = namesInput && typeof namesInput === 'object' && String(namesInput.recipient || '').trim() && String(namesInput.sender || '').trim()
        ? { recipient: String(namesInput.recipient).trim().slice(0, 120), sender: String(namesInput.sender).trim().slice(0, 120) }
        : null;

      // customer's answers to the "ask the song" questions — stored verbatim and
      // injected into generate-storyboard as FACTS (replacing its guesses)
      const cleanAnswers = Array.isArray(answersInput)
        ? answersInput
            .filter((a: any) => a && String(a.answer || '').trim())
            .slice(0, 3)
            .map((a: any) => ({
              id: String(a.id || '').slice(0, 24),
              question: String(a.question || '').slice(0, 140),
              answer: String(a.answer).trim().slice(0, 200),
            }))
        : [];

      await supabase.from('story_video_orders').update({
        recipient_photo_url: primaryUrl,
        state: 'generating_likeness',
        ...(cleanCast && cleanCast.length ? { cast_tags: cleanCast } : {}),
        ...(cleanAnswers.length ? { detail_answers: cleanAnswers } : {}),
        ...(cleanNames ? { names_override: cleanNames } : {}),
        ...(phone ? { customer_phone: String(phone).slice(0, 30) } : {}),
      }).eq('id', story_video_order_id);

      // capture the phone on the song too (so reminders/delivery can reach them),
      // without overwriting a number they already gave at checkout.
      if (phone && order.song_id) {
        const clean = String(phone).replace(/[^\d+]/g, '').slice(0, 20);
        if (clean.length >= 7) {
          const { data: s } = await supabase.from('songs').select('whatsapp_phone').eq('id', order.song_id).single();
          if (!s?.whatsapp_phone) await supabase.from('songs').update({ whatsapp_phone: clean }).eq('id', order.song_id);
        }
      }

      // LIKENESS TARGETING (2026-09-04). Until now generate-likeness was asked
      // for "the person in the reference photo" on whatever photo was primary:
      // a 12-person family photo came back as two random relatives (Alex,
      // 56b175ba) and a kitchen selfie came back as the dad's giant face when
      // the song was for the whole family (Fernando, 26e7a9d7). Now the
      // customer-confirmed cast decides: a group song -> draw everyone tagged,
      // at the same scale; a single recipient -> draw only the person whose
      // description matches; no cast -> old behaviour (single-face photo).
      let likenessSubject: string | null = null;
      let likenessExtra: string | null = null;
      let likenessPhoto: string = primaryUrl;
      try {
        const { data: songRow } = order.song_id
          ? await supabase.from('songs').select('recipient_name').eq('id', order.song_id).single()
          : { data: null };
        const inPhoto = (cleanCast || []).filter((c: any) => c.in_photo !== false && c.description);
        const recipients = inPhoto.filter((c: any) => c.role === 'recipient');
        const rn = String(cleanNames?.recipient || songRow?.recipient_name || '');
        // "Esposa Ana, mis hijos Jacob y Caleb y mi suegra Vilma" / "mi familia" / "mis hijos"
        const groupSong = /,| y |\b(familia|hijos|hijas|nietos|nietas|todos|todas|papás|padres|abuelos)\b/i.test(rn);
        const desc = (c: any) => `${c.name ? c.name + ' — ' : ''}${c.description}`;
        if (groupSong && inPhoto.length >= 2) {
          likenessSubject = `the family of ${inPhoto.length} in the reference photo: ${inPhoto.map(desc).join('; ')}`;
          likenessExtra = `Recompose the group as a natural, warm family portrait seen from normal camera distance, everyone at the same scale (no selfie wide-angle distortion, nobody oversized), standing close together. Exactly ${inPhoto.length} people, all ${inPhoto.length} faces clearly visible, front-facing and recognizable, no one else in the image, no text.`;
        } else if (likenessInput && typeof likenessInput === 'object' && String(likenessInput.description || '').trim()) {
          // the new upload screen: the customer TAPPED the recipient's face, in
          // the photo it says (usually the main photo — the cleanest portrait)
          const w = likenessInput.which === 'family' ? 'family' : 'main';
          likenessPhoto = pub(w);
          likenessSubject = `the ONE person in the reference photo who is: ${String(likenessInput.description).slice(0, 300)}${likenessInput.name ? ` (${String(likenessInput.name).slice(0, 60)})` : ''}`;
          likenessExtra = 'Draw only that person, waist-up, front-facing, faithful likeness; ignore everyone else in the photo. Exactly one person, no text.';
        } else if (recipients.length === 1 && inPhoto.length >= 2) {
          const r = recipients[0];
          likenessSubject = `the ONE person in the reference photo who is: ${r.description}${r.name ? ` (${r.name})` : ''}`;
          likenessExtra = 'Draw only that person, waist-up, front-facing, faithful likeness; ignore everyone else in the photo. Exactly one person, no text.';
        }
      } catch (e) { console.warn('likeness targeting skipped:', (e as any).message); }

      // Kick the likeness options + early storyboard as TRUE background work.
      // These take ~40-60s each; a bare un-awaited fetch keeps the isolate busy and
      // holds the HTTP response open until they finish, so the customer's browser sat
      // on "Guardando…" for a minute+ (the 2026-07-15 stuck-UI bug). EdgeRuntime.
      // waitUntil runs them in the background AND lets the response flush instantly.
      const kick = async () => {
        // owner heads-up first — it's a one-second Twilio call and must not wait
        // behind the ~minute of likeness generation.
        if (wasAwaitingPhoto && ALERT_SMS_TO) {
          try {
            const { data: s } = order.song_id
              ? await supabase.from('songs').select('recipient_name, sender_name').eq('id', order.song_id).single()
              : { data: null };
            const who = s?.recipient_name ? ` for ${s.recipient_name}` : '';
            const from = s?.sender_name ? ` (from ${s.sender_name})` : '';
            const r = await sendSms(ALERT_SMS_TO, `🎬 Animado: photo just came in${who}${from}. Likeness lands in the Animado tab to review in ~1 min.`);
            if (!r.ok) console.warn('animado owner SMS not sent:', r.error);
          } catch (e) { console.warn('animado owner SMS failed:', (e as any).message); }
        }
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/generate-likeness`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              songId: order.song_id, recipient_photo_url: primaryUrl, story_video_order_id,
              // the cast descriptions were written from THIS photo, so target it
              ...(likenessSubject ? { photo_url: likenessPhoto, subject: likenessSubject, extra: likenessExtra } : {}),
            }),
          });
        } catch (e) { console.error('generate-likeness kick failed:', (e as any).message); }
        if (order.song_id) {
          try {
            await fetch(`${SUPABASE_URL}/functions/v1/generate-storyboard`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE, 'Content-Type': 'application/json' },
              body: JSON.stringify({ songId: order.song_id }),
            });
          } catch (e) { console.error('generate-storyboard kick failed:', (e as any).message); }
        }
      };
      // @ts-ignore EdgeRuntime is provided by the Supabase Edge platform
      if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(kick()); else kick();

      return json(200, { success: true, state: 'generating_likeness' });
    }

    return json(400, { success: false, error: 'unknown action' });
  } catch (e: any) {
    console.error('animado-photo error:', e.message);
    return json(500, { success: false, error: e.message });
  }
});
