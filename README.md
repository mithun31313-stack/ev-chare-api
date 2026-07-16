# EV Wireless Charging API

Backend for the app: login, pay ₹ → get charging time, live status, admin dashboard, and the routes your ESP32 hardware will call.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in your Clever Cloud MySQL + Razorpay + JWT secret
3. Run `schema.sql` on your database (import via your MySQL client or Clever Cloud console)
4. `npm run dev` (or `npm start`)

## Routes overview

**Auth (app users)**
- `POST /auth/register` — { name, email, password }
- `POST /auth/login` — { email, password } → returns JWT

**Sessions (app users, need `Authorization: Bearer <token>`)**
- `POST /sessions/create` — { station_id, amount } → creates Razorpay order
- `POST /sessions/verify-payment` — { sessionId, razorpay_order_id, razorpay_payment_id, razorpay_signature } → starts charging
- `GET /sessions/:id/status` — live status + countdown
- `POST /sessions/:id/stop` — user stops early

**Device (ESP32, needs `x-device-key` header — set per station in DB)**
- `POST /device/telemetry` — { voltage, current, power, energy_kwh }
- `GET /device/command` — { shouldCharge, secondsRemaining }

**Admin (app users with role='admin', need Bearer token)**
- `GET /admin/stations`
- `POST /admin/stations` — add a station (generates its device_key manually for now)
- `GET /admin/sessions/active`
- `GET /admin/sessions` — history
- `GET /admin/stats` — power supplied + revenue totals
- `POST /admin/sessions/:id/force-stop`

## Making your first admin user

There's no signup option for admin (by design, for security). After registering normally, run this once in your database:
```sql
UPDATE users SET role = 'admin' WHERE email = 'your-email@example.com';
```

## Testing order (Postman)

1. Register → Login → copy the JWT token
2. Manually insert a test station in DB (or use `POST /admin/stations` once you're admin), note its `device_key`
3. `POST /sessions/create` with that station_id + an amount
4. Use Razorpay's test checkout to complete payment, then call `/sessions/verify-payment`
5. Simulate the ESP32: `POST /device/telemetry` with the station's `x-device-key` header
6. `GET /sessions/:id/status` to see it update
