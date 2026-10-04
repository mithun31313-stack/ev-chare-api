const nodemailer = require('nodemailer');
require('dotenv').config();

// Sends mail from your own Gmail account using an App Password
// (Google Account -> Security -> 2-Step Verification -> App Passwords)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

async function sendOtpEmail(toEmail, otpCode, purpose) {
  const purposeText = purpose === 'change_email' ? 'change your email' : 'change your password';
  await transporter.sendMail({
    from: `"EV Wireless Charging" <${process.env.GMAIL_USER}>`,
    to: toEmail,
    subject: `Your OTP code: ${otpCode}`,
    html: `
      <div style="font-family: sans-serif; max-width: 420px; margin: 0 auto;">
        <h2 style="color: #00c853;">EV Wireless Charging</h2>
        <p>Use this code to ${purposeText}:</p>
        <p style="font-size: 32px; font-weight: 800; letter-spacing: 6px;">${otpCode}</p>
        <p style="color: #777; font-size: 13px;">This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
      </div>
    `,
  });
}

module.exports = { sendOtpEmail };
