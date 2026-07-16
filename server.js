const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const sessionRoutes = require('./routes/sessions');
const deviceRoutes = require('./routes/device');
const adminRoutes = require('./routes/admin');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.send('EV Wireless Charging API is running'));

app.use('/auth', authRoutes);
app.use('/sessions', sessionRoutes);
app.use('/device', deviceRoutes);
app.use('/admin', adminRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
