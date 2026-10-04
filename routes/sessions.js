const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db');
const razorpay = require('../utils/razorpay');
const { endSession } = require('../utils/endSession');
const { verifyUser } = require('../middleware/auth');

// POST /sessions/estimate
// Given a vehicle + current charge %, work out how much energy (and therefore ₹) a full charge needs.
router.post('/estimate', verifyUser, async (req, res) => {
  try {
    const { station_id, vehicle_id, current_percent } = req.body;
    if (!station_id || !vehicle_id || current_percent == null) {
      return res.status(400).json({ error: 'station_id, vehicle_id and current_percent are required' });
    }
    if (current_percent < 0 || current_percent > 100) {
      return res.status(400).json({ error: 'current_percent must be between 0 and 100' });
    }

    const [stationRows] = await pool.query('SELECT * FROM charging_stations WHERE id = ?', [station_id]);
    if (stationRows.length === 0) return res.status(404).json({ error: 'Station not found' });
    const station = stationRows[0];

    const [vehicleRows] = await pool.query('SELECT * FROM vehicle_models WHERE id = ?', [vehicle_id]);
    if (vehicleRows.length === 0) return res.status(404).json({ error: 'Vehicle not found' });
    const vehicle = vehicleRows[0];

    const energyNeededKwh = Math.round(vehicle.battery_kwh * (100 - current_percent) / 100 * 100) / 100;
    const minutesNeeded = Math.ceil((energyNeededKwh / station.rated_power_kw) * 60);
    const amountNeeded = Math.ceil(minutesNeeded * station.rate_per_minute);

    res.json({
      vehicle: { brand: vehicle.brand, model: vehicle.model, battery_kwh: vehicle.battery_kwh },
      energy_needed_kwh: energyNeededKwh,
      minutes_needed: minutesNeeded,
      amount_needed: amountNeeded,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to calculate estimate' });
  }
});

// POST /sessions/create
router.post('/create', verifyUser, async (req, res) => {
  try {
    const { station_id, amount, vehicle_id, current_percent } = req.body;
    if (!station_id || !amount) {
      return res.status(400).json({ error: 'station_id and amount are required' });
    }

    const [stationRows] = await pool.query('SELECT * FROM charging_stations WHERE id = ?', [station_id]);
    if (stationRows.length === 0) return res.status(404).json({ error: 'Station not found' });
    const station = stationRows[0];
    if (station.status === 'charging') return res.status(409).json({ error: 'Station is currently in use' });

    const duration_minutes = Math.floor(amount / station.rate_per_minute);
    if (duration_minutes < 1) {
      return res.status(400).json({ error: 'Amount too low for even 1 minute of charging' });
    }

    // Optional vehicle info, so we know the full-charge target for this session
    let vehicleLabel = null, batteryKwh = null, energyNeededKwh = null;
    if (vehicle_id) {
      const [vehicleRows] = await pool.query('SELECT * FROM vehicle_models WHERE id = ?', [vehicle_id]);
      if (vehicleRows.length > 0) {
        const v = vehicleRows[0];
        vehicleLabel = `${v.brand} ${v.model}`;
        batteryKwh = v.battery_kwh;
        if (current_percent != null) {
          energyNeededKwh = Math.round(v.battery_kwh * (100 - current_percent) / 100 * 100) / 100;
        }
      }
    }

    const [sessionResult] = await pool.query(
      `INSERT INTO sessions
        (user_id, station_id, amount_paid, duration_minutes, vehicle_label, battery_kwh, start_percent, energy_needed_kwh, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment')`,
      [req.user.id, station_id, amount, duration_minutes, vehicleLabel, batteryKwh, current_percent ?? null, energyNeededKwh]
    );
    const sessionId = sessionResult.insertId;

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: 'INR',
      receipt: `session_${sessionId}`,
    });

    await pool.query(
      `INSERT INTO payments (user_id, session_id, razorpay_order_id, amount, status)
       VALUES (?, ?, ?, ?, 'created')`,
      [req.user.id, sessionId, order.id, amount]
    );

    res.json({
      sessionId,
      duration_minutes,
      razorpayOrderId: order.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      amount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// POST /sessions/verify-payment
router.post('/verify-payment', verifyUser, async (req, res) => {
  try {
    const { sessionId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    await pool.query(
      `UPDATE payments SET razorpay_payment_id = ?, status = 'paid' WHERE session_id = ?`,
      [razorpay_payment_id, sessionId]
    );

    const [sessionRows] = await pool.query('SELECT * FROM sessions WHERE id = ?', [sessionId]);
    const session = sessionRows[0];

    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + session.duration_minutes * 60000);

    await pool.query(
      `UPDATE sessions SET status = 'charging', start_time = ?, end_time = ? WHERE id = ?`,
      [startTime, endTime, sessionId]
    );
    await pool.query(`UPDATE charging_stations SET status = 'charging' WHERE id = ?`, [session.station_id]);

    res.json({ message: 'Payment verified, charging started', endTime });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Payment verification failed' });
  }
});

// GET /sessions/:id/status
router.get('/:id/status', verifyUser, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM sessions WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Session not found' });

    const session = rows[0];
    const secondsRemaining = session.end_time
      ? Math.max(0, Math.floor((new Date(session.end_time) - new Date()) / 1000))
      : null;

    res.json({ ...session, secondsRemaining });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// POST /sessions/:id/stop - user stops manually, refunded if time remains
router.post('/:id/stop', verifyUser, async (req, res) => {
  try {
    const result = await endSession(req.params.id, 'manual_stop');
    if (!result) return res.status(404).json({ error: 'Session not found' });
    res.json({ message: 'Charging stopped', refund_amount: result.refund_amount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to stop session' });
  }
});

// GET /sessions/mine
router.get('/mine', verifyUser, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.*, c.name AS station_name
       FROM sessions s
       JOIN charging_stations c ON s.station_id = c.id
       WHERE s.user_id = ?
       ORDER BY s.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

module.exports = router;
