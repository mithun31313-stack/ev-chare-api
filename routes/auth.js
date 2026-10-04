const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { verifyUser } = require('../middleware/auth');
const { sendOtpEmail } = require('../utils/mailer');

// POST /auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }

    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [name, email, password_hash, 'user']
    );

    res.status(201).json({ message: 'Registered successfully', userId: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ---------- OTP-based settings changes ----------

// POST /auth/request-otp   { purpose: 'change_email' | 'change_password', newEmail? }
// Sends a 6-digit code to the user's CURRENT registered email (proves they own the account)
router.post('/request-otp', verifyUser, async (req, res) => {
  try {
    const { purpose, newEmail } = req.body;
    if (!['change_email', 'change_password'].includes(purpose)) {
      return res.status(400).json({ error: 'Invalid purpose' });
    }
    if (purpose === 'change_email' && !newEmail) {
      return res.status(400).json({ error: 'newEmail is required' });
    }

    const [userRows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const user = userRows[0];

    if (purpose === 'change_email') {
      const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [newEmail]);
      if (existing.length > 0) {
        return res.status(409).json({ error: 'That email is already in use' });
      }
    }

    const otpCode = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await pool.query(
      `INSERT INTO otps (user_id, purpose, otp_code, new_value, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [user.id, purpose, otpCode, purpose === 'change_email' ? newEmail : null, expiresAt]
    );

    await sendOtpEmail(user.email, otpCode, purpose);

    res.json({ message: `OTP sent to ${user.email}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not send OTP. Check Gmail settings on the server.' });
  }
});

// POST /auth/verify-otp   { purpose, otp, newPassword? }
router.post('/verify-otp', verifyUser, async (req, res) => {
  try {
    const { purpose, otp, newPassword } = req.body;
    if (!otp) return res.status(400).json({ error: 'OTP is required' });
    if (purpose === 'change_password' && !newPassword) {
      return res.status(400).json({ error: 'newPassword is required' });
    }

    const [rows] = await pool.query(
      `SELECT * FROM otps WHERE user_id = ? AND purpose = ? AND otp_code = ? AND used = 0
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id, purpose, otp]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }
    const otpRow = rows[0];
    if (new Date(otpRow.expires_at) < new Date()) {
      return res.status(400).json({ error: 'OTP has expired, please request a new one' });
    }

    if (purpose === 'change_email') {
      await pool.query('UPDATE users SET email = ? WHERE id = ?', [otpRow.new_value, req.user.id]);
    } else if (purpose === 'change_password') {
      const password_hash = await bcrypt.hash(newPassword, 10);
      await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash, req.user.id]);
    }

    await pool.query('UPDATE otps SET used = 1 WHERE id = ?', [otpRow.id]);

    res.json({ message: purpose === 'change_email' ? 'Email updated' : 'Password updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not verify OTP' });
  }
});

module.exports = router;
