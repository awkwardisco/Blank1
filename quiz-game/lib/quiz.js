'use strict';

/**
 * Quiz definition: validation, normalisation and graph analysis.
 *
 * A quiz is a graph of nodes. Node types:
 *   question  – single / multi / text; routes via option.next, onCorrect, onIncorrect, next
 *   info      – a screen with a Continue button; routes via next
 *   branch    – invisible router; first matching rule wins, else `else`
 *   end       – a result screen
 */

const QUIZ_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
// Must start alphanumeric so ids like "__proto__" are impossible.
const NODE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TYPES = ['question', 'info', 'branch', 'end'];
const KINDS = ['single', 'multi', 'text'];
const COND_KEYS = ['scoreAtLeast', 'scoreBelow', 'correctAtLeast', 'tags', 'notTags', 'visited', 'notVisited'];
const MAX_NODES = 500;
const MAX_OPTIONS = 12;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const nonEmpty = (v) => isStr(v) && v.trim() !== '';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const clip = (s, n = 40) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

function describeCond(c) {
  if (!isObj(c) || Object.keys(c).length === 0) return 'always';
  const parts = [];
  if (c.scoreAtLeast != null) parts.push(`score ≥ ${c.scoreAtLeast}`);
  if (c.scoreBelow != null) parts.push(`score < ${c.scoreBelow}`);
  if (c.correctAtLeast != null) parts.push(`correct ≥ ${c.correctAtLeast}`);
  if (c.tags != null) {
    const t = Array.isArray(c.tags) ? c.tags.map((x) => [x, 1]) : Object.entries(c.tags);
    parts.push(t.map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).join(' & '));
  }
  if (c.notTags != null) parts.push('not ' + [].concat(c.notTags).join(', '));
  if (c.visited != null) parts.push('visited ' + [].concat(c.visited).join(', '));
  if (c.notVisited != null) parts.push('not visited ' + [].concat(c.notVisited).join(', '));
  return parts.join(', ');
}

/** Outgoing routes of a node as [{to, label}] (targets are not checked for existence). */
function edgesOf(node) {
  const out = [];
  const add = (to, label) => {
    if (isStr(to) && to) out.push({ to, label });
  };
  if (!isObj(node)) return out;
  switch (node.type) {
    case 'question':
      if (node.kind !== 'text' && Array.isArray(node.options)) {
        node.options.forEach((o) => isObj(o) && add(o.next, clip(o.text, 24)));
      }
      add(node.onCorrect, 'correct');
      add(node.onIncorrect, 'incorrect');
      add(node.next, 'default');
      break;
    case 'info':
      add(node.next, 'continue');
      break;
    case 'branch':
      if (Array.isArray(node.rules)) node.rules.forEach((r) => isObj(r) && add(r.goto, describeCond(r.if)));
      add(node.else, 'otherwise');
      break;
    default:
  }
  return out;
}

function nodeLabel(node) {
  if (!isObj(node)) return '?';
  switch (node.type) {
    case 'question':
      return clip(node.text, 34);
    case 'info':
      return clip(node.title || node.text, 34);
    case 'branch':
      return 'router';
    case 'end':
      return clip(node.title || node.text || 'End', 34);
    default:
      return '?';
  }
}

function validateCondition(cond, where, nodes, err) {
  if (cond === undefined) return;
  if (!isObj(cond)) return err(`${where}: "if" must be an object`);
  for (const k of Object.keys(cond)) {
    if (!COND_KEYS.includes(k)) err(`${where}: unknown condition "${k}" (allowed: ${COND_KEYS.join(', ')})`);
  }
  for (const k of ['scoreAtLeast', 'scoreBelow', 'correctAtLeast']) {
    if (cond[k] !== undefined && !isNum(cond[k])) err(`${where}: ${k} must be a number`);
  }
  if (cond.tags !== undefined) {
    const t = cond.tags;
    const ok =
      (Array.isArray(t) && t.every(nonEmpty)) ||
      (isObj(t) && Object.values(t).every((n) => Number.isInteger(n) && n >= 1));
    if (!ok) err(`${where}: tags must be a list of tag names or an object like {"sea": 2}`);
  }
  if (cond.notTags !== undefined && !(isStr(cond.notTags) || (Array.isArray(cond.notTags) && cond.notTags.every(isStr)))) {
    err(`${where}: notTags must be a tag name or a list of tag names`);
  }
  for (const k of ['visited', 'notVisited']) {
    if (cond[k] === undefined) continue;
    const ids = [].concat(cond[k]);
    if (!ids.every(isStr)) err(`${where}: ${k} must be a node id or a list of node ids`);
    else ids.filter((id) => !has(nodes, id)).forEach((id) => err(`${where}: ${k} refers to unknown node "${id}"`));
  }
}

/**
 * Validate and analyse a quiz definition.
 * Returns { errors: string[], warnings: string[], stats, graph }.
 * `graph` is only meaningful when the structure is sound enough to draw.
 */
function analyze(quiz) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);
  const result = () => ({ errors, warnings, stats: null, graph: { nodes: [], edges: [] } });

  if (!isObj(quiz)) {
    err('The quiz must be a JSON object');
    return result();
  }
  if (!isStr(quiz.id) || !QUIZ_ID_RE.test(quiz.id)) {
    err('id: required; lowercase letters, digits, "-" or "_" (max 64 chars, must start with a letter or digit)');
  }
  if (!nonEmpty(quiz.title)) err('title: required');
  for (const k of ['description']) {
    if (quiz[k] !== undefined && !isStr(quiz[k])) err(`${k}: must be text`);
  }
  if (quiz.published !== undefined && typeof quiz.published !== 'boolean') err('published: must be true or false');
  if (quiz.settings !== undefined) {
    if (!isObj(quiz.settings)) err('settings: must be an object');
    else if (quiz.settings.showFeedback !== undefined && typeof quiz.settings.showFeedback !== 'boolean') {
      err('settings.showFeedback: must be true or false');
    }
  }
  if (quiz.results !== undefined) {
    if (!Array.isArray(quiz.results)) err('results: must be a list of { min, title, text }');
    else {
      quiz.results.forEach((r, i) => {
        if (!isObj(r) || !isNum(r.min)) err(`results[${i}]: needs a numeric "min"`);
        else if (!nonEmpty(r.title) && !nonEmpty(r.text)) err(`results[${i}]: needs a title or text`);
      });
    }
  }

  if (!isObj(quiz.nodes) || Object.keys(quiz.nodes).length === 0) {
    err('nodes: required; an object of node id → node');
    return result();
  }
  const nodes = quiz.nodes;
  const ids = Object.keys(nodes);
  if (ids.length > MAX_NODES) err(`nodes: too many (max ${MAX_NODES})`);
  if (!isStr(quiz.start) || !has(nodes, quiz.start)) err('start: must be the id of an existing node');

  const route = (where, to) => {
    if (to === undefined) return;
    if (!isStr(to) || !has(nodes, to)) err(`${where}: points to unknown node ${JSON.stringify(to)}`);
  };

  for (const id of ids) {
    const n = nodes[id];
    const at = `nodes.${id}`;
    if (!NODE_ID_RE.test(id)) err(`${at}: node ids use letters, digits, "-" or "_" (max 64, start with a letter or digit)`);
    if (!isObj(n)) {
      err(`${at}: must be an object`);
      continue;
    }
    if (!TYPES.includes(n.type)) {
      err(`${at}.type: must be one of ${TYPES.join(', ')}`);
      continue;
    }
    for (const k of ['text', 'title', 'image', 'explanation']) {
      if (n[k] !== undefined && !isStr(n[k])) err(`${at}.${k}: must be text`);
    }
    if (n.image && !/^(https:\/\/|\/)/.test(n.image)) err(`${at}.image: must be an https:// URL or a /path`);

    if (n.type === 'question') {
      if (!nonEmpty(n.text)) err(`${at}.text: required`);
      const kind = n.kind === undefined ? 'single' : n.kind;
      if (!KINDS.includes(kind)) err(`${at}.kind: must be one of ${KINDS.join(', ')}`);
      if (n.points !== undefined && !(isNum(n.points) && n.points >= 0)) err(`${at}.points: must be a number ≥ 0`);
      route(`${at}.next`, n.next);
      route(`${at}.onCorrect`, n.onCorrect);
      route(`${at}.onIncorrect`, n.onIncorrect);
      if (kind === 'text') {
        if (!Array.isArray(n.answers) || n.answers.length === 0 || !n.answers.every(nonEmpty)) {
          err(`${at}.answers: required for text questions; a list of accepted answers`);
        }
      } else if (KINDS.includes(kind)) {
        if (!Array.isArray(n.options) || n.options.length < 2) err(`${at}.options: at least 2 required`);
        else if (n.options.length > MAX_OPTIONS) err(`${at}.options: at most ${MAX_OPTIONS}`);
        else {
          const seen = new Set();
          n.options.forEach((o, i) => {
            const w = `${at}.options[${i}]`;
            if (!isObj(o)) return err(`${w}: must be an object`);
            if (!nonEmpty(o.text)) err(`${w}.text: required`);
            const oid = o.id === undefined ? String(i) : String(o.id);
            if (o.id !== undefined && !(isStr(o.id) || isNum(o.id))) err(`${w}.id: must be text or a number`);
            if (seen.has(oid)) err(`${w}.id: duplicate option id "${oid}"`);
            seen.add(oid);
            if (o.correct !== undefined && typeof o.correct !== 'boolean') err(`${w}.correct: must be true or false`);
            if (o.points !== undefined && !isNum(o.points)) err(`${w}.points: must be a number`);
            if (o.tags !== undefined && !(Array.isArray(o.tags) && o.tags.every(nonEmpty))) err(`${w}.tags: must be a list of tag names`);
            if (o.feedback !== undefined && !isStr(o.feedback)) err(`${w}.feedback: must be text`);
            if (o.next !== undefined && kind === 'multi') warn(`${w}.next: ignored on multi-choice questions (use onCorrect / onIncorrect / next on the question)`);
            else route(`${w}.next`, o.next);
          });
          if (kind === 'single' && n.options.filter((o) => isObj(o) && o.correct === true).length > 1) {
            warn(`${at}: several options are marked correct; only one can be picked, so use kind "multi" if all are needed`);
          }
        }
      }
    } else if (n.type === 'info') {
      if (!nonEmpty(n.text) && !nonEmpty(n.title)) err(`${at}: needs a title or text`);
      route(`${at}.next`, n.next);
    } else if (n.type === 'branch') {
      if (!Array.isArray(n.rules) || n.rules.length === 0) err(`${at}.rules: required; a list of { if, goto }`);
      else {
        n.rules.forEach((r, i) => {
          const w = `${at}.rules[${i}]`;
          if (!isObj(r)) return err(`${w}: must be an object`);
          if (r.goto === undefined) err(`${w}.goto: required`);
          route(`${w}.goto`, r.goto);
          validateCondition(r.if, w, nodes, err);
        });
      }
      route(`${at}.else`, n.else);
      if (n.else === undefined) warn(`${at}: no "else" route; if no rule matches the quiz ends`);
    } else if (n.type === 'end') {
      if (!nonEmpty(n.title) && !nonEmpty(n.text)) warn(`${at}: end node has no title or text; the score band will be shown instead`);
    }
  }

  // Graph analysis (only over well-formed edges).
  const adj = new Map();
  const edges = [];
  for (const id of ids) {
    const targets = new Set();
    if (isObj(nodes[id])) {
      for (const e of edgesOf(nodes[id])) {
        if (has(nodes, e.to)) {
          targets.add(e.to);
          edges.push({ from: id, to: e.to, label: e.label });
        }
      }
    }
    adj.set(id, targets);
  }

  const layer = new Map();
  let paths = null;
  if (isStr(quiz.start) && has(nodes, quiz.start)) {
    layer.set(quiz.start, 0);
    const queue = [quiz.start];
    while (queue.length) {
      const cur = queue.shift();
      for (const t of adj.get(cur)) {
        if (!layer.has(t)) {
          layer.set(t, layer.get(cur) + 1);
          queue.push(t);
        }
      }
    }
    for (const id of ids) {
      if (!layer.has(id)) warn(`nodes.${id}: unreachable from "${quiz.start}"`);
    }

    // Count distinct start→terminal paths (null when the graph has loops).
    const memo = new Map();
    const stack = new Set();
    let loops = false;
    const dfs = (id) => {
      if (memo.has(id)) return memo.get(id);
      if (stack.has(id)) {
        loops = true;
        return 0;
      }
      stack.add(id);
      const outs = adj.get(id);
      let count = outs.size === 0 ? 1 : 0;
      for (const t of outs) count = Math.min(count + dfs(t), 1e9);
      stack.delete(id);
      memo.set(id, count);
      return count;
    };
    const total = dfs(quiz.start);
    paths = loops ? null : total;
    if (loops) warn('The quiz contains a loop; sessions are cut off after a fixed number of steps');

    for (const id of ids) {
      const n = nodes[id];
      if (layer.has(id) && isObj(n) && (n.type === 'question' || n.type === 'info') && adj.get(id).size === 0) {
        warn(`nodes.${id}: has no route onward, so the quiz ends here with the score-band result`);
      }
    }
    if (!ids.some((id) => isObj(nodes[id]) && nodes[id].type === 'end' && layer.has(id))) {
      warn('No end node is reachable; players will get the generic score-band result');
    }
  }

  const count = (t) => ids.filter((id) => isObj(nodes[id]) && nodes[id].type === t).length;
  const stats = {
    nodes: ids.length,
    questions: count('question'),
    info: count('info'),
    branches: count('branch'),
    ends: count('end'),
    paths,
  };

  const graph = {
    nodes: ids.map((id) => ({
      id,
      type: isObj(nodes[id]) ? nodes[id].type : '?',
      label: nodeLabel(nodes[id]),
      layer: layer.has(id) ? layer.get(id) : -1,
      start: id === quiz.start,
    })),
    edges,
  };
  return { errors, warnings, stats, graph };
}

/** Deep-ish copy with defaults filled in. Assumes analyze() reported no errors. */
function normalise(quiz) {
  const out = {
    ...quiz,
    published: quiz.published !== false,
    settings: { showFeedback: true, ...(quiz.settings || {}) },
    results: [...(quiz.results || [])].sort((a, b) => a.min - b.min),
    nodes: {},
  };
  for (const [id, n] of Object.entries(quiz.nodes)) {
    const node = { ...n };
    if (n.type === 'question') {
      node.kind = n.kind || 'single';
      if (node.kind !== 'text') {
        node.options = n.options.map((o, i) => ({ ...o, id: o.id === undefined ? String(i) : String(o.id) }));
      }
    }
    out.nodes[id] = node;
  }
  return out;
}

module.exports = { analyze, normalise, edgesOf, QUIZ_ID_RE, NODE_ID_RE, MAX_NODES };
