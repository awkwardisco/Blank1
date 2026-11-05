'use strict';

const root = document.getElementById('admin');
const logoutBtn = document.getElementById('logout');
const TOKEN_KEY = 'quiz-admin-token';
const SVG = 'http://www.w3.org/2000/svg';

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'disabled' || k === 'checked') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

let token = '';
try { token = sessionStorage.getItem(TOKEN_KEY) || ''; } catch { /* storage unavailable */ }

async function api(path, { method = 'GET', body, login } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    if (!login) signOut('Your session expired or the token is wrong; sign in again.');
    throw new Error('Wrong admin token');
  }
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status, data });
  return data;
}

function signOut(message) {
  token = '';
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  logoutBtn.classList.add('hidden');
  loginView(typeof message === 'string' ? message : undefined);
}
logoutBtn.addEventListener('click', () => signOut());

const flash = (el, text, cls = 'error') => el.replaceChildren(text ? h('div', { class: cls, role: 'alert' }, text) : '');

// ---- login -------------------------------------------------------------------

function loginView(message) {
  const err = h('div', {});
  const input = h('input', { type: 'password', id: 'tok', autocomplete: 'current-password', placeholder: 'Admin token' });
  const form = h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault();
    token = input.value.trim();
    try {
      await api('/admin/quizzes', { login: true });
      try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
      logoutBtn.classList.remove('hidden');
      listView();
    } catch (ex) { token = ''; flash(err, ex.message); }
  } },
    h('h1', {}, 'Sign in'),
    h('p', { class: 'muted' }, 'Use the ADMIN_TOKEN you started the server with, or the token printed in the server console (also saved in data/admin-token).'),
    h('label', { for: 'tok' }, 'Admin token'), input, err,
    h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'submit' }, 'Sign in'))
  );
  root.replaceChildren(form);
  if (message) flash(err, message);
  input.focus();
}

// ---- list --------------------------------------------------------------------

const TEMPLATE = {
  id: 'my-quiz',
  title: 'My new quiz',
  description: 'One line shown on the quiz list.',
  published: true,
  settings: { showFeedback: true },
  start: 'q1',
  results: [
    { min: 0, title: 'Good try', text: 'Have another go.' },
    { min: 2, title: 'Well done', text: 'Great score.' },
  ],
  nodes: {
    q1: {
      type: 'question',
      text: 'First question?',
      options: [
        { text: 'Right answer', correct: true },
        { text: 'Wrong answer', next: 'q2_easy' },
      ],
      explanation: 'Shown after answering.',
      next: 'q2',
    },
    q2: { type: 'question', kind: 'text', text: 'Type "yes".', answers: ['yes'], next: 'done' },
    q2_easy: { type: 'info', title: 'Take the easy route', text: 'Wrong answers branch here.', next: 'done' },
    done: { type: 'end', title: 'All done', text: 'Thanks for playing.' },
  },
};

async function listView() {
  const msg = h('div', {});
  const body = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
  root.replaceChildren(
    h('div', { class: 'row spread' }, h('h1', {}, 'Quizzes'), h('button', { class: 'primary', onclick: () => editView(null) }, 'New quiz')),
    msg, body
  );
  try {
    const { quizzes } = await api('/admin/quizzes');
    if (!quizzes.length) return body.replaceChildren(h('p', { class: 'muted' }, 'No quizzes yet. Create one, or drop JSON files into data/quizzes/.'));
    body.replaceChildren(h('div', { class: 'card' }, h('table', { class: 'admin-list' },
      h('thead', {}, h('tr', {}, ['Quiz', 'Status', 'Nodes', 'Paths', 'Plays', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, quizzes.map((q) => h('tr', {},
        h('td', {}, h('strong', {}, q.title), h('div', { class: 'muted' }, q.id)),
        h('td', {},
          !q.valid ? h('span', { class: 'badge bad' }, `${q.errors} error${q.errors === 1 ? '' : 's'}`) : q.published ? h('span', { class: 'badge good' }, 'Published') : h('span', { class: 'badge warn' }, 'Draft'),
          q.valid && q.warnings ? h('span', { class: 'badge warn' }, `${q.warnings} warning${q.warnings === 1 ? '' : 's'}`) : null),
        h('td', {}, q.stats ? q.stats.nodes : '–'),
        h('td', {}, q.stats ? (q.stats.paths == null ? 'loops' : q.stats.paths) : '–'),
        h('td', {}, q.plays),
        h('td', { class: 'row' },
          h('button', { onclick: () => editView(q.id) }, 'Edit'),
          q.valid && h('button', { onclick: () => statsView(q.id) }, 'Stats'),
          q.valid && q.published && h('a', { class: 'btn', href: `/#/quiz/${q.id}`, target: '_blank', rel: 'noopener' }, 'Play'),
          h('button', { class: 'danger', onclick: async () => {
            if (!confirm(`Delete "${q.title}"? Its file is removed; recorded results stay on disk.`)) return;
            try { await api(`/admin/quizzes/${q.id}`, { method: 'DELETE' }); listView(); } catch (e) { flash(msg, e.message); }
          } }, 'Delete'))
      )))
    )));
  } catch (e) { if (token) flash(msg, e.message); }
}

// ---- editor ------------------------------------------------------------------

async function editView(id) {
  const msg = h('div', {});
  const issues = h('div', {});
  const graphBox = h('div', {});
  const text = h('textarea', { class: 'code', spellcheck: 'false', 'aria-label': 'Quiz JSON', autocomplete: 'off' });
  const saveBtn = h('button', { class: 'primary', disabled: true }, 'Save');
  let timer = null;
  let seq = 0;

  const setText = (obj) => { text.value = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2); validate(); };

  async function validate() {
    clearTimeout(timer);
    const mine = ++seq;
    let parsed;
    try { parsed = JSON.parse(text.value); } catch (e) {
      saveBtn.disabled = true;
      issues.replaceChildren(h('div', { class: 'error' }, 'Not valid JSON: ' + e.message));
      graphBox.replaceChildren();
      return;
    }
    try {
      const { analysis } = await api('/admin/validate', { method: 'POST', body: parsed });
      if (mine !== seq) return;
      showAnalysis(analysis);
    } catch (e) { if (mine === seq) flash(msg, e.message); }
  }

  function showAnalysis(a) {
    saveBtn.disabled = a.errors.length > 0;
    const s = a.stats;
    issues.replaceChildren(...[
      s && h('div', { class: 'statline' },
        h('span', { class: 'badge' }, `${s.nodes} nodes`), h('span', { class: 'badge' }, `${s.questions} questions`),
        h('span', { class: 'badge' }, `${s.branches} routers`), h('span', { class: 'badge' }, `${s.ends} endings`),
        h('span', { class: 'badge' }, s.paths == null ? 'has loops' : `${s.paths} distinct path${s.paths === 1 ? '' : 's'}`)),
      a.errors.length === 0 && h('div', { class: 'badge good' }, 'Valid; ready to save'),
      (a.errors.length || a.warnings.length) ? h('ul', { class: 'issues' },
        a.errors.map((m) => h('li', { class: 'e' }, m)), a.warnings.map((m) => h('li', { class: 'w' }, m))) : null
    ].filter(Boolean));
    graphBox.replaceChildren(a.graph.nodes.length ? h('div', {}, h('h2', {}, 'Path map'), drawGraph(a.graph), h('p', { class: 'muted' }, 'Solid lines go forward; dashed lines loop back. Dimmed boxes cannot be reached from the start. Hover a line for its condition.')) : '');
  }

  text.addEventListener('input', () => { saveBtn.disabled = true; clearTimeout(timer); timer = setTimeout(validate, 500); });

  const file = h('input', { type: 'file', accept: '.json,application/json', class: 'sr', id: 'file', onchange: async () => {
    const f = file.files[0];
    if (!f) return;
    if (f.size > 1024 * 1024) return flash(msg, 'File is larger than 1 MB');
    setText(await f.text());
    flash(msg, '');
    file.value = '';
  } });

  saveBtn.addEventListener('click', async () => {
    let quiz;
    try { quiz = JSON.parse(text.value); } catch (e) { return flash(msg, 'Not valid JSON'); }
    try {
      const res = await api(`/admin/quizzes/${encodeURIComponent(quiz.id)}`, { method: 'PUT', body: quiz });
      flash(msg, res.created ? `Created "${quiz.id}".` : `Saved "${quiz.id}".`, 'feedback right');
      if (res.created) { id = quiz.id; }
      showAnalysis(res.analysis);
    } catch (e) {
      flash(msg, e.message);
      if (e.data && e.data.analysis) showAnalysis(e.data.analysis);
    }
  });

  root.replaceChildren(
    h('div', { class: 'row spread' },
      h('h1', {}, id ? `Edit: ${id}` : 'New quiz'),
      h('div', { class: 'row' },
        h('label', { for: 'file', class: 'btn', style: null }, 'Load JSON file…'), file,
        h('button', { onclick: () => {
          try {
            const q = JSON.parse(text.value);
            const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(q, null, 2)], { type: 'application/json' })), download: `${q.id || 'quiz'}.json` });
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          } catch { flash(msg, 'Fix the JSON before downloading'); }
        } }, 'Download'),
        saveBtn,
        h('button', { onclick: listView }, 'Back'))),
    msg,
    h('div', { class: 'editor' },
      h('div', {}, text),
      h('div', {}, issues, graphBox,
        h('details', { class: 'help card' }, h('summary', {}, 'Format reference'), h('pre', {}, FORMAT_HELP)))
    )
  );

  if (id) {
    try {
      const res = await api(`/admin/quizzes/${id}`);
      if (res.quiz) setText(res.quiz);
      else { text.value = ''; showAnalysis(res.analysis); }
    } catch (e) { flash(msg, e.message); }
  } else setText(TEMPLATE);
}

const FORMAT_HELP = `{
  "id": "slug", "title": "…", "description": "…",
  "published": true,                     // false = draft
  "settings": { "showFeedback": true },  // false hides right/wrong reveal
  "start": "nodeId",
  "results": [{ "min": 0, "title": "…", "text": "…" }],   // score bands
  "nodes": {
    "q1": { "type": "question",
      "kind": "single | multi | text",   // default single
      "text": "…", "image": "https://…", "points": 1,
      "options": [{ "text": "…", "correct": true, "points": 2,
                    "tags": ["sea"], "next": "nodeId", "feedback": "…" }],
      "answers": ["for text questions"],
      "explanation": "…",
      "onCorrect": "id", "onIncorrect": "id", "next": "id" },
    "i1": { "type": "info", "title": "…", "text": "…", "next": "id" },
    "r1": { "type": "branch",
      "rules": [{ "if": { "scoreAtLeast": 3, "scoreBelow": 9, "correctAtLeast": 2,
                          "tags": { "sea": 2 }, "notTags": ["x"],
                          "visited": ["q1"], "notVisited": ["q2"] },
                  "goto": "id" }],
      "else": "id" },
    "e1": { "type": "end", "title": "…", "text": "…", "image": "…" }
  }
}
Routing order after a question: chosen option.next → onCorrect / onIncorrect → next.
All conditions inside one "if" must hold; the first matching rule wins.`;

// ---- path map ----------------------------------------------------------------

function drawGraph(g, counts) {
  const W = 168, H = 46, GX = 64, GY = 16, PAD = 12;
  const cols = new Map();
  for (const n of g.nodes) {
    const c = n.layer < 0 ? Math.max(0, ...g.nodes.map((x) => x.layer)) + 1 : n.layer;
    if (!cols.has(c)) cols.set(c, []);
    cols.get(c).push(n);
  }
  const pos = new Map();
  let maxRows = 1;
  for (const [c, list] of cols) {
    maxRows = Math.max(maxRows, list.length);
    list.forEach((n, i) => pos.set(n.id, { x: PAD + c * (W + GX), y: PAD + i * (H + GY), col: c }));
  }
  const width = PAD * 2 + cols.size * (W + GX) - GX;
  const height = PAD * 2 + maxRows * (H + GY) - GY;
  const root = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Quiz path map' });
  const seen = new Set();
  for (const e of g.edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) continue;
    const key = e.from + '>' + e.to + '>' + e.label;
    if (seen.has(key)) continue;
    seen.add(key);
    const back = b.col <= a.col;
    const x1 = a.x + W, y1 = a.y + H / 2;
    const x2 = b.x, y2 = b.y + H / 2;
    const d = back
      ? `M ${a.x + W / 2} ${a.y + H} C ${a.x + W / 2} ${a.y + H + 40}, ${b.x + W / 2} ${b.y + H + 40}, ${b.x + W / 2} ${b.y + H}`
      : `M ${x1} ${y1} C ${x1 + GX / 2} ${y1}, ${x2 - GX / 2} ${y2}, ${x2} ${y2}`;
    root.append(svg('path', { d, class: 'g-edge' + (back ? ' back' : '') }, svg('title', {}, `${e.from} → ${e.to}: ${e.label}`)));
  }
  for (const n of g.nodes) {
    const p = pos.get(n.id);
    const c = counts && counts[n.id] ? counts[n.id] : 0;
    const label = n.label.length > 26 ? n.label.slice(0, 25) + '…' : n.label;
    root.append(svg('g', { class: `g-node ${n.type}${n.start ? ' start' : ''}${n.layer < 0 ? ' dim' : ''}`, transform: `translate(${p.x},${p.y})` },
      svg('title', {}, `${n.id} (${n.type}): ${n.label}`),
      svg('rect', { width: W, height: H, rx: 8 }),
      svg('text', { class: 'id', x: 10, y: 17 }, (n.start ? '▶ ' : '') + n.id + (counts ? `  ·  ${c}×` : '')),
      svg('text', { x: 10, y: 34 }, label)));
  }
  return h('div', { class: 'graph-wrap' }, root);
}

// ---- stats -------------------------------------------------------------------

async function statsView(id) {
  const msg = h('div', {});
  const body = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
  root.replaceChildren(h('div', { class: 'row spread' }, h('h1', {}, `Stats: ${id}`), h('button', { onclick: listView }, 'Back')), msg, body);
  try {
    const { stats, graph, nodes } = await api(`/admin/stats/${id}`);
    const visits = {};
    for (const [n, a] of Object.entries(stats.answers)) visits[n] = Object.values(a).reduce((x, y) => x + y, 0);
    for (const [e, c] of Object.entries(stats.ends)) visits[e] = (visits[e] || 0) + c;
    const maxEnd = Math.max(1, ...Object.values(stats.ends));
    body.replaceChildren(...[
      h('div', { class: 'statline' }, h('span', { class: 'badge' }, `${stats.plays} completed play${stats.plays === 1 ? '' : 's'}`), h('span', { class: 'badge' }, `average score ${stats.avgScore.toFixed(1)}`)),
      stats.plays === 0 ? h('p', { class: 'muted' }, 'No completed plays yet. Finish a game to see results here.') : null,
      h('h2', {}, 'Where players ended up'),
      h('div', { class: 'card' }, h('table', { class: 'admin-list' }, h('tbody', {}, Object.entries(stats.ends).sort((a, b) => b[1] - a[1]).map(([e, c]) =>
        h('tr', {}, h('td', {}, (nodes[e] && nodes[e].text) || e), h('td', {}, c), h('td', {}, barOf(c, maxEnd))))))),
      h('h2', {}, 'Answers per question'),
      Object.entries(stats.answers).map(([n, a]) => {
        const total = Object.values(a).reduce((x, y) => x + y, 0);
        const info = nodes[n] || {};
        return h('div', { class: 'card' }, h('strong', {}, info.text || n), h('div', { class: 'muted' }, `${n} · ${total} answer${total === 1 ? '' : 's'}`),
          h('table', { class: 'admin-list' }, h('tbody', {}, Object.entries(a).sort((x, y) => y[1] - x[1]).map(([k, c]) =>
            h('tr', {}, h('td', {}, labelFor(info, k)), h('td', {}, `${c} (${Math.round((c / total) * 100)}%)`), h('td', {}, barOf(c, total)))))));
      }),
      h('h2', {}, 'Path map (visits)'),
      drawGraph(graph, visits)
    ].flat().filter(Boolean));
  } catch (e) { flash(msg, e.message); }
}
const barOf = (c, max) => { const b = h('div', { class: 'bar' }); b.style.width = Math.max(2, (c / max) * 100) + '%'; return h('div', { class: 'barwrap' }, b); };
function labelFor(info, key) {
  if (key === 'correct') return 'Correct';
  if (key === 'incorrect') return 'Incorrect';
  if (key === 'continue') return 'Continue';
  if (!info.options) return key;
  return key.split(',').map((k) => info.options[k] || k).join(', ');
}

// ---- boot --------------------------------------------------------------------

if (token) {
  api('/admin/quizzes', { login: true }).then(() => { logoutBtn.classList.remove('hidden'); listView(); }).catch(() => loginView());
} else loginView();
