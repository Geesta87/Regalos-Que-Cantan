// supabase/functions/_shared/apimart.ts
//
// APIMart Suno bridge — RUNG 2 of the generation ladder (wired 2026-09-02
// after the 5-incidents-in-6-days Suno/Kie instability week). Same Suno v5.5
// engine as Kie through an independent door: when Kie fails, the SAME song
// (same payload, same voice gender, same style) re-submits here at ~$0.05
// per 2-take generation.
//
// Certified by bake-off 2026-09-01: generation quality scored at Kie level by
// owner's ears; 11 flawless tasks; failed tasks auto-refund. NOT certified:
// replaceMusic (ignores infill_lyrics — support ticket open), so this bridge
// is generation-only. Fix-song fallback is Mureka official region-edit.
//
// Ladder integration: _shared/kie-recovery.ts submits here between the Kie
// retry and the Mureka handoff; poll-processing-songs' APIMart job polls
// GET /v1/music/tasks/{id} and completes rows via completeSong().

const APIMART_KEY = Deno.env.get('APIMART_KEY') || '';
const AM = 'https://api.apimart.ai/v1';

export function isApimartConfigured(): boolean {
  return !!APIMART_KEY;
}

// Map a stored Kie submit payload (songs.kie_payload on processing rows) to
// APIMart's near-identical schema. Same engine, so the payload survives the
// translation intact.
export async function submitApimartFromKiePayload(
  kiePayload: Record<string, unknown>,
): Promise<{ taskId?: string; error?: string }> {
  try {
    const body: Record<string, unknown> = {
      model: 'suno',
      // Kie "V5_5" ↔ APIMart "v5.5" — the production model on both doors.
      version: 'v5.5',
      custom: true,
      prompt: String(kiePayload.prompt || '').substring(0, 5000),
      style: String(kiePayload.style || '').substring(0, 1000),
      title: String(kiePayload.title || 'untitled').substring(0, 80),
      vocal_gender: kiePayload.vocalGender === 'f' ? 'f' : 'm',
      negative_tags: String(kiePayload.negativeTags || '').substring(0, 200),
      style_weight: typeof kiePayload.styleWeight === 'number' ? kiePayload.styleWeight : 0.85,
      weirdness_constraint: typeof kiePayload.weirdnessConstraint === 'number' ? kiePayload.weirdnessConstraint : 0.3,
      audio_weight: typeof kiePayload.audioWeight === 'number' ? kiePayload.audioWeight : 0.7,
    };
    const r = await fetch(`${AM}/music/generations`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${APIMART_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });
    const j = await r.json().catch(() => ({} as any));
    const taskId = j?.data?.[0]?.task_id;
    if (!r.ok || !taskId) return { error: `apimart submit ${r.status}: ${JSON.stringify(j).substring(0, 200)}` };
    return { taskId };
  } catch (e: any) {
    return { error: `apimart submit threw: ${e?.message}` };
  }
}

export interface ApimartTrack { audio_url: string; image_url?: string; title?: string; duration?: number }

// Poll one task. Returns:
//   { state: 'pending' } while rendering,
//   { state: 'completed', tracks } with every audio the task produced,
//   { state: 'failed', error }.
export async function getApimartTask(
  taskId: string,
): Promise<{ state: 'pending' | 'completed' | 'failed'; tracks?: ApimartTrack[]; error?: string }> {
  try {
    const r = await fetch(`${AM}/music/tasks/${encodeURIComponent(taskId)}`, {
      headers: { 'Authorization': `Bearer ${APIMART_KEY}` },
      signal: AbortSignal.timeout(20000),
    });
    const j = await r.json().catch(() => ({} as any));
    const d = j?.data;
    const status = d?.status || d?.[0]?.status;
    // FAILURE FIRST (2026-09-02, Jazmin's order): a failed task ALSO carries
    // progress:100, so the completion shapes below would otherwise read it as
    // "completed with no tracks" and stall until the 30-min stale guard.
    const errObj = d?.error || d?.[0]?.error;
    if (status === 'failed' || errObj) {
      const msg = errObj?.message || 'unknown';
      return { state: 'failed', error: String(msg).substring(0, 300) };
    }
    // A finished task may carry status='completed' OR (as observed live
    // 2026-09-02) no status field at all — just progress:100 with a
    // populated result. Treat either shape as done.
    const progressDone = Number(d?.progress) === 100 || Number(d?.[0]?.progress) === 100 || !!d?.completed;
    if (['completed', 'done', 'succeeded'].includes(status) || progressDone) {
      const tracks: ApimartTrack[] = [];
      const scan = (o: unknown) => {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) { o.forEach(scan); return; }
        const rec = o as Record<string, unknown>;
        if (typeof rec.audio_url === 'string' && !tracks.some((t) => t.audio_url === rec.audio_url)) {
          tracks.push({
            audio_url: rec.audio_url,
            image_url: typeof rec.image_url === 'string' ? rec.image_url : undefined,
            title: typeof rec.title === 'string' ? rec.title : undefined,
            duration: typeof rec.duration === 'number' ? rec.duration : undefined,
          });
        }
        for (const v of Object.values(rec)) if (typeof v === 'object') scan(v);
      };
      scan(d);
      return { state: 'completed', tracks };
    }
    if (status === 'failed') {
      const msg = d?.error?.message || d?.[0]?.error?.message || 'unknown';
      return { state: 'failed', error: String(msg).substring(0, 300) };
    }
    return { state: 'pending' };
  } catch (e: any) {
    // A poll hiccup is not a task failure — report pending and try next cycle.
    console.warn(`apimart poll ${taskId}: ${e?.message}`);
    return { state: 'pending' };
  }
}
