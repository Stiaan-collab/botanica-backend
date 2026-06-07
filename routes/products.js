// ============================================================
// FILE: backend/routes/products.js
// ============================================================

const express = require('express');
const router  = express.Router();
const { getPool, sql } = require('../config/db');
const { adminRequired } = require('../middleware/auth');

// GET /api/products
// Query params: category, tag, search, sort, page, limit, featured
router.get('/', async (req, res, next) => {
  try {
    const pool = await getPool();
    const {
      category, tag, search,
      sort = 'featured',
      page = 1, limit = 12,
      featured,
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = ['p.is_active = 1'];
    const params = {};

    if (category) {
      where.push('c.slug = @category');
      params.category = category;
    }
    if (search) {
      where.push('(p.name LIKE @search OR p.short_desc LIKE @search)');
      params.search = `%${search}%`;
    }
    if (featured === 'true') {
      where.push('p.is_featured = 1');
    }

    const orderMap = {
      featured:   'p.is_featured DESC, p.created_at DESC',
      newest:     'p.created_at DESC',
      price_asc:  'COALESCE(p.sale_price, p.price) ASC',
      price_desc: 'COALESCE(p.sale_price, p.price) DESC',
      name:       'p.name ASC',
    };
    const orderBy = orderMap[sort] || orderMap.featured;

    const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const query = `
      SELECT
        p.id, p.name, p.slug, p.short_desc, p.price, p.sale_price,
        p.image_url, p.weight_ml, p.stock, p.is_featured,
        c.name AS category_name, c.slug AS category_slug,
        COALESCE(AVG(CAST(r.rating AS FLOAT)), 0) AS avg_rating,
        COUNT(DISTINCT r.id) AS review_count
      FROM Products p
      LEFT JOIN Categories c ON p.category_id = c.id
      LEFT JOIN Reviews r    ON r.product_id  = p.id
      ${tag ? `
        INNER JOIN ProductTags pt ON pt.product_id = p.id
        INNER JOIN Tags t         ON t.id = pt.tag_id AND t.name = @tag
      ` : ''}
      ${whereStr}
      GROUP BY
        p.id, p.name, p.slug, p.short_desc, p.price, p.sale_price,
        p.image_url, p.weight_ml, p.stock, p.is_featured,
        c.name, c.slug
      ORDER BY ${orderBy}
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT p.id) AS total
      FROM Products p
      LEFT JOIN Categories c ON p.category_id = c.id
      ${tag ? `
        INNER JOIN ProductTags pt ON pt.product_id = p.id
        INNER JOIN Tags t         ON t.id = pt.tag_id AND t.name = @tag
      ` : ''}
      ${whereStr}
    `;

    const request = pool.request()
      .input('offset', sql.Int, offset)
      .input('limit',  sql.Int, parseInt(limit));

    if (params.category) request.input('category', sql.NVarChar, params.category);
    if (params.search)   request.input('search',   sql.NVarChar, params.search);
    if (tag)             request.input('tag',       sql.NVarChar, tag);

    const [products, countResult] = await Promise.all([
      request.query(query),
      pool.request()
        .input('offset', sql.Int, offset)
        .input('limit',  sql.Int, parseInt(limit))
        .input('category', sql.NVarChar, params.category || null)
        .input('search',   sql.NVarChar, params.search   || null)
        .input('tag',      sql.NVarChar, tag             || null)
        .query(countQuery),
    ]);

    res.json({
      products: products.recordset,
      total:    countResult.recordset[0].total,
      page:     parseInt(page),
      pages:    Math.ceil(countResult.recordset[0].total / parseInt(limit)),
    });
  } catch (err) { next(err); }
});

// GET /api/products/categories
router.get('/categories', async (req, res, next) => {
  try {
    const pool   = await getPool();
    const result = await pool.request().query(
      `SELECT c.*, COUNT(p.id) AS product_count
       FROM Categories c
       LEFT JOIN Products p ON p.category_id = c.id AND p.is_active = 1
       GROUP BY c.id, c.name, c.slug, c.description, c.image_url
       ORDER BY c.name`
    );
    res.json(result.recordset);
  } catch (err) { next(err); }
});

// GET /api/products/:slug
router.get('/:slug', async (req, res, next) => {
  try {
    const pool = await getPool();

    const product = await pool.request()
      .input('slug', sql.NVarChar, req.params.slug)
      .query(`
        SELECT p.*, c.name AS category_name, c.slug AS category_slug
        FROM Products p
        LEFT JOIN Categories c ON p.category_id = c.id
        WHERE p.slug = @slug AND p.is_active = 1
      `);

    if (!product.recordset.length) return res.status(404).json({ error: 'Product not found' });

    const pid = product.recordset[0].id;

    const [tags, reviews] = await Promise.all([
      pool.request().input('pid', sql.Int, pid).query(
        `SELECT t.name FROM Tags t INNER JOIN ProductTags pt ON pt.tag_id = t.id WHERE pt.product_id = @pid`
      ),
      pool.request().input('pid', sql.Int, pid).query(
        `SELECT r.id, r.rating, r.title, r.body, r.created_at, u.first_name, u.last_name
         FROM Reviews r LEFT JOIN Users u ON u.id = r.user_id
         WHERE r.product_id = @pid ORDER BY r.created_at DESC`
      ),
    ]);

    res.json({
      ...product.recordset[0],
      tags:    tags.recordset.map(t => t.name),
      reviews: reviews.recordset,
    });
  } catch (err) { next(err); }
});

// POST /api/products/:id/reviews  (auth required)
const { authRequired } = require('../middleware/auth');
router.post('/:id/reviews', authRequired, async (req, res, next) => {
  try {
    const { rating, title, body } = req.body;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating 1-5 required' });
    const pool = await getPool();
    await pool.request()
      .input('product_id', sql.Int, parseInt(req.params.id))
      .input('user_id',    sql.Int, req.user.id)
      .input('rating',     sql.TinyInt, parseInt(rating))
      .input('title',      sql.NVarChar, title  || '')
      .input('body',       sql.NVarChar, body   || '')
      .query(`INSERT INTO Reviews (product_id, user_id, rating, title, body) VALUES (@product_id, @user_id, @rating, @title, @body)`);
    res.status(201).json({ message: 'Review submitted' });
  } catch (err) { next(err); }
});

module.exports = router;