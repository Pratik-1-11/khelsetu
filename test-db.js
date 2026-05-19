require('dotenv').config();
const { query } = require('./src/core/database/pg');

(async () => {
  try {
    const res = await query('SELECT NOW() AS now');
    console.log(res.rows);
    process.exit(0);
  } catch (err) {
    console.error('DB test error:', err);
    process.exit(1);
  }
})();
