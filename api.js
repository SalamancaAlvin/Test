/* Utilidades compartidas por index.html, watch.html y admin.html */

async function apiVideos(params = {}) {
  const query = new URLSearchParams(params).toString();
  const url = '/api/videos' + (query ? '?' + query : '');
  const r = await fetch(url);
  if (!r.ok) throw new Error('No se pudieron cargar los videos');
  return r.json();
}

function getToken() {
  try { return localStorage.getItem('vidlo-token') || ''; } catch (e) { return ''; }
}

function setToken(token) {
  try {
    if (token) localStorage.setItem('vidlo-token', token);
    else localStorage.removeItem('vidlo-token');
  } catch (e) {}
}

async function apiFetch(path, opts = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(path, { ...opts, headers });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Ocurrió un error en la solicitud');
  return d;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  const m = Math.floor(s / 60), h = Math.floor(s / 3600), d = Math.floor(s / 86400);
  if (m < 1) return 'hace un momento';
  if (h < 1) return `hace ${m} min`;
  if (d < 1) return `hace ${h} h`;
  if (d === 1) return 'hace un día';
  if (d < 7) return `hace ${d} días`;
  if (d < 14) return 'hace una semana';
  if (d < 30) return `hace ${Math.floor(d / 7)} semanas`;
  if (d < 60) return 'hace un mes';
  if (d < 365) return `hace ${Math.floor(d / 30)} meses`;
  const y = Math.floor(d / 365);
  return y === 1 ? 'hace un año' : `hace ${y} años`;
}

function fmtViews(n) {
  n = Number(n) || 0;
  if (n < 1000) return String(n);
  if (n < 1e6) return Math.round(n / 1000) + ' mil';
  return (n / 1e6).toFixed(1).replace('.', ',') + ' M';
}

const vidloHues = [262, 215, 160, 20, 330, 190, 45, 290];
function vidloArt(i, ang = 135) {
  const h = vidloHues[Math.abs(i) % vidloHues.length];
  return `background:linear-gradient(${ang}deg,hsl(${h} 70% 45%),hsl(${(h + 50) % 360} 75% 28%) 60%,hsl(${(h + 90) % 360} 60% 15%))`;
}
function vidloBg(v, ang = 135) {
  if (v && v.thumb) {
    const safe = v.thumb.replace(/['"\\\n]/g, c => encodeURIComponent(c));
    return `background:#000 url('${safe}') center/cover no-repeat`;
  }
  return vidloArt((v && v.id) || 0, ang);
}
