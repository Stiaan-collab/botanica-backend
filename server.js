/**
 * ════════════════════════════════════════════════════════════
 *  BOTANICA — Node.js / Express API Server
 *  Connected to Railway MySQL database
 * ════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const express = require('express');
const mysql   = require('mysql2/promise');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const cors    = require('cors');
const path    = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());
app.use(express.static(path.join(__dirname, '../Frontend')));

// ── MySQL connection config ────────────────────────────────
const dbConfig = {
  host:               'zephyr.proxy.rlwy.net',
  port:               34684,
  user:               'root',
  password:           'qFOuerJptXLCbooqNyCosFiwfSAVTcKt',
  database:           'railway',
  ssl:                { rejectUnauthorized: false },
  connectTimeout:     60000,
  waitForConnections: true,
  connectionLimit:    5,
};

let pool;
async function getPool() {
  if (!pool) {
    pool = await mysql.createPool(dbConfig);
  }
  return pool;
}

async function getPool() {
  return await mysql.createConnection(dbConfig);
}

// ── JWT auth middleware ────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'botanica_secret_change_me';

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ════════════════════════════════════════════════════════════

// POST /api/admin/login
app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });

  try {
    const db = await getPool();
    const [rows] = await db.execute('SELECT * FROM admin_users WHERE email = ?', [email]);
    const admin  = rows[0];

    if (!admin)
      return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match)
      return res.status(401).json({ error: 'Invalid credentials' });

    await db.execute('UPDATE admin_users SET last_login = NOW() WHERE id = ?', [admin.id]);

    const token = jwt.sign(
      { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token, user: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ════════════════════════════════════════════════════════════
//  DASHBOARD
// ════════════════════════════════════════════════════════════

app.get('/api/admin/dashboard', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    const [[stats]] = await db.execute(`
      SELECT
        (SELECT COUNT(*) FROM products WHERE is_active = 1)            AS total_products,
        (SELECT COUNT(*) FROM orders)                                   AS total_orders,
        (SELECT COUNT(*) FROM profiles WHERE role = 'customer')        AS total_customers,
        (SELECT COUNT(*) FROM products WHERE stock > 0 AND stock <= 5) AS low_stock
    `);

    const [recent_orders] = await db.execute(`
      SELECT o.id, o.total, o.status, o.created_at,
        IFNULL(CONCAT(p.first_name,' ',p.last_name), o.guest_email) AS customer_name,
        o.payment_method
      FROM orders o
      LEFT JOIN profiles p ON o.customer_id = p.id
      ORDER BY o.created_at DESC LIMIT 8
    `);

    res.json({ stats, recent_orders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  PRODUCTS
// ════════════════════════════════════════════════════════════

app.get('/api/admin/products', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    const [rows] = await db.execute(`
      SELECT p.*, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ORDER BY p.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/products/:id', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    const [rows] = await db.execute('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/products', authMiddleware, async (req, res) => {
  const { name, category_id, sku, price, sale_price, stock, weight_ml,
          short_desc, description, image_url, is_active, is_featured } = req.body;
  try {
    const db = await getPool();
    const [result] = await db.execute(`
      INSERT INTO products (name, category_id, sku, price, sale_price, stock, weight_ml,
        short_desc, description, image_url, is_active, is_featured)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, category_id || null, sku || null, price, sale_price || null,
       stock || 0, weight_ml || null, short_desc, description || null,
       image_url || null, is_active ? 1 : 0, is_featured ? 1 : 0]
    );
    res.json({ id: result.insertId, message: 'Product created' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/products/:id', authMiddleware, async (req, res) => {
  const { name, category_id, sku, price, sale_price, stock, weight_ml,
          short_desc, description, image_url, is_active, is_featured } = req.body;
  try {
    const db = await getPool();
    await db.execute(`
      UPDATE products SET name=?, category_id=?, sku=?, price=?, sale_price=?,
        stock=?, weight_ml=?, short_desc=?, description=?, image_url=?,
        is_active=?, is_featured=?, updated_at=NOW()
      WHERE id=?`,
      [name, category_id || null, sku || null, price, sale_price || null,
       stock || 0, weight_ml || null, short_desc, description || null,
       image_url || null, is_active ? 1 : 0, is_featured ? 1 : 0, req.params.id]
    );
    res.json({ message: 'Product updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/products/:id', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    await db.execute('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  ORDERS
// ════════════════════════════════════════════════════════════

app.get('/api/admin/orders', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    const [rows] = await db.execute(`
      SELECT o.*,
        IFNULL(CONCAT(p.first_name,' ',p.last_name), o.guest_email) AS customer_name_resolved,
        p.email AS customer_email
      FROM orders o
      LEFT JOIN profiles p ON o.customer_id = p.id
      ORDER BY o.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/orders/:id/status', authMiddleware, async (req, res) => {
  const { status } = req.body;
  try {
    const db = await getPool();
    await db.execute('UPDATE orders SET status=?, updated_at=NOW() WHERE id=?', [status, req.params.id]);
    res.json({ message: 'Status updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  CUSTOMERS
// ════════════════════════════════════════════════════════════

app.get('/api/admin/customers', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    const [rows] = await db.execute(`
      SELECT p.*, COUNT(o.id) AS order_count
      FROM profiles p
      LEFT JOIN orders o ON o.customer_id = p.id
      WHERE p.role = 'customer'
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  CATEGORIES
// ════════════════════════════════════════════════════════════

app.get('/api/admin/categories', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    const [rows] = await db.execute('SELECT * FROM categories ORDER BY id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  START
// ════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅  Botanica API running → http://localhost:${PORT}`);
  console.log(`   Admin panel: http://localhost:${PORT}/admin-login.html\n`);
});