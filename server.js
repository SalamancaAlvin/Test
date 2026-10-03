/* Vidlo – servidor
   - Sirve las páginas (index, watch, admin) y una API JSON de videos.
   - Guarda los datos en Postgres si existe DATABASE_URL; si no, en memoria (para probar en tu equipo).
   - Para agregar o borrar videos hace falta la contraseña ADMIN_PASSWORD. */
const express = require('express');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

class UserError extends Error {}

/* ---------- Enlaces de video ---------- */
function normSrc(link) {
  link = String(link || '').trim();
  if (!link) return [];
  let u;
  try { u = new URL(link); } catch { throw new UserError('El enlace del video no es válido'); }
  if (u.protocol !== 'https:') throw new UserError('El enlace del video debe empezar con https://');
  const host = u.hostname.replace(/^www\./, '');

  if (host === 'mega.nz' || host === 'mega.co.nz') {
    let id, key;
    let m = u.pathname.match(/^\/(?:file|embed)\/([\w-]+)$/);
    if (m && u.hash.length > 1) { id = m[1]; key = u.hash.slice(1); }
    else { m = u.hash.match(/^#!([\w-]+)!([\w-]+)$/); if (m) { id = m[1]; key = m[2]; } }
    if (!id || !key) throw new UserError('Enlace de Mega no reconocido. Usa el enlace del archivo con su clave (lleva un # al final).');
    return [{ n: 'Mega', embed: `https://mega.nz/embed/${id}#${key}`, dl: `https://mega.nz/file/${id}#${key}` }];
  }

  if (['youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) {
    let id = host === 'youtu.be' ? u.pathname.slice(1)
      : u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})/) || [])[1];
    if (!/^[\w-]{11}$/.test(id || '')) throw new UserError('Enlace de YouTube no reconocido');
    return [{ n: 'YouTube', embed: `https://www.youtube.com/embed/${id}`, dl: '' }];
  }

  return [{ n: 'Enlace', embed: u.href, dl: '' }];
}

/* ---------- Validación de lo que escribe el administrador ---------- */
const str = (x, max) => String(x == null ? '' : x).trim().slice(0, max);
function httpsUrl(x, label) {
  x = str(x, 500);
  if (!x) return '';
  let u;
  try { u = new URL(x); } catch { throw new UserError(`${label} no es un enlace válido`); }
  if (u.protocol !== 'https:') throw new UserError(`${label} debe empezar con https://`);
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
  return {
    title, ch, tags,
    dur: str(b.dur, 12), cat: str(b.cat, 40),
    year: year >= 1900 && year <= 2100 ? year : null,
    desc: str(b.desc, 2000),
    thumb: httpsUrl(b.thumb, 'La miniatura'),
    rating: str(b.rating, 6), votes: str(b.votes, 20),
    src: normSrc(b.link)
  };
}

/* ---------- Datos de ejemplo (solo se cargan si no hay videos) ---------- */
const MEGA = 'https://mega.nz/file/MnoChCpQ#S63JRkBV3kcc90w1aQnsEMjohfR6aaIHbbY-ieNnnmc';
const SEED = [
  { title: 'Cómo editar tu primer video en 15 minutos', ch: 'Taller Creativo', dur: '12:34', cat: 'Tutorial', year: 2026, views: 1200000, days: 1, link: MEGA,
    tags: ['Edición', 'Principiantes', 'Software'], rating: '8.73', votes: '1,204',
    desc: 'Un recorrido paso a paso por el proceso de edición: importar el material, ordenar las tomas, cortar con ritmo, agregar música y exportar el resultado final. Pensado para quien nunca ha abierto un editor de video y quiere terminar su primer proyecto hoy mismo, sin instalar nada extra.' },
  { title: 'Guía real para fotografiar de noche', ch: 'Lente Abierto', dur: '08:12', cat: 'Tutorial', year: 2026, views: 640000, days: 3,
    tags: ['Fotografía', 'Noche'], rating: '8.10', votes: '532',
    desc: 'Ajustes de cámara, trípode, enfoque manual y edición básica para conseguir fotos nítidas con poca luz, tanto con cámara como con el teléfono.' },
  { title: 'Probamos 5 micrófonos económicos', ch: 'Audio Lab', dur: '21:07', cat: 'Reseña', year: 2026, views: 980000, days: 3,
    tags: ['Audio', 'Equipo', 'Comparativa'], rating: '8.55', votes: '2,310',
    desc: 'Grabamos la misma frase con cinco micrófonos de menos de 50 dólares, en la misma habitación y con los mismos ajustes, para que puedas escuchar la diferencia real.' },
  { title: 'Historia corta de los videojuegos', ch: 'Pixel Archivo', dur: '17:45', cat: 'Documental', year: 2025, views: 870000, days: 4,
    tags: ['Juegos', 'Historia'], rating: '9.01', votes: '1,876',
    desc: 'De los primeros experimentos en laboratorios a las consolas modernas: los momentos y las personas que definieron cómo jugamos hoy.' },
  { title: 'Aprende guitarra con tres acordes', ch: 'Casa de Música', dur: '10:02', cat: 'Tutorial', year: 2026, views: 512000, days: 5,
    tags: ['Música', 'Guitarra', 'Principiantes'], rating: '8.32', votes: '744',
    desc: 'Tres acordes, un ritmo sencillo y cuatro canciones para practicar. Sin teoría complicada: solo manos a la obra desde el primer minuto.' },
  { title: 'Un día en un taller de cerámica', ch: 'Manos a la obra', dur: '06:58', cat: 'Vlog', year: 2026, views: 210000, days: 6,
    tags: ['Artesanía', 'Cerámica'], rating: '8.88', votes: '298',
    desc: 'Acompañamos a una ceramista durante una jornada completa: del barro crudo al horno, sin prisa y sin música de fondo.' },
  { title: 'Por qué se hunden las ciudades', ch: 'Mapa Mundi', dur: '14:20', cat: 'Documental', year: 2026, views: 1500000, days: 7,
    tags: ['Ciencia', 'Ciudades'], rating: '9.12', votes: '3,402',
    desc: 'El suelo bajo algunas de las grandes ciudades del mundo está descendiendo. Revisamos las causas, los datos y lo que se está haciendo al respecto.' },
  { title: 'Montaje de un estudio en casa', ch: 'Taller Creativo', dur: '19:33', cat: 'Vlog', year: 2025, views: 430000, days: 7,
    tags: ['Estudio', 'Equipo', 'Tutorial'], rating: '8.46', votes: '615',
    desc: 'Cómo transformamos una habitación vacía en un estudio de grabación funcional: acústica, iluminación, cableado y presupuesto final.' }
];
const seedToVideo = s => ({
  title: s.title, ch: s.ch, dur: s.dur, cat: s.cat, year: s.year, tags: s.tags, desc: s.desc, thumb: '',
  rating: s.rating, votes: s.votes, views: s.views, src: s.link ? normSrc(s.link) : [],
  created: new Date(Date.now() - s.days * 864e5)
});

/* ---------- Almacenamiento ---------- */
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
      await pool.query(`CREATE TABLE IF NOT EXISTS videos (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL, ch TEXT NOT NULL,
        dur TEXT DEFAULT '', cat TEXT DEFAULT '', year INT,
        tags JSONB DEFAULT '[]', descr TEXT DEFAULT '', thumb TEXT DEFAULT '',
        rating TEXT DEFAULT '', votes TEXT DEFAULT '', views INT DEFAULT 0,
        src JSONB DEFAULT '[]', created_at TIMESTAMPTZ DEFAULT now())`);
    },
    async count() { return (await pool.query('SELECT COUNT(*)::int AS c FROM videos')).rows[0].c; },
    async list() { return (await pool.query('SELECT * FROM videos ORDER BY id DESC')).rows; },
    async create(v) {
      const r = toRow(v);
      return (await pool.query(
        `INSERT INTO videos (title,ch,dur,cat,year,tags,descr,thumb,rating,votes,views,src,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [r.title, r.ch, r.dur, r.cat, r.year, JSON.stringify(r.tags), r.descr, r.thumb, r.rating, r.votes, r.views, JSON.stringify(r.src), r.created_at]
      )).rows[0];
    },
    async remove(id) { return (await pool.query('DELETE FROM videos WHERE id=$1', [id])).rowCount > 0; },
    async view(id) { await pool.query('UPDATE videos SET views = views + 1 WHERE id=$1', [id]); }
  };
}

function memStore() {
  const rows = []; let next = 1;
  return {
    kind: 'memoria (se borra al reiniciar)',
    async init() {},
    async count() { return rows.length; },
    async list() { return [...rows].sort((a, b) => b.id - a.id); },
    async create(v) { const r = { id: next++, ...toRow(v) }; rows.push(r); return r; },
    async remove(id) { const i = rows.findIndex(r => r.id === id); if (i < 0) return false; rows.splice(i, 1); return true; },
    async view(id) { const r = rows.find(x => x.id === id); if (r) r.views++; }
  };
}

const store = DATABASE_URL ? pgStore(DATABASE_URL) : memStore();

/* ---------- Seguridad del panel ---------- */
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

/* ---------- App ---------- */
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// Solo se publican estas páginas (el resto de archivos del proyecto no se expone)
const page = f => (req, res) => res.sendFile(path.join(__dirname, f));
app.get(['/', '/index.html'], page('index.html'));
app.get(['/watch', '/watch.html'], page('watch.html'));
app.get(['/admin', '/admin.html'], page('admin.html'));
app.get('/api.js', page('api.js'));
app.get('/healthz', (req, res) => res.send('ok'));

app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

app.get('/api/videos', wrap(async (req, res) => res.json((await store.list()).map(rowToApi))));

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

app.delete('/api/videos/:id', admin, wrap(async (req, res) => {
  const ok = await store.remove(parseInt(req.params.id, 10));
  res.status(ok ? 200 : 404).json({ ok });
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
