// Admin dashboard: projects → question editor (+ live start/stop) → results.
(() => {
  const app = $('#app');
  const EFFECT_LABELS = {
    random: '🎲 Surprise me (random)',
    boom: '💥 BOOM! (explodes)',
    poof: '☁️ POOF! (turns to smoke)',
    vanish: '✨ Disappear (vanishes)',
    splat: '🟣 SPLAT! (ink blot)',
    shake: '🙅 NOPE! (shake it off)',
  };
  const S = { token: store.get('dq:admin', null), route: '', project: null, dirty: false, events: null, refreshTimer: null, lastHash: location.hash };

  const call = (path, opts = {}) =>
    api(path, { ...opts, token: S.token }).catch((err) => {
      if (err.status === 401) {
        logout();
        throw Object.assign(new Error('Please log in again'), { handled: true });
      }
      throw err;
    });
  const fail = (err) => !err.handled && toast(err.message, 'error');
  const fmtDate = (t) => (t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const joinUrl = (code) => `${location.origin}/play/${code}`;
  const blankQuestion = () => ({ id: crypto.randomUUID?.() || String(Math.random()).slice(2), text: '', options: ['', '', '', ''], correct: 0, mustBeCorrect: false, effect: 'random' });

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied! 📋', 'ok');
    } catch {
      prompt('Copy this:', text);
    }
  }

  // ---------- auth ----------
  function logout() {
    S.token = null;
    store.del('dq:admin');
    S.events?.close();
    S.events = null;
    $('#logoutBtn').classList.add('hidden');
    loginScreen();
  }
  $('#logoutBtn').addEventListener('click', logout);

  function loginScreen() {
    app.innerHTML = `
      <form class="card yellow tape login" id="loginForm">
        <h1 class="center">📒 Admin</h1>
        <p class="center muted">Only quiz masters beyond this point.</p>
        <label class="field"><span>Password</span><input class="input" type="password" id="pw" required autocomplete="current-password" /></label>
        <button class="btn big pink block" type="submit">Open the notebook</button>
      </form>`;
    $('#pw').focus();
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const { token } = await api('/api/admin/login', { method: 'POST', body: { password: $('#pw').value } });
        S.token = token;
        store.set('dq:admin', token);
        boot();
      } catch (err) {
        toast(err.message, 'error');
        $('#loginForm').animate([{ transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'none' }], { duration: 300 });
      }
    });
  }

  // ---------- live updates ----------
  function connectEvents() {
    S.events?.close();
    S.events = new EventSource(`/api/admin/events?token=${encodeURIComponent(S.token)}`);
    S.events.addEventListener('update', (e) => {
      const { projectId } = JSON.parse(e.data);
      const [page, id] = S.route;
      if (page === 'home' || ((page === 'project' || page === 'results') && id === projectId)) {
        clearTimeout(S.refreshTimer);
        S.refreshTimer = setTimeout(() => refreshLive(), 250);
      }
    });
  }
  function refreshLive() {
    const [page] = S.route;
    if (page === 'home') return homeScreen(true);
    if (page === 'project') return refreshControl();
    if (page === 'results') return resultsScreen(S.route[1], S.route[2], true);
  }

  // ---------- routing ----------
  function parseRoute() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (parts[0] === 'p' && parts[1]) return ['project', parts[1]];
    if (parts[0] === 'r' && parts[1]) return ['results', parts[1], parts[2]];
    return ['home'];
  }
  function route() {
    S.route = parseRoute();
    const [page, a, b] = S.route;
    if (page === 'project') return editorScreen(a);
    if (page === 'results') return resultsScreen(a, b);
    homeScreen();
  }
  window.addEventListener('hashchange', () => {
    if (S.dirty && !confirm('You have unsaved changes. Leave anyway?')) {
      history.replaceState(null, '', S.lastHash || '#/');
      return;
    }
    S.dirty = false;
    S.lastHash = location.hash;
    route();
  });
  window.addEventListener('beforeunload', (e) => {
    if (S.dirty) e.preventDefault();
  });

  // ---------- home: projects ----------
  async function homeScreen(silent = false) {
    if (!silent) app.innerHTML = '<p class="center">Flipping pages<span class="dots"></span></p>';
    let list;
    try {
      list = await call('/api/admin/projects');
    } catch (err) {
      return fail(err);
    }
    if (S.route[0] !== 'home') return;
    const colors = ['yellow', 'pink', 'blue', 'green', 'orange', 'purple'];
    app.innerHTML = `
      <div class="page-head">
        <div><h1><span class="scribble-underline">My quiz projects</span></h1><p class="muted" style="margin:6px 0 0">Make a project, add MCQs, hit start, share the code.</p></div>
        <button class="btn big pink" id="newBtn" type="button">＋ New project</button>
      </div>
      ${
        list.length
          ? `<div class="projects">${list
              .map(
                (p, i) => `
            <article class="card ${colors[i % colors.length]} tape project-card">
              <div class="row"><h3>${esc(p.name)}</h3>${p.running ? '<span class="badge live">● LIVE</span>' : ''}</div>
              <div class="stats">
                <span class="badge">📝 ${p.questionCount} question${p.questionCount === 1 ? '' : 's'}</span>
                <span class="badge">🔑 ${esc(p.code)}</span>
                ${p.running ? `<span class="badge">🧑‍🤝‍🧑 ${p.livePlayers} playing</span>` : `<span class="badge">🗂 ${p.runCount} past run${p.runCount === 1 ? '' : 's'}</span>`}
              </div>
              <div class="actions">
                <a class="btn small white" href="#/p/${p.id}">✏️ Edit & run</a>
                <a class="btn small white" href="#/r/${p.id}">📊 Results</a>
              </div>
            </article>`
              )
              .join('')}</div>`
          : `<div class="card white empty tape"><div class="big">📓</div><h2>Your notebook is empty</h2><p>Create your first quiz project to get started.</p></div>`
      }`;
    $('#newBtn').addEventListener('click', newProject);
  }

  function newProject() {
    modal(
      `<h2>New quiz project</h2>
       <form id="npForm">
         <label class="field"><span>Project name</span><input class="input" id="npName" maxlength="120" placeholder="e.g. Friday Fun Trivia" required /></label>
         <div class="row end"><button class="btn white" type="button" data-close>Cancel</button><button class="btn pink" type="submit">Create ✨</button></div>
       </form>`,
      {
        onMount(el, close) {
          $('#npName', el).focus();
          $('#npForm', el).addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
              const p = await call('/api/admin/projects', { method: 'POST', body: { name: $('#npName', el).value } });
              close();
              location.hash = `#/p/${p.id}`;
            } catch (err) {
              fail(err);
            }
          });
        },
      }
    );
  }

  // ---------- editor ----------
  async function editorScreen(id) {
    app.innerHTML = '<p class="center">Opening project<span class="dots"></span></p>';
    try {
      S.project = await call(`/api/admin/projects/${id}`);
    } catch (err) {
      fail(err);
      return (app.innerHTML = '<div class="card white empty"><h2>Project not found</h2><a class="btn" href="#/">Back to projects</a></div>');
    }
    S.dirty = false;
    renderEditor();
  }

  function setDirty(v = true) {
    S.dirty = v;
    const d = $('#dirtyNote');
    if (d) d.textContent = v ? '✏️ Unsaved changes' : '✅ All saved';
  }

  function controlHtml(p, livePlayers = 0) {
    return `
      <div>
        <p class="muted" style="margin:0">Players join with this code</p>
        <div class="join-code">${esc(p.code)}</div>
        <div class="join-link"><code>${esc(joinUrl(p.code))}</code><button class="btn small white" type="button" data-act="copy-link">Copy link</button></div>
      </div>
      <div class="center">
        ${
          p.running
            ? `<p style="margin:0 0 8px"><span class="badge live">● LIVE</span> <b>${livePlayers}</b> player${livePlayers === 1 ? '' : 's'} in</p>
               <div class="row" style="justify-content:center">
                 <a class="btn white" href="#/r/${p.id}/${p.activeRunId}">📊 Live results</a>
                 <button class="btn big stop" type="button" data-act="stop">⏹ Stop test</button>
               </div>`
            : `<button class="btn big go" type="button" data-act="start">▶ Run test</button>
               <p class="small muted" style="margin:8px 0 0">Players can’t answer until you start.</p>`
        }
      </div>`;
  }

  async function refreshControl() {
    if (!S.project) return;
    try {
      const list = await call('/api/admin/projects');
      const item = list.find((x) => x.id === S.project.id);
      if (!item || S.route[0] !== 'project') return;
      S.project.running = item.running;
      S.project.activeRunId = item.runId;
      const panel = $('#control');
      if (panel) panel.innerHTML = controlHtml(S.project, item.livePlayers);
    } catch (err) {
      fail(err);
    }
  }

  function questionHtml(q, qi, total) {
    return `
      <article class="card q-edit" data-q="${qi}">
        <div class="q-head">
          <span class="q-num">${qi + 1}</span>
          ${q.mustBeCorrect ? '<span class="badge lock">🔒 Locked</span>' : ''}
          <div class="tools">
            <button class="icon-btn" type="button" data-act="up" title="Move up" aria-label="Move up" ${qi === 0 ? 'disabled' : ''}>↑</button>
            <button class="icon-btn" type="button" data-act="down" title="Move down" aria-label="Move down" ${qi === total - 1 ? 'disabled' : ''}>↓</button>
            <button class="icon-btn" type="button" data-act="dup-q" title="Duplicate" aria-label="Duplicate">⧉</button>
            <button class="icon-btn" type="button" data-act="del-q" title="Delete" aria-label="Delete question">🗑</button>
          </div>
        </div>
        <label class="field"><span>Question</span>
          <textarea class="input" data-f="text" rows="2" maxlength="1000" placeholder="Type your question…">${esc(q.text)}</textarea>
        </label>
        <span>Answers <span class="small muted">(tap the letter to mark the correct one)</span></span>
        <div class="opt-list">
          ${q.options
            .map(
              (o, oi) => `
            <div class="opt-row ${q.correct === oi ? 'is-correct' : ''}">
              <label class="radio" title="Mark as correct"><input type="radio" name="c-${qi}" data-f="correct" data-o="${oi}" ${q.correct === oi ? 'checked' : ''} />${LETTERS[oi]}</label>
              <input class="input" data-f="opt" data-o="${oi}" maxlength="300" value="${esc(o)}" placeholder="Option ${LETTERS[oi]}" />
              <button class="icon-btn" type="button" data-act="del-opt" data-o="${oi}" aria-label="Remove option" ${q.options.length <= 2 ? 'disabled' : ''}>✕</button>
            </div>`
            )
            .join('')}
        </div>
        ${q.options.length < 6 ? '<button class="btn small white" type="button" data-act="add-opt">＋ Add option</button>' : ''}
        <div class="q-foot" style="margin-top:14px">
          <label class="check gate-check">
            <input type="checkbox" data-f="must" ${q.mustBeCorrect ? 'checked' : ''} /><span class="box"></span>
            <span>🔒 Must pick the correct answer to go to the next stage</span>
          </label>
          <label class="row" style="gap:8px"><span>Wrong-answer reaction</span>
            <select class="input" data-f="effect">${Object.entries(EFFECT_LABELS)
              .map(([k, v]) => `<option value="${k}" ${q.effect === k ? 'selected' : ''}>${v}</option>`)
              .join('')}</select>
          </label>
        </div>
      </article>`;
  }

  function renderEditor() {
    const p = S.project;
    const y = window.scrollY;
    const qs = p.questions;
    const locked = qs.filter((q) => q.mustBeCorrect).length;
    app.innerHTML = `
      <a class="back-link" href="#/">← All projects</a>
      <div class="page-head">
        <h1>${esc(p.name)}</h1>
        <div class="row">
          <a class="btn small white" href="#/r/${p.id}">📊 Results</a>
          <button class="btn small danger" type="button" data-act="delete-project">Delete</button>
        </div>
      </div>

      <section class="card blue tape control" id="control">${controlHtml(p)}</section>
      ${p.running ? '<p class="badge lock" style="margin:-12px 0 20px">Heads up: edits apply the next time you start a test.</p>' : ''}

      <section class="settings">
        <label class="field card white"><span>Project name</span><input class="input" id="pName" maxlength="120" value="${esc(p.name)}" /></label>
        <label class="field card white"><span>👉 Point to the answer after…</span>
          <select class="input" id="pHint">
            ${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${p.hintAfter === n ? 'selected' : ''}>${n} wrong tr${n === 1 ? 'y' : 'ies'}</option>`).join('')}
            <option value="0" ${p.hintAfter === 0 ? 'selected' : ''}>Never — no hints!</option>
          </select>
          <span class="small muted" style="margin-top:6px">Only for 🔒 locked questions</span>
        </label>
      </section>

      <div class="page-head" style="margin-bottom:14px">
        <h2 style="margin:0">Questions <span class="badge">${qs.length}</span> ${locked ? `<span class="badge lock">🔒 ${locked} locked</span>` : ''}</h2>
        <div class="row">
          <button class="btn small white" type="button" data-act="import">⬆ Upload CSV</button>
          ${qs.length ? `<button class="btn small white" type="button" data-act="lock-all">${locked === qs.length ? 'Unlock all' : '🔒 Lock all'}</button>` : ''}
        </div>
      </div>
      <div class="q-list" id="qList">
        ${qs.length ? qs.map((q, i) => questionHtml(q, i, qs.length)).join('') : '<div class="card white empty"><div class="big">✍️</div><h3>No questions yet</h3><p>Add one below or upload a CSV.</p></div>'}
      </div>
      <div class="row" style="justify-content:center;margin-top:26px">
        <button class="btn big pink" type="button" data-act="add-q">＋ Add question</button>
      </div>

      <div class="save-bar">
        <span class="dirty small" id="dirtyNote"></span>
        <button class="btn green" type="button" data-act="save">💾 Save</button>
      </div>`;
    setDirty(S.dirty);
    window.scrollTo(0, y);
    refreshControl();
  }

  // Editor event delegation
  app.addEventListener('input', (e) => {
    if (S.route[0] !== 'project' || !S.project) return;
    const t = e.target;
    if (t.id === 'pName') {
      S.project.name = t.value;
      return setDirty();
    }
    const card = t.closest('[data-q]');
    if (!card) return;
    const q = S.project.questions[Number(card.dataset.q)];
    if (t.dataset.f === 'text') q.text = t.value;
    else if (t.dataset.f === 'opt') q.options[Number(t.dataset.o)] = t.value;
    else return;
    setDirty();
  });
  app.addEventListener('change', (e) => {
    if (S.route[0] !== 'project' || !S.project) return;
    const t = e.target;
    if (t.id === 'pHint') {
      S.project.hintAfter = Number(t.value);
      return setDirty();
    }
    const card = t.closest('[data-q]');
    if (!card) return;
    const q = S.project.questions[Number(card.dataset.q)];
    if (t.dataset.f === 'correct') {
      q.correct = Number(t.dataset.o);
      $$('.opt-row', card).forEach((row, i) => row.classList.toggle('is-correct', i === q.correct));
      Sound.pop();
    } else if (t.dataset.f === 'must') {
      q.mustBeCorrect = t.checked;
      Sound.pop();
      setDirty();
      return renderEditor();
    } else if (t.dataset.f === 'effect') q.effect = t.value;
    else return;
    setDirty();
  });
  app.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || S.route[0] !== 'project' || !S.project) return;
    const p = S.project;
    const card = btn.closest('[data-q]');
    const qi = card ? Number(card.dataset.q) : -1;
    const q = p.questions[qi];
    const act = btn.dataset.act;
    const structural = {
      'add-q': () => {
        p.questions.push(blankQuestion());
        setTimeout(() => $$('.q-edit').at(-1)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 30);
      },
      'del-q': () => {
        if ((q.text || q.options.some(Boolean)) && !confirm(`Delete question ${qi + 1}?`)) return false;
        p.questions.splice(qi, 1);
      },
      'dup-q': () => p.questions.splice(qi + 1, 0, { ...JSON.parse(JSON.stringify(q)), id: blankQuestion().id }),
      up: () => qi > 0 && p.questions.splice(qi - 1, 0, p.questions.splice(qi, 1)[0]),
      down: () => qi < p.questions.length - 1 && p.questions.splice(qi + 1, 0, p.questions.splice(qi, 1)[0]),
      'add-opt': () => q.options.length < 6 && q.options.push(''),
      'del-opt': () => {
        const oi = Number(btn.dataset.o);
        if (q.options.length <= 2) return false;
        q.options.splice(oi, 1);
        if (q.correct === oi) q.correct = 0;
        else if (q.correct > oi) q.correct--;
      },
      'lock-all': () => {
        const all = p.questions.every((x) => x.mustBeCorrect);
        p.questions.forEach((x) => (x.mustBeCorrect = !all));
      },
    };
    if (structural[act]) {
      if (structural[act]() === false) return;
      setDirty();
      return renderEditor();
    }
    if (act === 'save') return save();
    if (act === 'copy-link') return copy(joinUrl(p.code));
    if (act === 'import') return importModal();
    if (act === 'start') return startTest(btn);
    if (act === 'stop') return stopTest(btn);
    if (act === 'delete-project') return deleteProject();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's' && S.route[0] === 'project') {
      e.preventDefault();
      save();
    }
  });

  async function save() {
    const p = S.project;
    try {
      const saved = await call(`/api/admin/projects/${p.id}`, { method: 'PUT', body: { name: p.name, hintAfter: p.hintAfter, questions: p.questions } });
      S.project = saved;
      S.dirty = false;
      toast('Saved! 💾', 'ok');
      renderEditor();
      return true;
    } catch (err) {
      fail(err);
      const n = /Question (\d+)/.exec(err.message);
      if (n) $$('.q-edit')[Number(n[1]) - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
  }

  async function startTest(btn) {
    if (S.dirty && !(await save())) return;
    if (!S.project.questions.length) return toast('Add at least one question first ✍️', 'error');
    btn.disabled = true;
    try {
      await call(`/api/admin/projects/${S.project.id}/start`, { method: 'POST' });
      Sound.yay();
      toast('Test is LIVE! Share the code 🚀', 'ok');
      refreshControl();
    } catch (err) {
      btn.disabled = false;
      fail(err);
    }
  }

  function stopTest() {
    modal(
      `<h2>⏹ Stop the test?</h2>
       <p>Everyone gets a “Pencils down!” screen and can’t answer anymore. You’ll jump straight to the results.</p>
       <div class="row end"><button class="btn white" type="button" data-close>Keep going</button><button class="btn stop" type="button" id="confirmStop">Stop it</button></div>`,
      {
        onMount(el, close) {
          $('#confirmStop', el).addEventListener('click', async () => {
            try {
              const { runId } = await call(`/api/admin/projects/${S.project.id}/stop`, { method: 'POST' });
              close();
              Sound.boom();
              S.dirty = false;
              location.hash = `#/r/${S.project.id}/${runId}`;
            } catch (err) {
              fail(err);
            }
          });
        },
      }
    );
  }

  function deleteProject() {
    modal(
      `<h2>🗑 Delete “${esc(S.project.name)}”?</h2>
       <p>This removes the project, its questions and <b>all past results</b>. There’s no undo.</p>
       <div class="row end"><button class="btn white" type="button" data-close>Cancel</button><button class="btn danger" type="button" id="confirmDel">Delete forever</button></div>`,
      {
        onMount(el, close) {
          $('#confirmDel', el).addEventListener('click', async () => {
            try {
              await call(`/api/admin/projects/${S.project.id}`, { method: 'DELETE' });
              close();
              S.dirty = false;
              toast('Project deleted', 'ok');
              location.hash = '#/';
            } catch (err) {
              fail(err);
            }
          });
        },
      }
    );
  }

  // ---------- CSV upload ----------
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        row.push(cell);
        cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += ch;
    }
    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter((r) => r.some((c) => c.trim()));
  }

  // Columns: question, option_a … option_f, correct (A-F / 1-6 / exact text), locked (yes/no), effect
  function csvToQuestions(text) {
    const rows = parseCsv(text.replace(/^﻿/, ''));
    if (!rows.length) throw new Error('That file looks empty');
    let header = rows[0].map((h) => h.trim().toLowerCase());
    const hasHeader = header[0].startsWith('question');
    if (!hasHeader) header = ['question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct', 'locked', 'effect'];
    const col = (name) => header.findIndex((h) => h.replace(/[\s-]+/g, '_').startsWith(name));
    const qCol = col('question');
    const optCols = header.map((h, i) => (/^(option|opt|choice|answer_?[a-f1-6])/.test(h.replace(/\s+/g, '_')) && !/correct/.test(h) ? i : -1)).filter((i) => i >= 0);
    const cCol = col('correct');
    const lCol = header.findIndex((h) => /lock|must|gate|required/.test(h));
    const eCol = col('effect');
    if (qCol < 0 || optCols.length < 2 || cCol < 0) throw new Error('Need columns: question, option A, option B…, correct');

    return rows.slice(hasHeader ? 1 : 0).map((r, n) => {
      const line = n + (hasHeader ? 2 : 1);
      const options = optCols.map((i) => (r[i] || '').trim()).filter(Boolean).slice(0, 6);
      const raw = (r[cCol] || '').trim();
      let correct = -1;
      if (/^[a-f]$/i.test(raw)) correct = raw.toUpperCase().charCodeAt(0) - 65;
      else if (/^[1-6]$/.test(raw)) correct = Number(raw) - 1;
      else correct = options.findIndex((o) => o.toLowerCase() === raw.toLowerCase());
      if (!(r[qCol] || '').trim()) throw new Error(`Line ${line}: missing question text`);
      if (options.length < 2) throw new Error(`Line ${line}: needs at least 2 options`);
      if (correct < 0 || correct >= options.length) throw new Error(`Line ${line}: can’t tell which answer is correct (“${raw}”)`);
      const effect = (r[eCol] || '').trim().toLowerCase();
      return {
        ...blankQuestion(),
        text: r[qCol].trim(),
        options,
        correct,
        mustBeCorrect: lCol >= 0 && /^(y|yes|true|1|x|locked)$/i.test((r[lCol] || '').trim()),
        effect: EFFECT_LABELS[effect] ? effect : 'random',
      };
    });
  }

  const TEMPLATE = [
    'question,option_a,option_b,option_c,option_d,correct,locked,effect',
    'What is the capital of France?,Berlin,Paris,Rome,Madrid,B,yes,boom',
    'How many legs does a spider have?,6,8,10,12,B,no,poof',
    '"Which planet is known as the ""Red Planet""?",Venus,Jupiter,Mars,Saturn,Mars,yes,random',
  ].join('\n');

  function importModal() {
    modal(
      `<h2>⬆ Upload questions</h2>
       <p>Upload a <b>.csv</b> file (Excel / Google Sheets → Download as CSV) or paste rows below.</p>
       <div class="import-help"><code>${esc(TEMPLATE)}</code></div>
       <p class="small muted" style="margin-top:8px"><b>correct</b> = letter (A–F), number (1–6) or the exact answer text · <b>locked</b> = yes/no · <b>effect</b> = boom, poof, vanish, splat, shake or random</p>
       <div class="row" style="margin:10px 0"><button class="btn small white" type="button" id="tplBtn">⬇ Download template</button></div>
       <label class="file-drop"><input type="file" id="csvFile" accept=".csv,text/csv,text/plain" />📎 Choose a CSV file…</label>
       <label class="field" style="margin-top:12px"><span>…or paste here</span><textarea class="input" id="csvText" rows="5" placeholder="question,option_a,option_b,…"></textarea></label>
       <p id="csvPreview" class="small"></p>
       <div class="row end"><button class="btn white" type="button" data-close>Cancel</button><button class="btn pink" type="button" id="csvGo" disabled>Add questions</button></div>`,
      {
        onMount(el, close) {
          let parsed = [];
          const preview = () => {
            const text = $('#csvText', el).value;
            const out = $('#csvPreview', el);
            parsed = [];
            if (!text.trim()) {
              out.textContent = '';
            } else {
              try {
                parsed = csvToQuestions(text);
                out.innerHTML = `✅ Found <b>${parsed.length}</b> question${parsed.length === 1 ? '' : 's'} (${parsed.filter((q) => q.mustBeCorrect).length} locked)`;
              } catch (err) {
                out.innerHTML = `<span class="badge bad">⚠️ ${esc(err.message)}</span>`;
              }
            }
            $('#csvGo', el).disabled = !parsed.length;
          };
          $('#csvText', el).addEventListener('input', preview);
          $('#csvFile', el).addEventListener('change', async (e) => {
            const f = e.target.files[0];
            if (!f) return;
            $('#csvText', el).value = await f.text();
            preview();
          });
          $('#tplBtn', el).addEventListener('click', () => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }));
            a.download = 'quiz-template.csv';
            a.click();
          });
          $('#csvGo', el).addEventListener('click', () => {
            S.project.questions.push(...parsed);
            close();
            setDirty();
            renderEditor();
            toast(`Added ${parsed.length} questions — don’t forget to save 💾`, 'ok');
          });
        },
      }
    );
  }

  // ---------- results ----------
  async function resultsScreen(projectId, runId, silent = false) {
    if (!silent) app.innerHTML = '<p class="center">Crunching the numbers<span class="dots"></span></p>';
    let project, runs, res;
    try {
      [project, runs] = await Promise.all([call(`/api/admin/projects/${projectId}`), call(`/api/admin/projects/${projectId}/runs`)]);
      const chosen = runId || runs[0]?.id;
      res = chosen ? await call(`/api/admin/runs/${chosen}`) : null;
    } catch (err) {
      return fail(err);
    }
    if (S.route[0] !== 'results' || S.route[1] !== projectId) return;
    S.results = res;

    const head = `
      <a class="back-link" href="#/p/${project.id}">← Back to ${esc(project.name)}</a>
      <div class="page-head"><h1><span class="scribble-underline">Results</span></h1>
        ${res ? `<div class="row"><button class="btn small pink" type="button" id="pdfExport">📄 Scoreboard PDF</button><button class="btn small white" type="button" id="csvExport">⬇ Export CSV</button></div>` : ''}
      </div>`;
    if (!res) {
      app.innerHTML = `${head}<div class="card white empty tape"><div class="big">📊</div><h2>No test runs yet</h2><p>Start a test from the project page — results show up here live.</p><a class="btn pink" href="#/p/${project.id}">Go run a test</a></div>`;
      return;
    }

    const n = res.players.length;
    const finished = res.players.filter((p) => p.finishedAt).length;
    const qCount = res.questions.length;
    const avg = n ? (res.players.reduce((s, p) => s + p.score, 0) / n).toFixed(1) : '0';
    const traps = res.questions.filter((q) => q.trap);
    const hardest = res.questions.filter((q) => q.answered).sort((a, b) => a.firstRightPct - b.firstRightPct)[0];

    app.innerHTML = `${head}
      <div class="run-picker">
        <select class="input" id="runSelect" aria-label="Choose a test run">
          ${runs.map((r, i) => `<option value="${r.id}" ${r.id === res.id ? 'selected' : ''}>${r.live ? '● LIVE — ' : ''}Run #${runs.length - i} · ${fmtDate(r.startedAt)} · ${r.players} player${r.players === 1 ? '' : 's'}</option>`).join('')}
        </select>
        ${res.live ? '<span class="badge live">● LIVE — updating automatically</span>' : `<span class="badge">Ended ${fmtDate(res.endedAt)}</span>`}
        ${res.live && project.running && project.activeRunId === res.id ? '<button class="btn small stop" type="button" id="stopHere">⏹ Stop test</button>' : ''}
      </div>

      <div class="tiles">
        <div class="card yellow tile"><div class="num">${n}</div><div class="lbl">players</div></div>
        <div class="card green tile"><div class="num">${finished}</div><div class="lbl">finished</div></div>
        <div class="card blue tile"><div class="num">${avg}<span class="small">/${qCount}</span></div><div class="lbl">avg first-try score</div></div>
        <div class="card pink tile"><div class="num">${traps.length}</div><div class="lbl">trick question${traps.length === 1 ? '' : 's'} 🪤</div></div>
      </div>

      ${hardest ? `<div class="callout trap" style="margin-bottom:24px">🧠 <b>Toughest one:</b> Q${res.questions.indexOf(hardest) + 1} — only ${hardest.firstRightPct}% got it on the first click.</div>` : ''}

      <div class="page-head" style="margin-bottom:6px">
        <h2 style="margin:0">What people clicked <u>first</u></h2>
        <label class="switch" title="What players see as their final score">
          <input type="checkbox" id="fullScoreToggle" ${project.showFullScore ? 'checked' : ''} />
          <span class="track" aria-hidden="true"><span class="knob"></span></span>
          <span class="switch-text"><b>Full score</b> <span class="badge ${project.showFullScore ? 'good' : ''}" id="fullScoreState">${project.showFullScore ? 'ON' : 'OFF'}</span></span>
        </label>
      </div>
      <p class="muted">The first answer each person tapped — i.e. what they <i>thought</i> was correct before any hints.
        <br><span class="small" id="fullScoreHelp">${fullScoreHelp(project.showFullScore)}</span></p>
      ${res.questions.map((q, i) => resultQuestionHtml(q, i)).join('')}

      <div class="page-head" style="margin:34px 0 8px"><h2 style="margin:0">🏆 Scoreboard</h2>${n ? '<button class="btn small pink" type="button" id="pdfExport2">📄 Export PDF</button>' : ''}</div>
      <p class="muted">Score = answers right on the first click · Solved = got right in the end. Chips show each person’s first pick per question.</p>
      <div class="card white table-wrap">
        ${
          n
            ? `<table class="sketch-table">
          <thead><tr><th>#</th><th>Name</th><th>Score</th><th>Solved</th><th>Wrong taps</th><th>First picks</th><th>Status</th></tr></thead>
          <tbody>${res.players
            .map(
              (p, i) => `<tr>
              <td>${i < 3 ? `<span class="medal">${['🥇', '🥈', '🥉'][i]}</span>` : i + 1}</td>
              <td class="name">${esc(p.name)}</td>
              <td><b>${p.score}</b>/${qCount}</td>
              <td>${p.solved}/${qCount}</td>
              <td>${p.wrongClicks}</td>
              <td>${p.firstPicks.map((f, qi) => `<span class="chip ${f == null ? '' : f === res.questions[qi].correct ? 'ok' : 'no'}" title="Q${qi + 1}">${f == null ? '·' : LETTERS[f]}</span>`).join('')}</td>
              <td>${p.finishedAt ? '✅ done' : `✏️ ${p.answered}/${qCount}`}</td>
            </tr>`
            )
            .join('')}</tbody></table>`
            : '<p class="center muted" style="margin:20px">Nobody has joined yet. Share the code!</p>'
        }
      </div>`;

    $('#runSelect').addEventListener('change', (e) => (location.hash = `#/r/${project.id}/${e.target.value}`));
    $('#fullScoreToggle').addEventListener('change', async (e) => {
      const on = e.target.checked;
      try {
        await call(`/api/admin/projects/${project.id}`, { method: 'PUT', body: { showFullScore: on } });
        project.showFullScore = on;
        const state = $('#fullScoreState');
        state.textContent = on ? 'ON' : 'OFF';
        state.classList.toggle('good', on);
        $('#fullScoreHelp').innerHTML = fullScoreHelp(on);
        Sound.pop();
        toast(on ? 'Full score ON — players see e.g. 10/10 ✅' : 'Full score OFF — players see their first-try score', 'ok');
      } catch (err) {
        e.target.checked = !on;
        fail(err);
      }
    });
    $('#csvExport')?.addEventListener('click', () => exportCsv(res));
    const runNo = runs.length - runs.findIndex((r) => r.id === res.id);
    ['#pdfExport', '#pdfExport2'].forEach((sel) => $(sel)?.addEventListener('click', (e) => exportPdf(res, runNo, e.currentTarget)));
    $('#stopHere')?.addEventListener('click', async () => {
      if (!confirm('Stop the test for everyone?')) return;
      try {
        await call(`/api/admin/projects/${project.id}/stop`, { method: 'POST' });
        Sound.boom();
        toast('Test stopped ✋', 'ok');
        resultsScreen(project.id, res.id, true);
      } catch (err) {
        fail(err);
      }
    });
  }

  const fullScoreHelp = (on) =>
    on
      ? '🟢 <b>Full score ON:</b> players see how many they got right in the end (e.g. 10/10), and that’s what they share.'
      : '⚪ <b>Full score OFF:</b> players see their real first-try score (e.g. 3/10), and that’s what they share.';

  function resultQuestionHtml(q, i) {
    const max = Math.max(1, ...q.counts);
    let callout;
    if (!q.answered) callout = '<div class="callout none">No answers yet.</div>';
    else if (q.trap)
      callout = `<div class="callout trap">🪤 <b>Gotcha!</b> Most people first clicked <b>${LETTERS[q.topIndex]} “${esc(q.options[q.topIndex])}”</b> thinking it was correct. Only ${q.firstRightPct}% picked the real answer first.</div>`;
    else callout = `<div class="callout ok">🎯 <b>${q.firstRightPct}%</b> nailed it on the first click.${q.avgWrong ? ` Avg ${q.avgWrong} wrong taps per person.` : ''}</div>`;
    return `
      <section class="card ${i % 2 ? 'tilt-r' : 'tilt-l'} res-q">
        <div class="row" style="margin-bottom:6px"><span class="q-num" style="width:38px;height:38px">${i + 1}</span>${q.mustBeCorrect ? '<span class="badge lock">🔒 Locked</span>' : ''}<span class="badge">${q.answered} answered</span></div>
        <h3>${esc(q.text)}</h3>
        <div class="bars">
          ${q.options
            .map((o, oi) => {
              const pct = q.answered ? Math.round((q.counts[oi] / q.answered) * 100) : 0;
              const cls = oi === q.correct ? 'right' : q.trap && oi === q.topIndex ? 'trap' : '';
              return `<div class="bar-row ${cls}">
                <div class="bar-label"><b>${LETTERS[oi]}</b>${esc(o)} ${oi === q.correct ? '✔' : ''}</div>
                <div class="bar-track"><div class="bar-fill ${q.counts[oi] ? '' : 'zero'}" style="width:${(q.counts[oi] / max) * 100}%"></div></div>
                <div class="bar-num">${q.counts[oi]} · ${pct}%</div>
              </div>`;
            })
            .join('')}
        </div>
        ${callout}
      </section>`;
  }

  function exportCsv(res) {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Rank', 'Name', 'First-try score', 'Solved', 'Wrong taps', 'Finished', ...res.questions.map((q, i) => `Q${i + 1} first pick`)];
    const lines = [head.map(cell).join(',')];
    res.players.forEach((p, i) =>
      lines.push(
        [i + 1, p.name, p.score, p.solved, p.wrongClicks, p.finishedAt ? 'yes' : 'no', ...p.firstPicks.map((f, qi) => (f == null ? '' : `${LETTERS[f]}: ${res.questions[qi].options[f]}${f === res.questions[qi].correct ? ' ✔' : ''}`))]
          .map(cell)
          .join(',')
      )
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' }));
    a.download = `${res.projectName.replace(/[^\w-]+/g, '_')}-results.csv`;
    a.click();
  }

  // ---------- scoreboard PDF (sketchbook style) ----------
  const loadScript = (src) =>
    new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error('Could not load the PDF tools — check your internet connection'));
      document.head.appendChild(el);
    });

  // Notebook lines as an image: html2canvas draws background images more faithfully than gradients.
  function paperDataUrl() {
    const c = document.createElement('canvas');
    c.width = 794;
    c.height = 32;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fdfbf2';
    ctx.fillRect(0, 0, 794, 32);
    ctx.fillStyle = '#cfe0f1';
    ctx.fillRect(0, 31, 794, 1);
    ctx.fillStyle = '#f3a6a6';
    ctx.fillRect(52, 0, 2, 32);
    return c.toDataURL('image/png');
  }

  function pdfRowHtml(p, i, res) {
    const qCount = res.questions.length;
    return `<tr>
      <td class="rank">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</td>
      <td class="nm">${esc(p.name)}</td>
      <td><b>${p.score}</b>/${qCount}</td>
      <td>${p.solved}/${qCount}</td>
      <td>${p.wrongClicks}</td>
      <td class="picks">${p.firstPicks.map((f, qi) => `<span class="chip ${f == null ? '' : f === res.questions[qi].correct ? 'ok' : 'no'}">${f == null ? '·' : LETTERS[f]}</span>`).join('')}</td>
      <td>${p.finishedAt ? '✅' : `✏️ ${p.answered}/${qCount}`}</td>
    </tr>`;
  }

  async function exportPdf(res, runNo, btn) {
    if (!res.players.length) return toast('Nobody has played this run yet', 'error');
    const label = btn?.innerHTML;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = 'Drawing PDF<span class="dots"></span>';
    }
    try {
      await Promise.all([
        loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'),
        loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'),
      ]);
      await document.fonts.ready;

      const qCount = res.questions.length;
      const n = res.players.length;
      const finished = res.players.filter((p) => p.finishedAt).length;
      const avg = (res.players.reduce((s, p) => s + p.score, 0) / n).toFixed(1);
      const avgSolved = (res.players.reduce((s, p) => s + p.solved, 0) / n).toFixed(1);
      const chipLines = Math.max(1, Math.ceil(qCount / 12));
      const rowH = 42 + (chipLines - 1) * 24;
      const firstRows = Math.max(3, Math.floor(640 / rowH));
      const moreRows = Math.max(5, Math.floor(860 / rowH));
      const pages = [res.players.slice(0, firstRows)];
      for (let i = firstRows; i < n; i += moreRows) pages.push(res.players.slice(i, i + moreRows));

      const paper = paperDataUrl();
      const host = document.createElement('div');
      host.className = 'pdf-host';
      document.body.appendChild(host);
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
      let offset = 0;

      for (let pi = 0; pi < pages.length; pi++) {
        const rows = pages[pi];
        host.innerHTML = `
          <div class="pdf-page" style="background-image:url(${paper})">
            <div class="pdf-top"><span>📒 Doodle Quiz</span><span>Run #${runNo} · ${esc(fmtDate(res.startedAt))}</span></div>
            ${
              pi === 0
                ? `<h1 class="pdf-title"><span class="scribble-underline">Scoreboard</span> 🏆</h1>
                   <div class="pdf-sub"><span class="highlight">${esc(res.projectName)}</span> · ${qCount} questions · ${res.live ? 'still live' : `ended ${esc(fmtDate(res.endedAt))}`}</div>
                   <div class="pdf-tiles">
                     <div class="card yellow">${n}<small>players</small></div>
                     <div class="card green">${finished}<small>finished</small></div>
                     <div class="card blue">${avg}<small>avg first-try</small></div>
                     <div class="card pink">${avgSolved}<small>avg solved</small></div>
                   </div>`
                : `<h2 class="pdf-title small-title">Scoreboard <span class="muted">(continued)</span></h2>`
            }
            <div class="card pdf-table-card">
              <table class="sketch-table pdf-table">
                <thead><tr><th>#</th><th>Name</th><th>First try</th><th>Solved</th><th>Wrong</th><th>First picks</th><th>Done</th></tr></thead>
                <tbody>${rows.map((p, i) => pdfRowHtml(p, offset + i, res)).join('')}</tbody>
              </table>
            </div>
            <div class="pdf-foot"><span>First try = right on the first click · Solved = right in the end · <span class="chip ok">A</span> right <span class="chip no">A</span> wrong first pick</span><span>Page ${pi + 1} of ${pages.length}</span></div>
          </div>`;
        offset += rows.length;
        const canvas = await html2canvas(host.firstElementChild, { scale: 2, backgroundColor: '#fdfbf2', logging: false, useCORS: true });
        if (pi > 0) doc.addPage();
        doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 595.28, 841.89);
      }
      host.remove();
      doc.save(`${res.projectName.replace(/[^\w-]+/g, '_')}-scoreboard-run${runNo}.pdf`);
      toast('PDF downloaded 📄', 'ok');
    } catch (err) {
      $('.pdf-host')?.remove();
      toast(err.message || 'Could not create the PDF', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = label;
      }
    }
  }

  // ---------- boot ----------
  function boot() {
    $('#logoutBtn').classList.remove('hidden');
    connectEvents();
    route();
  }
  S.token ? boot() : loginScreen();
})();
