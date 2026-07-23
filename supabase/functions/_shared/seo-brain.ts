// ---------------------------------------------------------------------------
// SEO BRAIN — the "how Google actually ranks in 2026" knowledge base.
//
// Single source of truth for how Google Search + AI answer engines actually
// select and deliver results today, and what verifiably works for a small
// US-Hispanic e-commerce brand. Injected into the SEO Coach (seo-coach) so its
// advice is grounded in verified mechanics — not "write great content" filler.
//
// Built the same way as _shared/meta-algorithm-brain.ts: three deep-research
// passes (Google mechanics / measured outcomes / US-Hispanic search behavior)
// followed by an ADVERSARIAL verification pass that re-fetched primary sources
// and tried to refute every load-bearing claim (2026-07-23). Claims that failed
// are in the MYTHS section so the coach NEVER repeats them as fact.
//
// SOURCING DISCIPLINE (the anti-slop contract — keep it):
//   [VERIFIED]    = confirmed against a primary source (Google's live docs, Pew,
//                   Nielsen, US Census) or a large measured dataset that the
//                   verification pass independently re-checked (Ahrefs 300k-kw
//                   CTR panel, SparkToro/Similarweb clickstream, 75k-brand
//                   correlation study, Seer 25M-impression panel).
//   [GOOGLE-SAYS] = Google's own claim about itself, no independent audit.
//                   Cite as "Google says", never as proven — Google's public
//                   claims have been contradicted under oath before.
//   [LEAKED]      = documented in the May 2024 Content API leak or the DOJ
//                   antitrust trial. Authentic documents, but they prove an
//                   attribute EXISTS, not its weight or live use. State with
//                   that exact caveat.
//   [CONSENSUS]   = corroborated practitioner consensus with real data behind
//                   it, but not proven. Use directionally.
//   [DEBATE]      = sources disagree or data is thin. Offer as opinion with the
//                   tradeoff named, don't assert.
//   [SNAPSHOT]    = something we directly observed on a stated date (SERPs,
//                   competitors). True then; re-check before betting big on it.
//   [MYTH]        = failed verification. Do NOT state as true. Correct it.
//
// REFRESH: search moves fast (AI Overviews numbers shift quarterly). Re-run the
// research + verification passes every 6 months (last: 2026-07-23). If a claim
// here conflicts with what LIVE Search Console data shows for our site, TRUST
// THE ACCOUNT and say the doc may be stale.
// ---------------------------------------------------------------------------

export const SEO_BRAIN_LAST_REVIEWED = '2026-07-23';

export const SEO_BRAIN = `HOW GOOGLE + AI SEARCH ACTUALLY WORK (2026) — reason from these mechanics, not from folklore. Every item is tagged with how solid it is; respect the tags.

═══════════════════════════════════════════════════════════════
1. THE MACHINE — HOW GOOGLE ACTUALLY RANKS
═══════════════════════════════════════════════════════════════
[VERIFIED] Google's officially confirmed active systems include: PageRank/link analysis, RankBrain, BERT, neural matching, passage ranking, freshness systems, original-content systems, reviews system, site diversity system (generally max 2 listings per site in top results), removal-based demotions, and SpamBrain. The "Helpful Content system" no longer exists as a separate system — it was absorbed into core ranking in March 2024; Google says "there's no longer one signal" for helpfulness.
[LEAKED] The single biggest revelation of the DOJ trial (sworn testimony, 2023): NAVBOOST — a system Google publicly denied for years — uses 13 months of aggregated user CLICK behavior (goodClicks, badClicks, lastLongestClicks in the 2024 leak) as "one of the important signals," culling candidate results before final ranking. Internal framing from trial exhibits: rankings run on "ABC" — Anchors, Body text, Clicks. Google largely judges quality by watching how PEOPLE REACT to results.
WHAT THIS MEANS FOR US: satisfying the click is a real mechanic, not a metaphor. A page that wins the click but disappoints (user bounces back to the SERP) teaches Google to demote it over months. Match the page's promise to what the visitor actually finds.
[LEAKED] The leak documents "siteAuthority" (a site-level quality score Google denied having), "hostAge" (used to sandbox fresh spam), Chrome browser data in ranking-adjacent modules, siteFocusScore/siteRadius (how tightly a site sticks to its topic — a reason to stay focused on personalized-song/gift topics rather than publishing off-topic content), and "Twiddlers" (dozens of boost/demotion re-rankers applied after base scoring). CAVEAT that must always accompany these: the leak shows what Google CAN store, not the weight or whether each attribute is live. Never cite the leak as proof of a specific weight.
[VERIFIED] E-E-A-T is NOT a ranking factor or score — it is the rubric HUMAN quality raters use to benchmark algorithm changes (Google's Danny Sullivan, on record: "we don't have some E-E-A-T ranking score"). Real correlated signals exist (links, author entities, site trust), but "add E-E-A-T" as a checklist item is a category error. What's real: be a legitimate, focused site that demonstrates first-hand experience.

═══════════════════════════════════════════════════════════════
2. THE 2026 SERP REALITY — CLICKS ARE SCARCER, DATE-STAMP EVERYTHING
═══════════════════════════════════════════════════════════════
[VERIFIED — SparkToro/Similarweb clickstream, pub. Jun 2026] ~68% of US Google searches ended with NO click to the open web in early 2026 (up from ~60% in 2024). Only ~276 of every 1,000 searches send a click to any website. Methodology caveat: excludes the Google mobile app, so reality is likely worse.
[VERIFIED — Ahrefs 300k-keyword panel, pub. Feb 2026, data Dec 2023→Dec 2025] Position-1 CTR on informational queries fell from ~7.6% to ~3.9% WITHOUT an AI Overview, and from ~7.3% to ~1.6% WITH one (a 58% drop). Any pre-2024 CTR table ("position 1 gets 28%!") is obsolete for informational queries.
[VERIFIED — Pew, real browsing behavior of 903 US adults, Mar 2025] With an AI summary on the page, users clicked ANY result on only 8% of visits (vs 15% without), and clicked a source INSIDE the AI summary on only 1% of visits.
[VERIFIED — Amsive 700k-kw + Advanced Web Ranking panels, 2025] The two query classes that HOLD their clicks: BRANDED queries (CTR actually rose with AIOs present) and LONG-TAIL 4+ word queries. Strategy follows directly: build the brand people search by name, and own specific long-tail intent — don't fight head terms.
[VERIFIED — Semrush 10M-kw panel] AI Overviews triggered on ~13% of US desktop queries by Mar 2025 and mostly on INFORMATIONAL queries (~88% of triggers). Transactional/purchase queries trigger them far less — our money pages ("comprar canción personalizada") are less exposed than blog-style content. Trigger rates vary by panel and month (13–50% across trackers) — never quote one number as "the" rate.
[DEBATE] Whether AIO-lost clicks are "made up for" by higher-quality visits: Google claims clicks are now "higher quality" but has released zero data; independent panels contradict the volume story. What IS measured (Ahrefs first-party + Semrush): AI-referred visitors are few but convert far better than average. Both things can be true — traffic down, visitor quality up.

═══════════════════════════════════════════════════════════════
3. AI ANSWERS (AI OVERVIEWS / ChatGPT / PERPLEXITY) — THE NEW SURFACE
═══════════════════════════════════════════════════════════════
[VERIFIED — Google's live docs] There are NO special requirements or secret optimizations to appear in AI Overviews or AI Mode. A page needs to be indexed and snippet-eligible; the same SEO fundamentals apply. Anyone selling "AEO/GEO tricks" beyond that is selling folklore. The one real mechanical difference: "query fan-out" — the AI issues multiple sub-queries and retrieves for each, so deep coverage of SUB-topics can earn citations without ranking top-10 for the head query.
[VERIFIED — Ahrefs, 863k SERPs, Mar 2026] AIO citations decreasingly mirror the top 10: only ~38% of AI Overview citations came from top-10 results (down from 76% in Jul 2025); ~31% came from beyond position 100. You can be cited without ranking — and ranking doesn't guarantee citation.
[VERIFIED — Ahrefs 75k-brand correlation study, pub. May 2025] The strongest measured predictor of a brand appearing in AI answers is branded WEB MENTIONS (correlation 0.664) — three times stronger than backlinks (0.218). Follow-up (Dec 2025): YouTube mentions were the single strongest signal (~0.737). All correlational, and moderate — but the direction is consistent: for AI visibility, being TALKED ABOUT (press, creators, YouTube, Reddit) beats being linked to. For a music brand, YouTube presence is a measured lever.
[VERIFIED — Pew] Being cited in an AI answer mostly buys VISIBILITY, not clicks (1% click rate on citation links). Treat AI citations as brand impressions — like a billboard — and measure them that way.
[CONSENSUS — Evertune/Wix ~400M-citation analysis + Seer recency study] Directional patterns in what AI engines cite: numbered "Top-N" list formats, answers stated in the first third of the page, and recently published/updated content. Correlational, from GEO-tool vendors — use directionally, don't chase exact percentages.
[VERIFIED — controlled experiment, Princeton GEO paper, KDD 2024] The only experimental (not correlational) evidence: adding STATISTICS, QUOTATIONS, and CITED SOURCES to content boosted its visibility in generated answers by 30-40%. Keyword stuffing performed worst. Caveat: tested on simulated engines with pre-2024 models.
[VERIFIED — Elon University survey, Jan 2025] US Hispanic adults are the country's heaviest AI-assistant adopters: 66% use LLMs vs 47% of White adults (Nielsen panel data corroborates: +29% vs general population). Our audience is disproportionately ASKING AI for gift ideas — AI visibility matters more for us than for the average brand. No data yet exists on how often they prompt in Spanish.

═══════════════════════════════════════════════════════════════
4. CONTENT RULES — WHAT GETS REWARDED, WHAT GETS KILLED
═══════════════════════════════════════════════════════════════
[VERIFIED — Google's live policy] AI-generated content is NOT penalized for being AI-made. Google's exact stance: it rewards quality "however it is produced." What IS a spam policy violation (March 2024, "scaled content abuse"): many pages generated primarily to manipulate rankings without adding value — regardless of whether AI or humans wrote them. Enforcement was real: ~2% of 79,000 tracked sites were deindexed in March 2024; every penalized site hosted mass AI content. Separately, "doorway abuse" (its own policy, not part of scaled-content) bans near-duplicate pages targeting keyword variations that all funnel to the same place.
[CONSENSUS — documented failure/success cases] The programmatic-pages test that decides survival: if you remove the modifier word (the occasion, the genre, the city) and the page is otherwise identical to its siblings, it will eventually drop out of the index (soft-404 / "Crawled – currently not indexed" — not usually a manual penalty). Pages that survive at scale carry a UNIQUE ASSET per page. For our /ocasiones and /generos pages that means: real song audio for that occasion/genre, real customer stories, occasion-specific pricing/FAQ answers — not reworded templates.
[VERIFIED — Ahrefs, 2025 refresh] Brutal honesty on timelines: only 1.74% of newly published pages reach top-10 for even one keyword within a YEAR (the old "5.7%" figure is from 2017 — don't use it). ~73% of current top-10 pages are 3+ years old; the average #1 result is ~5 years old. And 96.55% of all pages get ZERO Google traffic. SEO is a compounding 6-18 month asset, not a growth hack. NEVER promise "rank #1 in 30 days."
[VERIFIED — Ahrefs ~4B-keyword database] ~95% of all keywords get ≤10 searches/month — demand lives in the long tail. For a low-authority domain, the realistic path is owning many specific long-tail queries (which also hold their CTR best under AI Overviews) and the branded queries we generate through ads and social.
[MYTH-ADJACENT, KEEP HONEST] Publishing FREQUENCY is not a ranking factor (Google on record, repeatedly; the viral "velocity studies" have no methodology). More pages help only as more lottery tickets on real queries. Freshness matters for time-sensitive queries and AI citations — that's an argument for UPDATING key pages, not for publishing daily.
[VERIFIED — trial + leak mechanics] Because clicks feed rankings (Navboost), the title/description's job is to win the click HONESTLY — clickbait that disappoints trains Google against us over a 13-month window.

═══════════════════════════════════════════════════════════════
5. TECHNICAL — WHAT ACTUALLY MATTERS FOR OUR STACK
═══════════════════════════════════════════════════════════════
[VERIFIED] Google renders JavaScript with an evergreen Chromium and a 2024 measurement (Vercel/MERJ, 100k+ Googlebot fetches) found ~100% of indexable HTML pages get fully rendered. BUT content in the initial HTML is processed earlier and more robustly, and JS errors/timeouts silently hide content. Our site PRERENDERS routes to static HTML at build time (scripts/prerender.mjs) — that is the right architecture; protect it. Any new public route MUST be added to the prerender route list or it ships as an empty JS shell.
[VERIFIED] Crawl budget is a NON-ISSUE for us: Google's own docs say it applies to sites with 1M+ pages or 10k+ daily-changing pages. Small-site "crawl budget optimization" is a service sold against a non-problem. What we need: a current sitemap.xml (the build generates one) and a healthy Page Indexing report.
[VERIFIED] Structured data (schema) is NOT a ranking factor — Google has said so continuously since 2018. Its real value: rich-result ELIGIBILITY (indirect CTR gains) and machine-readable clarity. Still-live rich results that matter for us: Product, Review snippet, Breadcrumb, Organization, Video. DEAD: FAQ rich results (removed entirely May 7, 2026) and HowTo (dead since Sept 2023) — our SEOHead.jsx still generates FAQ/HowTo markup; it's harmless but earns nothing, and any FAQ/HowTo schema advice is stale.
[WARNING — INTEGRITY] Schema that claims fake data is a manual-action risk: our generateGenreStructuredData/generateOccasionStructuredData hardcode aggregateRating 4.9 with INVENTED review counts (50/75 fallbacks). Fabricated review markup is exactly what Google penalizes manually. Fix: wire to real review counts or remove the aggregateRating block.
[VERIFIED] Language handling: Google IGNORES the HTML lang attribute — it detects language from visible content. One page = one language, at its own URL. Translated pages are NOT duplicate content. hreflang is only needed when alternate-language versions of the same page exist; it must be bidirectional or it's ignored; es-US and en-US are valid codes but es-419 is explicitly NOT supported (Google's docs name it as unsupported — old examples made this a zombie claim). NEVER auto-redirect by IP/browser language — Googlebot crawls from US IPs and would never see the alternates.
[VERIFIED] A Spanish-language page competes in the SPANISH-query result set (one index, query-time language matching). Our entire site being in natural, culturally-real Spanish is itself targeting.

═══════════════════════════════════════════════════════════════
6. OUR AUDIENCE — US HISPANIC SEARCH BEHAVIOR (real data, real edge)
═══════════════════════════════════════════════════════════════
[VERIFIED — Pew 2022-2025 primary research] The language reality is nuanced — respect it: 75% of US Latinos can converse in Spanish, but among US-born it's 57% and falling by generation (67% of US Latinos are now US-born). Bilinguals default to ENGLISH for information tasks (55% get news mostly in English vs 9% mostly Spanish) while Spanish persists for identity, family and emotional contexts — which is exactly the territory a personalized-song gift lives in. There is NO current data supporting "most US Hispanics search in Spanish"; the honest model is English-led search with situational Spanish, and Spanish queries signaling high cultural intent.
[VERIFIED — Pew 2024] Channel facts: WhatsApp reaches 54% of Hispanic adults (highest of any US group — our WhatsApp funnel is aligned with a measured behavior, not a hunch). Instagram 62%, TikTok 57%, YouTube ~86-88%. ~20% are smartphone-dependent (no home broadband) — mobile experience is not optional.
[VERIFIED — Nielsen Ad Intel, Sept 2025] The under-served-market fact: LESS THAN 1% of US online-retailer digital ad spend goes to Spanish-language websites. Meanwhile 53% of Hispanic shoppers at least sometimes look for Spanish-language shopping options (ThinkNow 2025, vendor-measured). The gap between demand and supply is our structural opportunity — but state it as an investment gap, not "no competition."
[VERIFIED — calendar/commerce facts] Seasonality that matters: Día de las Madres is FIXED on May 10 (Mexico, Guatemala, El Salvador families — many celebrate both it and US Mother's Day), Día del Padre follows US Father's Day, Feb 14 is shared (Día del Amor), Jan 6 (Reyes) is real and growing in the US, quinceañeras run year-round (~400k/year US — use the count; circulating dollar figures are unsourced). Build seasonal pages MONTHS ahead — pages need indexing time (see §4 timelines).
[CONSENSUS] Cultural specificity beats translation: Kantar (88% appreciate brands engaging in Spanish), Dentsu (76% more likely to buy from brands showing their culture) are vendor surveys — directional. The verified behavioral anchor is the Pew identity-context finding above. Same conclusion as the Meta brain: index on cultural truth (la abuela, the quinceañera, the long-distance family), not on language alone.

═══════════════════════════════════════════════════════════════
7. OUR MARKET — WHAT THE SERPS LOOKED LIKE (2026-07 snapshot)
═══════════════════════════════════════════════════════════════
[SNAPSHOT 2026-07] "canción personalizada" / "regalo musical personalizado" SERPs: dominated by SPAIN-based sites (euros, Spain shipping) plus instant-AI services and Etsy/Amazon listings. NO dominant US-focused Spanish-language brand appeared — and regalosquecantan.com did not appear at all in the observed sets. Geographic mismatch = our wedge: US pricing, US shipping context, es-US cultural framing.
[SNAPSHOT 2026-07] "corrido personalizado" is a thin, low-authority SERP (Etsy listings, small WhatsApp operators like corridosperrones.com at $49). Closest structural comp to our model. Thin SERPs + our genre depth = the most winnable head terms we have.
[SNAPSHOT 2026-07] English personalized-song incumbents (Songfinch ~$200, Songlorious ~$150) are English-only. The at-scale US Spanish segment is unserved. Re-verify these snapshots before major bets — SERPs move.

═══════════════════════════════════════════════════════════════
8. MYTHS — killed in verification. NEVER state these as true.
═══════════════════════════════════════════════════════════════
[MYTH] "Google penalizes AI-generated content." — False as stated; policy explicitly rewards quality "however it is produced." The real offense is scale-without-value.
[MYTH] "Schema markup boosts rankings." — Refuted by Google continuously since 2018. Eligibility + understanding only.
[MYTH] "E-E-A-T is a score you can optimize." — No such score exists; it's a rater rubric.
[MYTH] "FAQ schema wins SERP real estate." — Dead. Removed entirely May 2026. Any advice recommending it is stale.
[MYTH] "Google doesn't use clicks in ranking." — Google's own denial was the myth (Navboost, sworn testimony). But the overcorrection "CTR manipulation easily moves rankings" is also unsupported — signals aggregate over ~13 months with anti-spam filtering.
[MYTH] "Position 1 gets ~28-30% of clicks." — Pre-AI-era number. Current measured position-1 CTR on informational queries: ~1.6-3.9% (2026).
[MYTH] "You must rank top-10 to be cited by AI Overviews." — Only ~38% of citations came from the top-10 by Mar 2026.
[MYTH] "Longer content ranks better / gets cited more." — Ahrefs measured ~zero correlation (0.04) between word count and AIO citation across 174k pages.
[MYTH] "Publishing daily/frequently is rewarded." — No frequency ranking factor exists (Google on record; the viral velocity studies are methodology-free).
[MYTH] "Small sites must optimize crawl budget." — Google's own threshold is 1M+ pages.
[MYTH] "Spanish keyword difficulty is 55-65% lower than English." — Agency marketing with zero methodology. The opportunity is real but quantify it from OUR Search Console data, not invented percentages.
[MYTH] "Most US Hispanics search Google in Spanish." — No data supports it; measured behavior is English-led with situational Spanish.
[MYTH] "es-419 is valid hreflang." — Google's docs explicitly name it unsupported.
[MYTH] "50% of searches will be voice." — Fabricated attribution (ComScore denies it). No reliable Hispanic voice-search data exists; don't build strategy on it.
[MYTH] "Translated pages create a duplicate-content penalty." — False; and no "duplicate content penalty" exists generally (filtering, not punishment).
[MYTH] "Domain age is a confirmed ranking factor." — Denied by Google; the leak shows hostAge used for spam sandboxing specifically. Both extremes overclaim.

═══════════════════════════════════════════════════════════════
HOW TO USE THIS BRAIN WHEN ADVISING
═══════════════════════════════════════════════════════════════
- Lead with the mechanic, then the move: explain WHY (how Google/AI select) before WHAT to do. That's what separates real coaching from generic tips.
- Match confidence to the tag: assert [VERIFIED]; say "Google says" for [GOOGLE-SAYS]; give [LEAKED] with its exists-not-weighted caveat; recommend [CONSENSUS] directionally; present [DEBATE] as options; correct [MYTH] on sight; re-check [SNAPSHOT] dates before big bets.
- The LIVE Search Console data OUTRANKS this doc. If our real queries/clicks disagree with a principle here, trust the data, say so, and flag the doc may be stale.
- Be honest about time: organic results compound over 6-18 months (§4). Never promise fast rankings. The fast levers are different: winning the branded SERP, seasonal pages built early, AI-answer visibility via mentions/YouTube, and fixing what already almost ranks (positions 5-20 in GSC).
- Numbers are date-stamped for a reason: CTR/AIO figures move quarterly. Quote them WITH their date, rounded, or not at all.
- Never invent a benchmark to sound precise. "Your title probably isn't winning the click — here's a sharper promise" beats a fake "your CTR should be 4.2%."`;

// Compose the brain for injection into a staff agent's SYSTEM prompt. Optionally
// prepend a one-line role framing so each agent uses it in its own voice.
export function seoBrainContext(roleHint?: string): string {
  const hint = (roleHint || '').trim();
  const head = hint ? `${hint}\n\n` : '';
  return `${head}${SEO_BRAIN}\n\n(SEO brain last reviewed ${SEO_BRAIN_LAST_REVIEWED}; search mechanics change fast — if unsure or if live Search Console data disagrees, trust the account and flag it.)`;
}
