# One-tap secondary upsell — Stripe test-mode plan

Feature branch: `feature/one-tap-secondary-upsell`. **Nothing is deployed.** This
plan verifies the one-tap post-purchase upsell (Animado / instrumental) end to
end in **Stripe test mode** before any production deploy.

> This is a developer-level pass. It touches real payment plumbing, so do it
> carefully and in this order. None of it affects the live site until Section 10.

---

## 0. Principle — never test on live

The Vite preview cannot exercise Stripe. We test with **Stripe TEST keys** against
a **local Supabase stack** (Supabase CLI + Docker), with the **Stripe CLI**
forwarding test webhooks. This is fully isolated from production — no live key is
ever touched, no real card is ever charged.

---

## 1. What we're verifying

1. The song checkout saves the card (Stripe customer + payment method + last4 land on the song row).
2. A single tap charges that saved card — no second checkout.
3. The rare "bank wants verification" branch returns `needs_action` (no charge stuck).
4. A double-tap charges **once** (idempotency).
5. A stranger cannot charge someone else's card (ownership check).
6. Fulfillment fires: Animado → `awaiting_photo` order + photo step; instrumental → `karaoke_status='pending'` + worker trigger.

---

## 2. Prerequisites

- Supabase CLI · Docker Desktop (for `supabase start`)
- Stripe CLI (`stripe login`, in **test mode**)
- Stripe **test** keys from the Stripe dashboard (View test data → Developers → API keys):
  - `sk_test_...` (secret), `pk_test_...` (publishable)

---

## 3. Apply the migration locally

```bash
git checkout feature/one-tap-secondary-upsell
supabase start                 # local Postgres + functions
supabase db reset              # applies ALL migrations incl. 20260623120000_saved_card_one_tap_upsell.sql
```

Confirm the columns + table exist:

```sql
\d public.songs            -- expect stripe_customer_id, stripe_payment_method_id, stripe_card_last4
\d public.upsell_charges   -- expect the table + unique index upsell_charges_one_active_per_item
```

---

## 4. Test env for the functions

Create `supabase/functions/.env` (LOCAL ONLY — never commit):

```
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx        # printed by `stripe listen` in step 6
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<local service role from `supabase start` output>
BASE_URL=http://localhost:5173
KARAOKE_TRIGGER_SECRET=test-not-used-locally
```

---

## 5. Serve the functions locally

```bash
supabase functions serve create-checkout stripe-webhook charge-upsell \
  create-story-video-order --env-file supabase/functions/.env
```

(`config.toml` is respected — `charge-upsell` runs with `verify_jwt = true`.)

---

## 6. Forward Stripe test webhooks

In a second terminal:

```bash
stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook
```

Copy the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET` (step 4) and restart `functions serve`.

---

## 7. Seed a test song

Insert a minimal unpaid song to check out (local DB):

```sql
insert into public.songs (id, email, recipient_name, genre, audio_url, paid)
values (gen_random_uuid(), 'test@example.com', 'María', 'corrido',
        'https://example.com/test.mp3', false)
returning id;
```

Keep that `id` — call it `SONG_ID`.

---

## 8. Test runs

### T1 — happy path (save card → one-tap Animado)
1. Call `create-checkout` for `SONG_ID` (via the funnel or curl). Complete Stripe
   Checkout with **`4242 4242 4242 4242`**, any future expiry/CVC.
2. `stripe listen` forwards `checkout.session.completed` → check logs: no errors.
3. Verify the card was saved:
   ```sql
   select paid, stripe_customer_id, stripe_payment_method_id, stripe_card_last4,
          stripe_session_id
   from public.songs where id = 'SONG_ID';
   ```
   Expect `paid=true`, a `cus_...`, a `pm_...`, `last4=4242`, and a `cs_test_...` session id.
4. Charge the upsell (simulate the one tap):
   ```bash
   curl -X POST http://127.0.0.1:54321/functions/v1/charge-upsell \
     -H "Authorization: Bearer <local anon key>" -H "Content-Type: application/json" \
     -d '{"song_id":"SONG_ID","item":"animado","session_id":"<cs_test_... from step 3>"}'
   ```
   Expect `{"status":"paid","item":"animado","order_id":"...","payment_intent":"pi_..."}`.
5. Verify:
   ```sql
   select * from public.upsell_charges where song_id='SONG_ID';          -- one row, status='paid'
   select * from public.story_video_orders where song_id='SONG_ID';      -- state='awaiting_photo'
   ```
   And in the Stripe **test** dashboard: a $49.00 successful PaymentIntent.

### T2 — instrumental one-tap
Repeat the curl with `"item":"instrumental"`. Expect `status:paid`,
`songs.karaoke_status='pending'`, and a $7.99 test PaymentIntent.

### T3 — bank verification (off-session SCA → needs_action)
Re-run T1 but pay the original checkout with the off-session-authentication test
card **`4000 0025 0000 3155`** (confirm current number on Stripe's testing page).
Then call `charge-upsell`. Expect `{"status":"needs_action","reason":"authentication_required"}`
and an `upsell_charges` row with `status='needs_action'` — **no silent charge**.

### T4 — decline
Save card with a normal card, then charge an item whose PaymentIntent declines
(use a decline test token / `4000 0000 0000 0002` at checkout for a decline path).
Expect `status:error`, row `status='failed'`, retry allowed.

### T5 — double-tap idempotency
Fire the same `charge-upsell` curl **twice quickly**. Expect: exactly **one**
`status='paid'` row, **one** PaymentIntent in Stripe, and the second call returns
`{"status":"paid","already":true}`.

### T6 — ownership check
Call `charge-upsell` with a **wrong** `session_id`. Expect HTTP 403
`{"status":"error","error":"not_authorized"}` and **no charge**.

### T7 — no saved card (legacy order)
Null out the card on a paid song, then charge. Expect
`{"status":"needs_action","reason":"no_saved_card"}` — no crash.

---

## 9. What to check each run

- **DB:** `upsell_charges` (one active row per song+item), `songs.stripe_*`, `story_video_orders` / `karaoke_status`.
- **Stripe test dashboard:** PaymentIntents match amounts; no duplicates.
- **Logs:** `functions serve` shows no unhandled errors; webhook returns 200.

---

## 10. Go-live (only after all of T1–T7 pass)

Deploy in this order, plain `supabase functions deploy` (config.toml handles JWT —
do NOT pass `--no-verify-jwt`):

```bash
# 1) Migration to prod
supabase db push   # or run 20260623120000_saved_card_one_tap_upsell.sql via the dashboard

# 2) Functions (charge-upsell first; webhook + checkout are the sensitive pair)
supabase functions deploy charge-upsell        --project-ref yzbvajungshqcpusfiia
supabase functions deploy create-checkout      --project-ref yzbvajungshqcpusfiia
supabase functions deploy stripe-webhook       --project-ref yzbvajungshqcpusfiia
```

Then:
- Confirm **prod** `STRIPE_SECRET_KEY` is the **live** key (not a test key).
- Confirm the prod Stripe webhook already delivers `checkout.session.completed`
  (it does) — no new endpoint needed.
- Deploy the frontend (`git push` to `main`) **only when ready** — this is what
  removes the 3 extras from checkout and shows the one-tap screen.
- Smoke test: one real small purchase (or a Stripe "Resend" of a test event in
  live mode is not possible — use a genuine low-risk purchase), verify the card
  saves and a one-tap charge works, then refund it.

**Sequencing note:** the frontend (extras removed from checkout) and the backend
(card-saving + charge-upsell) should go live **together**, so there's never a
window where the extras are gone from checkout but the one-tap isn't live yet.

---

## 11. Rollback

- Frontend: `git revert` the frontend commit (extras reappear in checkout instantly).
- `charge-upsell`: it's additive and isolated — disabling the success-page mount
  (or reverting) stops all one-tap charges. The saved-card columns + webhook
  capture are harmless to leave in place.
- No data migration is destructive (only `add column` / `create table if not exists`).
