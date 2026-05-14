require('dotenv').config();
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || process.env.DATABASE || '';
if (!connectionString) {
  console.error('No DATABASE_URL found in environment or .env');
  process.exit(2);
}

const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });

(async () => {
  try {
    const start = Date.now();
    const r = await pool.query('SELECT 1 as ok');
    const latency = Date.now() - start;
    console.log('DB connected:', r.rows[0]);
    console.log('Latency ms:', latency);
    await pool.end();
    process.exit(0);
  } catch (e) {
    console.error('DB connection error:', e && e.message ? e.message : e);
    try { await pool.end(); } catch {}
    process.exit(1);
  }
})();
