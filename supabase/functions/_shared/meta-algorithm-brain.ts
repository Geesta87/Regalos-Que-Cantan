// ---------------------------------------------------------------------------
// META ALGORITHM BRAIN — the "how Meta actually delivers ads" knowledge base.
//
// Single source of truth for how Meta's 2026-era delivery system works and what
// verifiably makes winning ads. Injected into the AI ads staff (media-buyer-daily,
// the ads coach, and Sofía/cos-assistant) so their advice is grounded in how the
// machine ACTUALLY behaves today — not generic "test your creatives" filler.
//
// WHY THIS EXISTS: the media-buyer SYSTEM prompt reasons like a smart dashboard
// reader but carries ZERO knowledge of Andromeda, creative-as-targeting, the
// Entity-ID grouping, or the real winner/fatigue math. That gap is the difference
// between "read the numbers" and "read the numbers THROUGH how Meta delivers."
//
// SOURCING DISCIPLINE (this is the anti-slop contract — keep it):
// Every fact below is tagged by confidence. Two adversarially-verified deep-research
// passes (2026-07-21) fed this. Claims that FAILED verification are listed in the
// MYTHS section precisely so the staff NEVER repeat them as fact:
//   [VERIFIED]    = confirmed against a primary source (Meta eng blog, NVIDIA,
//                   Nielsen, or a large measured dataset like Motion Benchmarks 2026).
//   [META-REPORTS]= Meta's own self-reported number, no independent audit. Cite as
//                   "Meta reports", never as proven.
//   [CONSENSUS]   = strong, corroborated practitioner consensus w/ real data behind
//                   it, but not a hard law. Use directionally.
//   [DEBATE]      = practitioners disagree / no measured benchmark. Offer as an
//                   opinion, name the tradeoff, don't assert.
//   [MYTH]        = failed verification. Do NOT state as true. Correct it if asked.
//
// REFRESH: Meta ad mechanics move fast. Re-run the research pass and revise this
// file every 6-12 months (last: 2026-07-21). If a claim here conflicts with what
// the LIVE account data shows, TRUST THE ACCOUNT and say the doc may be stale.
// ---------------------------------------------------------------------------

export const META_BRAIN_LAST_REVIEWED = '2026-07-21';

export const META_ALGORITHM_BRAIN = `HOW META ACTUALLY DELIVERS ADS (2026) — reason from these mechanics, not from folklore. Each item is tagged with how solid it is; respect the tags.

═══════════════════════════════════════════════════════════════
1. THE DELIVERY ENGINE — ANDROMEDA
═══════════════════════════════════════════════════════════════
[VERIFIED] Andromeda (announced Dec 2, 2024) is Meta's personalized ads RETRIEVAL engine — a custom deep neural network running on the NVIDIA Grace Hopper Superchip. It replaced the old system of "isolated model stages and rule-based heuristics." It sits at the RETRIEVAL stage: it narrows tens of millions of eligible ads down to a few thousand candidates — PER USER, in real time — before the ranking auction happens.
[META-REPORTS] Meta claims ~10,000x more model capacity than the old system, +6% retrieval recall, and +8% ad quality "on selected segments." These are Meta's own unaudited numbers — say "Meta reports," never present as proven.
[VERIFIED] Andromeda selects using latent BEHAVIORAL signals (what a person actually engages with), not just demographic boxes. It reconstructs "latent user-ad interaction signals on-the-fly."

WHAT THIS MEANS FOR US (the single most important shift):
[CONSENSUS] CREATIVE IS THE TARGETING. Because the machine matches each creative to the users most likely to respond to THAT creative, your different ads act as self-selecting filters. You steer WHO Meta finds by WHAT you make — not by manually narrowing the audience. Diverse creative = the algorithm has more "doors" to find buyers through. This is well-supported practitioner consensus layered on a verified Meta mechanic — state it directionally, it is not a Meta quote.

═══════════════════════════════════════════════════════════════
2. CAMPAIGN STRUCTURE — THE ADVANTAGE+ ERA
═══════════════════════════════════════════════════════════════
[VERIFIED] Advantage+ automatically optimizes audience, placements, and budget by default. You CAN still toggle individual AI optimizations off — automation is the default, not a straitjacket. Demographic controls and customer exclusions still exist (a common myth says they don't — see MYTHS).
[CONSENSUS] Go BROAD and let the machine find buyers — BUT this is conditional, not a law:
  • Broad tends to win FOR ESTABLISHED-VOLUME accounts (roughly 50+ conversions/week of signal).
  • Narrow/detailed targeting still wins for COLD-START accounts, very niche or hyper-local audiences, and small daily budgets (under ~$30/day) where the algorithm lacks the signal to self-optimize.
  • For OUR business (~$25-40 AOV, US Hispanic): once conversion volume is steady, broad is likely right. At launch or after a dry spell, don't be afraid to give Meta a hand with a defined audience until signal builds. Judge by the live data, not dogma.

═══════════════════════════════════════════════════════════════
3. THE WINNER MATH — WHY VOLUME OF DISTINCT CREATIVE WINS
═══════════════════════════════════════════════════════════════
[VERIFIED — Motion Creative Benchmarks 2026: 550,000+ ads, 6,000+ advertisers, ~$1.3B spend, Sep 2025–Jan 2026]
  • Only ~5-8% of ads become real "winners" (a winner = spends 10x+ the account median). Micro accounts (<$10K/mo) ~3.8%; enterprise ($1M+/mo) ~8.2%.
  • About HALF of all ads never get meaningful spend at all.
  • THE TAKEAWAY: you do not "write a good ad." You feed enough genuinely different shots for the machine to find the ~1-in-15 winner. Ad creation is a portfolio, not a masterpiece.
[VERIFIED — same dataset] Top-quartile accounts launch 2-3x more new ads per week than average — WITHIN every spend tier. Cadence of fresh distinct creative is the measurable thing winners do differently.
[CONSENSUS] "One new ad per ~$3,000/mo of spend" is a rough planning heuristic that recurs across sources — use it to sanity-check volume, NOT as a hard rule (it was not a controlled benchmark).

═══════════════════════════════════════════════════════════════
4. CREATIVE DIVERSITY — WHAT "DISTINCT" ACTUALLY MEANS
═══════════════════════════════════════════════════════════════
[VERIFIED] Meta's "Entity ID" / Creative Similarity system groups VISUALLY SIMILAR creatives as effectively the SAME ad — they share performance learnings and compete as one, even with different Creative IDs and different hook text. Five lightly-tweaked versions of one concept ≈ one ad to Meta.
[CONSENSUS] Therefore minor variation testing (same image, swapped headline) is "largely wasteful" — a named practitioner (Cody Plofker, Jones Road Beauty) cut from 4-5 variations per ad down to 2-3 on this basis.
[CONSENSUS] "Distinct" must differ at the VISUAL, AUDIO, and STRUCTURAL level — a different hook, format, emotional trigger, and visual treatment — not just swapped copy on the same template. A practical target that appears in the data-backed sources: ~8-12 genuinely distinct concepts per campaign, with only 2-3 variations each.
[DEBATE] The exact "net-new vs iteration" ratio (e.g. Barry Hott's "90% new / 10% iteration") is a practitioner debate, NOT a measured benchmark. Offer it as one credible school of thought; the honest point underneath is simply "bias hard toward net-new concepts over micro-tweaks."

═══════════════════════════════════════════════════════════════
5. HOOKS, HOLD & FORMAT — HEALTH SIGNALS, NOT SACRED NUMBERS
═══════════════════════════════════════════════════════════════
IMPORTANT HONESTY NOTE: specific hook-rate/hold-rate "benchmarks" vary WILDLY between sources (one says a good hook rate is 30-40%, another 25-35%, another a 25% floor). Because they contradict each other, MOST specific thresholds FAILED verification. Treat these as directional health checks, never as pass/fail gates. What IS solid:
[VERIFIED] Hook rate (a.k.a. thumbstop rate) = 3-second video plays ÷ impressions. Hold rate = viewers retained past the 3s hook (to 15s or 75% completion, depending on definition — the two formulas give different numbers, so always know which one you're reading).
[CONSENSUS] Roughly: hook rate in the high-20s to 30s% is healthy; a very low hook rate means the first 2-3 seconds aren't stopping the scroll. Use as "this ad needs a better opening," not as a hard cutoff.
[VERIFIED] The hook must land in the first 2-3 seconds — it decides whether anyone sees the rest.
[CONSENSUS] For UGC-style video: keep it tight — under ~20 seconds / ~60 words tends to perform best for DTC.
[CONSENSUS] Format: video and static BOTH win; it is NOT "video always beats static." A large practitioner analysis (Curtis Howland, $100M+ spend, 67,000 ads) found top accounts run a MAJORITY static (median ~61% static). Static is cheaper to produce and often lower CPA; video holds attention and can widen reach. Run BOTH; let the account data pick. (A specific "video 1.9% CTR vs static 1.1%" figure exists but did NOT generalize in verification — don't quote it as a rule.)

═══════════════════════════════════════════════════════════════
6. CREATIVE FATIGUE — WHEN TO REFRESH
═══════════════════════════════════════════════════════════════
[CONSENSUS — corroborated across many 2025-26 sources] Real fatigue signals, in priority order:
  • Prospecting FREQUENCY climbing past ~2.5 (warning) to ~3.0 (act now).
  • CTR dropping ~20%+ week-over-week off its own baseline.
  • CPM / cost-per-result drifting UP while nothing else changed.
[CONSENSUS] Meta's own data scientists (via Gupta Media): by the ~4th repeated exposure, expect ~40% CTR drop and ~60% conversion-rate drop. Repetition decays conversions faster than clicks.
[CONSENSUS] Practical refresh cadence lands around 7-14 days for a hot/high-spend ad — but REFRESH ON THE SIGNALS ABOVE, not the calendar. A winner that's still converting doesn't need "freshening."

═══════════════════════════════════════════════════════════════
7. OUR AUDIENCE — US HISPANIC (this is a real edge, use it)
═══════════════════════════════════════════════════════════════
[VERIFIED — Nielsen 2023/2025 primary research]
  • Hispanics are MORE language-flexible than marketers assume: only ~40% call preferred-language content "important" (+32% "somewhat"), vs ~70% of non-Hispanic white audiences. Nielsen: "shared experiences can be more pivotal than language itself." → Don't over-index on Spanish-vs-English; index on CULTURAL truth and shared experience (family, the abuela, the quinceañera, the long-distance love, the hometown).
  • ~63% are more likely to buy from brands that feature "people like them." → Real faces, real families, culturally specific moments beat generic stock. This is a representation/authenticity mandate.
[CONSENSUS — TikTok Marketing Science] Bilingual audiences lean into code-switching: >half of bilinguals prefer BOTH languages in ads; ~2 in 3 say multiple languages make them feel closer to a brand. → Spanglish and natural code-switching are assets, not compromises.
[MYTH — did NOT verify] "Spanish audio gives a 57% ad lift" and "3 in 4 find Spanish music appealing" — specific stats FAILED verification. The authenticity principle above stands; these exact numbers do not — don't cite them.

═══════════════════════════════════════════════════════════════
8. MYTHS — killed in verification. NEVER state these as true.
═══════════════════════════════════════════════════════════════
[MYTH] "Advantage+ gives a flat +22% ROAS." — refuted.
[MYTH] "Keep creative-similarity scores below 40%." — refuted (made-up precision).
[MYTH] "10-15 creative types is THE optimal number." — refuted as a hard rule (see §4 for the honest, data-backed framing).
[MYTH] "Advantage+ Sales targets country-level only, no demographic targeting, can't exclude customers." — refuted; those controls exist.
[MYTH] "Static fatigues 30-50% faster than video." — refuted.
[MYTH] Any single hook/hold-rate number presented as a universal pass/fail gate — the sources contradict each other; use directionally.
[MYTH] "Narrowing the audience always hurts." — false; it depends on account volume/budget (see §2).

═══════════════════════════════════════════════════════════════
HOW TO USE THIS BRAIN WHEN ADVISING
═══════════════════════════════════════════════════════════════
- Lead with the mechanic, then the move: explain WHY (how Meta delivers) before WHAT to do. That's what makes advice trustworthy instead of generic.
- Match confidence to the tag: assert [VERIFIED]; recommend [CONSENSUS] directionally; present [DEBATE] as an option with its tradeoff; correct [MYTH] if it comes up.
- The account data OUTRANKS this doc. If live numbers disagree with a principle here, trust the numbers, say so, and flag the doc may be stale.
- Never invent a benchmark number to sound precise. "Your hook is likely weak — the first 2-3s aren't stopping the scroll" beats a fake "your hook rate should be 34%."`;

// Compose the brain for injection into a staff agent's SYSTEM prompt. Optionally
// prepend a one-line role framing so each agent uses it in its own voice.
export function metaBrainContext(roleHint?: string): string {
  const hint = (roleHint || '').trim();
  const head = hint ? `${hint}\n\n` : '';
  return `${head}${META_ALGORITHM_BRAIN}\n\n(Meta algorithm brain last reviewed ${META_BRAIN_LAST_REVIEWED}; mechanics change — if unsure or if live data disagrees, trust the account and flag it.)`;
}
