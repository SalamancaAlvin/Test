/* Vidlo – servidor principal */
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || 'vidlo-secret-key-change-in-production';

class UserError extends Error {}

function normSrc(link) {
  link = String(link || '').trim();
  if (!link) return [];
  let u;
  try { u = new URL(link); } catch { throw new UserError('El enlace del video no es válido'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new UserError('El enlace del video debe empezar con http:// o https://');
  const host = u.hostname.replace(/^www\./, '');

  if (host === 'mega.nz' || host === 'mega.co.nz') {
    let id, key;
    let m = u.pathname.match(/^\/(?:file|embed)\/([\w-]+)$/);
    if (m && u.hash.length > 1) { id = m[1]; key = u.hash.slice(1); }
    else { m = u.hash.match(/^#!([\w-]+)!([\w-]+)$/); if (m) { id = m[1]; key = m[2]; } }
    if (!id || !key) throw new UserError('Enlace de Mega no reconocido. Usa el enlace del archivo con su clave (lleva un # al final).');
    return [{ n: 'Mega', embed: `https://mega.nz/embed/${id}#${key}`, dl: `https://mega.nz/file/${id}#${key}`, type: 'iframe' }];
  }

  if (['youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) {
    let id = host === 'youtu.be' ? u.pathname.slice(1)
      : u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})/) || [])[1];
    if (!/^[\w-]{11}$/.test(id || '')) throw new UserError('Enlace de YouTube no reconocido');
    return [{ n: 'YouTube', embed: `https://www.youtube.com/embed/${id}`, dl: '', type: 'iframe' }];
  }

  if (u.pathname.endsWith('.m3u8')) {
    return [{ n: 'HLS Stream', embed: u.href, dl: '', type: 'hls' }];
  }

  if (/\.(mp4|webm|ogg)$/i.test(u.pathname)) {
    return [{ n: 'Video Directo', embed: u.href, dl: u.href, type: 'video' }];
  }

  return [{ n: 'Enlace', embed: u.href, dl: '', type: 'iframe' }];
}

const str = (x, max) => String(x == null ? '' : x).trim().slice(0, max);
function httpsUrl(x, label) {
  x = str(x, 500);
  if (!x) return '';
  let u;
  try { u = new URL(x); } catch { throw new UserError(`${label} no es un enlace válido`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new UserError(`${label} debe ser un enlace válido`);
  return u.href;
}
function clean(b) {
  b = b || {};
  const title = str(b.title, 200), ch = str(b.ch, 80);
  if (!title) throw new UserError('Falta el título');
  if (!ch) throw new UserError('Falta el canal');
  let tags = Array.isArray(b.tags) ? b.tags : String(b.tags || '').split(',');
  tags = tags.map(t => str(t, 30)).filter(Boolean).slice(0, 8);
  const year = parseInt(b.year, 10);
  let src = [];
  if (b.link) {
    src = normSrc(b.link);
  } else if (Array.isArray(b.src)) {
    src = b.src;
  }
  return {
    title, ch, tags,
    dur: str(b.dur, 12), cat: str(b.cat, 40),
    year: year >= 1900 && year <= 2100 ? year : null,
    desc: str(b.desc, 2000),
    thumb: httpsUrl(b.thumb, 'La miniatura'),
    rating: str(b.rating, 6), votes: str(b.votes, 20),
    src
  };
}

const MEGA = 'https://mega.nz/file/MnoChCpQ#S63JRkBV3kcc90w1aQnsEMjohfR6aaIHbbY-ieNnnmc';
const SEED = [
  { title: 'Cómo editar tu primer video en 15 minutos', ch: 'Taller Creativo', dur: '12:34', cat: 'Tutorial', year: 2026, views: 1200000, days: 1, link: MEGA,
    tags: ['Edición', 'Principiantes', 'Software'], rating: '8.73', votes: '1,204',
    desc: 'Un recorrido paso a paso por el proceso de edición: importar el material, ordenar las tomas, cortar con ritmo, agregar música y exportar el resultado final.' },
  { title: 'Guía real para fotografiar de noche', ch: 'Lente Abierto', dur: '08:12', cat: 'Tutorial', year: 2026, views: 640000, days: 3,
    tags: ['Fotografía', 'Noche'], rating: '8.10', votes: '532',
    desc: 'Ajustes de cámara, trípode, enfoque manual y edición básica para conseguir fotos nítidas con poca luz.' }
];
const seedToVideo = s => ({
  title: s.title, ch: s.ch, dur: s.dur, cat: s.cat, year: s.year, tags: s.tags, desc: s.desc, thumb: '',
  rating: s.rating, votes: s.votes, views: s.views, src: s.link ? normSrc(s.link) : [],
  created: new Date(Date.now() - s.days * 864e5)
});

const toRow = v => ({
  title: v.title, ch: v.ch, dur: v.dur, cat: v.cat, year: v.year, tags: v.tags, descr: v.desc, thumb: v.thumb,
  rating: v.rating, votes: v.votes, views: v.views || 0, src: v.src, created_at: v.created || new Date()
});
const rowToApi = r => ({
  id: r.id, title: r.title, ch: r.ch, dur: r.dur, cat: r.cat, year: r.year, tags: r.tags, desc: r.descr,
  thumb: r.thumb, rating: r.rating, votes: r.votes, views: r.views, src: r.src,
  created: new Date(r.created_at).toISOString()
});

function pgStore(url) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: url,
    ssl: /\.render\.com|sslmode=require/.test(url) ? { rejectUnauthorized: false } : false
  });
  return {
    kind: 'Postgres',
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS videos (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL, ch TEXT NOT NULL,
          dur TEXT DEFAULT '', cat TEXT DEFAULT '', year INT,
          tags JSONB DEFAULT '[]', descr TEXT DEFAULT '', thumb TEXT DEFAULT '',
          rating TEXT DEFAULT '', votes TEXT DEFAULT '', views INT DEFAULT 0,
          src JSONB DEFAULT '[]', created_at TIMESTAMPTZ DEFAULT now());

        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now());

        CREATE TABLE IF NOT EXISTS comments (
          id SERIAL PRIMARY KEY,
          video_id INT REFERENCES videos(id) ON DELETE CASCADE,
          user_id INT REFERENCES users(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now());
      `);
    },
    async count() { return (await pool.query('SELECT COUNT(*)::int AS c FROM videos')).rows[0].c; },
    async list({ page = 1, limit = 50, q = '', ch = '' } = {}) {
      const p = Math.max(1, parseInt(page, 10) || 1);
      const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
      const offset = (p - 1) * l;
      let query = 'SELECT * FROM videos WHERE 1=1';
      const params = [];

      if (q) {
        params.push(`%${q}%`);
        query += ` AND (title ILIKE $${params.length} OR ch ILIKE $${params.length} OR cat ILIKE $${params.length})`;
      }
      if (ch) {
        params.push(ch);
        query += ` AND ch = $${params.length}`;
      }

      query += ` ORDER BY id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(l, offset);
      return (await pool.query(query, params)).rows;
    },
    async get(id) {
      const res = await pool.query('SELECT * FROM videos WHERE id=$1', [id]);
      return res.rows[0] || null;
    },
    async create(v) {
      const r = toRow(v);
      return (await pool.query(
        `INSERT INTO videos (title,ch,dur,cat,year,tags,descr,thumb,rating,votes,views,src,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [r.title, r.ch, r.dur, r.cat, r.year, JSON.stringify(r.tags), r.descr, r.thumb, r.rating, r.votes, r.views, JSON.stringify(r.src), r.created_at]
      )).rows[0];
    },
    async update(id, v) {
      const r = toRow(v);
      const res = await pool.query(
        `UPDATE videos SET title=$1, ch=$2, dur=$3, cat=$4, year=$5, tags=$6, descr=$7, thumb=$8, rating=$9, votes=$10, src=$11
         WHERE id=$12 RETURNING *`,
        [r.title, r.ch, r.dur, r.cat, r.year, JSON.stringify(r.tags), r.descr, r.thumb, r.rating, r.votes, JSON.stringify(r.src), id]
      );
      return res.rows[0] || null;
    },
    async remove(id) { return (await pool.query('DELETE FROM videos WHERE id=$1', [id])).rowCount > 0; },
    async view(id) { await pool.query('UPDATE videos SET views = views + 1 WHERE id=$1', [id]); },

    async createUser(username, passwordHash) {
      const res = await pool.query('INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username', [username, passwordHash]);
      return res.rows[0];
    },
    async getUserByUsername(username) {
      const res = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
      return res.rows[0] || null;
    },
    async getUserById(id) {
      const res = await pool.query('SELECT id, username, created_at FROM users WHERE id=$1', [id]);
      return res.rows[0] || null;
    },

    async getComments(videoId) {
      const res = await pool.query(
        `SELECT c.id, c.video_id, c.user_id, c.content, c.created_at, u.username
         FROM comments c JOIN users u ON c.user_id = u.id
         WHERE c.video_id = $1 ORDER BY c.id DESC`, [videoId]
      );
      return res.rows;
    },
    async createComment(videoId, userId, content) {
      const res = await pool.query(
        'INSERT INTO comments (video_id, user_id, content) VALUES ($1, $2, $3) RETURNING *',
        [videoId, userId, content]
      );
      const user = await this.getUserById(userId);
      return { ...res.rows[0], username: user ? user.username : 'Anónimo' };
    },
    async getComment(commentId) {
      const res = await pool.query('SELECT * FROM comments WHERE id=$1', [commentId]);
      return res.rows[0] || null;
    },
    async removeComment(commentId) {
      return (await pool.query('DELETE FROM comments WHERE id=$1', [commentId])).rowCount > 0;
    }
  };
}

function memStore() {
  const rows = [];
  const users = [];
  const comments = [];
  let nextId = 1, nextUserId = 1, nextCommentId = 1;

  return {
    kind: 'memoria (se borra al reiniciar)',
    async init() {},
    async count() { return rows.length; },
    async list({ page = 1, limit = 50, q = '', ch = '' } = {}) {
      let filtered = [...rows];
      if (q) {
        const t = q.toLowerCase();
        filtered = filtered.filter(v => [v.title, v.ch, v.cat, ...(v.tags || [])].join(' ').toLowerCase().includes(t));
      }
      if (ch) filtered = filtered.filter(v => v.ch === ch);
      filtered.sort((a, b) => b.id - a.id);
      const p = Math.max(1, parseInt(page, 10) || 1);
      const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
      return filtered.slice((p - 1) * l, p * l);
    },
    async get(id) { return rows.find(r => r.id === id) || null; },
    async create(v) { const r = { id: nextId++, ...toRow(v) }; rows.push(r); return r; },
    async update(id, v) {
      const i = rows.findIndex(r => r.id === id);
      if (i < 0) return null;
      const updated = { id, ...toRow(v) };
      rows[i] = updated;
      return updated;
    },
    async remove(id) {
      const i = rows.findIndex(r => r.id === id);
      if (i < 0) return false;
      rows.splice(i, 1);
      return true;
    },
    async view(id) { const r = rows.find(x => x.id === id); if (r) r.views++; },

    async createUser(username, passwordHash) {
      const u = { id: nextUserId++, username, password: passwordHash, created_at: new Date() };
      users.push(u);
      return { id: u.id, username: u.username };
    },
    async getUserByUsername(username) { return users.find(u => u.username.toLowerCase() === username.toLowerCase()) || null; },
    async getUserById(id) { const u = users.find(x => x.id === id); return u ? { id: u.id, username: u.username } : null; },

    async getComments(videoId) {
      return comments.filter(c => c.video_id === videoId).sort((a, b) => b.id - a.id);
    },
    async createComment(videoId, userId, content) {
      const user = await this.getUserById(userId);
      const c = { id: nextCommentId++, video_id: videoId, user_id: userId, content, created_at: new Date(), username: user ? user.username : 'Anónimo' };
      comments.push(c);
      return c;
    },
    async getComment(commentId) { return comments.find(c => c.id === commentId) || null; },
    async removeComment(commentId) {
      const i = comments.findIndex(c => c.id === commentId);
      if (i < 0) return false;
      comments.splice(i, 1);
      return true;
    }
  };
}

const store = DATABASE_URL ? pgStore(DATABASE_URL) : memStore();

const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const fails = new Map();
function admin(req, res, next) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return res.status(503).json({ error: 'Falta configurar ADMIN_PASSWORD en el servidor' });
  const now = Date.now();
  const f = fails.get(req.ip) || { n: 0, t: now };
  if (now - f.t > 10 * 60 * 1000) { f.n = 0; f.t = now; }
  if (f.n >= 10) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
  if (!crypto.timingSafeEqual(sha(req.get('x-admin-password') || ''), sha(pw))) {
    f.n++; fails.set(req.ip, f);
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }
  next();
}

function authUser(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }
  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    req.user = null;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Debes iniciar sesión para realizar esta acción' });
  next();
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(authUser);

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

const page = f => (req, res) => res.sendFile(path.join(__dirname, f));
app.get(['/', '/index.html'], page('index.html'));
app.get(['/watch', '/watch.html'], page('watch.html'));
app.get(['/channel', '/channel.html'], page('channel.html'));
app.get(['/admin', '/admin.html'], page('admin.html'));
app.get('/api.js', page('api.js'));
app.get('/healthz', (req, res) => res.send('ok'));

app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

app.get('/api/videos', wrap(async (req, res) => {
  const { page, limit, q, ch } = req.query;
  const list = await store.list({ page, limit, q, ch });
  res.json(list.map(rowToApi));
}));

app.get('/api/videos/:id', wrap(async (req, res) => {
  const row = await store.get(parseInt(req.params.id, 10));
  if (!row) return res.status(404).json({ error: 'Video no encontrado' });
  res.json(rowToApi(row));
}));

app.post('/api/videos/:id/view', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id > 0) await store.view(id);
  res.json({ ok: true });
}));

app.get('/api/admin/check', admin, (req, res) => res.json({ ok: true }));

app.post('/api/videos', admin, wrap(async (req, res) => {
  const row = await store.create(clean(req.body));
  res.status(201).json(rowToApi(row));
}));

app.put('/api/videos/:id', admin, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const updated = await store.update(id, clean(req.body));
  if (!updated) return res.status(404).json({ error: 'Video no encontrado' });
  res.json(rowToApi(updated));
}));

app.delete('/api/videos/:id', admin, wrap(async (req, res) => {
  const ok = await store.remove(parseInt(req.params.id, 10));
  res.status(ok ? 200 : 404).json({ ok });
}));

const upload = multer({ dest: path.join(__dirname, 'tmp_uploads') });
app.post('/api/upload-thumbnail', admin, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Configura CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET en Render' });
  }

  try {
    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
    const result = await cloudinary.uploader.upload(req.file.path, { folder: 'vidlo' });
    fs.unlink(req.file.path, () => {});
    res.json({ url: result.secure_url });
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: 'Error al subir la imagen a Cloudinary: ' + err.message });
  }
});

app.post('/api/auth/register', wrap(async (req, res) => {
  const username = str(req.body.username, 30);
  const password = String(req.body.password || '');

  if (username.length < 3) return res.status(400).json({ error: 'El nombre de usuario debe tener al menos 3 caracteres' });
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

  const existing = await store.getUserByUsername(username);
  if (existing) return res.status(400).json({ error: 'El nombre de usuario ya está registrado' });

  const hash = await bcrypt.hash(password, 10);
  const user = await store.createUser(username, hash);
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });

  res.status(201).json({ token, user });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const username = str(req.body.username, 30);
  const password = String(req.body.password || '');

  const user = await store.getUserByUsername(username);
  if (!user) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, username: user.username } });
}));

app.get('/api/auth/me', requireAuth, wrap(async (req, res) => {
  const user = await store.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ user });
}));

app.get('/api/videos/:id/comments', wrap(async (req, res) => {
  const videoId = parseInt(req.params.id, 10);
  const comments = await store.getComments(videoId);
  res.json(comments);
}));

app.post('/api/videos/:id/comments', requireAuth, wrap(async (req, res) => {
  const videoId = parseInt(req.params.id, 10);
  const content = str(req.body.content, 1000);
  if (!content) return res.status(400).json({ error: 'El comentario no puede estar vacío' });

  const comment = await store.createComment(videoId, req.user.id, content);
  res.status(201).json(comment);
}));

app.delete('/api/comments/:id', requireAuth, wrap(async (req, res) => {
  const commentId = parseInt(req.params.id, 10);
  const comment = await store.getComment(commentId);
  if (!comment) return res.status(404).json({ error: 'Comentario no encontrado' });

  if (comment.user_id !== req.user.id) {
    return res.status(403).json({ error: 'No tienes permiso para eliminar este comentario' });
  }

  await store.removeComment(commentId);
  res.json({ ok: true });
}));

app.use((req, res) => res.status(404).send('No encontrado'));
app.use((err, req, res, next) => {
  if (err instanceof UserError) return res.status(400).json({ error: err.message });
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ error: 'Datos inválidos' });
  console.error(err);
  res.status(500).json({ error: 'Error del servidor' });
});

(async () => {
  await store.init();
  if (!(await store.count())) {
    for (const s of [...SEED].reverse()) await store.create(seedToVideo(s));
    console.log('Videos de ejemplo cargados');
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Vidlo listo en el puerto ${PORT} · almacenamiento: ${store.kind}`);
    if (!process.env.ADMIN_PASSWORD) console.warn('Aviso: define ADMIN_PASSWORD para poder usar el panel /admin.html');
  });
})().catch(e => { console.error(e); process.exit(1); });
