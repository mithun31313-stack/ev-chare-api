-- EV Wireless Charging System - Database Schema
-- Run this once on your Clever Cloud / MySQL database

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
  device_key VARCHAR(100) UNIQUE NOT NULL,   -- secret key the ESP32 uses to authenticate
  rate_per_minute DECIMAL(10,2) DEFAULT 5.00, -- ₹ per minute of charging
  status ENUM('idle', 'charging', 'offline') DEFAULT 'offline',
  last_seen TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  station_id INT NOT NULL,
  amount_paid DECIMAL(10,2) NOT NULL,
  duration_minutes INT NOT NULL,
  start_time TIMESTAMP NULL,
  end_time TIMESTAMP NULL,               -- calculated: start_time + duration_minutes
  energy_delivered_kwh DECIMAL(10,3) DEFAULT 0,
  latest_voltage DECIMAL(10,2) DEFAULT 0,
  latest_current DECIMAL(10,2) DEFAULT 0,
  latest_power DECIMAL(10,2) DEFAULT 0,
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
  amount DECIMAL(10,2) NOT NULL,
  status ENUM('created', 'paid', 'failed') DEFAULT 'created',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
