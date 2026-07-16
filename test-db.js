// Run this with: node test-db.js
// It just tries to connect and tells you exactly what's wrong, if anything.

require('dotenv').config();
const mysql = require('mysql2/promise');

async function testConnection() {
  console.log('Trying to connect with these settings:');
  console.log({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
  });

  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306,
    });

    console.log('✅ Connected successfully!');

    const [rows] = await connection.query('SHOW TABLES');
    console.log('Tables found:', rows.map((r) => Object.values(r)[0]));

    await connection.end();
  } catch (err) {
    console.log('❌ Connection failed');
    console.log('Error code:', err.code);
    console.log('Error message:', err.message);

    // Friendly hints based on common error codes
    if (err.code === 'ENOTFOUND') {
      console.log('👉 DB_HOST looks wrong, or there is no internet connection.');
    } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.log('👉 DB_USER or DB_PASSWORD is wrong.');
    } else if (err.code === 'ER_BAD_DB_ERROR') {
      console.log('👉 DB_NAME does not exist on this server. Check the exact name in Clever Cloud.');
    } else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED') {
      console.log('👉 DB_HOST or DB_PORT is wrong, or the database is not allowing your IP.');
    }
  }
}

testConnection();
