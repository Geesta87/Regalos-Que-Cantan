# P&L Financial Agent — Mercury Bank integration (design doc)

Status: **Phase 1 BUILT on branch `claude/pnl-financial-agent-mercury-f87c52`
(2026-09-02) — not yet merged or deployed.** Owner decisions locked in
2026-09-02: sync ALL Mercury accounts; tab + API are **owner-only** (role
`admin`; assistants like Ivan rejected server-side); big-debit alert threshold
**$500**; backfill 24 months. Phase 1 files: migration
`20260902150000_mercury_finance.sql`, `mercury-sync` (+ CRON_SETUP.sql),
`finance-data`, `FinanceTab.jsx`, config.toml blocks. Phases 2–3 below remain
design.

## 1. What this is

A new admin tab ("Finance") plus a backend agent that pulls **every dollar in and
out of the Mercury business checking account** and turns it into a real P&L:

- Money in: Stripe payouts, Zelle deposits, transfers in, interest.
- Money out: Meta ads card charges, Kie/Mureka/Shotstack/OpenAI/Supabase/Vercel/
  SendGrid/Twilio subscriptions, Cloud Run, refunds, owner draws, everything else.

Today the business already has a P&L, but it's **estimate-based**:
`cos-assistant` (`pnlForRange` / `buildPnl`, exposed as the `get_pnl` tool) computes
`profit = songs-table revenue − Meta ad spend − operating_costs estimates`, where
`operating_costs` rows are owner-guessed per-order/monthly numbers (the
`stripe_fees` row literally says "ESTIMATE — correct me"). **The Mercury agent's
core job is replacing those guesses with bank actuals** — and catching everything
the estimates miss (refunds, chargebacks, annual renewals, price creep, one-off
charges).

## 2. Mercury API facts (verified against docs.mercury.com, 2026-09-02)

- Base URL `https://api.mercury.com/api/v1/`, auth via
  `Authorization: Bearer <token>` (token format `secret-token:mercury_production_…`).
- **Token types:** Read-Only (no IP whitelist required), Read-Write (whitelist
  mandatory), Custom scopes. **We use Read-Only, full stop** — this system never
  moves money (see §7).
- **Token lifecycle gotcha:** unused tokens are **auto-deleted after 45 days**,
  and over-scoped tokens are auto-downgraded. Our nightly sync cron doubles as
  the keep-alive, so this only bites if the cron dies — health-check should watch
  sync freshness (§6).
- Key endpoints:
  - `GET /transactions` — cross-account, cursor-paginated (limit ≤1000), filters:
    `start`/`end` (createdAt), `postedStart`/`postedEnd`, `status[]`, `accountId`,
    `search`, `mercuryCategory`. This is the workhorse.
  - `GET /accounts` — account list + live balances.
  - `GET /account/{id}/statements` (+ PDF download) — monthly statements.
  - `POST /webhooks` — subscribe to `transaction.created` / `transaction.updated`
    and balance updates; signing secret returned **only at creation**; up to 100
    endpoints per org.
- **Transaction object** (the fields we care about): `id`, `accountId`, `amount`
  (**negative = money out, positive = money in**), `counterpartyName`,
  `counterpartyNickname`, `status` (pending/sent/cancelled/failed/reversed/blocked),
  `kind` (externalTransfer, creditCardTransaction, checkDeposit, …), `createdAt`,
  `postedAt`, `mercuryCategory` (Mercury's own enum: Software, Advertising, …),
  `categoryData` (custom category), `note`, `bankDescription`, `merchant` (MCC
  etc. on card txns), `dashboardLink`, `feeId`, `relatedTransactions`.
- Rate limits are not documented; be polite (nightly batch + webhook trickle is
  tiny anyway).

## 3. Architecture

Same shape as every other agent in this repo (migration + edge functions +
config.toml blocks in the same commit + CRON_SETUP.sql + admin tab).

```
Mercury API ──(nightly cron pull + optional webhook push)──▶ mercury_transactions
                                                                    │
                     mercury_category_rules (auto-categorizer)      │
                                                                    ▼
finance-agent (chat, verify_jwt=true) ◀── reads ──  P&L rollups (SQL views)
        │                                                           │
        ▼                                                           ▼
  FinanceTab.jsx (admin)  ◀───────────────────────────  monthly/weekly summaries
```

### 3.1 Edge functions

| Function | verify_jwt | Trigger | Job |
|---|---|---|---|
| `mercury-sync` | **false** (pg_cron) | nightly + on-demand from the tab | Pull `GET /transactions` since last cursor/date, upsert into `mercury_transactions`, refresh account balances, run the categorizer, then anomaly checks (§5). First run backfills 12–24 months. |
| `mercury-webhook` | **false** (external caller) | Mercury webhook | Optional Phase-2 nicety: near-real-time inserts + `transaction.updated` status changes (pending→sent). Verify the signing secret. Nightly sync remains the source of truth / self-healer. |
| `finance-agent` | **true** (frontend, admin JWT) | Finance tab | Interactive console, cloned from the `ops-agent` pattern: admin_users gate, Anthropic tool-use loop (`FINANCE_AGENT_MODEL || 'claude-opus-5'`), reads via `analyst_run_sql` + dedicated P&L tools. Serves both chat Q&A ("what did we spend on AI APIs in August?") and the tab's structured JSON (P&L table, charts). Write-shaped actions (recategorize, set a budget) go through a `finance_pending_actions` approval table — never executed inline. |

Per CLAUDE.md §3.2: the two `verify_jwt = false` blocks land in
`supabase/config.toml` **in the same commit** that adds the functions (pre-commit
hook enforces this).

### 3.2 Tables (one migration, house style: CHECK-enum text cols, RLS on, no policies = service-role only)

```sql
mercury_accounts        -- id (mercury uuid), name, kind, current_balance, available_balance, synced_at
mercury_transactions    -- id (mercury uuid PK), account_id, amount numeric, counterparty_name,
                        -- counterparty_clean (normalized), status, kind, mercury_category,
                        -- created_at_mercury, posted_at, bank_description, note,
                        -- category text        -- OUR P&L category (see below)
                        -- category_source     -- 'rule' | 'mercury' | 'agent' | 'manual'
                        -- is_transfer boolean  -- internal moves, excluded from P&L
                        -- raw jsonb, synced_at
mercury_category_rules  -- pattern (counterparty match), category, priority, created_by, hit_count
mercury_sync_state      -- last_synced_at, last_transaction_cursor, last_error
finance_pending_actions -- ops_pending_actions clone: action_type, params, summary, status, result
```

**P&L category set** (keep it small — ~12 buckets the owner actually thinks in):
`revenue_stripe`, `revenue_other`, `ads_meta`, `ads_other`, `ai_apis` (Kie,
Mureka/useapi, Anthropic, OpenAI), `infra` (Supabase, Vercel, Cloud Run,
Shotstack), `messaging` (Twilio, SendGrid), `software_tools`, `fees_bank`,
`refunds_chargebacks`, `owner_draw`, `taxes`, `other`. Mercury's own
`mercuryCategory` + `counterpartyName` rules auto-assign ~95% after the first
categorization session; the agent proposes categories for strangers and the
owner confirms with one tap (writes a new rule, so it sticks).

**Transfers:** internal account-to-account moves and credit-card payments get
`is_transfer = true` and are excluded from P&L (else they double-count).

### 3.3 Admin tab

`src/components/admin/FinanceTab.jsx`, default export, props
`{ accessToken, showToast }`, built from `admin/ui.jsx` (Card/Badge/Stat/btn —
indigo, English, no emoji). Wire into the three `AdminDashboard.jsx` spots:
deep-link `valid` array (~:3221), sidebar + mobile nav + header title, and the
content ternary. Admin-role gated like `dailybriefing`.

Tab layout (top to bottom):
1. **Header stats:** current bank balance, this-month net cash flow, this-month
   P&L profit, runway months (balance ÷ trailing-3-month avg burn).
2. **P&L statement:** month columns × category rows, actuals from the bank,
   with MoM deltas highlighted. Toggle: cash view (posted date) vs the existing
   songs-table revenue view side by side (§4).
3. **Cash-flow chart:** daily in/out bars + balance line, 90 days.
4. **Transactions ledger:** filterable list (date, category, account, search),
   inline recategorize (writes a rule via pending-action), link out to
   `dashboardLink` on Mercury.
5. **Agent chat + review queue:** ask questions; confirm proposed
   categorizations / flagged anomalies (Confirm/Cancel cards like OpsAgentTab).

## 4. Reconciliation — the highest-value feature

Three money views exist and none currently talk to each other:

1. **Stripe gross** (what customers paid) — songs table, deduped per
   `stripe_session_id` (memory: Stripe runs ~2% ahead of DB).
2. **Stripe net payouts** (what actually lands in Mercury) — gross − Stripe fees
   − refunds − chargebacks − reserve timing.
3. **Bank actuals** — everything, including spend the cost model has never seen.

The agent should continuously reconcile:
- **Payout check:** weekly, match Mercury's Stripe deposits against expected
  net revenue for the payout window. A widening gap = rising refunds/disputes
  or a fee change — surfaced before it silently eats margin. (Real Stripe fees
  finally replace the "$1.25/order — correct me" estimate.)
- **Ad-spend check:** Meta card charges in Mercury vs Meta API reported spend
  (`media-buyer-daily` already pulls the latter).
- **Cost-model calibration:** monthly, compare `operating_costs` estimates to
  bank actuals per category and propose corrections (pending-action; owner
  confirms). `cos-assistant`'s `get_pnl` and the daily briefing get truer
  numbers without changing their code — just better `operating_costs` rows,
  plus an optional later switch to read bank actuals directly.

## 5. Recommendations (beyond the basic ledger)

Ranked by value-per-effort for this business:

1. **Runway + burn on the header** — one glance answers "are we fine?" Trailing
   average burn, excluding transfers and owner draws (shown separately).
2. **Anomaly alerts via the existing health-check → WhatsApp/email channel:**
   new/unknown counterparty over $X, any single debit over $Y, a recurring
   vendor charging more than last cycle (**subscription price-creep detector** —
   this alone usually pays for the feature), balance below a floor, failed/
   reversed transactions, and **sync-stale > 48h** (also guards the 45-day
   token auto-delete).
3. **Monthly P&L email** — 1st of the month, deterministic like
   `cos-morning-digest`: statement table, MoM deltas, agent's 3-sentence read,
   contribution-margin framing (margin after CPA, per house rule).
4. **Duplicate-charge / forgotten-subscription sweep** — monthly list of
   recurring vendors with "last used?" annotations; memory shows 4 dead side
   projects were already paying Supabase before being caught by hand.
5. **Estimated-tax set-aside line** — show profit and "profit after ~X% tax
   reserve" so the header number is spendable truth. (Display only — Claude is
   not a tax advisor; the % is an owner-set config value.)
6. **Cash-flow forecast (later):** recurring-charge calendar + payout cadence →
   projected balance 30 days out; warn on projected dips.

**Deliberately out of scope:** paying bills, initiating transfers, or any
money movement (§7); full double-entry accounting (this is a P&L/cash view,
not a QuickBooks replacement — statements PDF export covers the accountant).

## 6. Ops & observability

- Secret: `MERCURY_API_TOKEN` (Supabase project secret; read-only token).
  Webhook signing secret: `MERCURY_WEBHOOK_SECRET` (captured at creation — it
  is not retrievable later).
- Cron: `mercury-sync` nightly (e.g. 03:15 America/Los_Angeles) via
  `CRON_SETUP.sql` next to the function (run by hand, not a migration —
  house convention). Report freshness into health-check.
- Audit: each sync + agent run writes an `agent_runs` row like the other agents.
- This repo is public: no account numbers, balances, or token fragments in
  code, fixtures, or docs. Transaction data lives only in Supabase.

## 7. Hard safety rules

- **Read-only Mercury token, always.** Never request or store a Read-Write
  token; this system must be architecturally unable to move money. (Also skips
  Mercury's IP-whitelist requirement, which we couldn't satisfy from edge
  functions with dynamic egress IPs anyway.)
- Agent writes are **proposals only** (`finance_pending_actions`), owner-
  confirmed in the tab — same contract as ops-agent/cos.
- Finance data is admin-role only (owner + Ivan see the tab per current
  admin gating; tighten to owner-only if preferred — decide before build).

## 8. Build order

- **Phase 1 — the ledger (ship first):** migration + `mercury-sync` + backfill
  + categorizer + FinanceTab with stats/P&L/ledger. Immediately useful with
  zero LLM involvement.
- **Phase 2 — the agent:** `finance-agent` chat, categorization proposals,
  reconciliation checks, anomaly alerts through health-check.
- **Phase 3 — polish:** monthly P&L email, webhook real-time feed,
  cost-model calibration loop, forecast.

Open questions for the owner before building:
1. One Mercury account or several (checking + savings/treasury)? Sync all.
2. Who sees the tab — owner only, or owner + Ivan?
3. Alert thresholds: single-debit $ amount, low-balance floor, tax-reserve %.
4. Backfill depth: 12 or 24 months?
5. Persona: personify as one of the existing agent cast (Ace/Cruz/Nova style)
   or keep it plain "Finance"? Cosmetic — decide at Phase 2.
