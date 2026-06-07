const mysql = require('mysql2/promise');

async function setup() {
  const db = await mysql.createConnection({
    host: 'zephyr.proxy.rlwy.net',
    port: 34684,
    user: 'root',
    password: 'qFOuerJptXLCbooqNyCosFiwfSAVTcKt',
    database: 'railway',
    ssl: { rejectUnauthorized: false }
  });

  console.log('Connected to Railway MySQL!');

  await db.execute(`CREATE TABLE IF NOT EXISTS categories (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    created_at DATETIME DEFAULT NOW()
  )`);
  console.log('categories table created');

  await db.execute(`CREATE TABLE IF NOT EXISTS products (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(200) NOT NULL,
    category_id INT,
    sku VARCHAR(100) UNIQUE,
    price DECIMAL(10,2) NOT NULL,
    sale_price DECIMAL(10,2),
    stock INT DEFAULT 0,
    weight_ml INT,
    short_desc VARCHAR(500) NOT NULL,
    description TEXT,
    image_url VARCHAR(500),
    is_active TINYINT DEFAULT 1,
    is_featured TINYINT DEFAULT 0,
    created_at DATETIME DEFAULT NOW(),
    updated_at DATETIME DEFAULT NOW()
  )`);
  console.log('products table created');

  await db.execute(`CREATE TABLE IF NOT EXISTS admin_users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(200),
    role VARCHAR(50) DEFAULT 'admin',
    created_at DATETIME DEFAULT NOW(),
    last_login DATETIME
  )`);
  console.log('admin_users table created');

  await db.execute(`CREATE TABLE IF NOT EXISTS profiles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(50),
    role VARCHAR(50) DEFAULT 'customer',
    created_at DATETIME DEFAULT NOW()
  )`);
  console.log('profiles table created');

  await db.execute(`CREATE TABLE IF NOT EXISTS orders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    customer_id INT,
    guest_email VARCHAR(255),
    customer_name VARCHAR(200),
    total DECIMAL(10,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    payment_method VARCHAR(100),
    notes TEXT,
    created_at DATETIME DEFAULT NOW(),
    updated_at DATETIME DEFAULT NOW()
  )`);
  console.log('orders table created');

  await db.execute(`CREATE TABLE IF NOT EXISTS order_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_id INT NOT NULL,
    product_id INT,
    name VARCHAR(200) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    qty INT DEFAULT 1
  )`);
  console.log('order_items table created');

  await db.execute(`INSERT IGNORE INTO categories (name, slug) VALUES
    ('Single Oils','single-oils'),
    ('Blends','blends'),
    ('Roll-Ons','roll-ons'),
    ('Diffuser Sets','diffuser-sets'),
    ('Carrier Oils','carrier-oils')`);
  console.log('categories seeded');

  console.log('\n✅ All tables created successfully!');
  await db.end();
}

setup().catch(console.error);