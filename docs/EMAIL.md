# Email delivery

Sign-in sends a **6-digit code**, not a magic link. Any SMTP provider works —
set `EMAIL_SERVER_HOST`, `EMAIL_SERVER_PORT`, `EMAIL_SERVER_USER`,
`EMAIL_SERVER_PASSWORD` and `EMAIL_FROM`. Leave them unset and the email
option disappears from the sign-in page, leaving Google OAuth only.

## Why a code instead of a link

- Operators read mail on a phone and work on a shared shop-floor terminal. A
  link opens the session on the wrong device; a code can be carried across.
- Corporate mail scanners pre-fetch URLs in incoming mail, silently consuming
  single-use magic links before the human clicks. A code is immune.
- Codes work when a mail client strips or rewrites links, which some Chinese
  corporate mail gateways do.

The code *is* NextAuth's verification token, so it is hashed with
`NEXTAUTH_SECRET` at rest and consumed exactly once. It expires in 10 minutes.

## Choosing a provider

The hard part is not Nigeria or Europe — it is **mainland China**. QQ Mail
(`@qq.com`), NetEase (`@163.com`, `@126.com`) and Sina between them cover most
Chinese business users, and they filter unknown foreign senders aggressively.
A provider that delivers perfectly to Gmail can be near-invisible to `@163.com`.

### Free tiers worth starting on

| Provider | Free tier | Notes |
|---|---|---|
| **Brevo** | 300 emails/day, ongoing | Generous, no card to start, plain SMTP. Good default. |
| **Resend** | 3,000/month (100/day) | Best developer experience; SMTP + API. |
| **Mailjet** | 6,000/month (200/day) | EU-based, straightforward SMTP. |
| **SendGrid** | Limited free tier | Widely supported; free tier has tightened over time. |
| **Amazon SES** | Not free (~$0.10 per 1,000) | Cheapest at volume once sending is steady. |

Any of these is fine for the Nigerian and international side of the business.

### For Chinese recipients

Consider a China-based relay for those addresses:

- **Alibaba Cloud DirectMail** (阿里云邮件推送)
- **Tencent Cloud SES** (腾讯云邮件推送)

Both are inside China's networks and are the conventional choice for reaching
`@qq.com` / `@163.com` reliably. Both require a verified sending domain and, in
general, Chinese real-name verification of the account — budget time for that
before a Zhejiang pilot rather than discovering it during one.

**Be aware:** a mainland ICP filing may be required to send from a `.cn` domain
or to use some domestic services at volume. Confirm the current requirement
with the provider directly — the rules change and depend on your entity.

### Practical recommendation

1. Start with **Brevo** or **Resend** now. One SMTP config, done, and enough
   for the first pilots.
2. Before the first Chinese pilot, send a test code to a real `@qq.com` and a
   real `@163.com` address and confirm it lands in the inbox rather than spam.
   That single test tells you more than any vendor's marketing.
3. If it does not land, add Alibaba DirectMail and route Chinese domains there.

## Improving deliverability wherever you send

These matter more than the provider choice:

- **Send from your own domain** (`no-reply@zemaai.com`), never a free mailbox.
  `EMAIL_FROM` must match the domain you authenticate.
- **Set SPF, DKIM and DMARC** on that domain. Your provider gives you the
  records. Without DKIM, Chinese hosts in particular will bin the mail.
- **Warm up gradually.** A brand-new domain sending a burst looks like spam.
- The code email ships **plain text alongside HTML** — Chinese hosts score
  HTML-only mail more harshly, and some factory clients render text only.
- The subject line **leads with the code**, so it can be read from a phone
  notification without opening the message.

## Verifying it works

```bash
npm run smoke https://your-domain
```

then request a code on `/signin` and confirm it arrives. Failures surface on
the sign-in page itself; check the Vercel function logs for the SMTP error if
nothing sends.
