-- EV Wireless Charging System - Database Schema

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('user', 'admin') DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS charging_stations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  location VARCHAR(255),
  device_key VARCHAR(100) UNIQUE NOT NULL,
  rate_per_minute DECIMAL(10,2) DEFAULT 5.00,
  rated_power_kw DECIMAL(6,3) DEFAULT 0.50,   -- average power this station delivers; used to estimate charging time from kWh needed
  status ENUM('idle', 'charging', 'offline') DEFAULT 'offline',
  last_seen TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Reference list of EV models and their battery capacity, used for the "how much to pay for a full charge" estimate
CREATE TABLE IF NOT EXISTS vehicle_models (
  id INT AUTO_INCREMENT PRIMARY KEY,
  brand VARCHAR(60) NOT NULL,
  model VARCHAR(80) NOT NULL,
  battery_kwh DECIMAL(6,2) NOT NULL
);

INSERT INTO vehicle_models (brand, model, battery_kwh)
SELECT * FROM (SELECT
  'Tata' AS brand, 'Nexon EV' AS model, 40.5 AS battery_kwh UNION ALL
  SELECT 'Tata', 'Tiago EV', 24.0 UNION ALL
  SELECT 'Tata', 'Tigor EV', 26.0 UNION ALL
  SELECT 'Tata', 'Punch EV', 35.0 UNION ALL
  SELECT 'MG', 'ZS EV', 50.3 UNION ALL
  SELECT 'MG', 'Comet EV', 17.3 UNION ALL
  SELECT 'Mahindra', 'XUV400', 39.4 UNION ALL
  SELECT 'Hyundai', 'Kona Electric', 39.2 UNION ALL
  SELECT 'BYD', 'Atto 3', 60.5 UNION ALL
  SELECT 'Citroen', 'eC3', 29.2 UNION ALL
  SELECT 'Ather', '450X', 3.7 UNION ALL
  SELECT 'Ola Electric', 'S1 Pro', 4.0 UNION ALL
  SELECT 'TVS', 'iQube', 3.4 UNION ALL
  SELECT 'Bajaj', 'Chetak', 3.0
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM vehicle_models LIMIT 1);

CREATE TABLE IF NOT EXISTS sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  station_id INT NOT NULL,
  amount_paid DECIMAL(10,2) NOT NULL,
  duration_minutes INT NOT NULL,
  start_time TIMESTAMP NULL,
  end_time TIMESTAMP NULL,
  energy_delivered_kwh DECIMAL(10,3) DEFAULT 0,
  latest_voltage DECIMAL(10,2) DEFAULT 0,
  latest_current DECIMAL(10,2) DEFAULT 0,
  latest_power DECIMAL(10,2) DEFAULT 0,
  low_current_since TIMESTAMP NULL,            -- when the relay first saw current drop low (used to detect "battery full")
  vehicle_label VARCHAR(140) NULL,              -- e.g. "Tata Nexon EV" - snapshot at time of booking
  battery_kwh DECIMAL(6,2) NULL,
  start_percent INT NULL,                       -- charge % the user said they were starting from
  energy_needed_kwh DECIMAL(6,2) NULL,           -- estimated energy needed for a full charge
  refund_amount DECIMAL(10,2) DEFAULT 0,
  end_reason ENUM('time_up', 'full_charge', 'manual_stop', 'admin_stop') NULL,
  status ENUM('pending_payment', 'charging', 'completed', 'stopped') DEFAULT 'pending_payment',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (station_id) REFERENCES charging_stations(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  session_id INT NOT NULL,
  razorpay_order_id VARCHAR(100),
  razorpay_payment_id VARCHAR(100),
  razorpay_refund_id VARCHAR(100) NULL,
  amount DECIMAL(10,2) NOT NULL,
  refund_amount DECIMAL(10,2) DEFAULT 0,
  status ENUM('created', 'paid', 'failed', 'refunded', 'partially_refunded') DEFAULT 'created',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS otps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  purpose ENUM('change_email', 'change_password') NOT NULL,
  otp_code VARCHAR(6) NOT NULL,
  new_value VARCHAR(255) NULL,
  expires_at TIMESTAMP NOT NULL,
  used TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
