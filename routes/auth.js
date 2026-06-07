// ============================================================
// FILE: backend/routes/auth.js
// ============================================================

const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const { getPool, sql } = require('../config/db');
const { authRequired } = require('../middleware/auth');

// ── ADMIN WHITELIST ────────────────────────────────────────
// ONLY these two emails can access the admin portal.
// They must also have role='admin' in the database.
// Change these before going live.
const ADMIN_WHITELIST = [
  'admin1@yourdomain.com',   // ← REPLACE with first admin email
  'admin2@yourdomain.com',   // ← REPLACE with second admin email
];

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, first_name, last_name, phone } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const pool = await getPool();
    const exists = await pool.request().input('email', sql.NVarChar, email.toLowerCase())
      .query('SELECT id FROM Users WHERE email=@email');
    if (exists.recordset.length) return res.status(409).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.request()
      .input('email',      sql.NVarChar, email.toLowerCase())
      .input('password',   sql.NVarChar, hash)
      .input('first_name', sql.NVarChar, first_name || '')
      .input('last_name',  sql.NVarChar, last_name  || '')
      .input('phone',      sql.NVarChar, phone      || '')
      .query(`INSERT INTO Users (email,password,first_name,last_name,phone)
              OUTPUT INSERTED.id,INSERTED.email,INSERTED.first_name,INSERTED.last_name,INSERTED.role
              VALUES(@email,@password,@first_name,@last_name,@phone)`);
    const user = result.recordset[0];
    res.status(201).json({ token: signToken(user), user });
  } catch (err) { next(err); }
});

// Backend/routes/auth.js — ADD THIS if missing
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  // Check admin emails
  const adminEmails = ['VeniceSephton@gmail.com', 'RachelAndrew@gmail.com'];
  
  if (!adminEmails.includes(email)) {
    return res.status(403).json({ error: 'Not an admin account' });
  }
  
  // Verify password against database
  const user = await db.query('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !await bcrypt.compare(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  // Generate JWT token
  const token = jwt.sign(
    { id: user.id, email: user.email, role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
  
  res.json({ token, user: { id: user.id, email: user.email, first_name: user.first_name, role: 'admin' } });
});

// POST /api/auth/admin-login  — ADMIN PORTAL ONLY
// Double-gated: whitelist check + database role='admin' check
router.post('/admin-login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const normalised = email.toLowerCase().trim();

    // Gate 1: Must be in hardcoded whitelist
    if (!ADMIN_WHITELIST.includes(normalised)) {
      return res.status(403).json({ error: 'Access denied. Unauthorised account.' });
    }

    // Gate 2: Must exist in DB with role=admin
    const pool   = await getPool();
    const result = await pool.request().input('email', sql.NVarChar, normalised)
      .query("SELECT * FROM Users WHERE email=@email AND role='admin'");
    const user = result.recordset[0];
    if (!user) return res.status(403).json({ error: 'Access denied. Admin account not configured.' });

    // Gate 3: Password must match
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials.' });

    console.log(`[ADMIN LOGIN] ${normalised} — ${new Date().toISOString()}`);
    const { password: _pw, ...safeUser } = user;
    res.json({ token: signToken(user), user: safeUser });
  } catch (err) { next(err); }
});

// GET /api/auth/me
router.get('/me', authRequired, async (req, res, next) => {
  try {
    const pool   = await getPool();
    const result = await pool.request().input('id', sql.Int, req.user.id)
      .query('SELECT id,email,first_name,last_name,phone,role,created_at FROM Users WHERE id=@id');
    if (!result.recordset.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.recordset[0]);
  } catch (err) { next(err); }
});

// PUT /api/auth/me
router.put('/me', authRequired, async (req, res, next) => {
  try {
    const { first_name, last_name, phone } = req.body;
    const pool = await getPool();
    await pool.request()
      .input('id',         sql.Int,      req.user.id)
      .input('first_name', sql.NVarChar, first_name || '')
      .input('last_name',  sql.NVarChar, last_name  || '')
      .input('phone',      sql.NVarChar, phone      || '')
      .query('UPDATE Users SET first_name=@first_name,last_name=@last_name,phone=@phone WHERE id=@id');
    res.json({ message: 'Profile updated' });
  } catch (err) { next(err); }
});

// POST /api/auth/change-password
router.post('/change-password', authRequired, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });
    if (new_password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const pool   = await getPool();
    const result = await pool.request().input('id', sql.Int, req.user.id).query('SELECT password FROM Users WHERE id=@id');
    const match  = await bcrypt.compare(current_password, result.recordset[0].password);
    if (!match) return res.status(401).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(new_password, 12);
    await pool.request().input('id', sql.Int, req.user.id).input('pw', sql.NVarChar, hash)
      .query('UPDATE Users SET password=@pw WHERE id=@id');
    res.json({ message: 'Password updated' });
  } catch (err) { next(err); }
});

module.exports = router;