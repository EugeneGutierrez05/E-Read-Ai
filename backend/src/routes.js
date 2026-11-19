const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('./db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production');
  return 'dev-only-secret-change-me';
})();
const GUEST_LIMIT = 5;
const USER_LIMIT = 10;

// ---------- helpers ----------
const sign = (payload) => jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

function auth(required = true) {
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return required ? res.status(401).json({ error: 'Authentication required' }) : next();
    try {
      req.auth = jwt.verify(token, JWT_SECRET);
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}
const adminOnly = (req, res, next) =>
  req.auth && req.auth.role === 'admin' ? next() : res.status(403).json({ error: 'Administrator access required' });
const registeredOnly = (req, res, next) =>
  req.auth && req.auth.role !== 'guest' ? next() : res.status(403).json({ error: 'Please register or log in to use this feature' });

const publicUser = (u) => ({ id: u.id, fullName: u.full_name, email: u.email, role: u.role });

function downloadStatus(auth) {
  if (auth.role === 'guest') {
    const used = db.prepare('SELECT COUNT(*) n FROM downloads WHERE guest_id = ?').get(auth.sub).n;
    return { used, limit: GUEST_LIMIT, remaining: Math.max(0, GUEST_LIMIT - used) };
  }
  const used = db.prepare('SELECT COUNT(*) n FROM downloads WHERE user_id = ?').get(auth.sub).n;
  return { used, limit: USER_LIMIT, remaining: Math.max(0, USER_LIMIT - used) };
}

const emailOk = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
const passOk = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 72 && /[A-Za-z]/.test(p) && /\d/.test(p);

// ---------- health ----------
router.get('/health', (_req, res) => {
  const books = db.prepare('SELECT COUNT(*) n FROM books').get().n;
  res.json({ status: 'ok', service: 'elibrary-ai', phase: 1, books });
});

// ---------- auth ----------
router.post('/auth/register', (req, res) => {
  const { fullName, email, password } = req.body || {};
  if (typeof fullName !== 'string' || fullName.trim().length < 2 || fullName.length > 100)
    return res.status(400).json({ error: 'Full name must be 2-100 characters' });
  if (!emailOk(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (!passOk(password)) return res.status(400).json({ error: 'Password must be 8+ characters with letters and numbers' });
  const mail = email.trim().toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(mail))
    return res.status(409).json({ error: 'Email is already registered' });
  const info = db.prepare('INSERT INTO users (full_name,email,password_hash) VALUES (?,?,?)')
  .run(fullName.trim(), mail, bcrypt.hashSync(password, 10));
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ token: sign({ sub: user.id, role: user.role }), user: publicUser(user) });
});

router.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!emailOk(email) || typeof password !== 'string') return res.status(400).json({ error: 'Email and password are required' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Incorrect email or password' });
  res.json({ token: sign({ sub: user.id, role: user.role }), user: publicUser(user) });
});

router.post('/auth/guest', (_req, res) => {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO guest_sessions (id) VALUES (?)').run(id);
  res.status(201).json({
    token: sign({ sub: id, role: 'guest' }),
    user: { id, fullName: 'Guest', email: null, role: 'guest' },
  });
});

// Stateless JWT: logout is confirmed server-side; clients discard the token.
router.post('/auth/logout', auth(false), (_req, res) => res.json({ message: 'Logged out' }));

router.get('/auth/me', auth(), (req, res) => {
  if (req.auth.role === 'guest')
    return res.json({ user: { id: req.auth.sub, fullName: 'Guest', email: null, role: 'guest' }, downloads: downloadStatus(req.auth) });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth.sub);
  if (!user) return res.status(401).json({ error: 'Account no longer exists' });
  res.json({ user: publicUser(user), downloads: downloadStatus(req.auth) });
});

// ---------- books ----------
const bookRow = (b) => ({
  id: b.id, title: b.title, author: b.author, category: b.category, description: b.description,
  coverUrl: `/api/books/${b.id}/cover`, license: b.license, source: b.source, year: b.year,
});

router.get('/books', auth(false), (req, res) => {
  const { q, author, category } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const where = []; const params = [];
  if (q) { where.push('(title LIKE ? OR author LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (author) { where.push('author LIKE ?'); params.push(`%${author}%`); }
  if (category) { where.push('category = ?'); params.push(category); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM books ${w}`).get(...params).n;
  const rows = db.prepare(`SELECT * FROM books ${w} ORDER BY title LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
  res.json({ total, page, limit, books: rows.map(bookRow) });
});

router.get('/categories', (_req, res) => {
  res.json({ categories: db.prepare('SELECT category name, COUNT(*) count FROM books GROUP BY category ORDER BY category').all() });
});

router.get('/books/:id', (req, res) => {
  const b = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Book not found' });
  res.json({ book: bookRow(b) });
});

router.get('/books/:id/cover', (req, res) => {
  const b = db.prepare('SELECT title, author, category, cover_url FROM books WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Book not found' });
  if (/^https:\/\/www\.gutenberg\.org\/cache\/epub\/\d+\/pg\d+\.cover\.medium\.jpg$/.test(b.cover_url || '')) {
    return res.redirect(302, b.cover_url);
  }
  const escapeXml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[char]);
  const title = escapeXml(b.title);
  const author = escapeXml(b.author);
  const category = escapeXml(b.category);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#9a7355"/>
        <stop offset="1" stop-color="#4a3527"/>
      </linearGradient>
      <filter id="shadow"><feDropShadow dx="0" dy="8" stdDeviation="12" flood-opacity=".25"/></filter>
    </defs>
    <rect width="400" height="600" rx="18" fill="url(#bg)"/>
    <rect x="36" y="36" width="328" height="528" rx="12" fill="none" stroke="#d8c6a8" stroke-width="3" opacity=".7"/>
    <circle cx="200" cy="185" r="78" fill="#d8c6a8" opacity=".12"/>
    <path d="M200 108v154M123 185h154" stroke="#d8c6a8" stroke-width="8" stroke-linecap="round" opacity=".24"/>
    <text x="200" y="370" fill="#fff" font-family="Georgia,serif" font-size="34" font-weight="700" text-anchor="middle">
      ${title.replace(/.{38}\s|.{38}/g, '$&\n')}
    </text>
    <text x="200" y="480" fill="#f3eadc" font-family="Arial,sans-serif" font-size="22" text-anchor="middle">${author}</text>
    <text x="200" y="526" fill="#d8c6a8" font-family="Arial,sans-serif" font-size="16" text-anchor="middle">${category}</text>
  </svg>`;
  res.set('Content-Type', 'image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(svg);
});

// Download: limits are ENFORCED HERE (guest 5 per session, registered 10 per account).
router.post('/books/:id/download', auth(), (req, res) => {
  const b = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Book not found' });
  const isGuest = req.auth.role === 'guest';
  const result = db.transaction(() => {
    const st = downloadStatus(req.auth);
    const already = isGuest
      ? db.prepare('SELECT 1 FROM downloads WHERE guest_id=? AND book_id=?').get(req.auth.sub, b.id)
      : db.prepare('SELECT 1 FROM downloads WHERE user_id=? AND book_id=?').get(req.auth.sub, b.id);
    if (already) return { ok: true, downloads: st, repeat: true };       // re-download of the same book is free
    if (st.remaining <= 0) return { ok: false };
    db.prepare('INSERT INTO downloads (user_id, guest_id, book_id) VALUES (?,?,?)')
      .run(isGuest ? null : req.auth.sub, isGuest ? req.auth.sub : null, b.id);
    return { ok: true, downloads: downloadStatus(req.auth) };
  })();
  if (!result.ok)
    return res.status(403).json({
      error: isGuest ? `Guest download limit reached (${GUEST_LIMIT}). Register to get ${USER_LIMIT} downloads.`
                     : `Download limit reached (${USER_LIMIT}).`,
      downloads: downloadStatus(req.auth),
    });
  res.json({ downloadUrl: b.download_url, license: b.license, downloads: result.downloads });
});

// ---------- favorites & my library (registered only) ----------
router.get('/favorites', auth(), registeredOnly, (req, res) => {
  const rows = db.prepare('SELECT b.* FROM favorites f JOIN books b ON b.id=f.book_id WHERE f.user_id=? ORDER BY f.created_at DESC').all(req.auth.sub);
  res.json({ books: rows.map(bookRow) });
});
router.put('/favorites/:id', auth(), registeredOnly, (req, res) => {
  if (!db.prepare('SELECT 1 FROM books WHERE id=?').get(req.params.id)) return res.status(404).json({ error: 'Book not found' });
  db.prepare('INSERT OR IGNORE INTO favorites (user_id, book_id) VALUES (?,?)').run(req.auth.sub, req.params.id);
  res.json({ favorite: true });
});
router.delete('/favorites/:id', auth(), registeredOnly, (req, res) => {
  db.prepare('DELETE FROM favorites WHERE user_id=? AND book_id=?').run(req.auth.sub, req.params.id);
  res.json({ favorite: false });
});
router.get('/library', auth(), registeredOnly, (req, res) => {
  const rows = db.prepare('SELECT b.* FROM library l JOIN books b ON b.id=l.book_id WHERE l.user_id=? ORDER BY l.created_at DESC').all(req.auth.sub);
  res.json({ books: rows.map(bookRow) });
});
router.put('/library/:id', auth(), registeredOnly, (req, res) => {
  if (!db.prepare('SELECT 1 FROM books WHERE id=?').get(req.params.id)) return res.status(404).json({ error: 'Book not found' });
  db.prepare('INSERT OR IGNORE INTO library (user_id, book_id) VALUES (?,?)').run(req.auth.sub, req.params.id);
  res.json({ inLibrary: true });
});
router.delete('/library/:id', auth(), registeredOnly, (req, res) => {
  db.prepare('DELETE FROM library WHERE user_id=? AND book_id=?').run(req.auth.sub, req.params.id);
  res.json({ inLibrary: false });
});

// ---------- admin (initial) ----------
router.get('/admin/stats', auth(), adminOnly, (_req, res) => {
  const n = (sql) => db.prepare(sql).get().n;
  res.json({
    users: n("SELECT COUNT(*) n FROM users WHERE role='user'"),
    guests: n('SELECT COUNT(*) n FROM guest_sessions'),
    books: n('SELECT COUNT(*) n FROM books'),
    downloads: n('SELECT COUNT(*) n FROM downloads'),
    targetBooks: 200,
  });
});

// ---------- AI agent (planned architecture; implemented in Phase 2) ----------
router.get('/ai/architecture', (_req, res) => {
  res.json({
    status: 'planned',
    phase: 2,
    pattern: 'LLM tool-calling agent running on the backend; embedded as a chat panel in web and Android',
    endpoint: 'POST /api/ai/chat  { message, conversationId }',
    tools: [
      { name: 'search_books', description: 'Search the real catalog by title, author or category' },
      { name: 'get_book_details', description: 'Retrieve full details for a book id' },
      { name: 'compare_books', description: 'Compare two or more books side-by-side' },
      { name: 'recommend_books', description: 'Recommend books from the catalog based on stated interests' },
      { name: 'save_to_library', description: 'Save a book to My Library (requires explicit user confirmation)' },
    ],
    safety: ['Tools run server-side under the caller\'s JWT', 'save_to_library needs a confirmation step', 'Every tool call logged in ai_tool_logs'],
  });
});

module.exports = router;
