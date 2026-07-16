const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyUser, verifyAdmin } = require('../middleware/auth');

router.use(verifyUser, verifyAdmin);

// GET /admin/stations - all stations with live status
router.get('/stations', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM charging_stations ORDER BY id');
  res.json(rows);
});

// POST /admin/stations - add a new station
router.post('/stations', async (req, res) => {
  const { name, location, device_key, rate_per_minute } = req.body;
  const [result] = await pool.query(
    `INSERT INTO charging_stations (name, location, device_key, rate_per_minute, status)
     VALUES (?, ?, ?, ?, 'offline')`,
    [name, location, device_key, rate_per_minute || 5.0]
  );
  res.status(201).json({ message: 'Station added', stationId: result.insertId });
});

// GET /admin/sessions/active - who is charging right now
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

// GET /admin/sessions - full history (optionally ?station_id=&user_id=)
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

// GET /admin/stats - power supplied + revenue totals
router.get('/stats', async (req, res) => {
  const [[totals]] = await pool.query(
    `SELECT
       COALESCE(SUM(energy_delivered_kwh), 0) AS total_energy_kwh,
       COALESCE(SUM(amount_paid), 0) AS total_revenue,
       COUNT(*) AS total_sessions
     FROM sessions WHERE status IN ('completed', 'stopped', 'charging')`
  );

  const [[today]] = await pool.query(
    `SELECT
       COALESCE(SUM(energy_delivered_kwh), 0) AS today_energy_kwh,
       COALESCE(SUM(amount_paid), 0) AS today_revenue
     FROM sessions
     WHERE DATE(created_at) = CURDATE()`
  );

  res.json({ ...totals, ...today });
});

// POST /admin/sessions/:id/force-stop
router.post('/sessions/:id/force-stop', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM sessions WHERE id = ?', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Session not found' });
  const session = rows[0];

  await pool.query(`UPDATE sessions SET status = 'stopped', end_time = NOW() WHERE id = ?`, [
    req.params.id,
  ]);
  await pool.query(`UPDATE charging_stations SET status = 'idle' WHERE id = ?`, [
    session.station_id,
  ]);

  res.json({ message: 'Session force-stopped by admin' });
});

module.exports = router;
