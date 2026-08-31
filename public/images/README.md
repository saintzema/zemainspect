# Public images

## `alipay-qr.jpg`

The Alipay receive-money QR code shown on the billing page.

Export the code from the Alipay app (Me → Receive Money → Save Image) and save
it here as **`alipay-qr.jpg`** — lower case, hyphenated, no spaces. Vercel's
filesystem is case-sensitive, so `AliPay QR Code.jpg` resolves locally on macOS
and 404s in production.

Then set the environment variable that switches the option on:

```
ALIPAY_QR_URL=/images/alipay-qr.jpg
ALIPAY_CONTACT=you@example.com
```

The card stays hidden until `ALIPAY_QR_URL` is set, so a deployment without a
QR code on file never offers a payment method that goes nowhere.
