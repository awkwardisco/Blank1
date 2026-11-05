# Quiz Game

A browser quiz game with a small Node backend. You load questionnaires as JSON
files (from the admin page, or by dropping them into a folder) and quizzes can
**branch**: the next question depends on the answer, the running score, or tags
collected along the way.

No dependencies; needs Node 20 or later.

```bash
cd quiz-game
npm start            # http://127.0.0.1:3000
npm test             # engine + validator tests
```

| Setting | Default | Notes |
|---|---|---|
| `PORT` | `3000` | |
| `HOST` | `127.0.0.1` | use `0.0.0.0` to expose on your network |
| `DATA_DIR` | `./data` | quizzes in `quizzes/*.json`, results in `results.jsonl` |
| `ADMIN_TOKEN` | generated | if unset, a random token is written to `data/admin-token` and printed at start-up |

## Pages

- `/` – players pick a quiz, give an optional name, and play. Keys `1`–`9` choose
  options, `Enter` continues. A refresh resumes the game in progress.
- `/admin.html` – sign in with the admin token, then:
  - **New quiz / Edit**: edit the JSON live. It is validated as you type, with a
    **path map** showing every route through the quiz and a count of distinct paths.
  - **Load JSON file…**: load a questionnaire from your computer into the editor, then Save.
  - **Stats**: plays, average score, where players ended up, answers per question,
    and a path map annotated with visit counts.
  - **Delete**, **Download**, draft/published switching (`"published": false`).

You can also copy `.json` files straight into `data/quizzes/`; they are picked up
immediately and shown in the admin list (with any errors).

## Questionnaire format

```jsonc
{
  "id": "my-quiz",                 // = file name; lowercase letters, digits, - _
  "title": "…", "description": "…",
  "published": true,               // false = draft, hidden from players
  "settings": { "showFeedback": true },   // false: no right/wrong reveal (e.g. personality quizzes)
  "start": "q1",
  "results": [                     // score bands, used when an end node has no text of its own
    { "min": 0, "title": "Good try", "text": "…" },
    { "min": 5, "title": "Brilliant", "text": "…" }
  ],
  "nodes": { "q1": { … }, … }
}
```

### Node types

**`question`**

| Field | Meaning |
|---|---|
| `kind` | `single` (default), `multi` (checkboxes), or `text` (typed answer) |
| `text`, `image`, `explanation` | question, optional image (`https://…` or `/path`), shown after answering |
| `options[]` | `text`, `correct`, `points`, `tags[]`, `next`, `feedback`, optional `id` |
| `answers[]` | accepted answers for `text` (case, accents and punctuation ignored) |
| `points` | points for a correct answer (default 1) |
| `onCorrect`, `onIncorrect`, `next` | routes |

Scoring: `single` gives the option's `points`, or the question `points` if it is
marked `correct`. `multi` gives the question `points` only when the selected set
exactly matches the `correct` options, plus any `points` on selected options.
Questions with no `correct` options (surveys, personality quizzes) are not counted
as right or wrong.

Routing after a question, first match wins: the chosen option's `next` →
`onCorrect` / `onIncorrect` → `next`. If nothing matches the quiz ends.

**`info`**: a screen with a Continue button (`title`, `text`, `image`, `next`).

**`branch`**: an invisible router. The first rule whose `if` matches wins, otherwise `else`:

```json
{ "type": "branch",
  "rules": [
    { "if": { "scoreAtLeast": 4 }, "goto": "end_gold" },
    { "if": { "tags": { "sea": 2 }, "notVisited": "q7" }, "goto": "end_sea" }
  ],
  "else": "end_default" }
```

Conditions (all inside one `if` must hold): `scoreAtLeast`, `scoreBelow`,
`correctAtLeast`, `tags` (`["a","b"]` or `{"a": 2}` for counts), `notTags`,
`visited`, `notVisited`.

**`end`**: a result screen (`title`, `text`, `image`).

The two quizzes in `data/quizzes/` show a score-driven route (`space-trivia`) and a
tag-driven personality quiz (`which-explorer`).

## API

Player (no auth):

| | |
|---|---|
| `GET /api/quizzes` | published quizzes |
| `POST /api/quizzes/:id/sessions` `{name?}` | start a game |
| `GET /api/sessions/:sid` | current step (resume) |
| `POST /api/sessions/:sid/answer` `{answer}` | submit; returns `{feedback, step}` |
| `GET /api/quizzes/:id/leaderboard` | top 10 named scores |

Admin (`Authorization: Bearer <token>`): `GET /api/admin/quizzes`,
`GET|PUT|DELETE /api/admin/quizzes/:id`, `POST /api/admin/validate`,
`GET /api/admin/stats/:id`. `PUT` refuses invalid quizzes with a 422 and the
list of errors, so you can also load quizzes from scripts:

```bash
curl -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  --data @my-quiz.json http://127.0.0.1:3000/api/admin/quizzes/my-quiz
```

## Design notes

- The game state lives on the server. The browser is only sent the current
  question, never the correct answers or routes, and only gets the reveal
  after it has answered.
- Sessions are in memory (2-hour idle expiry), so a server restart ends games in
  progress. Quizzes and results are on disk.
- The validator checks references, duplicate ids, bad conditions and unreachable
  nodes, and warns about loops and dead ends. Loops are allowed (e.g. "retry")
  but a session is stopped after 1000 steps.
- Admin access is a single shared token with a failed-attempt lockout. If you
  expose this beyond your own machine, put it behind HTTPS.
