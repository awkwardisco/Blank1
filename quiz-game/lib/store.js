'use strict';

/** File-backed storage: one JSON file per quiz, results appended as JSON lines. */

const fs = require('fs');
const path = require('path');
const { analyze, normalise, QUIZ_ID_RE } = require('./quiz');
const { httpError } = require('./errors');

class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.quizDir = path.join(dataDir, 'quizzes');
    this.resultsFile = path.join(dataDir, 'results.jsonl');
    fs.mkdirSync(this.quizDir, { recursive: true });
    this.cache = new Map();
  }

  file(id) {
    if (typeof id !== 'string' || !QUIZ_ID_RE.test(id)) throw httpError(400, 'Invalid quiz id');
    return path.join(this.quizDir, id + '.json');
  }

  ids() {
    return fs
      .readdirSync(this.quizDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .filter((id) => QUIZ_ID_RE.test(id))
      .sort();
  }

  /** Load a quiz entry { raw, analysis, quiz|null }; null if it does not exist. Re-reads when the file changes. */
  load(id) {
    const file = this.file(id);
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      this.cache.delete(id);
      return null;
    }
    const hit = this.cache.get(id);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
    let entry;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const analysis = analyze(raw);
      if (analysis.errors.length === 0 && raw.id !== id) analysis.errors.push(`id: "${raw.id}" does not match the file name "${id}.json"`);
      entry = { raw, analysis, quiz: analysis.errors.length ? null : normalise(raw) };
    } catch (e) {
      entry = { raw: null, analysis: { errors: ['Invalid JSON: ' + e.message], warnings: [], stats: null, graph: { nodes: [], edges: [] } }, quiz: null };
    }
    entry.mtimeMs = st.mtimeMs;
    entry.size = st.size;
    this.cache.set(id, entry);
    return entry;
  }

  save(id, raw) {
    const file = this.file(id);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n');
    fs.renameSync(tmp, file);
    this.cache.delete(id);
  }

  remove(id) {
    try {
      fs.unlinkSync(this.file(id));
    } catch (e) {
      if (e.code === 'ENOENT') return false;
      throw e;
    }
    this.cache.delete(id);
    return true;
  }

  /** Playable quizzes for the public list. */
  listPublic() {
    const out = [];
    for (const id of this.ids()) {
      const e = this.load(id);
      if (!e || !e.quiz || e.quiz.published === false) continue;
      out.push({
        id,
        title: e.quiz.title,
        description: e.quiz.description || '',
        questions: e.analysis.stats.questions,
        image: e.quiz.image || null,
      });
    }
    return out;
  }

  /** Every quiz including drafts and broken files, for the admin list. */
  listAdmin() {
    return this.ids().map((id) => {
      const e = this.load(id);
      return {
        id,
        title: (e.raw && e.raw.title) || id,
        published: !!(e.raw && e.raw.published !== false),
        valid: !!e.quiz,
        errors: e.analysis.errors.length,
        warnings: e.analysis.warnings.length,
        stats: e.analysis.stats,
        plays: this.results(id).length,
      };
    });
  }

  // ---- results -----------------------------------------------------------

  appendResult(rec) {
    fs.appendFileSync(this.resultsFile, JSON.stringify(rec) + '\n');
  }

  results(quizId) {
    let text;
    try {
      text = fs.readFileSync(this.resultsFile, 'utf8');
    } catch {
      return [];
    }
    const out = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const r = JSON.parse(line);
        if (r.quizId === quizId) out.push(r);
      } catch {
        /* skip a corrupt line */
      }
    }
    return out;
  }

  leaderboard(quizId, limit = 10) {
    return this.results(quizId)
      .filter((r) => r.name)
      .sort((a, b) => b.score - a.score || a.ms - b.ms)
      .slice(0, limit)
      .map((r) => ({ name: r.name, score: r.score, at: r.at }));
  }

  stats(quizId) {
    const rs = this.results(quizId);
    const ends = {};
    const answers = {};
    let total = 0;
    for (const r of rs) {
      total += r.score;
      const key = r.endId || '(implicit end)';
      ends[key] = (ends[key] || 0) + 1;
      for (const p of r.path || []) {
        const a = (answers[p.n] = answers[p.n] || {});
        a[p.a] = (a[p.a] || 0) + 1;
      }
    }
    return { plays: rs.length, avgScore: rs.length ? total / rs.length : 0, ends, answers };
  }
}

module.exports = { Store };
