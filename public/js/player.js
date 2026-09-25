// Player flow: code → name → waiting room → questions → finish / pencils down.
(() => {
  const app = $('#app');
  const S = {
    code: null,
    name: store.get('dq:name', ''),
    status: null,
    runId: null,
    playerId: null,
    questions: [],
    progress: {},
    idx: 0,
    screen: null,
    joining: false,
    busy: false,
    events: null,
  };

  const ADJ = ['Sneaky', 'Wobbly', 'Cosmic', 'Fuzzy', 'Turbo', 'Sparkly', 'Grumpy', 'Jolly', 'Sleepy', 'Mighty', 'Bouncy', 'Crispy', 'Doodly', 'Zippy'];
  const NOUN = ['Penguin', 'Pickle', 'Noodle', 'Llama', 'Taco', 'Otter', 'Waffle', 'Panda', 'Cactus', 'Dumpling', 'Octopus', 'Muffin', 'Yeti', 'Pencil'];
  const randomName = () => `${pick(ADJ)} ${pick(NOUN)}`;
  const CARD_COLORS = ['yellow', 'pink', 'blue', 'green', 'orange', 'purple'];

  // ---------- helpers ----------
  function show(name, html, after) {
    const old = app.firstElementChild;
    const mount = () => {
      S.screen = name;
      app.innerHTML = `<section class="screen screen-${name}">${html}</section>`;
      removeActionBar();
      window.scrollTo(0, 0);
      after?.(app.firstElementChild);
    };
    if (old && S.screen && S.screen !== name) {
      old.classList.add('leaving');
      setTimeout(mount, 260);
    } else mount();
  }
  function actionBar(label, onClick, cls = 'go') {
    removeActionBar();
    const bar = document.createElement('div');
    bar.className = 'action-bar';
    bar.id = 'actionBar';
    bar.innerHTML = `<button class="btn big ${cls}" type="button">${label}</button>`;
    bar.querySelector('button').addEventListener('click', onClick);
    document.body.appendChild(bar);
    setTimeout(() => bar.querySelector('button')?.focus({ preventScroll: true }), 50);
  }
  const removeActionBar = () => $('#actionBar')?.remove();
  function setWho() {
    const who = $('#whoami');
    if (S.playerId && S.name) {
      who.textContent = `🙂 ${S.name}`;
      who.classList.remove('hidden');
    } else who.classList.add('hidden');
  }
  const scoreNow = () => S.questions.filter((q) => S.progress[q.id]?.firstTryCorrect).length;
  const solvedNow = () => S.questions.filter((q) => S.progress[q.id]?.solved).length;

  // ---------- mute ----------
  const muteBtn = $('#muteBtn');
  const paintMute = () => (muteBtn.textContent = Sound.muted ? '🔇' : '🔊');
  paintMute();
  muteBtn.addEventListener('click', () => {
    Sound.toggle();
    paintMute();
    Sound.pop();
  });

  // ---------- screens ----------
  function codeScreen(error = '') {
    show(
      'code',
      `<div class="hero">
         <div class="big-emoji">🎒</div>
         <h1><span class="scribble-underline">Doodle Quiz</span></h1>
         <p class="muted">Grab your pencil. Got a secret game code from your host?</p>
       </div>
       <form class="card yellow tape tilt-l" id="codeForm" autocomplete="off">
         <label class="field"><span>Game code</span>
           <input class="input code-input" id="codeInput" maxlength="8" inputmode="text" autocapitalize="characters" placeholder="ABCDE" required />
         </label>
         ${error ? `<p class="badge bad">⚠️ ${esc(error)}</p>` : ''}
         <button class="btn big pink block" type="submit">Let me in ✏️</button>
       </form>`,
      (el) => {
        const input = $('#codeInput', el);
        input.focus();
        $('#codeForm', el).addEventListener('submit', (e) => {
          e.preventDefault();
          const code = input.value.trim().toUpperCase();
          if (!code) return;
          history.replaceState(null, '', `/play/${encodeURIComponent(code)}`);
          start(code);
        });
      }
    );
  }

  function nameScreen() {
    show(
      'name',
      `<div class="hero">
         <div class="big-emoji">👋</div>
         <h1>Hey there!</h1>
         <p>You're about to play <span class="highlight">${esc(S.status.name)}</span></p>
       </div>
       <form class="card pink tape tilt-r" id="nameForm" autocomplete="off">
         <label class="field"><span>What should we call you?</span>
           <div class="name-row">
             <input class="input" id="nameInput" maxlength="40" placeholder="Your name" required value="${esc(S.name)}" />
             <button class="icon-btn" id="dice" type="button" title="Give me a silly name" aria-label="Random name" style="width:52px;height:52px;flex:none">🎲</button>
           </div>
         </label>
         <button class="btn big block" type="submit">Let's gooo! 🚀</button>
         <p class="small muted center" style="margin:12px 0 0">Your name shows up on the host's scoreboard.</p>
       </form>`,
      (el) => {
        const input = $('#nameInput', el);
        if (!S.name) input.focus();
        $('#dice', el).addEventListener('click', () => {
          input.value = randomName();
          Sound.pop();
          $('#dice', el).animate([{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { duration: 400 });
        });
        $('#nameForm', el).addEventListener('submit', (e) => {
          e.preventDefault();
          const name = input.value.trim();
          if (!name) return;
          S.name = name;
          store.set('dq:name', name);
          Sound.pop();
          afterName();
        });
      }
    );
  }

  function waitingScreen(ended = false) {
    show(
      'waiting',
      `<div class="card blue tape waiting">
         <div class="doodle-clock">${ended ? '🏁' : '⏳'}</div>
         <h2>${ended ? 'That round is over!' : `Hang tight, ${esc(S.name)}!`}</h2>
         <p>${ended ? 'Stay here — you’ll jump in automatically when the host starts the next one' : 'Waiting for the host to start the test'}<span class="dots"></span></p>
         <ul class="tips card white tilt-l">
           <li>🔒 <b>Locked</b> questions need the right answer before you move on.</li>
           <li>💥 Wrong answers go <b>BOOM</b>, <b>POOF</b> or just… vanish.</li>
           <li>👉 Stuck? After a few misses we'll point you to the answer.</li>
           <li>⭐ Your score = answers you got right on the <b>first</b> try!</li>
         </ul>
       </div>`
    );
  }

  function questionScreen() {
    const q = S.questions[S.idx];
    const total = S.questions.length;
    const pct = Math.round((S.idx / total) * 100);
    const color = CARD_COLORS[S.idx % CARD_COLORS.length];
    const prog = S.progress[q.id] || { done: false, wrong: [] };
    const long = q.options.some((o) => o.length > 28);
    show(
      `q-${S.idx}`,
      `<div class="q-meta">
         <span class="q-page">Page ${S.idx + 1} of ${total}</span>
         <span class="badge">⭐ ${scoreNow()}</span>
       </div>
       <div class="pencil-progress" aria-hidden="true"><div class="fill" style="width:${pct}%"></div><span class="pencil" style="left:${pct}%">✏️</span></div>
       <div class="card ${color} tape ${S.idx % 2 ? 'tilt-r' : 'tilt-l'} question-card">
         ${q.mustBeCorrect ? '<span class="badge lock">🔒 Must get it right to unlock the next page</span>' : ''}
         <p class="q-text">${esc(q.text)}</p>
       </div>
       <div class="options ${long ? '' : 'two-col'}" role="group" aria-label="Answers">
         ${q.options
           .map(
             (o, i) => `<button class="option" type="button" data-i="${i}"><span class="letter">${LETTERS[i]}</span><span class="text">${esc(o)}</span></button>`
           )
           .join('')}
       </div>
       <div id="note"></div>`,
      (el) => {
        const buttons = $$('.option', el);
        for (const i of prog.wrong || []) {
          buttons[i].classList.add('crossed');
          buttons[i].disabled = true;
        }
        buttons.forEach((b) => b.addEventListener('click', () => answer(Number(b.dataset.i), b)));
      }
    );
  }

  function note(html, cls = 'yellow') {
    const n = $('#note');
    if (n) n.innerHTML = `<div class="card ${cls} answer-note">${html}</div>`;
  }

  const WRONG_LINES = ['Nope! Give it another shot 🤔', 'So close… (maybe) 😅', 'Oof! Try a different one 🙈', 'Not that one, buddy! 🐢', 'Plot twist: that was wrong 🎬'];
  const LOCK_LINES = ['🔒 This page is locked until you find the right one!', '🔒 No skipping! Find the correct answer to continue.'];

  async function answer(i, btn) {
    const q = S.questions[S.idx];
    if (S.busy || btn.disabled || S.progress[q.id]?.done) return;
    S.busy = true;
    btn.classList.add('busy');
    let res;
    try {
      res = await api('/api/play/answer', { method: 'POST', body: { runId: S.runId, playerId: S.playerId, questionId: q.id, option: i } });
    } catch (err) {
      btn.classList.remove('busy');
      S.busy = false;
      if (err.data?.stopped) return stoppedScreen();
      return toast(err.message, 'error');
    }
    btn.classList.remove('busy');
    S.busy = false;
    if (res.repeat) return;

    const buttons = $$('.option');
    const prog = (S.progress[q.id] ||= { done: false, wrong: [], firstTryCorrect: false });
    prog.done = res.done;
    if (res.correct) prog.solved = true;
    if (res.firstTry !== undefined) prog.firstTryCorrect = res.firstTry;

    if (res.correct) {
      buttons.forEach((b) => (b.disabled = true));
      $$('.hint-bubble, .hint-hand, .circle-mark').forEach((n) => n.remove());
      btn.classList.remove('hint');
      FX.playCorrect(btn, res.firstTry);
      note(res.firstTry ? '🎉 <b>First try!</b> +1 star for you ⭐' : '🙌 You got there! (No star this time — first tries only.)', 'green');
      return nextBar();
    }

    prog.wrong.push(i);
    btn.disabled = true;
    FX.playWrong(btn, q.effect);

    if (q.mustBeCorrect) {
      if (res.correctIndex != null) {
        setTimeout(() => FX.showHint(buttons[res.correctIndex], 'psst… it’s this one! tap it'), 450);
        note('👀 Okay okay, we’ll help — <b>tap the circled answer</b> to unlock the next page.', 'pink');
      } else {
        note(`${pick(WRONG_LINES)}<br><span class="small">${pick(LOCK_LINES)}</span>`, 'yellow');
      }
      return;
    }

    // One-shot question: reveal the answer and move on.
    buttons.forEach((b) => (b.disabled = true));
    if (res.correctIndex != null) {
      setTimeout(() => {
        const right = buttons[res.correctIndex];
        FX.showHint(right, '✔ here’s the answer!');
        right.classList.add('correct');
      }, 500);
    }
    note(`${pick(['Whoops! ', 'Aww, ', 'Ouch! '])}The right answer is <b>${esc(q.options[res.correctIndex])}</b>`, 'orange');
    nextBar();
  }

  function nextBar() {
    const last = S.idx >= S.questions.length - 1;
    actionBar(last ? 'Finish! 🏁' : 'Next page ➜', () => {
      Sound.pop();
      goToNext();
    });
  }
  function goToNext() {
    const next = S.questions.findIndex((q) => !S.progress[q.id]?.done);
    if (next === -1) return finishScreen();
    S.idx = next;
    questionScreen();
  }

  // The admin's "full score" switch decides what the big number means:
  // on  → questions right in the end (locked ones always end right)
  // off → the original first-try score
  const fullScoreOn = () => !!S.status?.fullScore;
  function scoreCard(title, subtitle) {
    const total = S.questions.length;
    const first = scoreNow();
    const full = fullScoreOn();
    const shown = full ? solvedNow() : first;
    const ratio = total ? shown / total : 0;
    const stars = ratio >= 0.9 ? 3 : ratio >= 0.6 ? 2 : ratio > 0 ? 1 : 0;
    const verdict =
      ratio === 1
        ? first === total
          ? 'Flawless! Absolute legend 🏆'
          : 'All correct — you got there! 🏆'
        : ratio >= 0.6
          ? 'Big brain energy 🧠'
          : ratio >= 0.3
            ? 'Not bad at all! 😎'
            : 'Hey, you showed up! 🫶';
    return {
      html: `<div class="card yellow tape finish">
               <h1>${title}</h1>
               <div class="score-circle">${shown}/${total}<small>${full ? 'answered correctly' : 'correct answers'}</small></div>
               <div class="stars">${[0, 1, 2].map((i) => `<span class="${i < stars ? '' : 'off'}" style="animation-delay:${0.3 + i * 0.2}s">⭐</span>`).join('')}</div>
               <h2>${verdict}</h2>
               <p class="muted">${subtitle}</p>
               <button class="btn linkedin share-main" type="button" id="shareBtn"><span class="in-logo">in</span> Share on LinkedIn</button>
             </div>`,
      celebrate: ratio >= 0.6,
    };
  }

  const wireShare = () => $('#shareBtn')?.addEventListener('click', () => Share.open(shareData()));
  const shareData = () => ({ code: S.code, name: S.name, quiz: S.status?.name || 'Doodle Quiz', solved: solvedNow(), first: scoreNow(), total: S.questions.length, fullScore: fullScoreOn() });

  function finishScreen() {
    const { html, celebrate } = scoreCard(`You did it, ${esc(S.name)}!`, 'All pages done! Hang out here — the host will wrap things up soon<span class="dots"></span>');
    show('finish', html, () => {
      wireShare();
      if (celebrate) {
        Sound.yay();
        FX.confetti(innerWidth / 2, innerHeight / 3, 70);
      }
    });
  }

  function stoppedScreen() {
    removeActionBar();
    if (!S.playerId) return waitingScreen(true);
    const { html } = scoreCard('✋ Pencils down!', 'The host has stopped the test. Thanks for playing! If a new round starts, you’ll hop right in.');
    show('stopped', html, () => {
      wireShare();
      Sound.boom();
    });
  }

  // ---------- live status + joining ----------
  function connect() {
    S.events?.close();
    const es = new EventSource(`/api/play/${encodeURIComponent(S.code)}/events`);
    S.events = es;
    es.addEventListener('status', (e) => onStatus(JSON.parse(e.data)));
  }

  function onStatus(status) {
    const prev = S.status;
    S.status = status;
    if (prev && !!prev.fullScore !== !!status.fullScore && status.runId === S.runId) {
      if (S.screen === 'finish') finishScreen();
      else if (S.screen === 'stopped') stoppedScreen();
    }
    if (!S.name || S.screen === 'name' || S.screen === 'code') return;
    if (status.running && status.runId !== S.runId) return join();
    if (!status.running && S.runId && prev?.running) {
      S.runId = null;
      return stoppedScreen();
    }
  }

  async function join() {
    if (S.joining || !S.status?.runId) return;
    S.joining = true;
    const runId = S.status.runId;
    try {
      const data = await api(`/api/play/${encodeURIComponent(S.code)}/join`, {
        method: 'POST',
        body: { name: S.name, playerId: store.get(`dq:player:${runId}`) },
      });
      store.set(`dq:player:${data.runId}`, data.playerId);
      Object.assign(S, { runId: data.runId, playerId: data.playerId, name: data.name, questions: data.questions, progress: data.progress, busy: false });
      for (const p of Object.values(S.progress)) p.wrong ||= [];
      setWho();
      const next = S.questions.findIndex((q) => !S.progress[q.id]?.done);
      if (next === -1) return finishScreen();
      if (next === 0 && !Object.keys(S.progress).length) toast(`Game on, ${S.name}! ✏️`, 'ok');
      S.idx = next;
      questionScreen();
    } catch (err) {
      if (err.data?.waiting) waitingScreen();
      else toast(err.message, 'error');
    } finally {
      S.joining = false;
    }
  }

  function afterName() {
    connect();
    if (S.status.running) join();
    else waitingScreen();
  }

  async function start(code) {
    S.code = code.toUpperCase();
    try {
      S.status = await api(`/api/play/${encodeURIComponent(S.code)}`);
    } catch (err) {
      history.replaceState(null, '', '/');
      return codeScreen(err.status === 404 ? 'Hmm, no game with that code' : err.message);
    }
    document.title = `${S.status.name} · Doodle Quiz`;
    // Already joined this round (e.g. page refresh)? Skip straight back in.
    if (S.status.running && S.name && store.get(`dq:player:${S.status.runId}`)) return afterName();
    nameScreen();
  }

  // keyboard: A–F / 1–6 to answer, Enter for next
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea') || e.metaKey || e.ctrlKey) return;
    const k = e.key.toUpperCase();
    let i = LETTERS.indexOf(k);
    if (i < 0 && /^[1-6]$/.test(k)) i = Number(k) - 1;
    const btn = $$('.option')[i];
    if (btn && !btn.disabled) btn.click();
  });

  const fromPath = location.pathname.match(/^\/play\/([^/]+)/);
  const code = fromPath ? decodeURIComponent(fromPath[1]) : new URLSearchParams(location.search).get('code');
  code ? start(code) : codeScreen();
})();
