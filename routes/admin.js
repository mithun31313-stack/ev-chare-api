const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyUser, verifyAdmin } = require('../middleware/auth');
const { endSession } = require('../utils/endSession');

router.use(verifyUser, verifyAdmin);

router.get('/stations', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM charging_stations ORDER BY id');
  res.json(rows);
});

router.post('/stations', async (req, res) => {
  const { name, location, device_key, rate_per_minute, rated_power_kw } = req.body;
  const [result] = await pool.query(
    `INSERT INTO charging_stations (name, location, device_key, rate_per_minute, rated_power_kw, status)
     VALUES (?, ?, ?, ?, ?, 'offline')`,
    [name, location, device_key, rate_per_minute || 5.0, rated_power_kw || 0.5]
  );
  res.status(201).json({ message: 'Station added', stationId: result.insertId });
});

router.get('/sessions/active', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT s.*, u.name AS user_name, u.email, c.name AS station_name
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     JOIN charging_stations c ON s.station_id = c.id
     WHERE s.status = 'charging'`
  );
  res.json(rows);
});

router.get('/sessions', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT s.*, u.name AS user_name, c.name AS station_name
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     JOIN charging_stations c ON s.station_id = c.id
     ORDER BY s.created_at DESC LIMIT 200`
  );
  res.json(rows);
});

router.get('/stats', async (req, res) => {
  const [[totals]] = await pool.query(
    `SELECT
       COALESCE(SUM(energy_delivered_kwh), 0) AS total_energy_kwh,
       COALESCE(SUM(amount_paid), 0) AS total_collected,
       COALESCE(SUM(refund_amount), 0) AS total_refunded,
       COALESCE(SUM(amount_paid - refund_amount), 0) AS total_revenue,
       COUNT(*) AS total_sessions
     FROM sessions WHERE status IN ('completed', 'stopped', 'charging')`
  );

  const [[today]] = await pool.query(
    `SELECT
       COALESCE(SUM(energy_delivered_kwh), 0) AS today_energy_kwh,
       COALESCE(SUM(amount_paid - refund_amount), 0) AS today_revenue
     FROM sessions
     WHERE DATE(created_at) = CURDATE()`
  );

  res.json({ ...totals, ...today });
});

router.post('/sessions/:id/force-stop', async (req, res) => {
  const result = await endSession(req.params.id, 'admin_stop');
  if (!result) return res.status(404).json({ error: 'Session not found' });
  res.json({ message: 'Session force-stopped by admin', refund_amount: result.refund_amount });
});

module.exports = router;
