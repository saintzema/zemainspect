# Payments

Three ways to get paid, by market.

| Market | Rail | Settlement |
| --- | --- | --- |
| Nigeria / West Africa | **Paystack** — cards, bank transfer, USSD | automatic, by webhook |
| Rest of world | **Stripe** | automatic, by webhook |
| China | **Alipay QR** | by hand |

## Paystack

Set the secret key and you are done:

```
PAYSTACK_SECRET_KEY=sk_live_…      # or sk_test_… while testing
PAYSTACK_CURRENCY=NGN              # must be enabled on your Paystack account
```

Paystack has no inline pricing — a subscription needs a `Plan` object that
exists on the account. **The app creates those itself** on the first checkout
for a tier, named `ZemaInspect STARTER (NGN)` / `ZemaInspect PRO (NGN)`, priced
from `lib/plans.ts`. The lookup matches on name, amount, currency and interval
together, so it is idempotent across deploys, and changing a price creates a new
plan rather than silently billing the old amount.

This is deliberate. Hand-creating plans in the dashboard and pasting `PLN_…`
codes into environment variables is the single most common way this integration
ends up broken: the code gets pasted from the live account into a test
deployment, or the plan is deleted, and every checkout fails. If you do want to
manage plans by hand, pin them:

```
PAYSTACK_PLAN_CODE_STARTER=PLN_…   # optional
PAYSTACK_PLAN_CODE_PRO=PLN_…       # optional
```

A pinned code that no longer resolves is logged and **falls back** to the
managed plan, so a stale pin cannot take checkout down.

### Prices

Naira prices live in `lib/plans.ts` as `priceNgnKobo`, held as their own number
rather than converted from USD at request time — a price that drifts with the
exchange rate is impossible to quote to a customer. Current values are ₦75,000
(Starter) and ₦225,000 (Pro), set against $49/$149 at roughly ₦1,510–1,530 to
the dollar. **Revisit these when the rate moves far enough to matter.**

Override per deployment without touching code:

```
PAYSTACK_PRICE_STARTER_KOBO=7500000
PAYSTACK_PRICE_PRO_KOBO=22500000
```

### When checkout fails

The billing page now shows Paystack's own message rather than a generic
"Could not start checkout", because the person looking at it is the account
owner who can fix it. Common ones:

| Message | Fix |
| --- | --- |
| `Invalid key` | `PAYSTACK_SECRET_KEY` is wrong, or a test key is set on a live deployment |
| `Currency not supported by merchant` | Enable that currency on your Paystack account, or set `PAYSTACK_CURRENCY=NGN` |
| `Plan not found` | A pinned `PAYSTACK_PLAN_CODE_*` from another account — clear it and let the app manage the plan |

### Webhook

Point Paystack at `https://your-domain/api/webhooks/paystack`. The tier is
resolved from the plan code, then our own checkout metadata, then the plan's
name — so auto-created plans still upgrade the customer. A payment that cannot
be mapped to a tier is logged as an error rather than dropped silently.

## Alipay

This is **not** a payments integration. Alipay's merchant API needs a registered
Chinese business entity, which is the thing you do not have before incorporating
there. What you do have is a personal receive-money QR code, and Chinese
customers scan those without a second thought — it is the ordinary way small
B2B payments get made.

So the billing page shows the QR, the exact amount in yuan, and a reference
(`ZI-PRO-A1B2C3`, derived from the organization id) for the buyer to put in the
transfer note. You reconcile the payment by hand and switch the account on with
**Grant free access** in `/admin/organizations`.

The copy says settlement is manual, out loud. A customer who pays and watches
their plan not change will assume the payment failed and pay again.

### Setup

1. Export the code from Alipay (Me → Receive Money → Save Image).
2. Save it to `public/images/alipay-qr.jpg` — lower case, hyphenated, **no
   spaces**. Vercel's filesystem is case-sensitive, so `AliPay QR Code.jpg`
   works on macOS and 404s in production.
3. Commit it, then set:

```
ALIPAY_QR_URL=/images/alipay-qr.jpg
ALIPAY_CONTACT=you@example.com      # or a WeChat ID; defaults to ADMIN_EMAIL
ALIPAY_ACCOUNT_NAME=Your Name       # optional, so the buyer can check the account
```

The whole card stays hidden until `ALIPAY_QR_URL` is set, so a deployment
without a QR code on file never offers a payment method that goes nowhere.

Yuan prices come from `priceCnyFen` in `lib/plans.ts` (¥350 / ¥1,050) and can be
overridden with `ALIPAY_PRICE_STARTER_FEN` / `ALIPAY_PRICE_PRO_FEN`.
