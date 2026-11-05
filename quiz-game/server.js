'use strict';

/**
 * Quiz game server. Zero dependencies (Node ≥ 20).
 *
 *   PORT         default 3000
 *   HOST         default 127.0.0.1 (use 0.0.0.0 to expose on the network)
 *   DATA_DIR     default ./data   (quizzes/*.json, results.jsonl)
 *   ADMIN_TOKEN  admin password; if unset one is generated into DATA_DIR/admin-token
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Store } = require('./lib/store');
const { analyze } = require('./lib/quiz');
const engine = require('./lib/engine');
const { HttpError, httpError } = require('./lib/errors');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 1024 * 1024;
const SESSION_TTL = 2 * 60 * 60 * 1000;
const MAX_SESSIONS = 5000;

const store = new Store(DATA_DIR);
const sessions = new Map();

// ---- admin token -----------------------------------------------------------

function adminToken() {
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN;
  const file = path.join(DATA_DIR, 'admin-token');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const t = crypto.randomBytes(12).toString('hex');
    fs.writeFileSync(file, t + '\n', { mode: 0o600 });
    return t;
  }
}
const TOKEN = adminToken();

const failures = new Map(); // ip → { n, since }
function requireAdmin(req) {
  const ip = req.socket.remoteAddress || '';
  const f = failures.get(ip);
  if (f && Date.now() - f.since < 5 * 60 * 1000 && f.n >= 10) throw httpError(429, 'Too many failed attempts; try again in a few minutes');
  const header = req.headers.authorization || '';
  const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
  const want = Buffer.from(TOKEN);
  const ok = given.length === want.length && crypto.timingSafeEqual(given, want);
  if (!ok) {
    const cur = f && Date.now() - f.since < 5 * 60 * 1000 ? f : { n: 0, since: Date.now() };
    cur.n += 1;
    failures.set(ip, cur);
    throw httpError(401, 'Admin token required');
  }
  failures.delete(ip);
}

// ---- helpers -----------------------------------------------------------------

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf ? headers['Content-Type'] : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(httpError(413, 'Request body too large (max 1 MB)'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (size === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(httpError(400, 'Body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function getSession(sid) {
  const s = sessions.get(sid);
  if (!s) throw httpError(404, 'Game not found or expired; start a new one');
  return s;
}

function recordIfDone(s) {
  if (!s.done || s.recorded) return;
  s.recorded = true;
  store.appendResult({
    quizId: s.quizId,
    name: s.name,
    score: s.score,
    correct: s.correct,
    scored: s.scored,
    endId: s.end.id,
    path: s.path,
    ms: Date.now() - s.startedAt,
    at: new Date().toISOString(),
  });
}

setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL;
  for (const [id, s] of sessions) if (s.touchedAt < cutoff) sessions.delete(id);
}, 10 * 60 * 1000).unref();

// ---- API ---------------------------------------------------------------------

const routes = [];
const route = (method, pattern, handler, admin = false) => routes.push({ method, re: new RegExp(`^${pattern}$`), handler, admin });
const ID = '([a-z0-9][a-z0-9_-]{0,63})';

route('GET', '/api/quizzes', () => ({ quizzes: store.listPublic() }));

route('GET', `/api/quizzes/${ID}/leaderboard`, (ctx, id) => ({ leaderboard: store.leaderboard(id) }));

route('POST', `/api/quizzes/${ID}/sessions`, async (ctx, id) => {
  const e = store.load(id);
  if (!e || !e.quiz || e.quiz.published === false) throw httpError(404, 'Quiz not found');
  if (sessions.size >= MAX_SESSIONS) throw httpError(503, 'Server is busy; try again shortly');
  const body = await readJson(ctx.req);
  const s = engine.createSession(e.quiz, { name: typeof body.name === 'string' ? body.name : '' });
  sessions.set(s.id, s);
  recordIfDone(s);
  return { sessionId: s.id, quiz: { id, title: e.quiz.title }, step: engine.publicStep(s) };
});

route('GET', '/api/sessions/([0-9a-f-]{36})', (ctx, sid) => {
  const s = getSession(sid);
  return { sessionId: s.id, quiz: { id: s.quizId, title: s.quiz.title }, step: engine.publicStep(s) };
});

route('POST', '/api/sessions/([0-9a-f-]{36})/answer', async (ctx, sid) => {
  const s = getSession(sid);
  const body = await readJson(ctx.req);
  const out = engine.submit(s, body.answer);
  recordIfDone(s);
  return out;
});

// Admin
route('GET', '/api/admin/quizzes', () => ({ quizzes: store.listAdmin() }), true);

route(
  'GET',
  `/api/admin/quizzes/${ID}`,
  (ctx, id) => {
    const e = store.load(id);
    if (!e) throw httpError(404, 'Quiz not found');
    return { quiz: e.raw, analysis: e.analysis };
  },
  true
);

route(
  'POST',
  '/api/admin/validate',
  async (ctx) => ({ analysis: analyze(await readJson(ctx.req)) }),
  true
);

route(
  'PUT',
  `/api/admin/quizzes/${ID}`,
  async (ctx, id) => {
    const quiz = await readJson(ctx.req);
    const analysis = analyze(quiz);
    if (!analysis.errors.length && quiz.id !== id) analysis.errors.push(`id: "${quiz.id}" does not match the URL id "${id}"`);
    if (analysis.errors.length) throw httpError(422, 'Quiz is not valid', { analysis });
    const existed = !!store.load(id);
    store.save(id, quiz);
    return { saved: true, created: !existed, analysis };
  },
  true
);

route(
  'DELETE',
  `/api/admin/quizzes/${ID}`,
  (ctx, id) => {
    if (!store.remove(id)) throw httpError(404, 'Quiz not found');
    return { deleted: true };
  },
  true
);

route(
  'GET',
  `/api/admin/stats/${ID}`,
  (ctx, id) => {
    const e = store.load(id);
    if (!e) throw httpError(404, 'Quiz not found');
    return { stats: store.stats(id), graph: e.analysis.graph, nodes: Object.fromEntries(Object.entries((e.raw && e.raw.nodes) || {}).map(([k, n]) => [k, summarise(n)])) };
  },
  true
);

function summarise(n) {
  const options = n.kind === 'text' || !Array.isArray(n.options) ? undefined : Object.fromEntries(n.options.map((o, i) => [o.id === undefined ? String(i) : String(o.id), o.text]));
  return { type: n.type, text: n.type === 'question' ? n.text || '' : n.title || n.text || '', options };
}

// ---- static files ------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};
const CSP = "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, { error: 'Bad path' });
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'Not found' });
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Security-Policy': CSP, 'Cache-Control': 'no-cache' });
  });
}

// ---- server ------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        if (r.admin) requireAdmin(req);
        const out = await r.handler({ req, res, url }, ...m.slice(1));
        return send(res, 200, out);
      }
      const known = routes.some((r) => r.re.test(url.pathname));
      throw httpError(known ? 405 : 404, known ? 'Method not allowed' : 'Not found');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, 'Method not allowed');
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...(e.extra || {}) });
    console.error(e);
    return send(res, 500, { error: 'Internal server error' });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Quiz game:  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`);
    console.log(`Admin:      http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/admin.html`);
    console.log(process.env.ADMIN_TOKEN ? 'Admin token: from ADMIN_TOKEN' : `Admin token: ${TOKEN}  (stored in ${path.join(DATA_DIR, 'admin-token')})`);
  });
}

module.exports = { server };
