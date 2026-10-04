const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyDevice } = require('../middleware/auth');
const { endSession } = require('../utils/endSession');

// If current stays below this for FULL_CHARGE_SUSTAIN_SECONDS, we treat the battery as full.
// EV/Li-ion charging naturally tapers current to near-zero as it approaches 100% (CC-CV charging).
const LOW_CURRENT_THRESHOLD_A = 0.05; // 50 mA
const FULL_CHARGE_SUSTAIN_SECONDS = 45;

router.post('/telemetry', verifyDevice, async (req, res) => {
  try {
    const { voltage, current, power, energy_kwh } = req.body;
    const station = req.station;

    await pool.query(
      `UPDATE charging_stations SET last_seen = NOW(),
        status = IF(status = 'offline', 'idle', status) WHERE id = ?`,
      [station.id]
    );

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

      // --- Full-charge detection ---
      const isLowCurrent = current != null && current < LOW_CURRENT_THRESHOLD_A;

      if (isLowCurrent) {
        if (!session.low_current_since) {
          await pool.query('UPDATE sessions SET low_current_since = NOW() WHERE id = ?', [session.id]);
        } else {
          const lowSinceSeconds = (Date.now() - new Date(session.low_current_since).getTime()) / 1000;
          if (lowSinceSeconds >= FULL_CHARGE_SUSTAIN_SECONDS) {
            await endSession(session.id, 'full_charge');
          }
        }
      } else if (session.low_current_since) {
        // Current came back up - reset the taper timer
        await pool.query('UPDATE sessions SET low_current_since = NULL WHERE id = ?', [session.id]);
      }
    }

    res.json({ message: 'Telemetry received' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save telemetry' });
  }
});

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
      await endSession(session.id, 'time_up');
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
