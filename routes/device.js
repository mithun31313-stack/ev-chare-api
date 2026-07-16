const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyDevice } = require('../middleware/auth');

// POST /device/telemetry
// ESP32 pushes live readings every few seconds.
router.post('/telemetry', verifyDevice, async (req, res) => {
  try {
    const { voltage, current, power, energy_kwh } = req.body;
    const station = req.station;

    await pool.query(
      `UPDATE charging_stations SET last_seen = NOW(),
        status = IF(status = 'offline', 'idle', status) WHERE id = ?`,
      [station.id]
    );

    // Update the active session for this station, if any
    const [activeSessions] = await pool.query(
      `SELECT * FROM sessions WHERE station_id = ? AND status = 'charging' LIMIT 1`,
      [station.id]
    );

    if (activeSessions.length > 0) {
      const session = activeSessions[0];
      await pool.query(
        `UPDATE sessions SET latest_voltage = ?, latest_current = ?, latest_power = ?,
          energy_delivered_kwh = ? WHERE id = ?`,
        [voltage, current, power, energy_kwh || 0, session.id]
      );
    }

    res.json({ message: 'Telemetry received' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save telemetry' });
  }
});

// GET /device/command
// ESP32 polls this every few seconds to know whether it should be charging.
router.get('/command', verifyDevice, async (req, res) => {
  try {
    const station = req.station;

    const [activeSessions] = await pool.query(
      `SELECT * FROM sessions WHERE station_id = ? AND status = 'charging' LIMIT 1`,
      [station.id]
    );

    if (activeSessions.length === 0) {
      return res.json({ shouldCharge: false });
    }

    const session = activeSessions[0];
    const now = new Date();
    const endTime = new Date(session.end_time);

    if (now >= endTime) {
      // Time's up - auto complete the session
      await pool.query(`UPDATE sessions SET status = 'completed' WHERE id = ?`, [session.id]);
      await pool.query(`UPDATE charging_stations SET status = 'idle' WHERE id = ?`, [station.id]);
      return res.json({ shouldCharge: false });
    }

    res.json({
      shouldCharge: true,
      secondsRemaining: Math.floor((endTime - now) / 1000),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch command' });
  }
});

module.exports = router;
