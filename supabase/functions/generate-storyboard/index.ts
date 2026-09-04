// supabase/functions/generate-storyboard/index.ts
// Deploy with: supabase functions deploy generate-storyboard --project-ref yzbvajungshqcpusfiia
//
// THE AUTO-STORYBOARD (the brain). Given { songId }, reads details+lyrics+exact
// word-timings and asks Claude to emit a structured scene plan: characters (with
// gender/age), occupation, ~15-23 anchor-pinned child-safe scenes, hero picks,
// and morph. Encodes every lesson from the hand-built videos.
//
// Server-to-server (no Supabase JWT) -> verify_jwt MUST be false (config.toml).
// Reads ANTHROPIC_API_KEY (already a project secret, used by generate-song) +
// service-role key from its own env. Requires songs.lyrics_timestamps (run
// transcribe-song first).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('STORYBOARD_MODEL') || 'claude-opus-4-8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM = `You are the storyboard director for an animated Pixar-style story-video made FROM a personalized song. You turn the customer's real story + lyrics into a scene-by-scene plan where each visual lands on the exact lyric being sung.

HARD RULES (learned from production — never violate):
1. ANCHORS: every scene (except the intro) is pinned to a short, DISTINCTIVE sung phrase that appears in the provided word list. NEVER anchor to a repeated chorus phrase (e.g. "tú y yo", "eres mi padre", "madre mía") — those repeat and will mis-place. Pick unique verse/bridge phrases.
2. DENSE + REUSE: cover the WHOLE song so no single shot would hold longer than ~16s. Songs have long/repeated choruses — REUSE earlier scene images on repeated chorus lines (lyrically natural) rather than inventing filler. Aim for 18-24 scenes total mapping to ~12-16 unique images.
3. CHILD-SAFE: text-prompting a child's face gets blocked. For any child: show them FROM BEHIND, or focus on OBJECTS (a toy, shoes), or a baby as a wrapped BUNDLE — UNLESS the character comes from cartoonifying a real family photo (then the child is fine). State the technique in the prompt.
4. GENDER/AGE ACCURACY: read the story to know each person's gender and age, and bake it into every prompt ("a little girl with long hair", "the toddler boy"). Name siblings correctly.
5. NO INVENTED SPECIFICS — CRITICAL. If the customer's story/lyrics do NOT explicitly state a concrete visual fact (their JOB, what they wear, the kind of car, a specific city/place), DO NOT guess one. Turning "trabaja mucho"/"works hard" into a CONSTRUCTION WORKER, or a vague line into a specific landmark, is a FAILURE — it's a stereotype, not their story. Instead depict the CONCEPT abstractly: "works hard" with no named job → a tired parent coming home at sunset, the sacrifice for family, a neutral everyday workplace — NOT a specific trade or uniform. Keep people in neutral everyday clothing unless their look is described. Only show an occupation/uniform/vehicle/landmark when the customer EXPLICITLY named it. When unsure, lean on what you KNOW (the family, the emotion, the relationship) instead of guessing.
6. CONSISTENCY: every scene prompt references "the same <person> from the reference" so the character stays identical. For a FAMILY, the recurring character is the whole family group.
7. FAMILY MORPH + OPENER: if the recipient is a family/group, the FIRST scene must be the family group itself (a pose-matched cartoon), held through the instrumental intro, so the real→cartoon morph flows straight into it. Do not open a family video on an unrelated establishing shot.
8. HERO SCENES: mark exactly 3 scenes as hero=true — the most emotional or motion-worthy moments (an embrace, driving, the signature image) — these get animated. Don't pick scenes whose window would be <5s. For EACH hero scene also write "motion_prompt": ONE sentence of intentional camera + subject motion that fits the moment (e.g. "slow push-in as they embrace", "camera drifts alongside as he walks", "gentle parallax as she looks up at the sky"). Keep it subtle and warm — the character must stay identical, no morphing, no fast cuts.
9. STYLE: every prompt is warm, wholesome, "Pixar-style 3D", "mature adults" where relevant, soft cinematic light. Keep prompts ~1-2 sentences of scene action (the cast descriptors from rule 11 come after).
10. FLAG YOUR GUESSES: whenever a scene depicts ANY detail the customer did NOT explicitly state (an inferred setting, occupation, object, or activity), add an entry to "assumptions" naming the image_id, exactly what you assumed, and why. If you stuck strictly to stated facts, leave assumptions empty. This lets a human catch a wrong guess BEFORE we build.
11. CAST LOCK — CRITICAL (learned 2026-07-14: a group reference photo without this produced wrong-person pairings in 9 of 25 scenes). When a reference image is provided, FIRST inventory every person in it into "cast": each with a short "key" (e.g. "oscar"), physical description (hair color + texture, clothing and its color, apparent age bracket) and role. Then EVERY scene MUST: (a) in its "people" array, list the cast KEYS of everyone visible in that scene (this is REQUIRED and drives the automated QC check — an empty/missing people list means the QC gate can't verify the scene, so never omit it when people are present); (b) in its visual_prompt, identify each depicted person by their physical description from the reference — e.g. "Oscar — the mature man with short silver-gray hair in the blue shirt from the reference"; (c) state "Exactly N people in frame"; (d) explicitly name which reference people to EXCLUDE (e.g. "do NOT include the two daughters or the son from the reference") whenever the scene shows a subset. A scene prompt that just says a bare name like "Oscar" with no physical descriptor is a FAILURE — the image model cannot know which face that is.
12. NOT-IN-PHOTO PEOPLE: if the story/lyrics reference a person who is NOT visible in the reference image (a late relative, a grandmother, a child not pictured), show them ONLY from behind or as a distant/soft figure — NEVER invent a face for a real named person. Record them in "cast" with in_photo=false.
13. YOUNGER/FLASHBACK VERSIONS: when a scene shows a person younger than in the reference, KEEP their distinctive features exactly as in the reference (hair color included — a silver-haired man stays silver-haired young; likeness beats realism) and say so in the prompt: "same silver-gray hair, same facial features, slightly more youthful face".
14. NO BAKED TEXT — CRITICAL: image models bake ugly wrong-language text into scenes (speech bubbles, banners, name tags on pet collars). EVERY visual_prompt must end with: "Absolutely NO text, NO words, NO letters, NO speech bubbles, NO banners, NO name tags anywhere in the image."
15. SHOT VARIETY — CINEMATOGRAPHY (learned 2026-08-11: portrait-ref conditioning produced 15 near-identical front-facing chest-up portraits — a slideshow, not a story). Assign every scene a "shot" from this palette: wide (character small inside a larger environment), medium (waist-up, mid-action), close-up (face filling the frame — reserve for the strongest emotional beat), detail (hands/objects only, no face), over-shoulder, from-behind, profile. The visual_prompt MUST OPEN with that shot direction (e.g. "Wide shot, seen from behind: ..."). Never give two consecutive NEW images the same shot type, and AT MOST one third of the unique images may be front-facing medium/close-up portraits looking toward camera. Characters are always DOING something concrete in a real place (walking, cooking, hugging, riding, looking at something) — never posing at the camera. The reference image defines each person's IDENTITY only, never the composition or framing.

You will be given: the recipient, sender, relationship, occasion, genre, the customer's own story (details), the lyrics, the exact sung word list with timestamps, and (when available) the approved character reference image. Output ONLY via the emit_storyboard tool.`;

const TOOL = {
  name: 'emit_storyboard',
  description: 'Emit the structured storyboard.',
  input_schema: {
    type: 'object',
    properties: {
      is_family: { type: 'boolean', description: 'true if the recipient is a family/group (multiple people)' },
      occupation: { type: 'string', description: "the recipient's real job/role ONLY if the customer explicitly stated it, else empty (do NOT guess)" },
      assumptions: {
        type: 'array',
        description: 'every visual detail you depicted that the customer did NOT explicitly state (empty array if you invented nothing). A human reviews these before the build.',
        items: {
          type: 'object',
          properties: {
            image_id: { type: 'string', description: 'the scene where the assumption appears' },
            assumed: { type: 'string', description: 'what you depicted that was not stated, e.g. "office/business setting"' },
            reason: { type: 'string', description: 'why, e.g. "story says \'trabaja mucho\' but names no job"' },
          }, required: ['assumed'],
        },
      },
      characters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' }, gender: { type: 'string' }, age: { type: 'string' }, role: { type: 'string' },
          }, required: ['name', 'gender', 'role'],
        },
      },
      cast: {
        type: 'array',
        description: 'CAST LOCK inventory (rule 11): one entry per person relevant to the story. For people visible in the reference image, describe them physically; for story people NOT in the image, in_photo=false (they may only appear from behind).',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'short id, e.g. "oscar", "daughter_older"' },
            name: { type: 'string', description: 'their name if known from the story, else empty' },
            role: { type: 'string', description: 'recipient / sender / daughter / son / mother / etc.' },
            description: { type: 'string', description: 'physical descriptor from the reference image: hair color+texture, clothing+color, age bracket — the exact phrase scene prompts use to identify them' },
            in_photo: { type: 'boolean', description: 'false if this story person is NOT visible in the reference image' },
          }, required: ['key', 'role', 'description', 'in_photo'],
        },
      },
      scenes: {
        type: 'array',
        description: '18-24 ordered scenes covering the whole song.',
        items: {
          type: 'object',
          properties: {
            image_id: { type: 'string', description: 'short id; REUSE the same id across repeated choruses to reuse an image' },
            anchor: { type: ['string', 'null'], description: 'distinctive sung phrase (lowercase, no punctuation); null only for the intro scene' },
            shot: { type: 'string', enum: ['wide', 'medium', 'close-up', 'detail', 'over-shoulder', 'from-behind', 'profile'], description: 'the camera shot type (rule 15); the visual_prompt must open with this direction. Vary across scenes — never two consecutive new images with the same type, ≤1/3 front-facing portraits.' },
            visual_prompt: { type: 'string', description: 'OPENS with the shot direction (rule 15); child-safe, gender-correct, Pixar 3D; MUST embed each depicted person\'s cast description, "Exactly N people in frame", exclusions for reference people not in the scene, and end with the no-text clause (rules 11-14)' },
            people: { type: 'array', items: { type: 'string' }, description: 'REQUIRED: the cast keys (from the "cast" array) of every person visible in this scene. Empty array only for a scene with no people (pure scenery/objects). The QC gate uses this to verify the right people were drawn, so it must be accurate.' },
            hero: { type: 'boolean' },
            motion_prompt: { type: 'string', description: 'hero scenes ONLY (rule 8): one sentence of intentional camera + subject motion, e.g. "slow push-in as they embrace". Omit/empty for non-hero scenes.' },
          }, required: ['image_id', 'anchor', 'shot', 'visual_prompt', 'people', 'hero'],
        },
      },
    },
    required: ['is_family', 'characters', 'scenes'],
  },
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const json = (code: number, obj: unknown) =>
    new Response(JSON.stringify(obj), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: code });

  try {
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
    const { songId } = await req.json();
    if (!songId) throw new Error('Missing songId');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: song, error } = await supabase
      .from('songs')
      .select('id, recipient_name, sender_name, relationship, occasion, genre_name, details, lyrics, lyrics_timestamps')
      .eq('id', songId).single();
    if (error || !song) throw new Error(`Song not found: ${error?.message || 'no row'}`);

    let ts = song.lyrics_timestamps as any;
    // self-ensure timings so this can run EARLY (at the likeness stage, before the
    // build) — if they're missing, transcribe first and re-read.
    if (!ts || !Array.isArray(ts.words) || ts.words.length === 0) {
      await fetch(`${SUPABASE_URL}/functions/v1/transcribe-song`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, apikey: SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId }),
      }).catch(() => {});
      const { data: refreshed } = await supabase.from('songs').select('lyrics_timestamps').eq('id', songId).single();
      ts = refreshed?.lyrics_timestamps;
      if (!ts || !Array.isArray(ts.words) || ts.words.length === 0)
        throw new Error('No lyrics_timestamps — transcribe-song did not produce timings');
    }

    // CAST LOCK (rule 11): show the storyboard brain the actual reference image the
    // scenes will be generated from, so it can describe each person physically
    // instead of using bare names the image model can't resolve. Prefer the
    // admin-approved cartoon likeness (that IS the scene reference); fall back to
    // the uploaded photo; degrade to text-only if the order has neither yet.
    const { data: svo } = await supabase.from('story_video_orders')
      .select('approved_character_url, recipient_photo_url, cast_tags, detail_answers, names_override')
      .eq('song_id', songId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const refImageUrl = svo?.approved_character_url || svo?.recipient_photo_url || null;
    // Stage 3: customer-confirmed who-is-who. When present it is AUTHORITATIVE —
    // the storyboard must use these exact role/name assignments instead of guessing
    // (a customer knows the woman on the left is grandma; the model does not).
    const confirmedCast = Array.isArray(svo?.cast_tags) && svo.cast_tags.length ? svo.cast_tags : null;
    // "Ask the song" answers (animado-photo action=questions -> attach.answers):
    // the customer told us the concrete things the story left blank. They are
    // FACTS — use them instead of an abstract depiction or an assumption.
    const detailAnswers = Array.isArray(svo?.detail_answers) ? svo.detail_answers.filter((a: any) => a?.answer) : [];
    // the customer may have flipped para/de on the upload screen (video only)
    const recipientName = svo?.names_override?.recipient || song.recipient_name;
    const senderName = svo?.names_override?.sender || song.sender_name;
    const detailFacts = detailAnswers.length
      ? `\n\nCUSTOMER-PROVIDED DETAILS (we asked after purchase — treat every line as a FACT and depict it; these are NOT guesses and must not appear in "assumptions"):\n${detailAnswers.map((a: any) => `- ${a.question ? a.question + ' → ' : ''}${a.answer}`).join('\n')}`
      : '';

    // flatten Kie word tokens (it glues "[Verse 1]\nErica," -> "verse 1 erica")
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const wordList = ts.words.map((w: any) => `${norm(w.word).replace(/ /g, '|')}@${Number(w.start).toFixed(0)}`).join(' ');

    const userMsg =
      `RECIPIENT: ${recipientName}\nSENDER: ${senderName}\nRELATIONSHIP: ${song.relationship}\n` +
      `OCCASION: ${song.occasion}\nGENRE: ${song.genre_name}\n\n` +
      `STORY (customer's own words):\n${song.details}${detailFacts}\n\n` +
      `LYRICS:\n${song.lyrics}\n\n` +
      `SUNG WORDS (token@second; '|' joins multi-word tokens):\n${wordList}\n\n` +
      `Produce the storyboard. Remember: distinctive anchors only, dense coverage with image reuse on repeated choruses, child-safe + gender-correct prompts, exactly 3 hero scenes. Vary the camera per rule 15 — assign every scene a shot type, open every prompt with it, and keep front-facing portraits to at most a third of the unique images. NEVER invent an occupation, uniform, vehicle, or place the story didn't state — depict unstated concepts abstractly and list every guess in "assumptions".` +
      (refImageUrl
        ? `\n\nThe attached image is the CHARACTER REFERENCE every scene will be generated from. Apply CAST LOCK (rules 11-14): inventory everyone in it into "cast" with physical descriptors, use those descriptors + exact person counts + exclusions in every scene prompt, and end every prompt with the no-text clause.`
        : `\n\nNo reference image is available yet — still fill "cast" from the story (in_photo=false for everyone) and follow rules 12-14 in every prompt.`) +
      (confirmedCast
        ? `\n\nCUSTOMER-CONFIRMED CAST — AUTHORITATIVE. The customer explicitly identified each person in the reference photo. Use these role/name assignments EXACTLY; do NOT re-guess who is who. Build your "cast" from these (keep each person's physical description, refine it from the image if helpful) and map story references (e.g. "mi mamá", a named child) to the matching person here. Anyone the story mentions who is NOT in this list is NOT in the photo — show them only from behind, never invent their face.\n${confirmedCast.map((c: any) => `- ${c.name || '(unnamed)'} — role: ${c.role}; looks like: ${c.description}`).join('\n')}`
        : '');

    // vision content when we have the reference image; plain text otherwise
    const userContent: any = refImageUrl
      ? [
          { type: 'image', source: { type: 'url', url: refImageUrl } },
          { type: 'text', text: userMsg },
        ]
      : userMsg;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'emit_storyboard' },
        messages: [{ role: 'user', content: userContent }],
      }),
    });
    if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 400)}`);
    const data = await resp.json();
    const toolUse = (data.content || []).find((c: any) => c.type === 'tool_use');
    if (!toolUse) throw new Error('No storyboard returned');
    const storyboard = toolUse.input;

    // cache onto the song for reuse/debug
    await supabase.from('songs').update({ storyboard }).eq('id', songId).then(() => {}, () => {});

    return json(200, { success: true, model: MODEL, scene_count: storyboard.scenes?.length, storyboard });
  } catch (e: any) {
    console.error('generate-storyboard error:', e.message);
    return json(500, { success: false, error: e.message });
  }
});
