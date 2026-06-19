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
8. HERO SCENES: mark exactly 3 scenes as hero=true — the most emotional or motion-worthy moments (an embrace, driving, the signature image) — these get animated. Don't pick scenes whose window would be <5s.
9. STYLE: every prompt is warm, wholesome, "Pixar-style 3D", "mature adults" where relevant, soft cinematic light. Keep prompts ~1-2 sentences.
10. FLAG YOUR GUESSES: whenever a scene depicts ANY detail the customer did NOT explicitly state (an inferred setting, occupation, object, or activity), add an entry to "assumptions" naming the image_id, exactly what you assumed, and why. If you stuck strictly to stated facts, leave assumptions empty. This lets a human catch a wrong guess BEFORE we build.

You will be given: the recipient, sender, relationship, occasion, genre, the customer's own story (details), the lyrics, and the exact sung word list with timestamps. Output ONLY via the emit_storyboard tool.`;

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
      scenes: {
        type: 'array',
        description: '18-24 ordered scenes covering the whole song.',
        items: {
          type: 'object',
          properties: {
            image_id: { type: 'string', description: 'short id; REUSE the same id across repeated choruses to reuse an image' },
            anchor: { type: ['string', 'null'], description: 'distinctive sung phrase (lowercase, no punctuation); null only for the intro scene' },
            visual_prompt: { type: 'string', description: 'child-safe, gender-correct, references the character, Pixar 3D' },
            hero: { type: 'boolean' },
          }, required: ['image_id', 'anchor', 'visual_prompt', 'hero'],
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

    // flatten Kie word tokens (it glues "[Verse 1]\nErica," -> "verse 1 erica")
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const wordList = ts.words.map((w: any) => `${norm(w.word).replace(/ /g, '|')}@${Number(w.start).toFixed(0)}`).join(' ');

    const userMsg =
      `RECIPIENT: ${song.recipient_name}\nSENDER: ${song.sender_name}\nRELATIONSHIP: ${song.relationship}\n` +
      `OCCASION: ${song.occasion}\nGENRE: ${song.genre_name}\n\n` +
      `STORY (customer's own words):\n${song.details}\n\n` +
      `LYRICS:\n${song.lyrics}\n\n` +
      `SUNG WORDS (token@second; '|' joins multi-word tokens):\n${wordList}\n\n` +
      `Produce the storyboard. Remember: distinctive anchors only, dense coverage with image reuse on repeated choruses, child-safe + gender-correct prompts, exactly 3 hero scenes. NEVER invent an occupation, uniform, vehicle, or place the story didn't state — depict unstated concepts abstractly and list every guess in "assumptions".`;

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
        messages: [{ role: 'user', content: userMsg }],
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
