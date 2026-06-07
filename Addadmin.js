const mysql  = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function addAdmins() {
  const db = await mysql.createConnection({
    host: 'zephyr.proxy.rlwy.net',
    port: 34684,
    user: 'root',
    password: 'qFOuerJptXLCbooqNyCosFiwfSAVTcKt',
    database: 'railway',
    ssl: { rejectUnauthorized: false }
  });

  console.log('Connected!');

  // Stiaan's account
  const hash1 = await bcrypt.hash('Stiaan458', 10);
  await db.execute(
    'INSERT IGNORE INTO admin_users (email, name, password_hash) VALUES (?, ?, ?)',
    ['stiaanerasmus8@gmail.com', 'Stiaan', hash1]
  );
  console.log('Stiaan account added');

  // Venice's account
  const hash2 = await bcrypt.hash('Venice@1', 10);
  await db.execute(
    'INSERT IGNORE INTO admin_users (email, name, password_hash) VALUES (?, ?, ?)',
    ['sephtonv50.vs@gmail.com', 'Venice', hash2]
  );
  console.log('Venice account added');

  console.log('\n✅ Both admin accounts created!');
  await db.end();
}

addAdmins().catch(console.error);