# Regalos Que Cantan — Claude session guide

This file is loaded automatically at the start of every Claude Code session.
**Read it before you touch Supabase edge functions or the Stripe webhook.**

## 1. Stack at a glance

- Frontend: Vite + React, deployed to **Vercel** via git push to `main` (never call it Netlify — the `netlify.toml` is a stale leftover)
- Database / auth / edge functions: Supabase (project ref `yzbvajungshqcpusfiia`, name *Regalos Que Cantan*)
- Payments: **Stripe**
- Music generation: Kie.ai + Mureka via useapi.net
- Video generation: Shotstack
- Email: SendGrid
- Scheduled jobs: Supabase pg_cron

Supabase edge functions run on **Deno**, not Node. That matters — see §3.

## 2. Production incident — 2026-04-17

**Never repeat this.** Two back-to-back outages blocked all Stripe payment confirmations for several hours:

1. **JWT 401 outage.** `stripe-webhook` was redeployed without `--no-verify-jwt`, which re-enabled JWT verification. Stripe webhooks don't carry a Supabase JWT — every call bounced with 401.
2. **constructEvent 400 outage.** Once the 401 was fixed, the handler started returning 400 with `"SubtleCryptoProvider cannot be used in a synchronous context. Use await constructEventAsync(...) instead of constructEvent(...)"`. Stripe SDK's sync crypto doesn't work in Deno.

Root causes: (a) no `supabase/config.toml` to persist per-function `verify_jwt` settings, so every deploy of `stripe-webhook` forgot the flag; (b) code used `stripe.webhooks.constructEvent(...)` instead of the async variant.

Both are now fixed. The fixes **regressed once in the same day** when a parallel branch (`claude/eloquent-stonebraker`) redeployed `stripe-webhook` from an out-of-date tree. The rules below exist to stop that from ever happening again.

## 3. Rules — do not deviate

### 3.1 Stripe webhook signature verification

Always use the async variant. The sync variant throws in Deno and returns 400.

```ts
// ✅ correct
const event = await stripe.webhooks.constructEventAsync(body, signature, STRIPE_WEBHOOK_SECRET);

// ❌ will silently break production
const event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);
```

Never "clean up" the `await` or drop the `Async` suffix, even if a linter suggests it.

### 3.2 verify_jwt — config.toml is the source of truth

`supabase/config.toml` pins `verify_jwt = false` for every edge function that is invoked by an external service (Stripe, Shotstack, Kie.ai, useapi.net) or by pg_cron. The Supabase CLI reads this file on deploy. As long as the entry exists, the flag survives redeploys.

**Any new edge function you add that falls into one of these categories MUST get a `[functions.<name>]` block with `verify_jwt = false` in `supabase/config.toml` in the same commit that adds the function.** If you skip this step, the first deploy of that function will 401 every external webhook.

Category quick-check:
- Called by an external webhook / callback / provider → `verify_jwt = false`
- Called by pg_cron → `verify_jwt = false`
- Called by another edge function with service-role context → `verify_jwt = false`
- Called by your own frontend with the Supabase anon key / user JWT → leave as default (`true`)

### 3.3 Deploy commands

Use the plain form — config.toml handles JWT:

```bash
supabase functions deploy <name> --project-ref yzbvajungshqcpusfiia
```

Do NOT pass `--no-verify-jwt`. That flag is deprecated for this project; the file does the work now.

Do NOT copy the `// Deploy with:` comment at the top of older function files verbatim. Several of them are outdated and were the vector for the 2026-04-17 outage.

### 3.4 Before any webhook-adjacent deploy

1. Make sure your local tree has `supabase/config.toml`. If not, rebase on `main`.
2. If you're adding a new webhook function, add its config block first.
3. If you're modifying `stripe-webhook`, keep `constructEventAsync` intact.
4. After deploying, fire a real or Resend'd Stripe event and verify HTTP 200 in Supabase logs before walking away.

### 3.5 Functions that MUST have `verify_jwt = false`

Already pinned in `supabase/config.toml`:
- `stripe-webhook` (Stripe)
- `video-callback` (Shotstack)
- `mureka-useapi-callback` (useapi.net / Mureka)
- `song-callback` (Kie.ai)
- `health-check` (pg_cron)
- `poll-processing-songs` (pg_cron)
- `recover-temp-videos` (pg_cron)
- `generate-song-mureka` (server-to-server)

Functions that should be added to the list as work on `claude/eloquent-stonebraker` lands:
- `render-social-clip`
- `social-clip-callback`

## 4. Observability

- `health-check` runs every 10 min via pg_cron and flags payment-sync mismatches, stuck songs, failed-song spikes, and low WhatsApp capture rate. Alerts go to `ALERT_EMAIL` / `ALERT_WHATSAPP_TO` if those project secrets are set. If you change anything that could affect reconciliation, confirm those secrets are configured.
- Supabase edge function logs live at https://supabase.com/dashboard/project/yzbvajungshqcpusfiia/functions — filter by function name and watch for 4xx spikes.
- SendGrid Activity is the source of truth for email delivery; filter by category (`purchase_confirmation`, `checkout_recovery`, `purchase_link_resend`, etc).

## 5. Safeguards enforced by this repo

- `.githooks/pre-commit` blocks commits that (a) use sync `stripe.webhooks.constructEvent(`, or (b) add a new `supabase/functions/<name>/index.ts` without a matching entry in `supabase/config.toml`. The hook auto-installs on `npm install` via the `postinstall` script.
- If the hook fires on a commit, read the message — it points at the exact rule that's being violated. Do not bypass with `--no-verify` without fixing the underlying issue.

## 6. Fix-a-Song system (correcting paid songs)

How customer song corrections work. Read this before touching `fix-song-section`,
`song-fix-queue`, `fix-song-auto`, `FixSongCard`/`FixQueue` in AdminDashboard.jsx,
or `src/utils/audioSplice.js`.

### Hard rules (owner decisions — do not relitigate)

- **Whole Suno takes ONLY.** Never splice, time-stretch (`atempo`), or pitch-shift
  a customer's song. Every spliced result was audibly worse and owner-rejected
  (2026-07/08). The only permitted audio surgery is a single END-TRIM (cut + fade
  at the song's true final lyric line) to remove Suno's duplicated-tail
  over-extension.
- **A human always approves.** Automation may generate and STAGE candidates; only
  the owner (or Ivan) releases a fix into a customer's live song. Preview first.
- **Length discipline:** a take ships as-is only if its sung length is ≤1.08× the
  original; longer takes get the end-trim rescue (trimmed target ≤1.15×); beyond
  that, reject the take. The old 1.30× as-is ceiling shipped a 3:52 song as 4:49.

### The flow

1. `section-submit` (Kie replace-section) re-sings from the corrected lyrics —
   returns a COMPLETE song, internally blended. Validate the WHOLE output by
   Whisper transcript (corrected line sung ≥ its lyric occurrence count, old
   wording sung zero times, prior fix corrections still present, structure and
   length intact), then rehost + present + `apply`.
2. Applies CHAIN: `fixTaskId`/`fixAudioId` are stored into
   `kie_task_id`/`kie_payload` so the NEXT fix re-sings from the corrected take.
   `fix_corrections` accumulates; takes that revert an earlier correction are
   rejected. (Pre-2026-08-06, fix #2 silently reverted fix #1 — never remove this.)
3. Multi-spot fixes: the ladder drives spots sequentially (earliest first,
   chained, one final preview).
4. **Persona re-roll — the escape hatch** when replace-section over-extends every
   round (long structures / [Hablado] sections do this): `mint-persona` clones
   the song's own singer (ONE mint per audioId EVER — persisted in
   `songs.kie_source.personaId`, always reuse), then `full-submit` with
   `personaId` + `durationS` = fresh full take, SAME voice, pinned length
   (`duration` works on V5_5 only). It is still a new performance — owner ears
   judge the A/B before applying.

### Kie facts (verified against docs.kie.ai 2026-08-09)

- replace-section window: 6–60s, ≤50% of song, **no length-control parameter**.
- Source audio is purged ~14 days per take; every applied fix is a fresh take,
  which resets that clock.
- Whisper gotchas when validating: numbers/years transcribe as DIGITS ("13",
  "19 de agosto") or spelled words — match both; name pronunciation cannot be
  judged from transcripts (g/k confusion); ignore the hallucinated
  "Subtítulos … Amara.org" over instrumental outros (verify by timestamp).

### Auto-fix pipeline (ON since 2026-08-09)

Chat → "Send to Fix Song" intake (auto-pulls the customer's email from the
conversation) → `fix-song-auto` (pg_cron job 48 — reconstructable from
`supabase/functions/fix-song-auto/CRON_SETUP.sql`; kill switch
`fix_auto_state.enabled`, toggleable via the 🤖 pill in the Fix Song queue
header, owner-only) understands → plans → generates → validates (same
count-based checklist as the manual ladder, on the audible part only) → STAGES
(candidate_meta carries the winner's `fixTaskId`/`fixAudioId`/`fixTrimAtS` so
release keeps the chain) → WhatsApp ping to approvers → one-tap Release in
`/admin?tab=fixsong` (releases auto-notify the customer and report any paid
stale artifacts to re-run). It never guesses: ambiguity ⇒ `needs_human`, and
the queue card shows the robot's reason.

Splice/rehost/trim run on Cloud Run `rqc-video-renderer` (`/splice-audio`), which
also hosts Clip Studio routes — deploy it only from an up-to-date main.

### Hardening (2026-08-10)

- `fix-song-section` requires auth IN-HANDLER: the service-role key
  (server-to-server) or a logged-in `admin_users` session. The public anon key
  is rejected — never "simplify" the frontend back to `Bearer ${ANON}` for it.
- **Add-a-line is a FULL re-roll** now. The old `runAddLine` splice graft
  (spliceAddedTail) violated the whole-takes-only rule and was retired; do not
  resurrect it.
- The daily auto cap counts `song_fix_attempts.action='auto-submit'` marker
  rows only; manual browser fixes don't starve the robot.
- `fix_auto_state.active_since` must be non-NULL while enabled (a NULL makes
  the worker silently process nothing). The `auto-toggle` action sets it on
  first enable — keep that invariant.
