'use strict';

const app = document.getElementById('app');
const STORE_KEY = 'quiz-session';

/** Tiny DOM helper. All text goes in via text nodes, so quiz content can never inject HTML. */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'disabled' || k === 'checked' || k === 'autofocus') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
  return data;
}

const save = (v) => {
  try { v ? sessionStorage.setItem(STORE_KEY, JSON.stringify(v)) : sessionStorage.removeItem(STORE_KEY); } catch { /* storage unavailable */ }
};
const load = () => {
  try { return JSON.parse(sessionStorage.getItem(STORE_KEY)); } catch { return null; }
};

let keyHandler = null;
function mount(...nodes) {
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = null;
  app.replaceChildren(...nodes.filter(Boolean));
  window.scrollTo(0, 0);
}
function onKeys(fn) {
  keyHandler = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA)$/.test(e.target.tagName) && e.key !== 'Enter') return;
    fn(e);
  };
  document.addEventListener('keydown', keyHandler);
}
const showError = (e) =>
  mount(h('div', { class: 'error', role: 'alert' }, e.message || 'Something went wrong'), h('a', { class: 'btn', href: '#/' }, 'Back to quizzes'));

// ---- views -------------------------------------------------------------------

async function home() {
  save(null);
  mount(h('p', { class: 'muted' }, 'Loading…'));
  const { quizzes } = await api('/quizzes');
  if (!quizzes.length) {
    return mount(h('h1', {}, 'No quizzes yet'), h('p', { class: 'muted' }, 'Load one from the '), h('a', { href: '/admin.html' }, 'admin page'));
  }
  mount(
    h('h1', {}, 'Choose a quiz'),
    h('div', { class: 'grid' },
      quizzes.map((q) =>
        h('button', { class: 'card quiz-card', onclick: () => (location.hash = `#/quiz/${q.id}`) },
          h('h3', {}, q.title),
          q.description && h('p', {}, q.description),
          h('span', { class: 'badge' }, `${q.questions} question${q.questions === 1 ? '' : 's'}`)
        )
      )
    )
  );
}

async function intro(id) {
  const { quizzes } = await api('/quizzes');
  const q = quizzes.find((x) => x.id === id);
  if (!q) throw new Error('Quiz not found');
  const name = h('input', { type: 'text', id: 'pname', maxlength: 30, autocomplete: 'nickname', placeholder: 'Optional; shown on the leaderboard' });
  const start = async (e) => {
    e.preventDefault();
    const res = await api(`/quizzes/${id}/sessions`, { method: 'POST', body: { name: name.value } });
    save({ sessionId: res.sessionId, quizId: id });
    render(res.sessionId, id, res.step);
  };
  mount(
    h('div', { class: 'card' },
      h('h1', {}, q.title),
      q.description && h('p', { class: 'muted' }, q.description),
      h('form', { onsubmit: (e) => start(e).catch(showError) },
        h('label', { for: 'pname' }, 'Your name'),
        name,
        h('div', { class: 'actions' },
          h('button', { class: 'primary', type: 'submit' }, 'Start quiz'),
          h('a', { class: 'btn', href: '#/' }, 'Back')
        )
      )
    )
  );
  name.focus();
}

async function resumeOrIntro(id) {
  const saved = load();
  if (saved && saved.quizId === id) {
    try {
      const res = await api(`/sessions/${saved.sessionId}`);
      return render(saved.sessionId, id, res.step);
    } catch { save(null); }
  }
  return intro(id);
}

function hud(step) {
  return h('div', { class: 'hud' },
    h('span', {}, step.type === 'end' ? 'Finished' : `Question ${step.answered + (step.type === 'question' ? 1 : 0) || 1}`),
    h('span', {}, `Score: ${step.score}`)
  );
}

function render(sid, quizId, step) {
  if (step.type === 'end') return renderEnd(sid, quizId, step);
  if (step.type === 'info') return renderInfo(sid, quizId, step);
  return renderQuestion(sid, quizId, step);
}

function renderInfo(sid, quizId, step) {
  const go = async () => {
    btn.disabled = true;
    const res = await api(`/sessions/${sid}/answer`, { method: 'POST', body: {} });
    render(sid, quizId, res.step);
  };
  const btn = h('button', { class: 'primary', onclick: () => go().catch(showError) }, 'Continue');
  mount(
    hud(step),
    h('div', { class: 'card' },
      step.image && h('img', { class: 'qimg', src: step.image, alt: '' }),
      step.title && h('h1', {}, step.title),
      step.text && h('p', {}, step.text),
      h('div', { class: 'actions' }, btn)
    )
  );
  btn.focus();
  onKeys((e) => { if (e.key === 'Enter') btn.click(); });
}

function renderQuestion(sid, quizId, step, result) {
  // `result` is set once the answer has been submitted: { feedback, next, chosen }
  const locked = !!result;
  const chosen = new Set(result ? result.chosen : []);
  const right = new Set((result && result.feedback && result.feedback.correctOptionIds) || []);
  let sending = false;

  const submit = async (answer, chosenIds) => {
    if (sending || locked) return;
    sending = true;
    document.querySelectorAll('button, input').forEach((el) => (el.disabled = true));
    const res = await api(`/sessions/${sid}/answer`, { method: 'POST', body: { answer } });
    if (res.feedback) renderQuestion(sid, quizId, step, { feedback: res.feedback, next: res.step, chosen: chosenIds });
    else render(sid, quizId, res.step);
  };
  const wrap = (fn) => () => fn().catch((e) => { sending = false; showError(e); });

  let body;
  let focusEl = null;
  let keys = null;
  if (step.kind === 'text') {
    const input = h('input', { type: 'text', id: 'answer', maxlength: 300, autocomplete: 'off', 'aria-label': 'Your answer', disabled: locked, value: result ? result.chosen[0] : null });
    if (result) input.value = result.chosen[0];
    const go = h('button', { class: 'primary', disabled: locked, onclick: wrap(() => (input.value.trim() ? submit(input.value, [input.value]) : Promise.resolve())) }, 'Submit');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
    body = h('div', {}, input, !locked && h('div', { class: 'actions' }, go));
    focusEl = locked ? null : input;
  } else if (step.kind === 'multi') {
    const boxes = step.options.map((o, i) => {
      const cb = h('input', { type: 'checkbox', value: o.id, checked: chosen.has(o.id), disabled: locked });
      const cls = ['option', locked && 'locked', locked && right.has(o.id) && 'right', locked && chosen.has(o.id) && !right.has(o.id) && 'wrong'];
      return h('label', { class: cls.filter(Boolean).join(' '), 'data-key': i + 1 }, cb, h('span', {}, o.text));
    });
    const go = h('button', { class: 'primary', disabled: locked, onclick: wrap(() => {
      const ids = [...document.querySelectorAll('.option input:checked')].map((c) => c.value);
      return ids.length ? submit(ids, ids) : Promise.resolve();
    }) }, 'Submit');
    body = h('div', {}, h('div', { class: 'options', role: 'group', 'aria-label': 'Options' }, boxes), !locked && h('div', { class: 'actions' }, go));
    if (!locked) {
      keys = (e) => {
        const n = Number(e.key);
        if (n >= 1 && n <= boxes.length) { const cb = boxes[n - 1].querySelector('input'); cb.checked = !cb.checked; }
        else if (e.key === 'Enter') go.click();
      };
    }
  } else {
    const buttons = step.options.map((o, i) => {
      const cls = ['option', locked && 'locked', locked && right.has(o.id) && 'right', locked && chosen.has(o.id) && !right.has(o.id) && right.size && 'wrong', locked && chosen.has(o.id) && !right.size && 'selected'];
      return h('button', { class: cls.filter(Boolean).join(' '), type: 'button', disabled: locked, onclick: wrap(() => submit(o.id, [o.id])) },
        h('span', { class: 'key', 'aria-hidden': 'true' }, i + 1), h('span', {}, o.text));
    });
    body = h('div', { class: 'options' }, buttons);
    if (!locked) keys = (e) => { const n = Number(e.key); if (n >= 1 && n <= buttons.length) buttons[n - 1].click(); };
  }

  let fb = null;
  let cont = null;
  if (locked) {
    const f = result.feedback;
    const kind = f.correct === true ? 'right' : f.correct === false ? 'wrong' : 'neutral';
    fb = h('div', { class: `feedback ${kind}`, role: 'status' },
      h('strong', {}, f.correct === true ? `Correct! +${f.points}` : f.correct === false ? (f.points ? `Not quite. +${f.points}` : 'Not quite.') : f.points ? `+${f.points}` : 'Answer recorded'),
      f.correctAnswer && h('p', {}, `Accepted answer: ${f.correctAnswer}`),
      f.optionFeedback && h('p', {}, f.optionFeedback),
      f.explanation && h('p', {}, f.explanation)
    );
    cont = h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => render(sid, quizId, result.next) }, result.next.type === 'end' ? 'See result' : 'Continue'));
    keys = (e) => { if (e.key === 'Enter') cont.firstChild.click(); };
  }

  mount(
    hud(locked ? { ...step, score: result.next.score, answered: result.next.answered } : step),
    h('div', { class: 'card' },
      step.image && h('img', { class: 'qimg', src: step.image, alt: '' }),
      h('h1', { class: 'question' }, step.text),
      body, fb, cont
    )
  );
  if (keys) onKeys(keys);
  if (focusEl) focusEl.focus();
  if (cont) cont.firstChild.focus();
}

async function renderEnd(sid, quizId, step) {
  save(null);
  const board = h('div', {});
  mount(
    hud(step),
    h('div', { class: 'card' },
      step.image && h('img', { class: 'qimg', src: step.image, alt: '' }),
      h('p', { class: 'muted' }, 'Your result'),
      h('h1', {}, step.title),
      step.text && h('p', {}, step.text),
      h('p', {}, h('span', { class: 'score-big' }, step.score), ' points', step.scored ? h('span', { class: 'muted' }, `  ·  ${step.correct} of ${step.scored} correct`) : null),
      h('div', { class: 'actions' },
        h('button', { class: 'primary', onclick: () => { location.hash = '#/quiz/' + quizId; route(); } }, 'Play again'),
        h('a', { class: 'btn', href: '#/' }, 'All quizzes')
      )
    ),
    step.recap.length > 0 && h('div', { class: 'card' },
      h('h2', {}, 'Your answers'),
      h('ul', { class: 'recap' }, step.recap.map((r) =>
        h('li', {},
          h('span', { class: `mark ${r.correct === true ? 'right' : r.correct === false ? 'wrong' : ''}`, 'aria-label': r.correct === true ? 'correct' : r.correct === false ? 'incorrect' : 'answered' }, r.correct === true ? '✓' : r.correct === false ? '✗' : '•'),
          h('span', {}, r.q, h('small', {}, r.a))
        )))
    ),
    board
  );
  try {
    const { leaderboard } = await api(`/quizzes/${quizId}/leaderboard`);
    if (leaderboard.length) {
      board.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Leaderboard'),
        h('table', { class: 'board' }, h('thead', {}, h('tr', {}, h('th', {}, 'Player'), h('th', {}, 'Score'))),
          h('tbody', {}, leaderboard.map((r) => h('tr', {}, h('td', {}, r.name), h('td', {}, r.score)))))));
    }
  } catch { /* leaderboard is optional */ }
}

// ---- routing -----------------------------------------------------------------

function route() {
  const m = /^#\/quiz\/([a-z0-9][a-z0-9_-]*)$/.exec(location.hash);
  const task = m ? resumeOrIntro(m[1]) : home();
  task.catch(showError);
}
window.addEventListener('hashchange', route);
route();
