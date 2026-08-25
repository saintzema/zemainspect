# Deployment

Target: Vercel (app + API) and Neon (Postgres). Everything else is optional and
degrades gracefully when unset.

## 1. Database — Neon

Create a project, then take **two** connection strings from the dashboard:

```
DATABASE_URL="postgresql://...-pooler.../zemainspect?sslmode=require"   # pooled
DIRECT_DATABASE_URL="postgresql://.../zemainspect?sslmode=require"      # direct
```

Both are required. Prisma migrations fail over PgBouncer, so they use the
direct URL while the app runs on the pooled one.

## 2. Vercel

Import the repo, then set the environment variables from `.env.example` for
**Production and Preview**. The minimum for a working deploy:

| Variable | Why |
|---|---|
| `DATABASE_URL`, `DIRECT_DATABASE_URL` | database |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | sessions (`openssl rand -base64 32`) |
| `GOOGLE_CLIENT_ID` / `SECRET` **or** the `EMAIL_SERVER_*` set | at least one sign-in method |
| `NEXT_PUBLIC_APP_URL` | absolute URLs in checkout and referral links |
| `ADMIN_EMAIL` | seeded as `SUPER_ADMIN` on first login |

The build command is already set in `package.json`:

```
prisma generate && prisma migrate deploy && npm run prepare:assets && next build
```

`prepare:assets` copies the ONNX Runtime WASM files into `public/ort/`. They are
gitignored and regenerated every build — do not commit them.

If your platform runs migrations separately, use `npm run build:ci`, which
skips `migrate deploy`.

## 3. Model weights

See [MODEL.md](MODEL.md). Until this is done the app runs and every other
feature works, but `/api/v1/inspect` returns `503 model_unavailable`.

## 4. Payments

### Paystack (primary — NGN and African cards)

1. Create two **Plans** in the Paystack dashboard (monthly): Starter and Pro.
2. Set `PAYSTACK_PLAN_CODE_STARTER` and `PAYSTACK_PLAN_CODE_PRO` to their
   `PLN_...` codes, plus `PAYSTACK_SECRET_KEY`.
3. Add a webhook pointing at `https://<domain>/api/webhooks/paystack`.

The plan carries its own amount and currency — the app reads them from Paystack
rather than hardcoding NGN prices, so you change pricing in one place.

Paystack signs webhooks with HMAC-SHA512 of the raw body using your **secret
key** (there is no separate webhook secret).

### Stripe (international)

1. Create monthly Prices for Starter and Pro; set `STRIPE_PRICE_ID_*`.
2. Add a webhook for `checkout.session.completed`,
   `customer.subscription.created|updated|deleted`, `invoice.payment_failed`
   at `https://<domain>/api/webhooks/stripe`.
3. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.

Configure either, or both. With both, an org's provider is chosen by currency
(NGN/GHS/ZAR/KES → Paystack, otherwise Stripe) and the customer can override on
the billing page. With one, that one is always used.

## 5. Cron

`vercel.json` already registers `/api/cron/check-thresholds` every 15 minutes.
Set `CRON_SECRET` and Vercel will send it as a bearer token; the route rejects
unauthenticated calls when it is set.

## 6. Optional

| Variable | Effect if unset |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | frames are not retained; detection still works |
| `DEEPL_API_KEY` / `GOOGLE_TRANSLATE_API_KEY` | dynamic strings echo untranslated; the static UI is unaffected |
| `PDF_CJK_FONT_URL` | Chinese compliance PDFs fall back to English with a note |
| `INFERENCE_SERVICE_URL` | everyone uses the local nano model |

## 7. Smoke test

1. Sign up → an Organization is created on a 14-day trial.
2. Sign in as `ADMIN_EMAIL` → `/admin` is reachable (violet accent).
3. Onboarding → copy the API key → `POST /api/v1/inspect` returns detections.
4. `/dashboard` shows the result; **Start camera** runs edge inference.
5. Upgrade via Paystack or Stripe test mode → the webhook flips the org to
   `ACTIVE` and `/admin/subscriptions` shows it.
6. `/admin/organizations` → **Grant free access** → the org shows a pilot badge.

## Notes

- **Vercel function limits.** Inference routes declare `maxDuration = 60`,
  which needs a Pro plan. On Hobby (10 s) prefer the edge path, or Path B.
- **`onnxruntime-node` and the 250 MB function limit.** The package ships
  prebuilt binaries for five platforms (~283 MB): darwin/arm64, win32/x64,
  win32/arm64, linux/x64 and linux/arm64. A serverless deploy only ever runs
  linux/x64 (~44 MB), and Vercel caps an unzipped function at 250 MB — so
  shipping all five exceeds the cap and fails the deploy. `next.config.mjs`
  excludes the other four from output file tracing, which brings the inspect
  function to ~110 MB.
- **`.npmrc` sets `onnxruntime-node-install=skip`.** The CPU runtime we use is
  already inside the npm tarball; that postinstall exists only to pull CUDA 12
  and TensorRT provider libraries from NuGet, which this app never loads (it
  runs `executionProviders: ["cpu"]`, and no serverless host has a GPU).
  Skipping it removes a build-time CDN dependency and keeps the function small.
  Do not remove this file — `npm ci` fails without network access to NuGet,
  and succeeding would only bloat the deploy.
- **Cold starts.** The first server inference after a cold start pays session
  creation (~1–2 s). The edge path avoids this entirely after the first load.
