// Doodle Quiz — Node server backed by PostgreSQL (Neon).
// Serves the player + admin UIs, a JSON API, and live multiplayer updates over SSE.
// Live events fan out through Postgres LISTEN/NOTIFY so several server instances stay in sync.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Pool, Client } = require('pg');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATABASE_URL = process.env.DATABASE_URL;
const PUBLIC_DIR = path.join(__dirname, 'public');
const EFFECTS = ['random', 'boom', 'poof', 'vanish', 'splat', 'shake'];
const MAX_BODY = 1024 * 1024;
const MAX_PLAYERS = 5000;
const INSTANCE = crypto.randomUUID();
const CHANNEL = 'doodle_quiz_events';

if (!DATABASE_URL) {
  console.error('\n  ✋ DATABASE_URL is not set. Copy .env.example to .env and paste your Neon connection string.\n');
  process.exit(1);
}

const pgConfig = { connectionString: DATABASE_URL };
// LISTEN needs a session connection; Neon's "-pooler" host (PgBouncer) can't hold one, so listen on the direct host.
const listenConfig = { connectionString: DATABASE_URL.replace('-pooler.', '.') };
const pool = new Pool({ ...pgConfig, max: 10, idleTimeoutMillis: 30000 });
pool.on('error', (err) => console.error('Postgres pool error:', err.message));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id            uuid PRIMARY KEY,
  name          text NOT NULL,
  code          text NOT NULL UNIQUE,
  hint_after    int  NOT NULL DEFAULT 2,
  questions     jsonb NOT NULL DEFAULT '[]',
  active_run_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS runs (
  id           uuid PRIMARY KEY,
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  project_name text NOT NULL,
  hint_after   int  NOT NULL,
  questions    jsonb NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz
);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS show_full_score boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS runs_project_idx ON runs(project_id, started_at DESC);
CREATE TABLE IF NOT EXISTS players (
  id          uuid PRIMARY KEY,
  run_id      uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  name        text NOT NULL,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS players_run_idx ON players(run_id);
CREATE TABLE IF NOT EXISTS attempts (
  id          bigserial PRIMARY KEY,
  run_id      uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  question_id text NOT NULL,
  option      int  NOT NULL,
  is_correct  boolean NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, question_id, option)
);
CREATE INDEX IF NOT EXISTS attempts_run_idx ON attempts(run_id);
CREATE TABLE IF NOT EXISTS share_cards (
  id          text PRIMARY KEY,
  run_id      uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  code        text NOT NULL,
  title       text NOT NULL,
  description text NOT NULL,
  mime        text NOT NULL,
  image       bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS share_cards_player_idx ON share_cards(player_id);
`;

const q = (text, params) => pool.query(text, params);
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

const uuid = () => crypto.randomUUID();
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
const ms = (d) => (d ? new Date(d).getTime() : null);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.randomBytes(5), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

function projectRow(r) {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    hintAfter: r.hint_after,
    questions: r.questions,
    activeRunId: r.active_run_id,
    running: !!r.active_run_id,
    showFullScore: r.show_full_score,
    createdAt: ms(r.created_at),
    updatedAt: ms(r.updated_at),
  };
}
const getProject = async (id) => (isUuid(id) ? (await q('SELECT * FROM projects WHERE id=$1', [id])).rows[0] : null);
const getProjectByCode = async (code) => (await q('SELECT * FROM projects WHERE code=$1', [String(code).toUpperCase().slice(0, 12)])).rows[0];
const getRun = async (id) => (isUuid(id) ? (await q('SELECT * FROM runs WHERE id=$1', [id])).rows[0] : null);

// ---------- auth ----------
const ADMIN_TOKEN = crypto.createHmac('sha256', ADMIN_PASSWORD).update('doodle-quiz-admin').digest('hex');
function isAdmin(req, url) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token') || '';
  const a = Buffer.from(token);
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- live updates: SSE locally, Postgres NOTIFY across instances ----------
const playerStreams = new Map(); // projectId -> Set<res>
const adminStreams = new Set();

function openStream(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
}
const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

function statusOf(p) {
  return { name: p.name, code: p.code, running: !!p.active_run_id, runId: p.active_run_id || null, questionCount: p.questions.length, fullScore: !!p.show_full_score };
}

// Delivers an event to SSE clients connected to *this* instance.
function deliver(evt) {
  if (evt.type === 'status') {
    const set = playerStreams.get(evt.projectId);
    if (set) for (const res of set) send(res, 'status', evt.status);
  }
  for (const res of adminStreams) send(res, 'update', { projectId: evt.projectId });
}

let listener = null;
async function startListener() {
  try {
    listener = new Client(listenConfig);
    listener.on('error', (err) => {
      console.warn('Live-sync listener lost:', err.message, '— retrying in 3s');
      listener = null;
      setTimeout(startListener, 3000);
    });
    await listener.connect();
    await listener.query(`LISTEN ${CHANNEL}`);
    listener.on('notification', (msg) => {
      try {
        const evt = JSON.parse(msg.payload);
        if (evt.from !== INSTANCE) deliver(evt);
      } catch {}
    });
  } catch (err) {
    console.warn('LISTEN unavailable (fine for a single server):', err.message);
    listener = null;
  }
}

function publish(evt) {
  deliver(evt);
  q('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify({ ...evt, from: INSTANCE })]).catch(() => {});
}
const broadcastStatus = (p) => publish({ type: 'status', projectId: p.id, status: statusOf(p) });

// Coalesce answer bursts into at most ~2 admin pushes per second.
const adminPending = new Set();
let adminTimer = null;
function notifyAdmins(projectId) {
  adminPending.add(projectId);
  if (adminTimer) return;
  adminTimer = setTimeout(() => {
    for (const pid of adminPending) publish({ type: 'update', projectId: pid });
    adminPending.clear();
    adminTimer = null;
  }, 400);
}

setInterval(() => {
  for (const set of playerStreams.values()) for (const res of set) res.write(': ping\n\n');
  for (const res of adminStreams) res.write(': ping\n\n');
}, 25000);

// ---------- validation ----------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const str = (v, max) => String(v ?? '').trim().slice(0, max);

function cleanQuestions(input) {
  if (!Array.isArray(input)) throw new HttpError(400, 'questions must be a list');
  if (input.length > 300) throw new HttpError(400, 'Max 300 questions per project');
  const seen = new Set();
  return input.map((item, i) => {
    const n = i + 1;
    const text = str(item.text, 1000);
    if (!text) throw new HttpError(400, `Question ${n} needs some text`);
    const options = Array.isArray(item.options) ? item.options.map((o) => str(o, 300)) : [];
    if (options.length < 2 || options.length > 6) throw new HttpError(400, `Question ${n} needs 2–6 options`);
    if (options.some((o) => !o)) throw new HttpError(400, `Question ${n} has an empty option`);
    const correct = Number(item.correct);
    if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) throw new HttpError(400, `Question ${n}: pick the correct answer`);
    let qid = typeof item.id === 'string' && item.id ? item.id.slice(0, 64) : uuid();
    if (seen.has(qid)) qid = uuid();
    seen.add(qid);
    return { id: qid, text, options, correct, mustBeCorrect: !!item.mustBeCorrect, effect: EFFECTS.includes(item.effect) ? item.effect : 'random' };
  });
}

// ---------- answers & results ----------
// Rebuilds each player's per-question state from their attempt rows.
function answerState(question, attempts) {
  const first = attempts.length ? attempts[0].option : null;
  const done = attempts.some((a) => a.is_correct) || (!question.mustBeCorrect && attempts.length > 0);
  const wrong = attempts.filter((a) => !a.is_correct).map((a) => a.option);
  const solved = attempts.some((a) => a.is_correct);
  return { first, done, wrong, solved };
}

async function loadRunData(runId) {
  const [players, attempts] = await Promise.all([
    q('SELECT * FROM players WHERE run_id=$1 ORDER BY joined_at', [runId]),
    q('SELECT player_id, question_id, option, is_correct FROM attempts WHERE run_id=$1 ORDER BY id', [runId]),
  ]);
  const byPlayer = new Map(players.rows.map((p) => [p.id, {}]));
  for (const a of attempts.rows) {
    const m = byPlayer.get(a.player_id);
    if (m) (m[a.question_id] ||= []).push(a);
  }
  return { players: players.rows, byPlayer };
}

async function computeResults(run) {
  const { players, byPlayer } = await loadRunData(run.id);
  const questions = run.questions.map((qq) => {
    const counts = qq.options.map(() => 0);
    let answered = 0;
    let firstRight = 0;
    let wrongClicks = 0;
    for (const p of players) {
      const s = answerState(qq, byPlayer.get(p.id)[qq.id] || []);
      if (s.first == null) continue;
      answered++;
      counts[s.first]++;
      if (s.first === qq.correct) firstRight++;
      wrongClicks += s.wrong.length;
    }
    // Most-picked first answer; ties go to the correct one so a tie isn't flagged as a trap.
    const max = Math.max(...counts);
    const topIndex = !answered ? null : counts[qq.correct] === max ? qq.correct : counts.indexOf(max);
    return {
      id: qq.id,
      text: qq.text,
      options: qq.options,
      correct: qq.correct,
      mustBeCorrect: qq.mustBeCorrect,
      counts,
      answered,
      firstRight,
      firstRightPct: answered ? Math.round((firstRight / answered) * 100) : 0,
      topIndex,
      trap: answered > 0 && topIndex !== qq.correct,
      avgWrong: answered ? +(wrongClicks / answered).toFixed(2) : 0,
    };
  });

  const ranked = players
    .map((p) => {
      let answered = 0;
      let score = 0;
      let solved = 0;
      let wrongClicks = 0;
      const firstPicks = run.questions.map((qq) => {
        const s = answerState(qq, byPlayer.get(p.id)[qq.id] || []);
        if (s.first == null) return null;
        answered++;
        if (s.solved) solved++;
        if (s.first === qq.correct) score++;
        wrongClicks += s.wrong.length;
        return s.first;
      });
      return { id: p.id, name: p.name, joinedAt: ms(p.joined_at), finishedAt: ms(p.finished_at), answered, score, solved, wrongClicks, firstPicks };
    })
    .sort((a, b) => b.score - a.score || a.wrongClicks - b.wrongClicks || (a.finishedAt || Infinity) - (b.finishedAt || Infinity));

  return {
    id: run.id,
    projectId: run.project_id,
    projectName: run.project_name,
    startedAt: ms(run.started_at),
    endedAt: ms(run.ended_at),
    live: !run.ended_at,
    hintAfter: run.hint_after,
    questions,
    players: ranked,
  };
}

const publicQuestions = (run) => run.questions.map((qq) => ({ id: qq.id, text: qq.text, options: qq.options, mustBeCorrect: qq.mustBeCorrect, effect: qq.effect }));

async function playerProgress(run, playerId) {
  const { rows } = await q('SELECT question_id, option, is_correct FROM attempts WHERE player_id=$1 ORDER BY id', [playerId]);
  const grouped = {};
  for (const r of rows) (grouped[r.question_id] ||= []).push(r);
  const progress = {};
  for (const qq of run.questions) {
    if (!grouped[qq.id]) continue;
    const s = answerState(qq, grouped[qq.id]);
    progress[qq.id] = { done: s.done, solved: s.solved, firstTryCorrect: s.first === qq.correct, wrong: s.wrong };
  }
  return progress;
}

async function submitAnswer(body) {
  if (!isUuid(body.runId) || !isUuid(body.playerId)) throw new HttpError(400, 'Bad request');
  return tx(async (c) => {
    const run = (await c.query('SELECT * FROM runs WHERE id=$1', [body.runId])).rows[0];
    if (!run) throw new HttpError(404, 'Game not found');
    if (run.ended_at) return { status: 409, body: { error: 'The test has ended', stopped: true } };
    // Row lock serialises taps from the same player (double taps, flaky networks).
    const player = (await c.query('SELECT * FROM players WHERE id=$1 AND run_id=$2 FOR UPDATE', [body.playerId, run.id])).rows[0];
    if (!player) throw new HttpError(404, 'Player not found — please rejoin');
    const qIndex = run.questions.findIndex((qq) => qq.id === body.questionId);
    if (qIndex < 0) throw new HttpError(404, 'Question not found');
    const question = run.questions[qIndex];
    const option = Number(body.option);
    if (!Number.isInteger(option) || option < 0 || option >= question.options.length) throw new HttpError(400, 'Invalid option');

    const { rows } = await c.query('SELECT question_id, option, is_correct FROM attempts WHERE player_id=$1 ORDER BY id', [player.id]);
    const grouped = {};
    for (const r of rows) (grouped[r.question_id] ||= []).push(r);
    const stateOf = (qq) => answerState(qq, grouped[qq.id] || []);

    // Locked stages: every earlier "must be correct" question has to be solved first.
    for (const prev of run.questions.slice(0, qIndex)) {
      if (prev.mustBeCorrect && !stateOf(prev).done) throw new HttpError(403, 'Solve the earlier locked question first');
    }
    const before = stateOf(question);
    if (before.done) return { body: { correct: option === question.correct, done: true, correctIndex: question.correct, already: true } };
    const mine = grouped[question.id] || [];
    if (mine.some((a) => a.option === option)) return { body: { correct: false, done: false, repeat: true, wrongCount: before.wrong.length } };

    const correct = option === question.correct;
    await c.query('INSERT INTO attempts (run_id, player_id, question_id, option, is_correct) VALUES ($1,$2,$3,$4,$5)', [run.id, player.id, question.id, option, correct]);
    (grouped[question.id] ||= []).push({ question_id: question.id, option, is_correct: correct });
    const after = stateOf(question);

    const out = { correct, done: after.done, wrongCount: after.wrong.length, firstTry: after.first === question.correct };
    if (after.done || (run.hint_after > 0 && after.wrong.length >= run.hint_after)) out.correctIndex = question.correct;
    if (!player.finished_at && run.questions.every((qq) => stateOf(qq).done)) {
      await c.query('UPDATE players SET finished_at=now() WHERE id=$1', [player.id]);
    }
    return { body: out, projectId: run.project_id };
  });
}

// ---------- LinkedIn share cards (Open Graph previews) ----------
// Each share gets its own id so LinkedIn (which caches previews per URL) always shows the latest card.
const shareId = () => Array.from(crypto.randomBytes(8), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');

async function saveShareCard(body) {
  if (!isUuid(body.runId) || !isUuid(body.playerId)) throw new HttpError(400, 'Bad request');
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image || ''));
  if (!m) throw new HttpError(400, 'Image must be a PNG or JPEG');
  const image = Buffer.from(m[2], 'base64');
  const png = image.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const jpg = image.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (!(png || jpg) || image.length > 700 * 1024) throw new HttpError(400, 'Invalid image');

  const run = await getRun(body.runId);
  if (!run) throw new HttpError(404, 'Game not found');
  const player = (await q('SELECT * FROM players WHERE id=$1 AND run_id=$2', [body.playerId, run.id])).rows[0];
  if (!player) throw new HttpError(404, 'Player not found');
  const project = await getProject(run.project_id);

  // Score in the preview title is computed here, not trusted from the browser.
  const progress = await playerProgress(run, player.id);
  const total = run.questions.length;
  const vals = Object.values(progress);
  const shown = project?.show_full_score ? vals.filter((p) => p.solved).length : vals.filter((p) => p.firstTryCorrect).length;
  const title = `${player.name} scored ${shown}/${total} in ${run.project_name} 🎉`;
  const description = str(body.description, 300) || 'Think you can beat that score? Tap to play the quiz!';

  const id = shareId();
  await q('DELETE FROM share_cards WHERE player_id=$1', [player.id]);
  await q('INSERT INTO share_cards (id, run_id, player_id, code, title, description, mime, image) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
    id,
    run.id,
    player.id,
    project?.code || '',
    title,
    description,
    m[1],
    image,
  ]);
  return { id };
}

const attr = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function originOf(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  const proto = String(req.headers['x-forwarded-proto'] || (/^(localhost|127\.|\[::1\])/.test(host) ? 'http' : 'https')).split(',')[0].trim();
  return `${proto}://${host}`;
}

// Open Graph tags for /play/CODE (and /play/CODE?s=SHARE_ID with the player's own score card).
async function ogTags(req, url) {
  const code = decodeURIComponent(url.pathname.split('/')[2] || '');
  if (!code) return '';
  const origin = originOf(req);
  const sid = url.searchParams.get('s');
  const card = sid && /^[a-z0-9]{4,16}$/.test(sid) ? (await q('SELECT id, code, title, description FROM share_cards WHERE id=$1', [sid])).rows[0] : null;
  const project = card ? null : await getProjectByCode(code);
  if (!card && !project) return '';
  const pageUrl = `${origin}/play/${encodeURIComponent(code)}${card ? `?s=${card.id}` : ''}`;
  const title = card ? card.title : `${project.name} · Doodle Quiz`;
  const description = card ? card.description : 'A sketchbook-style quiz game. Tap to play!';
  const tags = [
    ['og:type', 'website'],
    ['og:site_name', 'Doodle Quiz'],
    ['og:url', pageUrl],
    ['og:title', title],
    ['og:description', description],
  ];
  if (card) tags.push(['og:image', `${origin}/og/${card.id}`], ['og:image:width', '1200'], ['og:image:height', '627'], ['og:image:alt', title]);
  return (
    tags.map(([k, v]) => `<meta property="${k}" content="${attr(v)}" />`).join('\n  ') +
    `\n  <meta name="description" content="${attr(description)}" />` +
    `\n  <meta name="twitter:card" content="${card ? 'summary_large_image' : 'summary'}" />` +
    `\n  <link rel="canonical" href="${attr(pageUrl)}" />`
  );
}

async function serveShareImage(res, id) {
  const card = /^[a-z0-9]{4,16}$/.test(id) ? (await q('SELECT mime, image FROM share_cards WHERE id=$1', [id])).rows[0] : null;
  if (!card) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': card.mime, 'Content-Length': card.image.length, 'Cache-Control': 'public, max-age=31536000, immutable' });
  res.end(card.image);
}

// ---------- HTTP plumbing ----------
async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const method = req.method;

  // ----- admin -----
  if (parts[0] === 'admin') {
    if (parts[1] === 'login' && method === 'POST') {
      const body = await readJson(req);
      if (String(body.password || '') !== ADMIN_PASSWORD) throw new HttpError(401, 'Wrong password');
      return json(res, 200, { token: ADMIN_TOKEN });
    }
    if (!isAdmin(req, url)) throw new HttpError(401, 'Please log in');

    if (parts[1] === 'events' && method === 'GET') {
      openStream(res);
      adminStreams.add(res);
      req.on('close', () => adminStreams.delete(res));
      return;
    }

    if (parts[1] === 'projects') {
      const pid = parts[2];
      if (!pid && method === 'GET') {
        const { rows } = await q(`
          SELECT p.*,
            (SELECT count(*)::int FROM players pl WHERE pl.run_id = p.active_run_id) AS live_players,
            (SELECT count(*)::int FROM runs r WHERE r.project_id = p.id) AS run_count
          FROM projects p ORDER BY p.updated_at DESC`);
        return json(
          res,
          200,
          rows.map((r) => ({
            id: r.id,
            name: r.name,
            code: r.code,
            createdAt: ms(r.created_at),
            updatedAt: ms(r.updated_at),
            questionCount: r.questions.length,
            running: !!r.active_run_id,
            runId: r.active_run_id,
            livePlayers: r.live_players,
            runCount: r.run_count,
          }))
        );
      }
      if (!pid && method === 'POST') {
        const body = await readJson(req);
        const name = str(body.name, 120) || 'Untitled quiz';
        for (let tries = 0; ; tries++) {
          try {
            const { rows } = await q('INSERT INTO projects (id, name, code) VALUES ($1,$2,$3) RETURNING *', [uuid(), name, newCode()]);
            return json(res, 201, projectRow(rows[0]));
          } catch (e) {
            if (e.code !== '23505' || tries > 5) throw e; // retry on join-code collision
          }
        }
      }

      const project = await getProject(pid);
      if (!project) throw new HttpError(404, 'Project not found');
      const action = parts[3];

      if (!action && method === 'GET') return json(res, 200, projectRow(project));
      if (!action && method === 'PUT') {
        const body = await readJson(req);
        const name = body.name !== undefined ? str(body.name, 120) || 'Untitled quiz' : project.name;
        let hint = project.hint_after;
        if (body.hintAfter !== undefined) {
          const h = Number(body.hintAfter);
          hint = Number.isInteger(h) && h >= 0 && h <= 10 ? h : 2;
        }
        const questions = body.questions !== undefined ? cleanQuestions(body.questions) : project.questions;
        const fullScore = body.showFullScore !== undefined ? !!body.showFullScore : project.show_full_score;
        const { rows } = await q('UPDATE projects SET name=$2, hint_after=$3, questions=$4, show_full_score=$5, updated_at=now() WHERE id=$1 RETURNING *', [
          project.id,
          name,
          hint,
          JSON.stringify(questions),
          fullScore,
        ]);
        // Players' finish screens react live to the full-score switch.
        if (fullScore !== project.show_full_score) broadcastStatus(rows[0]);
        return json(res, 200, projectRow(rows[0]));
      }
      if (!action && method === 'DELETE') {
        await q('DELETE FROM projects WHERE id=$1', [project.id]);
        broadcastStatus({ ...project, active_run_id: null });
        return json(res, 200, { ok: true });
      }
      if (action === 'start' && method === 'POST') {
        if (!project.questions.length) throw new HttpError(400, 'Add at least one question first');
        const updated = await tx(async (c) => {
          const p = (await c.query('SELECT * FROM projects WHERE id=$1 FOR UPDATE', [project.id])).rows[0];
          if (p.active_run_id) return p;
          const runId = uuid();
          await c.query('INSERT INTO runs (id, project_id, project_name, hint_after, questions) VALUES ($1,$2,$3,$4,$5)', [
            runId,
            p.id,
            p.name,
            p.hint_after,
            JSON.stringify(p.questions),
          ]);
          return (await c.query('UPDATE projects SET active_run_id=$2 WHERE id=$1 RETURNING *', [p.id, runId])).rows[0];
        });
        broadcastStatus(updated);
        return json(res, 200, { runId: updated.active_run_id });
      }
      if (action === 'stop' && method === 'POST') {
        const result = await tx(async (c) => {
          const p = (await c.query('SELECT * FROM projects WHERE id=$1 FOR UPDATE', [project.id])).rows[0];
          if (!p.active_run_id) throw new HttpError(400, 'No test is running');
          await c.query('UPDATE runs SET ended_at=now() WHERE id=$1', [p.active_run_id]);
          const up = (await c.query('UPDATE projects SET active_run_id=NULL WHERE id=$1 RETURNING *', [p.id])).rows[0];
          return { runId: p.active_run_id, project: up };
        });
        broadcastStatus(result.project);
        return json(res, 200, { runId: result.runId });
      }
      if (action === 'runs' && method === 'GET') {
        const { rows } = await q(
          `SELECT r.id, r.started_at, r.ended_at, jsonb_array_length(r.questions) AS questions,
             (SELECT count(*)::int FROM players pl WHERE pl.run_id = r.id) AS players
           FROM runs r WHERE r.project_id=$1 ORDER BY r.started_at DESC`,
          [project.id]
        );
        return json(
          res,
          200,
          rows.map((r) => ({ id: r.id, startedAt: ms(r.started_at), endedAt: ms(r.ended_at), live: !r.ended_at, players: r.players, questions: r.questions }))
        );
      }
    }

    if (parts[1] === 'runs' && parts[2] && method === 'GET') {
      const run = await getRun(parts[2]);
      if (!run) throw new HttpError(404, 'Run not found');
      return json(res, 200, await computeResults(run));
    }
    throw new HttpError(404, 'Not found');
  }

  // ----- player -----
  if (parts[0] === 'play') {
    if (parts[1] === 'share-card' && method === 'POST') return json(res, 201, await saveShareCard(await readJson(req)));

    if (parts[1] === 'answer' && method === 'POST') {
      const result = await submitAnswer(await readJson(req));
      if (result.projectId) notifyAdmins(result.projectId);
      return json(res, result.status || 200, result.body);
    }

    const project = await getProjectByCode(parts[1] || '');
    if (!project) throw new HttpError(404, 'No game with that code');

    if (!parts[2] && method === 'GET') return json(res, 200, statusOf(project));

    if (parts[2] === 'events' && method === 'GET') {
      openStream(res);
      if (!playerStreams.has(project.id)) playerStreams.set(project.id, new Set());
      playerStreams.get(project.id).add(res);
      send(res, 'status', statusOf(project));
      req.on('close', () => playerStreams.get(project.id)?.delete(res));
      return;
    }

    if (parts[2] === 'join' && method === 'POST') {
      const body = await readJson(req);
      const run = project.active_run_id && (await getRun(project.active_run_id));
      if (!run || run.ended_at) return json(res, 409, { error: 'The test has not started yet', waiting: true });
      let player = isUuid(body.playerId) ? (await q('SELECT * FROM players WHERE id=$1 AND run_id=$2', [body.playerId, run.id])).rows[0] : null;
      if (!player) {
        const name = str(body.name, 40);
        if (!name) throw new HttpError(400, 'Tell us your name first');
        const { rows } = await q('SELECT count(*)::int AS n FROM players WHERE run_id=$1', [run.id]);
        if (rows[0].n >= MAX_PLAYERS) throw new HttpError(429, 'This game is full');
        player = (await q('INSERT INTO players (id, run_id, name) VALUES ($1,$2,$3) RETURNING *', [uuid(), run.id, name])).rows[0];
        notifyAdmins(project.id);
      }
      return json(res, 200, {
        runId: run.id,
        playerId: player.id,
        name: player.name,
        projectName: run.project_name,
        hintAfter: run.hint_after,
        fullScore: !!project.show_full_score,
        questions: publicQuestions(run),
        progress: await playerProgress(run, player.id),
      });
    }
  }
  throw new HttpError(404, 'Not found');
}

// ---------- static files ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};
function serveStatic(req, res, url) {
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    rel = '/';
  }
  if (rel === '/' || rel === '/play' || rel.startsWith('/play/')) rel = '/index.html';
  else if (rel === '/admin' || rel === '/admin/') rel = '/admin.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// The player page, with Open Graph tags so LinkedIn shows a rich preview for shared links.
async function servePlayPage(req, res, url) {
  const indexHtml = await fs.promises.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  let tags = '';
  try {
    tags = await ogTags(req, url);
  } catch (err) {
    console.error('OG tags failed:', err.message);
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(tags ? indexHtml.replace('</title>', `</title>\n  ${tags}`) : indexHtml);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/og/')) return await serveShareImage(res, url.pathname.slice(4));
    if (url.pathname.startsWith('/play/')) return await servePlayPage(req, res, url);
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);
    await handleApi(req, res, url);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) json(res, status, { error: status === 500 ? 'Something went wrong' : err.message });
  }
});

(async () => {
  try {
    await q(SCHEMA);
  } catch (err) {
    console.error('\n  ✋ Could not connect to Postgres:', err.message, '\n');
    process.exit(1);
  }
  await startListener();
  server.listen(PORT, () => {
    const lan = Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => `http://${i.address}:${PORT}`);
    console.log(`\n  ✏️  Doodle Quiz is running (Postgres connected${listener ? ', live sync on' : ''})\n`);
    console.log(`  Players : http://localhost:${PORT}${lan.length ? '   (phones on same Wi-Fi: ' + lan.join(', ') + ')' : ''}`);
    console.log(`  Admin   : http://localhost:${PORT}/admin   (password: ${process.env.ADMIN_PASSWORD ? 'from ADMIN_PASSWORD' : 'admin123'})\n`);
  });
})();
