# EV Wireless Charging API

## Setup

1. `npm install`
2. Copy `.env.example` to `.env`, fill in your MySQL + Razorpay + Gmail details
3. Run `schema.sql` on your database (adds a new `otps` table — re-run this even if you set up the DB before, it's safe since every table uses `CREATE TABLE IF NOT EXISTS`)
4. `npm run dev`

## Setting up Gmail for OTP emails

1. Go to your Google Account → **Security** → turn on **2-Step Verification** (required first)
2. Still in Security, search for **"App Passwords"**
3. Create one (name it "EV Charging API"), Google gives you a 16-character code
4. Put that in `.env`:
   ```
   GMAIL_USER=youraddress@gmail.com
   GMAIL_APP_PASSWORD=the16charcode
   ```
5. **Important:** also add these two to your **Render environment variables** (Render dashboard → your backend service → Environment tab) — your local `.env` only affects your laptop, not the deployed backend

## New routes (Settings page support)

- `POST /sessions/mine` — wait, this is actually `GET /sessions/mine` — the logged-in user's own session history
- `POST /auth/request-otp` — `{ purpose: 'change_email' | 'change_password', newEmail? }` — sends a 6-digit code to the user's current email
- `POST /auth/verify-otp` — `{ purpose, otp, newPassword? }` — confirms the code and applies the change

OTP codes expire after 10 minutes and can only be used once.

## Routes overview

**Auth**
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/request-otp` (needs Bearer token)
- `POST /auth/verify-otp` (needs Bearer token)

**Sessions** (Bearer token)
- `POST /sessions/create`
- `POST /sessions/verify-payment`
- `GET /sessions/:id/status`
- `POST /sessions/:id/stop`
- `GET /sessions/mine`

**Device** (x-device-key header)
- `POST /device/telemetry`
- `GET /device/command`

**Admin** (Bearer token, role=admin)
- `GET /admin/stations`, `POST /admin/stations`
- `GET /admin/sessions/active`, `GET /admin/sessions`
- `GET /admin/stats`
- `POST /admin/sessions/:id/force-stop`

## Making your first admin user

```sql
UPDATE users SET role = 'admin' WHERE email = 'your-email@example.com';
```
