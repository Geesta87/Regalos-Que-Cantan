import { useState, useEffect, useCallback, useRef } from 'react';

// Admin "Needs Approval" tab for the animated story-video pipeline.
// Two gates: pick 1 of 2 likeness options, then approve/reject the final video.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const FN_URL = `${SUPABASE_URL}/functions/v1/admin-story-videos`;

export default function NeedsApprovalTab({ accessToken, showToast, gate = 'likeness' }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null); // `${id}:${action}`
  const [error, setError] = useState('');

  const call = useCallback(async (body) => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }, [accessToken]);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true); setError('');
    try { const d = await call({ action: 'list' }); setOrders(d.orders || []); }
    catch (e) { setError(e.message || 'Could not load.'); }
    finally { setLoading(false); }
  }, [accessToken, call]);

  useEffect(() => { load(); }, [load]);

  async function act(id, action, extra = {}) {
    setBusy(`${id}:${action}`);
    try {
      await call({ action, id, ...extra });
      showToast?.(action.includes('approve') ? '✓ Approved' : 'Done', 'success');
      await load();
    } catch (e) { showToast?.(e.message || 'Error', 'error'); }
    finally { setBusy(null); }
  }

  const likeness = orders.filter((o) => o.state === 'likeness_review');
  const finals = orders.filter((o) => o.state === 'final_review');
  const rebuilding = orders.filter((o) => o.state === 'building');
  const failed = orders.filter((o) => o.state === 'failed');
  const isLikeness = gate === 'likeness';

  // auto-refresh while something is rebuilding so the finished video pops in by itself
  useEffect(() => {
    if (isLikeness || rebuilding.length === 0) return;
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [isLikeness, rebuilding.length, load]);

  const minsAgo = (ts) => Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">
            {isLikeness ? 'Animated — Choose likeness' : 'Animated — Approve final video'}
          </h2>
          <p className="text-sm text-gray-400">
            {isLikeness
              ? `${likeness.length} likeness(es) pending`
              : `${finals.length} video(s) to review${rebuilding.length ? ` · ${rebuilding.length} building` : ''}${failed.length ? ` · ${failed.length} failed` : ''}`}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 text-sm rounded-lg bg-pink-600 hover:bg-pink-700 text-white font-semibold transition disabled:opacity-50">
          {loading ? '...' : '↻ Refresh'}
        </button>
      </div>
      {error && <div className="rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-sm px-3 py-2">{error}</div>}

      {/* GATE 1 — pick the likeness (compare the 2 options against the original photo) */}
      {isLikeness && (
        <section>
          {likeness.length === 0 ? <Empty text="No likenesses pending." /> : (
            <div className="space-y-4">
              {likeness.map((o) => (
                <div key={o.id} className="rounded-xl border border-gray-800 bg-[#1a1f26] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-white font-semibold">{o.recipient}</div>
                    <button onClick={() => act(o.id, 'reject_likeness')} disabled={busy}
                      className="text-xs text-gray-400 hover:text-rose-400">Reject / request another photo</button>
                  </div>
                  <Assumptions items={o.assumptions} />
                  <p className="text-xs text-gray-500 mb-2">Compare against the real photo and pick the closest likeness:</p>
                  <div className="grid grid-cols-3 gap-3">
                    {/* original photo for comparison — no button */}
                    <div className="rounded-lg overflow-hidden bg-gray-900 ring-1 ring-sky-500/40">
                      {o.recipient_photo_url
                        ? <img src={o.recipient_photo_url} alt="original photo" className="w-full aspect-[3/4] object-cover" />
                        : <div className="w-full aspect-[3/4] flex items-center justify-center text-gray-600 text-xs">no photo</div>}
                      <div className="py-2 text-center text-xs font-semibold text-sky-300 bg-sky-500/10">📷 Original photo</div>
                    </div>
                    {/* the cartoon / style options */}
                    {(o.character_options || []).map((opt, i) => (
                      <div key={i} className="rounded-lg overflow-hidden bg-gray-900 ring-1 ring-gray-800">
                        {opt.label && (
                          <div className="py-1.5 text-center text-xs font-bold text-white bg-white/5 truncate px-1">{opt.label}</div>
                        )}
                        <img src={opt.url} alt={opt.label || `option ${i + 1}`} className="w-full aspect-[3/4] object-cover" />
                        <button onClick={() => act(o.id, 'approve_likeness', { index: i })}
                          disabled={busy === `${o.id}:approve_likeness`}
                          className="w-full py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-50">
                          {busy === `${o.id}:approve_likeness` ? '...' : (opt.label ? `✓ Use ${opt.label}` : `✓ Use option ${i + 1}`)}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* GATE 2 — approve the final video */}
      {!isLikeness && (
        <section className="space-y-4">
          {/* in-progress rebuilds stay visible so a re-rendered order never "disappears" */}
          {rebuilding.map((o) => (
            <div key={o.id} className="rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-4 py-3 flex items-center gap-3">
              <div className="animate-spin h-5 w-5 border-2 border-indigo-400 border-t-transparent rounded-full flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-indigo-200">{o.recipient} — video is building…</p>
                <p className="text-xs text-indigo-300/70">Started {minsAgo(o.updated_at)} min ago · usually ready in 10–30 min · it comes back here by itself for your approval.</p>
              </div>
            </div>
          ))}
          {failed.map((o) => (
            <div key={o.id} className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3">
              <p className="text-sm font-semibold text-rose-200">{o.recipient} — build failed</p>
              {o.error && <p className="text-xs text-rose-300/80 mt-0.5 break-words">{o.error}</p>}
              <button onClick={() => act(o.id, 'rerender')} disabled={busy}
                className="mt-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white transition disabled:opacity-50">
                ↻ Retry build
              </button>
            </div>
          ))}
          {finals.length === 0 && rebuilding.length === 0 && failed.length === 0 ? <Empty text="No final approvals pending." /> : finals.length === 0 ? null : (
            <div className="grid grid-cols-1 gap-4">
              {finals.map((o) => (
                <div key={o.id} className="rounded-xl border border-gray-800 bg-[#1a1f26] p-4">
                  <div className="text-white font-semibold mb-3">{o.recipient}</div>
                  {o.video_url && <video controls src={o.video_url} className="w-full rounded-lg bg-black aspect-[9/16] max-h-[480px] mx-auto" />}
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => act(o.id, 'approve_final')} disabled={busy}
                      className="flex-1 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-50">
                      {busy === `${o.id}:approve_final` ? '...' : '✓ Approve and send'}
                    </button>
                    <button onClick={() => act(o.id, 'reject_final')} disabled={busy}
                      className="px-3 py-2 text-sm font-semibold rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition disabled:opacity-50">
                      ↺ Redo
                    </button>
                  </div>
                  <SceneReview orderId={o.id} call={call} showToast={showToast} onRerender={load} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// Shows the AI's flagged guesses (details it depicted that the customer didn't state),
// so the admin can catch a wrong assumption (e.g. "construction worker") BEFORE the build.
function Assumptions({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mb-3 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2.5">
      <p className="text-xs font-bold text-amber-300 mb-1.5">⚠️ The AI assumed things not stated in the story — review before approving:</p>
      <ul className="space-y-1">
        {items.map((a, i) => (
          <li key={i} className="text-xs text-amber-100/90 leading-snug">
            • <span className="font-semibold">{a.assumed}</span>
            {a.image_id ? <span className="text-amber-200/60"> ({a.image_id})</span> : null}
            {a.reason ? <span className="text-amber-200/60"> — {a.reason}</span> : null}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-amber-200/60 mt-1.5">If something is wrong, reject and request a photo or adjust the story.</p>
    </div>
  );
}

function Empty({ text }) {
  return <div className="rounded-xl border border-dashed border-gray-800 text-gray-500 text-sm px-4 py-8 text-center">{text}</div>;
}

// ---------------------------------------------------------------------------
// Scene-by-scene review for a final video: every visual in song order with its
// context, a per-scene Revise box (regenerates just that visual), a re-render
// button, and an Ask-AI copilot grounded in the lyrics + the customer's story.
// ---------------------------------------------------------------------------
function SceneReview({ orderId, call, showToast, onRerender }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null); // { order, song }
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState({});   // image_id -> edited prompt
  const [busyScene, setBusyScene] = useState(null);
  const [revised, setRevised] = useState(false); // any revision since load -> show re-render
  const pollRef = useRef(null);

  const loadDetail = useCallback(async () => {
    try {
      const d = await call({ action: 'detail', id: orderId });
      setDetail(d);
      return d;
    } catch (e) { showToast?.(e.message || 'Could not load scenes', 'error'); return null; }
  }, [call, orderId, showToast]);

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true); setLoading(true);
    await loadDetail();
    setLoading(false);
  }

  // poll while any scene is regenerating so the new visual appears by itself
  useEffect(() => {
    const anyRevising = (detail?.order?.scene_assets || []).some((a) => a.revising);
    if (open && anyRevising && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        const d = await loadDetail();
        if (!(d?.order?.scene_assets || []).some((a) => a.revising)) { clearInterval(pollRef.current); pollRef.current = null; }
      }, 6000);
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [open, detail, loadDetail]);

  async function revise(imageId) {
    const text = (drafts[imageId] || '').trim();
    if (!text) return;
    setBusyScene(imageId);
    try {
      await call({ action: 'revise_scene', id: orderId, image_id: imageId, new_prompt: text });
      showToast?.('Regenerating this scene — the new visual appears here in ~1 min', 'success');
      setRevised(true);
      await loadDetail();
    } catch (e) { showToast?.(e.message || 'Revision failed', 'error'); }
    finally { setBusyScene(null); }
  }

  async function rerender() {
    if (!window.confirm('Re-render the final video with your revised scenes? Takes ~10-15 min; unchanged scenes are reused (no extra AI cost).')) return;
    try {
      await call({ action: 'rerender', id: orderId });
      showToast?.('Re-rendering — the order returns here when the new video is ready', 'success');
      setOpen(false);
      onRerender?.();
    } catch (e) { showToast?.(e.message || 'Re-render failed', 'error'); }
  }

  const order = detail?.order;
  const song = detail?.song;
  const scenes = order?.storyboard?.scenes || [];
  const assetFor = (id) => (order?.scene_assets || []).find((a) => a.image_id === id);
  // unique visuals in first-appearance (song) order; note every anchor where each repeats
  const uniques = [];
  scenes.forEach((s, i) => {
    let u = uniques.find((x) => x.image_id === s.image_id);
    if (!u) { u = { image_id: s.image_id, prompt: s.visual_prompt, hero: false, anchors: [], firstIdx: i }; uniques.push(u); }
    if (s.hero) u.hero = true;
    if (s.anchor) u.anchors.push(s.anchor);
  });

  return (
    <div className="mt-3">
      <button onClick={toggle}
        className="w-full py-2 text-sm font-semibold rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/30 transition">
        {open ? '▴ Hide scenes' : '🎬 Review scenes & revise'}
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          {loading && <div className="text-sm text-gray-400 py-4 text-center">Loading scenes…</div>}

          {!loading && order && (
            <>
              {/* reference strip: what the customer gave us vs the approved character */}
              <div className="flex gap-3">
                {order.recipient_photo_url && (
                  <div className="w-24">
                    <img src={order.recipient_photo_url} alt="original" className="rounded-lg w-full aspect-[3/4] object-cover ring-1 ring-sky-500/40" />
                    <div className="text-[10px] text-sky-300 text-center mt-1">Customer photo</div>
                  </div>
                )}
                {order.approved_character_url && (
                  <div className="w-24">
                    <img src={order.approved_character_url} alt="character" className="rounded-lg w-full aspect-[3/4] object-cover ring-1 ring-emerald-500/40" />
                    <div className="text-[10px] text-emerald-300 text-center mt-1">Approved character</div>
                  </div>
                )}
                <div className="flex-1 text-xs text-gray-400 leading-relaxed">
                  <span className="text-gray-300 font-semibold">{song?.recipient_name}</span>
                  {song?.relationship ? <> · {song.relationship}</> : null}
                  {song?.occasion ? <> · {song.occasion}</> : null}
                  {song?.genre_name ? <> · {song.genre_name}</> : null}
                  {song?.details && <p className="mt-1 text-gray-500 line-clamp-4">“{song.details}”</p>}
                </div>
              </div>

              {(order.storyboard?.assumptions || []).length > 0 && (
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2">
                  <p className="text-xs font-bold text-amber-300 mb-1">⚠️ AI guesses to verify:</p>
                  {(order.storyboard.assumptions).map((a, i) => (
                    <p key={i} className="text-xs text-amber-100/90">• <b>{a.assumed}</b>{a.image_id ? ` (${a.image_id})` : ''}</p>
                  ))}
                </div>
              )}

              {/* every visual in song order, with its context + revise box — 5-up on desktop */}
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                {uniques.map((u, idx) => {
                  const a = assetFor(u.image_id);
                  const draft = drafts[u.image_id] ?? u.prompt;
                  const changed = draft.trim() !== u.prompt.trim();
                  return (
                    <div key={u.image_id} className="rounded-lg border border-gray-800 bg-gray-900/60 overflow-hidden flex flex-col">
                      <div className="relative">
                        {a?.revising ? (
                          <div className="w-full aspect-[9/16] flex flex-col items-center justify-center text-indigo-300 text-xs gap-2 bg-black/40">
                            <div className="animate-spin h-6 w-6 border-2 border-indigo-400 border-t-transparent rounded-full" />
                            Regenerating…
                          </div>
                        ) : a?.motion_url ? (
                          <video controls muted loop src={a.motion_url} className="w-full aspect-[9/16] object-cover bg-black" />
                        ) : a?.image_url ? (
                          <img src={a.image_url} alt={u.image_id} className="w-full aspect-[9/16] object-cover" />
                        ) : (
                          <div className="w-full aspect-[9/16] flex items-center justify-center text-gray-600 text-xs bg-black/40">no preview saved</div>
                        )}
                        <div className="absolute top-1 left-1 flex gap-1">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/70 text-gray-200">#{idx + 1}</span>
                          {u.hero && <span className="text-[10px] px-1.5 py-0.5 rounded bg-fuchsia-600/80 text-white font-semibold">MOTION</span>}
                          {a?.revise_failed && <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-600/80 text-white">retry failed</span>}
                        </div>
                      </div>
                      <div className="p-2 flex flex-col gap-1.5 flex-1">
                        {u.anchors.length > 0 && (
                          <p className="text-[10px] text-gray-500 italic line-clamp-2">♪ “{u.anchors[0]}”{u.anchors.length > 1 ? ` (+${u.anchors.length - 1} more)` : ''}</p>
                        )}
                        <textarea value={draft}
                          onChange={(e) => setDrafts((d) => ({ ...d, [u.image_id]: e.target.value }))}
                          rows={4}
                          className="w-full text-[11px] leading-snug bg-black/40 border border-gray-800 rounded-md p-1.5 text-gray-300 focus:border-indigo-500 focus:outline-none resize-y" />
                        <button onClick={() => revise(u.image_id)}
                          disabled={!changed || busyScene === u.image_id || a?.revising}
                          className={`w-full py-1.5 text-xs font-semibold rounded-md transition ${changed ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-gray-800 text-gray-500'} disabled:opacity-60`}>
                          {busyScene === u.image_id ? 'Submitting…' : a?.revising ? 'Regenerating…' : changed ? '✎ Submit revision' : 'Edit context to revise'}
                        </button>
                        {u.hero && changed && <p className="text-[10px] text-fuchsia-300/70">Motion re-animates from the new visual during re-render.</p>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Always available: re-render reuses every persisted scene (near-free;
                  only heroes whose motion was cleared re-animate), so it must stay
                  reachable even when scenes were revised outside this session. */}
              <button onClick={rerender}
                className="w-full py-2.5 text-sm font-bold rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition">
                🔁 Re-render final video with current scenes
              </button>

              <Copilot orderId={orderId} call={call} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Small Q&A box grounded in the order's lyrics + customer details, so the admin
// can confirm what a scene SHOULD show (e.g. "does the story mention two boys?").
function Copilot({ orderId, call }) {
  const [msgs, setMsgs] = useState([]); // {role, content}
  const [q, setQ] = useState('');
  const [thinking, setThinking] = useState(false);

  async function ask(e) {
    e?.preventDefault();
    const question = q.trim();
    if (!question || thinking) return;
    setQ('');
    setMsgs((m) => [...m, { role: 'user', content: question }]);
    setThinking(true);
    try {
      const d = await call({ action: 'copilot', id: orderId, question, history: msgs });
      setMsgs((m) => [...m, { role: 'assistant', content: d.answer || '(no answer)' }]);
    } catch (err) {
      setMsgs((m) => [...m, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally { setThinking(false); }
  }

  return (
    <div className="rounded-lg border border-gray-800 bg-black/30 p-3">
      <p className="text-xs font-bold text-indigo-300 mb-2">🤖 Ask AI — knows the lyrics & what the customer wrote</p>
      {msgs.length > 0 && (
        <div className="space-y-2 mb-2 max-h-56 overflow-y-auto pr-1">
          {msgs.map((m, i) => (
            <div key={i} className={`text-xs leading-relaxed rounded-md px-2.5 py-1.5 whitespace-pre-wrap ${m.role === 'user' ? 'bg-indigo-600/20 text-indigo-100' : 'bg-gray-800/80 text-gray-200'}`}>
              {m.content}
            </div>
          ))}
          {thinking && <div className="text-xs text-gray-500 px-2.5">Thinking…</div>}
        </div>
      )}
      <form onSubmit={ask} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder='e.g. "Does the customer mention two boys or a girl?"'
          className="flex-1 text-xs bg-black/40 border border-gray-800 rounded-md px-2.5 py-2 text-gray-200 focus:border-indigo-500 focus:outline-none" />
        <button type="submit" disabled={thinking || !q.trim()}
          className="px-3 py-2 text-xs font-semibold rounded-md bg-indigo-600 hover:bg-indigo-700 text-white transition disabled:opacity-50">
          Ask
        </button>
      </form>
    </div>
  );
}
