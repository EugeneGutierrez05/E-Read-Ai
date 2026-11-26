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

const coverScenes = [
  ['pride and prejudice', '#b5655b', '#452f48', '<path d="M92 290h216V190L200 112 92 190z" fill="#f3d9b2"/><path d="M72 196 200 98l128 98-18 20-110-84-110 84z" fill="#693e50"/><rect x="174" y="220" width="52" height="70" rx="26" fill="#c17a60"/><path d="M116 290v-56h38v56m92 0v-56h38v56" fill="#73536a"/><circle cx="92" cy="128" r="13" fill="#e99c88"/><circle cx="308" cy="146" r="10" fill="#e99c88"/>'],
  ['emma', '#d2a35f', '#685044', '<path d="M112 296c-42-55-23-119 22-145 15 34 8 54-3 72 38-42 91-50 144-35-16 24-37 38-62 48 32-2 59 12 76 35-49 2-93 10-131 25z" fill="#f3d59b"/><path d="M185 270c-17-31-5-67 16-83 16 24 15 48 5 64 28-14 56-8 71 8-29 5-57 14-83 29z" fill="#ba665b"/><path d="M186 272c-9-24 0-44 15-54 8 16 7 28 2 38 16-8 31-4 40 6-16 3-32 8-46 17z" fill="#e9a47c"/>'],
  ['frankenstein', '#596d83', '#252b42', '<path d="M190 102h20l-16 67h38l-60 92 15-68h-37z" fill="#ffe18b"/><path d="M122 302v-55h24v-34h35v34h38v-34h35v34h24v55z" fill="#283444"/><path d="M158 248v-45m84 45v-45m-52 97v-42h24v42" stroke="#adc1c5" stroke-width="7"/><path d="M109 311h182" stroke="#d1d8cc" stroke-width="4"/>'],
  ['dracula', '#6b3f58', '#211f3e', '<circle cx="277" cy="139" r="49" fill="#f4d99f"/><path d="M75 300h250V227H75zM102 227v-86l29 28 30-56 34 50 32-73 35 65 34-34v106" fill="#302b48"/><path d="M172 300v-52h56v52" fill="#b05d62"/><path d="M115 179h22m42-20h20m55-4h22" stroke="#f4d99f" stroke-width="5"/>'],
  ['time machine', '#3d7381', '#25354f', '<circle cx="200" cy="210" r="101" fill="none" stroke="#f2d394" stroke-width="13"/><circle cx="200" cy="210" r="77" fill="#497d85" stroke="#d8b979" stroke-width="5"/><path d="M200 148v64l46 28" fill="none" stroke="#fff0c8" stroke-width="10" stroke-linecap="round"/><path d="M200 116v14m0 160v14m-98-94h14m168 0h14" stroke="#fff0c8" stroke-width="7"/>'],
  ['war of the worlds', '#a65344', '#302c48', '<circle cx="274" cy="146" r="58" fill="#e07856"/><path d="M83 300 128 191l33 43 31-76 38 83 34-50 53 109z" fill="#343347"/><path d="M173 278v-91m0 29-34 25m34-15 33 17m37 49v-70m0 22-27 21m27-10 29 18" stroke="#dfbd79" stroke-width="8" stroke-linecap="round"/><circle cx="103" cy="129" r="4" fill="#fff1ce"/><circle cx="160" cy="116" r="3" fill="#fff1ce"/>'],
  ['alice', '#64928b', '#334e62', '<path d="M101 284c-15-57 10-101 52-113l-10-66c-2-17 20-23 27-7l24 58c8-4 18-6 28-5l20-60c6-18 29-11 25 7l-10 67c38 17 57 57 44 119z" fill="#f2e5c7"/><circle cx="177" cy="208" r="5" fill="#4a5360"/><circle cx="229" cy="208" r="5" fill="#4a5360"/><path d="M184 228q19 15 38 0" fill="none" stroke="#ba7469" stroke-width="5"/><path d="M91 300h48m122 0h48" stroke="#e4b987" stroke-width="8"/><circle cx="106" cy="267" r="24" fill="#c66d67"/>'],
  ['sherlock', '#647d78', '#30444b', '<path d="M138 148c0-47 124-47 124 0l-14 36h-96z" fill="#d2b37b"/><path d="M126 184h148l-24 16H150z" fill="#b18c60"/><circle cx="200" cy="238" r="58" fill="none" stroke="#f0d7a1" stroke-width="12"/><path d="m242 280 51 51" stroke="#f0d7a1" stroke-width="15" stroke-linecap="round"/><path d="M166 238h68m-34-34v68" stroke="#d6e0d0" stroke-width="4" opacity=".8"/>'],
  ['moby dick', '#39818a', '#203e58', '<path d="M73 258c28-65 93-100 176-82 29 7 53 22 75 37l30-13-19 38 24 27-38-10c-39 44-98 59-154 39-41-14-73-13-94-36z" fill="#e9e2ca"/><path d="M72 281q32-20 64 0t64 0 64 0 64 0" fill="none" stroke="#7bd0c2" stroke-width="9"/><path d="M95 313q32-20 64 0t64 0 64 0 64 0" fill="none" stroke="#7bd0c2" stroke-width="7" opacity=".7"/><circle cx="287" cy="218" r="5" fill="#263e4c"/>'],
  ['tom sawyer', '#60876d', '#2c5360', '<path d="M73 286q42-57 84 0t84 0 84 0" fill="#78b8a5"/><path d="M87 244h210l-34 45H122z" fill="#e8c486"/><path d="M152 242v-68h72v68m-86-68h100l-50-47z" fill="#f4e3bf"/><path d="M163 207h20m20 0h20" stroke="#55706c" stroke-width="9"/><path d="M103 298v-82m195 82v-82" stroke="#9ab786" stroke-width="8"/>'],
  ['treasure island', '#d2a353', '#435d52', '<path d="M72 264q49-43 96-12 30-59 83-45 38 10 77 57l-41 42H111z" fill="#4f806b"/><path d="M149 226q29-91 74-8" fill="#84a46f"/><path d="M200 159v110m-46-67h92m-79-32 66 66m0-66-66 66" stroke="#f4d893" stroke-width="5"/><circle cx="200" cy="213" r="56" fill="none" stroke="#f4d893" stroke-width="4"/><path d="m190 190 27 22-32 17z" fill="#e9a35f"/>'],
  ['art of war', '#ba5d49', '#4b3544', '<path d="m125 126 151 158m-12-176L112 278" stroke="#e8d1a2" stroke-width="14" stroke-linecap="round"/><path d="m117 119 23 23m131-42-23 23m-149 160 26-9m151 13-27-13" stroke="#f4e5c4" stroke-width="7"/><circle cx="200" cy="207" r="81" fill="none" stroke="#e5a96c" stroke-width="4"/><path d="M200 106v-20m0 242v-20m101-101h20M79 207h20" stroke="#e5a96c" stroke-width="5"/>'],
  ['meditations', '#9d7953', '#394b50', '<path d="M95 291V154h39v137m31 0V125h39v166m31 0V154h39v137m31 0V125h31v166" fill="#e6d3ad"/><path d="M82 296h236m-205-15h174M84 146h234l-117-61z" fill="#c69e68"/><circle cx="201" cy="190" r="31" fill="#d9b779" opacity=".7"/>'],
  ['the prince', '#854c55', '#382d45', '<path d="m112 256 18-104 52 54 20-94 36 94 52-54 18 104z" fill="#e9c779"/><path d="M124 264h152v32H124z" fill="#d4aa63"/><circle cx="130" cy="142" r="13" fill="#f2e5c8"/><circle cx="202" cy="103" r="14" fill="#f2e5c8"/><circle cx="278" cy="142" r="13" fill="#f2e5c8"/><path d="M154 274h90" stroke="#88505a" stroke-width="7"/>'],
  ['noli me tangere', '#55806f', '#344451', '<circle cx="273" cy="135" r="45" fill="#f0c66f"/><path d="M79 294h242V206H79zM104 206v-76l33 31 27-46 37 41 35-55 37 43 23-26v88" fill="#e0c49a"/><path d="M177 294v-52h45v52m-84-69h29m103 0h27" fill="#7a5960"/><path d="M91 187q20-50 39 0m176 2q20-51 39 0" fill="none" stroke="#8eb18a" stroke-width="9"/>'],
  ['count of monte cristo', '#456d7d', '#2d374e', '<path d="M74 288q45-54 90-4 36-72 80-20 38-44 82 22z" fill="#62927d"/><path d="M101 245h190l-33 42H130z" fill="#d9bd8f"/><path d="M192 243v-99l-61 88h61m0-71 65 71h-65" fill="#f1e4c8"/><path d="M76 309q35-18 70 0t70 0 70 0 42 0" fill="none" stroke="#79c4bd" stroke-width="7"/>'],
  ['great expectations', '#71818a', '#414354', '<path d="M80 285h241v-86H80zM107 199v-70h48v70m29 0v-95h59v95m27 0v-71h39v71" fill="#d1c5aa"/><path d="m86 131 44-34 45 34m38-28 31-24 33 24" fill="none" stroke="#e5d7b8" stroke-width="8"/><path d="M173 285v-56h53v56" fill="#776e72"/><path d="M66 303h269" stroke="#bac1b3" stroke-width="5" opacity=".8"/>'],
  ['crime and punishment', '#9d5b4b', '#463344', '<path d="M95 293h210m-184 0v-99m158 99v-99m-190-6h214m-190 0 83-56 83 56" fill="none" stroke="#e1c58f" stroke-width="9"/><path d="M153 205h94m-47-57v57" stroke="#e1c58f" stroke-width="7"/><path d="M133 210q-28 35 0 53 28-18 0-53m134 0q-28 35 0 53 28-18 0-53" fill="#d2a765"/><circle cx="200" cy="122" r="17" fill="#e58a6b"/>'],
  ['picture of dorian gray', '#626d7a', '#342b43', '<rect x="113" y="100" width="174" height="205" rx="8" fill="#d8bd83"/><rect x="127" y="114" width="146" height="177" rx="4" fill="#4b5061"/><path d="M171 260c-10-42 2-93 29-112 28 20 41 70 29 112z" fill="#c29b79"/><circle cx="199" cy="167" r="25" fill="#e0bd99"/><path d="M176 170q22-23 47-3" fill="none" stroke="#5a4653" stroke-width="7"/><path d="M97 92h206M97 313h206" stroke="#f0d99c" stroke-width="7"/>'],
  ['wuthering heights', '#667778', '#343947', '<path d="M70 291 145 179l45 64 45-111 95 159z" fill="#728478"/><path d="M105 291q31-81 95-59 48-40 96 59z" fill="#4d5960"/><path d="M185 232v-47h30v47m-38-47h47l-24-26z" fill="#d4bd96"/><circle cx="284" cy="127" r="28" fill="#eee0bd"/><path d="M83 300q44-25 88 0t88 0 63 0" fill="none" stroke="#c6b89c" stroke-width="5"/>'],
];

const coverPalettes = {
  Romance: ['#d27a72', '#713d54'],
  'Science Fiction': ['#557f91', '#30364f'],
  Horror: ['#76506b', '#332b49'],
  Fantasy: ['#658c80', '#354c5c'],
  Mystery: ['#69857e', '#344950'],
  Adventure: ['#c19454', '#435d53'],
  Philosophy: ['#a8875d', '#465451'],
  Politics: ['#9d5d62', '#483449'],
  'Classic Literature': ['#936c61', '#493b4e'],
};

function coverSvg(book) {
  const titleKey = book.title.toLowerCase();
  const scene = coverScenes.find(([key]) => titleKey.includes(key));
  const [start, end] = scene ? [scene[1], scene[2]] : (coverPalettes[book.category] || ['#98775c', '#46394a']);
  const art = scene ? scene[3] : '<circle cx="200" cy="205" r="72" fill="none" stroke="#f0d6a0" stroke-width="8"/><path d="M200 130v150m-75-75h150" stroke="#f0d6a0" stroke-width="7"/>';
  const escapeXml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[char]);
  const titleWords = String(book.title ?? '').split(/\s+/);
  const titleLines = [];
  let line = '';
  for (const word of titleWords) {
    if (line && `${line} ${word}`.length > 23) {
      titleLines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) titleLines.push(line);
  const titleText = titleLines.map((text, index) =>
    `<tspan x="200" dy="${index ? 31 : 0}">${escapeXml(text)}</tspan>`).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">
    <defs>
      <linearGradient id="cover" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${start}"/><stop offset="1" stop-color="${end}"/>
      </linearGradient>
      <radialGradient id="glow"><stop stop-color="#fff1c8" stop-opacity=".45"/><stop offset="1" stop-color="#fff1c8" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="400" height="600" rx="18" fill="url(#cover)"/>
    <circle cx="200" cy="208" r="170" fill="url(#glow)"/>
    <rect x="24" y="24" width="352" height="552" rx="12" fill="none" stroke="#f5e5c5" stroke-opacity=".62" stroke-width="2"/>
    <text x="200" y="65" fill="#f8e9c9" font-family="Arial,sans-serif" font-size="13" letter-spacing="4" text-anchor="middle">E-READ CLASSICS</text>
    <g>${art}</g>
    <path d="M58 386h284" stroke="#f2dfb6" stroke-opacity=".6"/>
    <text x="200" y="429" fill="#fff8e9" font-family="Georgia,serif" font-size="27" font-weight="700" text-anchor="middle">${titleText}</text>
    <text x="200" y="524" fill="#f4e5c8" font-family="Arial,sans-serif" font-size="17" text-anchor="middle">${escapeXml(book.author)}</text>
    <text x="200" y="553" fill="#f2d99f" font-family="Arial,sans-serif" font-size="13" letter-spacing="2" text-anchor="middle">${escapeXml(book.category.toUpperCase())}</text>
  </svg>`;
}

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
  const book = { title: b.title, author: b.author, category: b.category };
  res.set('Content-Type', 'image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(coverSvg(book));
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
