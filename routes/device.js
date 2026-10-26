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

    // Amount the user paid for this session (uses the first column name that exists)
    const amount =
      session.amount ??
      session.amount_paid ??
      session.total_amount ??
      session.total_cost ??
      session.cost ??
      session.price;

    const reply = {
      shouldCharge: true,
      secondsRemaining: Math.floor((endTime - now) / 1000),
    };
    if (amount != null) reply.amount = Number(amount);

    res.json(reply);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch command' });
  }
});
