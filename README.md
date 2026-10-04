# EV Wireless Charging API

## Setup

1. `npm install`
2. Copy `.env.example` to `.env`, fill in MySQL + Razorpay + Gmail details
3. Run `schema.sql` on your database — safe to re-run even on an existing database:
   - Adds `vehicle_models` table, pre-seeded with common EVs/scooters
   - Adds `rated_power_kw` to `charging_stations`
   - Adds `vehicle_label`, `battery_kwh`, `start_percent`, `energy_needed_kwh`,
     `refund_amount`, `end_reason`, `low_current_since` to `sessions`
   - Adds `razorpay_refund_id`, `refund_amount` to `payments`
4. `npm run dev`

## New: vehicle-based smart estimate

- `GET /vehicles` — list of EV models with battery capacity, for the picker
- `POST /sessions/estimate` — `{ station_id, vehicle_id, current_percent }` → returns the
  energy needed (kWh), estimated minutes, and the exact ₹ amount for a full charge
- `POST /sessions/create` now optionally accepts `vehicle_id` and `current_percent` to store
  alongside the session, for reference and the refund flow

## New: auto-stop on full charge + automatic refund

`routes/device.js` watches the `current` value in every `/device/telemetry` call. EV/Li-ion
batteries naturally taper their charging current down to near-zero as they approach 100% — this
is standard CC-CV charging behavior, not something specific to this project. When current stays
below 50 mA for 45 seconds straight, the backend treats the battery as full and:

1. Ends the session (`end_reason = 'full_charge'`)
2. Calculates the unused time as a fraction of the total paid session
3. Issues a partial refund via `razorpay.payments.refund()` for that unused portion
4. Updates the `payments` row to `partially_refunded`

The same refund logic (`utils/endSession.js`) is shared by:
- Full-charge auto-stop (`routes/device.js`)
- User manually clicking "Stop Charging" (`POST /sessions/:id/stop`)
- Admin force-stop (`POST /admin/sessions/:id/force-stop`)

A normal finish where the timer just runs out (`end_reason = 'time_up'`) does **not** refund
anything — the user paid for that full duration.

## Tuning the full-charge detection

In `routes/device.js`:
- `LOW_CURRENT_THRESHOLD_A` — how low current must drop (default 0.05A / 50mA)
- `FULL_CHARGE_SUSTAIN_SECONDS` — how long it must stay that low before triggering (default 45s)

Raise the sustain time if you see false triggers (e.g. from a momentary dip), lower it if you
want faster detection.

## Setting up Gmail for OTP emails

1. Google Account → Security → turn on 2-Step Verification
2. Search "App Passwords" → create one
3. Put the 16-character code in `.env` as `GMAIL_APP_PASSWORD`, and your address as `GMAIL_USER`
4. Also add both to your Render environment variables, not just your local `.env`

## Routes overview

**Auth:** `POST /auth/register`, `POST /auth/login`, `POST /auth/request-otp`, `POST /auth/verify-otp`

**Vehicles:** `GET /vehicles`

**Sessions** (Bearer token): `POST /sessions/estimate`, `POST /sessions/create`,
`POST /sessions/verify-payment`, `GET /sessions/:id/status`, `POST /sessions/:id/stop`,
`GET /sessions/mine`

**Device** (x-device-key header): `POST /device/telemetry`, `GET /device/command`

**Admin** (Bearer token, role=admin): `GET /admin/stations`, `POST /admin/stations`,
`GET /admin/sessions/active`, `GET /admin/sessions`, `GET /admin/stats`,
`POST /admin/sessions/:id/force-stop`

## Making your first admin user

```sql
UPDATE users SET role = 'admin' WHERE email = 'your-email@example.com';
```
