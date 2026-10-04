const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /vehicles - list of EV models with battery capacity, for the "pick your vehicle" dropdown
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, brand, model, battery_kwh FROM vehicle_models ORDER BY brand, model'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch vehicle list' });
  }
});

module.exports = router;
