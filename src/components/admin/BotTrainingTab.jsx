import React, { useState, useEffect, useCallback } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// Bot Training (Admin)
//
// Self-serve panel to "train" the customer-service AI rep without any code:
//   • Edit its KNOWLEDGE (facts, prices, tone, rules) in a plain text box. Saved
//     to cs_agent_settings.knowledge_doc; the bot uses it on the very next reply.
//   • Master ON/OFF switch for the whole bot.
//   • Review + delete the examples it has LEARNED from your approved replies.
//
// Talks to the cs-training-admin edge function (admin-gated).
// ──────────────────────────────────────────────────────────────────────────

export default function BotTrainingTab({ accessToken }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const [enabled, setEnabled] = useState(false);
  const [knowledge, setKnowledge] = useState('');
  const [savedKnowledge, setSavedKnowledge] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [examples, setExamples] = useState([]);
  const [proposals, setProposals] = useState([]);

  const dirty = knowledge !== savedKnowledge;

  const call = useCallback(async (payload) => {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cs-training-admin`,
      {
        method: payload ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: payload ? JSON.stringify(payload) : undefined,
      }
    );
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }, [accessToken]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await call(null);
      setEnabled(!!data.enabled);
      setKnowledge(data.knowledge || '');
      setSavedKnowledge(data.knowledge || '');
      setIsCustom(!!data.is_custom);
      setExamples(Array.isArray(data.examples) ? data.examples : []);
      setProposals(Array.isArray(data.proposals) ? data.proposals : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => { load(); }, [load]);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const handleSave = async () => {
    if (!dirty || !knowledge.trim()) return;
    setSaving(true);
    try {
      await call({ action: 'save', knowledge });
      setSavedKnowledge(knowledge);
      setIsCustom(true);
      flash('✅ Saved — the bot will use this on its next reply');
    } catch (e) {
      flash(`⚠ ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm('Reset the bot knowledge back to the built-in default? Your custom text will be replaced.')) return;
    setSaving(true);
    try {
      const data = await call({ action: 'reset' });
      setKnowledge(data.knowledge || '');
      setSavedKnowledge(data.knowledge || '');
      setIsCustom(false);
      flash('✅ Reset to default');
    } catch (e) {
      flash(`⚠ ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async () => {
    const next = !enabled;
    setEnabled(next);
    try {
      await call({ action: 'toggle', enabled: next });
      flash(next ? '✅ Bot ON' : '⏸ Bot paused');
    } catch (e) {
      setEnabled(!next); // rollback
      flash(`⚠ ${e.message}`);
    }
  };

  const handleDeleteExample = async (id) => {
    const prev = examples;
    setExamples((e) => e.filter((x) => x.id !== id));
    try {
      await call({ action: 'delete-example', id });
    } catch (_e) {
      setExamples(prev); // rollback
    }
  };

  const handleApproveProposal = async (id) => {
    setProposals((p) => p.filter((x) => x.id !== id));
    try {
      const data = await call({ action: 'approve-proposal', proposal_id: id });
      if (data.knowledge) { setKnowledge(data.knowledge); setSavedKnowledge(data.knowledge); setIsCustom(true); }
      flash('✅ Added to the bot’s knowledge');
    } catch (e) { flash(`⚠ ${e.message}`); load(); }
  };

  const handleRejectProposal = async (id) => {
    setProposals((p) => p.filter((x) => x.id !== id));
    try { await call({ action: 'reject-proposal', proposal_id: id }); }
    catch (e) { flash(`⚠ ${e.message}`); load(); }
  };

  return (
    <div className="max-w-4xl">
      {/* Header + master switch */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">🎓 Bot Training</h2>
          <p className="text-sm text-gray-500">Teach the customer-service rep what to say. Changes apply to its next reply — no code needed.</p>
        </div>
        <button
          onClick={handleToggle}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
            enabled ? 'bg-green-500/15 text-green-300 hover:bg-green-500/25' : 'bg-white/5 text-gray-400 hover:bg-white/10'
          }`}
        >
          {enabled ? '🟢 Bot is ON' : '⏸ Bot is OFF'}
        </button>
      </div>

      {toast && (
        <div className="mb-4 px-4 py-2.5 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-sm text-indigo-200">{toast}</div>
      )}
      {error && (
        <div className="mb-4 px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-300">{error}</div>
      )}

      {loading ? (
        <div className="p-10 text-center text-gray-500">Loading…</div>
      ) : (
        <>
          {/* Step 4: knowledge updates the bot proposed from your corrections */}
          {proposals.length > 0 && (
            <div className="bg-amber-400/5 rounded-2xl border border-amber-400/20 p-4 mb-6">
              <h3 className="text-sm font-semibold text-amber-200 mb-1">💡 Suggested knowledge updates ({proposals.length})</h3>
              <p className="text-xs text-gray-400 mb-3">
                The bot noticed these gaps from replies you corrected. Approve to add to what it knows, or dismiss.
              </p>
              <div className="space-y-2">
                {proposals.map((p) => (
                  <div key={p.id} className="bg-black/20 border border-white/10 rounded-xl p-3">
                    <div className="text-sm font-semibold text-white">{p.title}</div>
                    <div className="text-[13px] text-gray-200 whitespace-pre-wrap mt-1">{p.proposal}</div>
                    {p.rationale && <div className="text-[11px] text-gray-500 mt-1.5">Why: {p.rationale}</div>}
                    <div className="flex items-center gap-2 mt-2.5">
                      <button onClick={() => handleApproveProposal(p.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-500 text-white hover:bg-green-400 transition">✓ Add to knowledge</button>
                      <button onClick={() => handleRejectProposal(p.id)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-gray-300 hover:bg-white/10 transition">Dismiss</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Knowledge editor */}
          <div className="bg-[#1a1f26] rounded-2xl border border-white/5 p-4 mb-6">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-white">
                What the bot knows {isCustom ? <span className="text-[11px] text-green-400 font-normal">· customized</span> : <span className="text-[11px] text-gray-500 font-normal">· built-in default</span>}
              </label>
              <span className="text-[11px] text-gray-500">{knowledge.length} chars</span>
            </div>
            <p className="text-xs text-gray-500 mb-2">
              Prices, delivery times, tone, and rules (what to always say / never say). Write it like instructions to a new employee.
            </p>
            <textarea
              value={knowledge}
              onChange={(e) => setKnowledge(e.target.value)}
              spellCheck={false}
              className="w-full h-[420px] resize-y px-3.5 py-3 bg-black/30 border border-white/10 rounded-xl text-gray-100 text-[13px] leading-relaxed font-mono focus:outline-none focus:border-indigo-400/50"
            />
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={handleSave}
                disabled={!dirty || saving || !knowledge.trim()}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-indigo-500 text-white hover:bg-indigo-400 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
              </button>
              {dirty && (
                <button
                  onClick={() => setKnowledge(savedKnowledge)}
                  disabled={saving}
                  className="px-3 py-2 rounded-xl text-sm font-medium bg-white/5 text-gray-300 hover:bg-white/10 transition"
                >
                  Discard
                </button>
              )}
              <div className="flex-1" />
              <button
                onClick={handleReset}
                disabled={saving}
                className="px-3 py-2 rounded-xl text-xs font-medium bg-white/5 text-gray-400 hover:bg-white/10 transition"
              >
                Reset to default
              </button>
            </div>
          </div>

          {/* Learned examples */}
          <div className="bg-[#1a1f26] rounded-2xl border border-white/5 p-4">
            <h3 className="text-sm font-semibold text-white mb-1">Learned from your replies</h3>
            <p className="text-xs text-gray-500 mb-3">
              The bot mimics the tone of replies you approve. These are its most recent learned examples ({examples.length}). Delete any you don't want it copying. <span className="text-gray-600">"corrected" = you edited the draft.</span>
            </p>
            {examples.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No examples yet — they'll appear here as you approve replies.</p>
            ) : (
              <div className="space-y-2 max-h-[420px] overflow-y-auto">
                {examples.map((ex) => (
                  <div key={ex.id} className="bg-black/20 rounded-xl px-3.5 py-2.5 border border-white/5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] uppercase tracking-wide text-gray-500">{ex.channel === 'whatsapp' ? '🟢 WhatsApp' : '💬 SMS'}</span>
                      {ex.was_edited && <span className="text-[10px] text-amber-300 bg-amber-400/10 rounded px-1.5 py-0.5">corrected</span>}
                      <div className="flex-1" />
                      <button
                        onClick={() => handleDeleteExample(ex.id)}
                        className="text-[11px] text-gray-500 hover:text-red-300 transition"
                      >
                        Delete
                      </button>
                    </div>
                    {ex.customer_msg && <p className="text-xs text-gray-500 mb-0.5"><span className="text-gray-600">Cliente:</span> {ex.customer_msg}</p>}
                    <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">{ex.reply}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
