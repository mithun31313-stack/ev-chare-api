const pool = require('../db');
const razorpay = require('./razorpay');

/**
 * Ends a charging session, and if it finished early (full charge or manual stop
 * before time ran out), refunds the unused portion back to the original payment.
 *
 * reason: 'time_up' | 'full_charge' | 'manual_stop' | 'admin_stop'
 */
async function endSession(sessionId, reason) {
  const [sessionRows] = await pool.query('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  if (sessionRows.length === 0) return null;
  const session = sessionRows[0];

  if (session.status !== 'charging') return session; // already ended, nothing to do

  const now = new Date();
  const endTime = new Date(session.end_time);
  const totalSeconds = session.duration_minutes * 60;
  const secondsRemaining = Math.max(0, Math.floor((endTime - now) / 1000));

  let refundAmount = 0;

  // Only refund if it ended EARLY (full charge or manual stop) - not on a normal time_up finish
  if ((reason === 'full_charge' || reason === 'manual_stop' || reason === 'admin_stop') && secondsRemaining > 0) {
    const unusedFraction = secondsRemaining / totalSeconds;
    refundAmount = Math.round(session.amount_paid * unusedFraction * 100) / 100;
  }

  await pool.query(
    `UPDATE sessions SET status = ?, end_time = NOW(), end_reason = ?, refund_amount = ? WHERE id = ?`,
    [reason === 'time_up' ? 'completed' : 'stopped', reason, refundAmount, sessionId]
  );
  await pool.query(`UPDATE charging_stations SET status = 'idle' WHERE id = ?`, [session.station_id]);

  if (refundAmount > 0) {
    try {
      const [paymentRows] = await pool.query(
        `SELECT * FROM payments WHERE session_id = ? AND status = 'paid' LIMIT 1`,
        [sessionId]
      );
      if (paymentRows.length > 0) {
        const payment = paymentRows[0];
        const refund = await razorpay.payments.refund(payment.razorpay_payment_id, {
          amount: Math.round(refundAmount * 100), // paise
        });
        await pool.query(
          `UPDATE payments SET refund_amount = ?, razorpay_refund_id = ?, status = 'partially_refunded' WHERE id = ?`,
          [refundAmount, refund.id, payment.id]
        );
      }
    } catch (err) {
      // Refund failing shouldn't block the session from ending - log it for manual follow-up
      console.error('Refund failed for session', sessionId, err.message);
    }
  }

  return { ...session, refund_amount: refundAmount, end_reason: reason };
}

module.exports = { endSession };
