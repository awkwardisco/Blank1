'use strict';

/**
 * Game engine: pure functions over a normalised quiz and a session object.
 * The server keeps sessions in memory and never sends correct answers or
 * routing to the browser until after a question has been answered.
 */

const crypto = require('crypto');
const { httpError } = require('./errors');

const MAX_STEPS = 1000;
const MAX_TEXT_ANSWER = 300;

const norm = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

const countTag = (tags, t) => tags.reduce((n, x) => (x === t ? n + 1 : n), 0);
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function matches(cond, s) {
  if (!cond) return true;
  if (cond.scoreAtLeast != null && !(s.score >= cond.scoreAtLeast)) return false;
  if (cond.scoreBelow != null && !(s.score < cond.scoreBelow)) return false;
  if (cond.correctAtLeast != null && !(s.correct >= cond.correctAtLeast)) return false;
  if (cond.tags != null) {
    const need = Array.isArray(cond.tags) ? Object.fromEntries(cond.tags.map((t) => [t, 1])) : cond.tags;
    for (const [t, n] of Object.entries(need)) if (countTag(s.tags, t) < n) return false;
  }
  if (cond.notTags != null && [].concat(cond.notTags).some((t) => s.tags.includes(t))) return false;
  if (cond.visited != null && ![].concat(cond.visited).every((id) => s.visited.includes(id))) return false;
  if (cond.notVisited != null && [].concat(cond.notVisited).some((id) => s.visited.includes(id))) return false;
  return true;
}

function pickBand(quiz, score) {
  let band = null;
  for (const r of quiz.results) if (score >= r.min) band = r;
  return band;
}

function finish(quiz, s, endId) {
  const node = endId ? quiz.nodes[endId] : null;
  const band = pickBand(quiz, s.score);
  s.done = true;
  s.node = null;
  s.end = {
    id: endId || null,
    title: (node && node.title) || (band && band.title) || 'Quiz complete',
    text: (node && node.text) || (band && band.text) || '',
    image: (node && node.image) || null,
  };
}

/** Move the session to `id`, resolving invisible branch nodes on the way. */
function advance(quiz, s, id) {
  for (;;) {
    if (++s.steps > MAX_STEPS) return finish(quiz, s, null);
    if (id == null || !Object.prototype.hasOwnProperty.call(quiz.nodes, id)) return finish(quiz, s, null);
    const node = quiz.nodes[id];
    s.visited.push(id);
    if (node.type === 'branch') {
      const rule = (node.rules || []).find((r) => matches(r.if, s));
      id = rule ? rule.goto : node.else;
      continue;
    }
    if (node.type === 'end') return finish(quiz, s, id);
    s.node = id;
    return;
  }
}

function createSession(quiz, { name } = {}) {
  const s = {
    id: crypto.randomUUID(),
    quizId: quiz.id,
    quiz,
    name: name ? String(name).trim().slice(0, 30) : '',
    node: null,
    done: false,
    end: null,
    recorded: false,
    score: 0,
    correct: 0,
    scored: 0,
    answered: 0,
    tags: [],
    visited: [],
    path: [], // [{ n: nodeId, a: answerKey }] for statistics
    recap: [], // [{ q, a, correct }] shown on the result screen
    steps: 0,
    startedAt: Date.now(),
    touchedAt: Date.now(),
  };
  advance(quiz, s, quiz.start);
  return s;
}

/** What the browser may see for the session's current position. */
function publicStep(s) {
  const base = { answered: s.answered, score: s.score };
  if (s.done) {
    return {
      ...base,
      type: 'end',
      title: s.end.title,
      text: s.end.text,
      image: s.end.image,
      endId: s.end.id,
      correct: s.correct,
      scored: s.scored,
      recap: s.recap,
    };
  }
  const n = s.quiz.nodes[s.node];
  if (n.type === 'question') {
    return {
      ...base,
      type: 'question',
      id: s.node,
      kind: n.kind,
      text: n.text,
      image: n.image || null,
      options: n.kind === 'text' ? undefined : n.options.map((o) => ({ id: o.id, text: o.text, image: o.image || null })),
    };
  }
  return { ...base, type: 'info', id: s.node, title: n.title || '', text: n.text || '', image: n.image || null };
}

function evaluate(node, answer) {
  if (node.kind === 'single') {
    if (typeof answer !== 'string') throw httpError(400, 'Choose one option');
    const opt = node.options.find((o) => o.id === answer);
    if (!opt) throw httpError(400, 'Unknown option');
    const marked = node.options.some((o) => o.correct === true);
    const correct = marked ? opt.correct === true : null;
    const points = opt.points != null ? opt.points : correct ? (node.points != null ? node.points : 1) : 0;
    return { correct, points, tags: opt.tags || [], next: opt.next, key: opt.id, label: opt.text, optionFeedback: opt.feedback };
  }
  if (node.kind === 'multi') {
    if (!Array.isArray(answer) || answer.length === 0 || !answer.every((a) => typeof a === 'string')) {
      throw httpError(400, 'Choose at least one option');
    }
    const picked = [...new Set(answer)];
    const opts = picked.map((id) => node.options.find((o) => o.id === id));
    if (opts.some((o) => !o)) throw httpError(400, 'Unknown option');
    const want = node.options.filter((o) => o.correct === true).map((o) => o.id);
    const correct = want.length ? want.length === picked.length && want.every((id) => picked.includes(id)) : null;
    let points = correct ? (node.points != null ? node.points : 1) : 0;
    for (const o of opts) if (o.points != null) points += o.points;
    return {
      correct,
      points,
      tags: opts.flatMap((o) => o.tags || []),
      next: undefined,
      key: picked.slice().sort().join(','),
      label: opts.map((o) => o.text).join(', '),
    };
  }
  // text
  if (typeof answer !== 'string' || !answer.trim()) throw httpError(400, 'Type an answer');
  if (answer.length > MAX_TEXT_ANSWER) throw httpError(400, 'Answer is too long');
  const given = norm(answer);
  const correct = node.answers.some((a) => norm(a) === given);
  return {
    correct,
    points: correct ? (node.points != null ? node.points : 1) : 0,
    tags: [],
    next: undefined,
    key: correct ? 'correct' : 'incorrect',
    label: answer.trim(),
  };
}

/**
 * Submit the answer for the current node (or `undefined` for info nodes).
 * Returns { feedback, step }; mutates the session.
 */
function submit(s, answer) {
  if (s.done) throw httpError(409, 'This game has finished');
  const quiz = s.quiz;
  const node = quiz.nodes[s.node];
  s.touchedAt = Date.now();

  if (node.type === 'info') {
    s.path.push({ n: s.node, a: 'continue' });
    advance(quiz, s, node.next);
    return { feedback: null, step: publicStep(s) };
  }

  const r = evaluate(node, answer);
  s.score += r.points;
  s.answered += 1;
  s.tags.push(...r.tags);
  if (r.correct !== null) {
    s.scored += 1;
    if (r.correct) s.correct += 1;
  }
  s.path.push({ n: s.node, a: r.key });
  s.recap.push({ q: clip(node.text, 160), a: clip(r.label, 160), correct: r.correct });

  const feedback =
    quiz.settings.showFeedback === false
      ? null
      : {
          correct: r.correct,
          points: r.points,
          explanation: node.explanation || '',
          optionFeedback: r.optionFeedback || '',
          correctOptionIds: node.kind === 'text' ? undefined : node.options.filter((o) => o.correct === true).map((o) => o.id),
          correctAnswer: node.kind === 'text' && r.correct === false ? node.answers[0] : undefined,
        };

  let next = r.next;
  if (next === undefined && r.correct === true) next = node.onCorrect;
  if (next === undefined && r.correct === false) next = node.onIncorrect;
  if (next === undefined) next = node.next;
  advance(quiz, s, next);
  return { feedback, step: publicStep(s) };
}

module.exports = { createSession, publicStep, submit, matches, norm };
