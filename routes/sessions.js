const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const pool = require('../db');
const { verifyUser } = require('../middleware/auth');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// POST /sessions/create
// User picks a station + amount. We create a pending session + a Razorpay order.
router.post('/create', verifyUser, async (req, res) => {
  try {
    const { station_id, amount } = req.body; // amount in ₹
    if (!station_id || !amount) {
      return res.status(400).json({ error: 'station_id and amount are required' });
    }

    const [stationRows] = await pool.query(
      'SELECT * FROM charging_stations WHERE id = ?',
      [station_id]
    );
    if (stationRows.length === 0) {
      return res.status(404).json({ error: 'Station not found' });
    }
    const station = stationRows[0];
    if (station.status === 'charging') {
      return res.status(409).json({ error: 'Station is currently in use' });
    }

    const duration_minutes = Math.floor(amount / station.rate_per_minute);
    if (duration_minutes < 1) {
      return res.status(400).json({ error: 'Amount too low for even 1 minute of charging' });
    }

    const [sessionResult] = await pool.query(
      `INSERT INTO sessions (user_id, station_id, amount_paid, duration_minutes, status)
       VALUES (?, ?, ?, ?, 'pending_payment')`,
      [req.user.id, station_id, amount, duration_minutes]
    );
    const sessionId = sessionResult.insertId;

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // paise
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
// Called by the app after Razorpay checkout succeeds.
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
    await pool.query(
      `UPDATE charging_stations SET status = 'charging' WHERE id = ?`,
      [session.station_id]
    );

    res.json({ message: 'Payment verified, charging started', endTime });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Payment verification failed' });
  }
});

// GET /sessions/:id/status
// Polled by the app's live charging screen.
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

// POST /sessions/:id/stop
// User manually ends charging early.
router.post('/:id/stop', verifyUser, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM sessions WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Session not found' });
    const session = rows[0];

    await pool.query(`UPDATE sessions SET status = 'stopped', end_time = NOW() WHERE id = ?`, [
      req.params.id,
    ]);
    await pool.query(`UPDATE charging_stations SET status = 'idle' WHERE id = ?`, [
      session.station_id,
    ]);

    res.json({ message: 'Charging stopped' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to stop session' });
  }
});

module.exports = router;
