# Accounts, sign-in and the admin console

## How people sign in

Three methods, offered in this order. Each one only appears if the deployment
is actually configured for it, so nobody is shown a form that does nothing.

| Method | Needs | Why it exists |
| --- | --- | --- |
| **Email + password** | nothing | The default. Works with no inbox access at all, which is the only thing you can rely on for an operator mid-shift. |
| **Email one-time code** | `EMAIL_SERVER_HOST`, `EMAIL_FROM` | For anyone who has forgotten their password but can read mail. A 6-digit code, not a magic link, so it can be carried from a phone to a shared terminal. |
| **Google** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Convenient outside China. Google is blocked on the mainland, so it is never the default. |

Sessions are JWTs (NextAuth cannot do database sessions alongside a credentials
provider), but role, organization and disabled state are **re-read from the
database on every request**. A JWT is tamper-proof yet still a snapshot; reading
through to the database means disabling an account or changing a role takes
effect on the target's very next request instead of whenever their token
happens to expire.

### Passwords

- bcrypt, cost 12.
- Minimum 10 characters; the handful of passwords that credential-stuffing
  tries first are rejected outright. Rules live in `lib/password-rules.ts`, which
  has no server-only imports so the sign-up form enforces the same thing in the
  browser.
- Over 72 UTF-8 bytes is rejected rather than silently truncated by bcrypt —
  the case a length check counted in characters would wave through.
- A wrong password, an unknown address and a Google-only account all take the
  same time and return the same answer, so sign-in cannot be used to find out
  which addresses are registered.

## The admin console

**Endpoint:** `/admin` — overview, organizations, **users**, subscriptions,
inspections, referrals. It renders with a violet accent so it is never mistaken
for a customer dashboard.

**There are no separate admin credentials, and no default password.** An admin
signs in at `/signin` like everyone else; the console is gated on the account's
`role` being `SUPER_ADMIN`.

### Becoming the first admin

Set `ADMIN_EMAIL` to the address you will sign up with. The first time an
account is created with that address it is provisioned as `SUPER_ADMIN`.

```
ADMIN_EMAIL=you@yourcompany.com
```

Then go to `/signup`, create the account with that address and a password of
your choosing, and `/admin` is reachable.

If you already signed up before setting `ADMIN_EMAIL`, promote the existing
account once against the production database:

```sql
UPDATE "User" SET role = 'SUPER_ADMIN' WHERE email = 'you@yourcompany.com';
```

The change is live on that account's next request — no need to sign out.

### Managing users — `/admin/users`

| Action | Effect |
| --- | --- |
| **Create user** | Makes the account and returns a 14-character temporary password, shown **once**. Hand it over; it is not written to the audit log and cannot be recovered. Leave the organization field on "New organization" to give them their own on a trial, or pick an existing one. |
| **Reset password** | Issues a fresh temporary password. There is deliberately no "forgot password" email flow — the reason password sign-in exists here is that email is not dependable for these users, so an admin resets it and passes it on by whatever channel works. |
| **Disable / Enable** | Takes effect immediately: existing sessions stop resolving to a user, the dashboard bounces them, and they cannot sign back in. The account and its audit trail are kept. |
| **Role** | `OWNER`, `ADMIN`, `VIEWER`, `SUPER_ADMIN`. |

You cannot disable or change the role of **your own** account — doing so would
leave the platform with no way back into the console short of a database edit.
Both the UI and the API refuse it.

Every create, role change, disable and password reset is written to
`AdminAuditLog` with the admin who did it. Temporary passwords are not.
