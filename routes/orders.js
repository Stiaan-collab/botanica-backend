// ============================================================
// FILE: backend/routes/orders.js
// ============================================================

const express = require('express');
const router  = express.Router();
const { getPool, sql } = require('../config/db');
const { authRequired } = require('../middleware/auth');

// POST /api/orders  — create order after payment
router.post('/', async (req, res, next) => {
  try {
    const {
      items, subtotal, shipping_cost = 0, discount = 0, total,
      shipping_address, payment_method, payment_intent,
      guest_email, coupon_code,
    } = req.body;

    if (!items?.length || !total) return res.status(400).json({ error: 'Invalid order data' });

    const userId = req.user?.id || null;
    const pool   = await getPool();

    // Create order
    const orderResult = await pool.request()
      .input('user_id',        sql.Int,        userId)
      .input('guest_email',    sql.NVarChar,   guest_email || null)
      .input('subtotal',       sql.Decimal(10,2), subtotal)
      .input('shipping_cost',  sql.Decimal(10,2), shipping_cost)
      .input('discount',       sql.Decimal(10,2), discount)
      .input('total',          sql.Decimal(10,2), total)
      .input('ship_name',      sql.NVarChar,   shipping_address.name)
      .input('ship_line1',     sql.NVarChar,   shipping_address.line1)
      .input('ship_line2',     sql.NVarChar,   shipping_address.line2 || '')
      .input('ship_city',      sql.NVarChar,   shipping_address.city)
      .input('ship_state',     sql.NVarChar,   shipping_address.state || '')
      .input('ship_postal',    sql.NVarChar,   shipping_address.postal_code)
      .input('ship_country',   sql.NVarChar,   shipping_address.country)
      .input('payment_method', sql.NVarChar,   payment_method)
      .input('payment_intent', sql.NVarChar,   payment_intent || null)
      .query(`
        INSERT INTO Orders
          (user_id, guest_email, subtotal, shipping_cost, discount, total,
           ship_name, ship_line1, ship_line2, ship_city, ship_state, ship_postal, ship_country,
           payment_method, payment_intent)
        OUTPUT INSERTED.id
        VALUES
          (@user_id, @guest_email, @subtotal, @shipping_cost, @discount, @total,
           @ship_name, @ship_line1, @ship_line2, @ship_city, @ship_state, @ship_postal, @ship_country,
           @payment_method, @payment_intent)
      `);

    const orderId = orderResult.recordset[0].id;

    // Insert order items
    for (const item of items) {
      await pool.request()
        .input('order_id',   sql.Int,           orderId)
        .input('product_id', sql.Int,           item.product_id)
        .input('name',       sql.NVarChar,      item.name)
        .input('price',      sql.Decimal(10,2), item.unit_price)
        .input('quantity',   sql.Int,           item.quantity)
        .input('image_url',  sql.NVarChar,      item.image_url || '')
        .query(`INSERT INTO OrderItems (order_id, product_id, name, price, quantity, image_url)
                VALUES (@order_id, @product_id, @name, @price, @quantity, @image_url)`);

      // Deduct stock
      await pool.request()
        .input('id',  sql.Int, item.product_id)
        .input('qty', sql.Int, item.quantity)
        .query('UPDATE Products SET stock = stock - @qty WHERE id = @id AND stock >= @qty');
    }

    // Increment coupon usage
    if (coupon_code) {
      await pool.request().input('code', sql.NVarChar, coupon_code.toUpperCase())
        .query('UPDATE Coupons SET used_count = used_count + 1 WHERE code = @code');
    }

    // Clear session cart
    if (req.session) req.session.cart = [];

    res.status(201).json({ orderId, message: 'Order created successfully' });
  } catch (err) { next(err); }
});

// GET /api/orders  — list orders for logged-in user
router.get('/', authRequired, async (req, res, next) => {
  try {
    const pool   = await getPool();
    const result = await pool.request()
      .input('user_id', sql.Int, req.user.id)
      .query(`
        SELECT o.id, o.status, o.total, o.created_at, o.payment_method,
               COUNT(oi.id) AS item_count
        FROM Orders o
        LEFT JOIN OrderItems oi ON oi.order_id = o.id
        WHERE o.user_id = @user_id
        GROUP BY o.id, o.status, o.total, o.created_at, o.payment_method
        ORDER BY o.created_at DESC
      `);
    res.json(result.recordset);
  } catch (err) { next(err); }
});

// GET /api/orders/:id
router.get('/:id', async (req, res, next) => {
  try {
    const pool  = await getPool();
    const order = await pool.request()
      .input('id', sql.Int, parseInt(req.params.id))
      .query('SELECT * FROM Orders WHERE id = @id');
    if (!order.recordset.length) return res.status(404).json({ error: 'Order not found' });

    // Security: only owner or admin can view
    const o = order.recordset[0];
    const userId = req.user?.id;
    if (userId && o.user_id && o.user_id !== userId && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const items = await pool.request()
      .input('order_id', sql.Int, o.id)
      .query('SELECT * FROM OrderItems WHERE order_id = @order_id');

    res.json({ ...o, items: items.recordset });
  } catch (err) { next(err); }
});

module.exports = router;