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

- `.githooks/pre-commit` blocks commits that (a) use sync `stripe.webhooks.constructEvent(`, (b) add a new `supabase/functions/<name>/index.ts` without a matching entry in `supabase/config.toml`, or (c) contain a backslash-escaped template placeholder `\${...}` in any edge function file — this emits literal `${...}` text instead of interpolating values, and was the cause of the 2026-04-21 "Descargar button does nothing" outage in purchase confirmation emails. The hook auto-installs on `npm install` via the `postinstall` script.
- If the hook fires on a commit, read the message — it points at the exact rule that's being violated. Do not bypass with `--no-verify` without fixing the underlying issue.
