const jwt = require('jsonwebtoken');
const pool = require('../db');

// Checks the app user is logged in (JWT from login)
function verifyUser(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Must be used AFTER verifyUser - checks role is admin
function verifyAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access only' });
  }
  next();
}

// Checks the ESP32 device is sending its correct secret key
async function verifyDevice(req, res, next) {
  const deviceKey = req.headers['x-device-key'];
  if (!deviceKey) {
    return res.status(401).json({ error: 'Missing device key' });
  }
  try {
    const [rows] = await pool.query(
      'SELECT * FROM charging_stations WHERE device_key = ?',
      [deviceKey]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid device key' });
    }
    req.station = rows[0];
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Server error verifying device' });
  }
}

module.exports = { verifyUser, verifyAdmin, verifyDevice };
