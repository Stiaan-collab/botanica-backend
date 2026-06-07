// ============================================================
// FILE: backend/routes/cart.js
// Cart stored in server-side session (works for guests + users)
// ============================================================

const express = require('express');
const router  = express.Router();
const { getPool, sql } = require('../config/db');

// Helper — enrich cart items with live product data
async function enrichCart(items) {
  if (!items.length) return [];
  const pool = await getPool();
  const ids   = items.map(i => i.product_id).join(',');
  const rows  = await pool.request().query(
    `SELECT id, name, slug, price, sale_price, image_url, stock FROM Products WHERE id IN (${ids})`
  );
  const map = {};
  rows.recordset.forEach(p => { map[p.id] = p; });
  return items.map(i => {
    const p = map[i.product_id] || {};
    return {
      ...i,
      name:       p.name,
      slug:       p.slug,
      image_url:  p.image_url,
      unit_price: p.sale_price || p.price,
      stock:      p.stock,
      line_total: (p.sale_price || p.price) * i.quantity,
    };
  }).filter(i => i.name);
}

function getCart(req) { return req.session.cart || []; }
function saveCart(req, cart) { req.session.cart = cart; }

// GET /api/cart
router.get('/', async (req, res, next) => {
  try {
    const items = await enrichCart(getCart(req));
    const subtotal = items.reduce((s, i) => s + i.line_total, 0);
    res.json({ items, subtotal });
  } catch (err) { next(err); }
});

// POST /api/cart  — add / update quantity
router.post('/', async (req, res, next) => {
  try {
    const { product_id, quantity = 1 } = req.body;
    if (!product_id) return res.status(400).json({ error: 'product_id required' });

    // Validate product exists
    const pool = await getPool();
    const p = await pool.request().input('id', sql.Int, product_id)
      .query('SELECT id, stock FROM Products WHERE id=@id AND is_active=1');
    if (!p.recordset.length) return res.status(404).json({ error: 'Product not found' });

    const cart = getCart(req);
    const idx  = cart.findIndex(i => i.product_id === product_id);
    const newQty = Math.max(1, parseInt(quantity));

    if (newQty > p.recordset[0].stock) return res.status(400).json({ error: 'Not enough stock' });

    if (idx > -1) {
      cart[idx].quantity = newQty;
    } else {
      cart.push({ product_id, quantity: newQty });
    }
    saveCart(req, cart);

    const items    = await enrichCart(cart);
    const subtotal = items.reduce((s, i) => s + i.line_total, 0);
    res.json({ items, subtotal, message: 'Cart updated' });
  } catch (err) { next(err); }
});

// DELETE /api/cart/:product_id
router.delete('/:product_id', (req, res) => {
  const cart = getCart(req).filter(i => i.product_id !== parseInt(req.params.product_id));
  saveCart(req, cart);
  res.json({ message: 'Item removed', count: cart.length });
});

// DELETE /api/cart  — clear cart
router.delete('/', (req, res) => {
  saveCart(req, []);
  res.json({ message: 'Cart cleared' });
});

// POST /api/cart/coupon
router.post('/coupon', async (req, res, next) => {
  try {
    const { code } = req.body;
    const pool = await getPool();
    const result = await pool.request().input('code', sql.NVarChar, code.toUpperCase())
      .query(`SELECT * FROM Coupons WHERE code=@code AND is_active=1
              AND (expires_at IS NULL OR expires_at > GETDATE())
              AND (max_uses IS NULL OR used_count < max_uses)`);
    if (!result.recordset.length) return res.status(400).json({ error: 'Invalid or expired coupon' });
    const coupon = result.recordset[0];
    res.json({ coupon: { code: coupon.code, type: coupon.type, value: coupon.value, min_order: coupon.min_order } });
  } catch (err) { next(err); }
});

module.exports = router;