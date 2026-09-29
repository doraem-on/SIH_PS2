const { Pool } = require('pg');

// Hardcoding the connection to force it into the right database
const pool = new Pool({
  user: 'lalit',
  host: 'localhost',
  database: 'gdlr_engine',
  password: '', // Leave empty if you don't have one
  port: 5432,
});

// This will tell us exactly where we are landed
pool.query('SELECT current_database(), current_user', (err, res) => {
    if (err) {
        console.error("CONNECTION ERROR:", err.message);
    } else {
        console.log(`>> ACTUAL DB: ${res.rows[0].current_database} | USER: ${res.rows[0].current_user}`);
    }
});

module.exports = pool;