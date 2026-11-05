'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { analyze, normalise } = require('../lib/quiz');
const engine = require('../lib/engine');

const load = (name) => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/quizzes', name + '.json'), 'utf8'));
  const a = analyze(raw);
  assert.deepEqual(a.errors, []);
  return normalise(raw);
};
const optId = (step, text) => step.options.find((o) => o.text === text).id;

test('sample quizzes are valid and have multiple paths', () => {
  assert.equal(analyze(require('../data/quizzes/space-trivia.json')).stats.paths, 6);
  assert.equal(analyze(require('../data/quizzes/which-explorer.json')).stats.paths, 8);
});

test('public step never leaks correct answers or routing', () => {
  const s = engine.createSession(load('space-trivia'));
  engine.submit(s, undefined); // info → q1
  const json = JSON.stringify(engine.publicStep(s));
  assert.ok(!json.includes('correct"'));
  assert.ok(!json.includes('hard1'));
  assert.ok(!json.includes('explanation'));
});

test('correct first answer takes the hard route and scores through to the top ending', () => {
  const s = engine.createSession(load('space-trivia'));
  engine.submit(s, undefined);
  let r = engine.submit(s, optId(engine.publicStep(s), 'Mars'));
  assert.equal(r.feedback.correct, true);
  assert.equal(r.step.id, 'hard1');
  const step = r.step;
  r = engine.submit(s, ['Jupiter', 'Saturn', 'Neptune'].map((t) => optId(step, t)));
  assert.equal(r.feedback.correct, true);
  assert.equal(r.step.id, 'hard2');
  r = engine.submit(s, '  TITAN ');
  assert.equal(r.step.type, 'end');
  assert.equal(r.step.endId, 'end_commander');
  assert.equal(r.step.score, 5);
  assert.equal(r.step.correct, 3);
  assert.equal(r.step.scored, 3);
});

test('wrong first answer takes the easy route and caps at cadet', () => {
  const s = engine.createSession(load('space-trivia'));
  engine.submit(s, undefined);
  let r = engine.submit(s, optId(engine.publicStep(s), 'Venus'));
  assert.equal(r.feedback.correct, false);
  assert.equal(r.step.id, 'easy1');
  r = engine.submit(s, optId(r.step, 'Jupiter'));
  r = engine.submit(s, 'sun');
  assert.equal(r.step.endId, 'end_cadet');
  assert.equal(r.step.score, 2);
});

test('multi-choice needs the exact set', () => {
  const s = engine.createSession(load('space-trivia'));
  engine.submit(s, undefined);
  let r = engine.submit(s, optId(engine.publicStep(s), 'Mars'));
  r = engine.submit(s, ['Jupiter', 'Saturn'].map((t) => optId(r.step, t)));
  assert.equal(r.feedback.correct, false);
  assert.equal(r.feedback.points, 0);
});

test('personality quiz routes by tag counts and option-level next', () => {
  const quiz = load('which-explorer');
  const run = (picks) => {
    const s = engine.createSession(quiz);
    const visited = [];
    for (const p of picks) {
      const st = engine.publicStep(s);
      visited.push(st.id);
      engine.submit(s, optId(st, p));
    }
    return { s, visited };
  };
  const sea = run(['Out on the water at first light', 'A small sailing boat', 'A waterproof map', 'Not knowing what is over the horizon']);
  assert.equal(sea.s.end.id, 'end_sea');
  assert.deepEqual(sea.visited, ['q1', 'sea_extra', 'q2', 'q3']);
  const mix = run(['Sunrise on a mountain ridge', 'A waterproof map', 'Answering the biggest questions']);
  assert.equal(mix.s.end.id, 'end_wanderer');
  assert.deepEqual(mix.visited, ['q1', 'q2', 'q3']);
});

test('invalid answers are rejected without changing state', () => {
  const s = engine.createSession(load('space-trivia'));
  engine.submit(s, undefined);
  assert.throws(() => engine.submit(s, 'nope'), { status: 400 });
  assert.throws(() => engine.submit(s, ['0']), { status: 400 });
  assert.equal(s.answered, 0);
});

test('loops are cut off instead of hanging', () => {
  const raw = { id: 'loop', title: 'Loop', start: 'a', nodes: { a: { type: 'branch', rules: [{ goto: 'a' }] } } };
  const a = analyze(raw);
  assert.deepEqual(a.errors, []);
  const s = engine.createSession(normalise(raw));
  assert.equal(s.done, true);
});

test('validator reports broken references, duplicates and unreachable nodes', () => {
  const a = analyze({
    id: 'Bad Id', title: '', start: 'zzz',
    nodes: {
      q: { type: 'question', text: 'x', options: [{ text: 'a', next: 'ghost' }, { text: 'b', id: '0' }] },
      orphan: { type: 'end', title: 'x' },
      __proto__x: { type: 'end' },
    },
  });
  const joined = a.errors.join('\n');
  for (const needle of ['id:', 'title:', 'start:', 'ghost', 'duplicate option id', '__proto__x']) assert.ok(joined.includes(needle), needle);
  assert.equal(analyze({ id: 'ok', title: 't', start: 'e', nodes: { e: { type: 'end', title: 'x' }, o: { type: 'end', title: 'y' } } }).warnings.some((w) => w.includes('unreachable')), true);
});

test('prototype-pollution style input is rejected', () => {
  const raw = JSON.parse('{"id":"p","title":"t","start":"__proto__","nodes":{"__proto__":{"type":"end","title":"x"}}}');
  assert.ok(analyze(raw).errors.length > 0);
});
