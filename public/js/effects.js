// Comic-book reactions: BOOM, POOF, vanish, SPLAT, shake, YAY, and the "psst, it's this one" hint.
const FX = (() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const WRONG_EFFECTS = ['boom', 'poof', 'vanish', 'splat', 'shake'];

  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }
  function layer(className, x, y, html = '', life = 1200) {
    const el = document.createElement('div');
    el.className = `fx ${className}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.innerHTML = html;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), life);
    return el;
  }
  function burst(x, y, kind, text) {
    return layer(`fx-burst ${kind}`, x, y, `<span>${esc(text)}</span>`, 1100);
  }
  function particles(x, y, symbols, count = 12, spread = 150) {
    if (reduced) return;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const dist = spread * (0.6 + Math.random() * 0.6);
      const p = layer('fx-particle', x, y, esc(pick(symbols)), 1300);
      p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
      p.style.setProperty('--rot', `${Math.random() * 540 - 270}deg`);
      p.style.setProperty('--size', `${16 + Math.random() * 18}px`);
      p.style.setProperty('--dur', `${0.7 + Math.random() * 0.5}s`);
    }
  }
  function confetti(x, y, count = 40) {
    if (reduced) return;
    const colors = ['#ff5c8a', '#ffd43b', '#51cf66', '#4dabf7', '#9775fa', '#ff922b'];
    for (let i = 0; i < count; i++) {
      const c = layer('fx-confetti', x, y, '', 1900);
      c.style.setProperty('--c', pick(colors));
      c.style.setProperty('--dx', `${(Math.random() - 0.5) * 520}px`);
      c.style.setProperty('--dy', `${-120 - Math.random() * 260 + Math.random() * 520}px`);
      c.style.setProperty('--rot', `${Math.random() * 900}deg`);
      c.style.setProperty('--dur', `${1.1 + Math.random() * 0.8}s`);
    }
  }
  function shakeScreen() {
    const main = document.getElementById('app');
    main.classList.remove('screen-shake');
    void main.offsetWidth;
    main.classList.add('screen-shake');
  }
  const retrigger = (el, cls) => {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  };

  const wrong = {
    boom(el) {
      const c = centerOf(el);
      retrigger(el, 'shake');
      Sound.boom();
      shakeScreen();
      burst(c.x, c.y, 'boom', pick(['BOOM!', 'KABOOM!', 'BLAM!']));
      particles(c.x, c.y, ['✦', '✸', '💥', '★', '⚡'], 14, 170);
      setTimeout(() => el.classList.add('crossed'), 350);
    },
    poof(el) {
      const c = centerOf(el);
      Sound.poof();
      burst(c.x, c.y, 'poof', pick(['POOF!', 'PFFT!', 'POOF!']));
      particles(c.x, c.y, ['☁', '○', '◌', '💨'], 10, 110);
      el.classList.add('crossed', 'ghost');
    },
    vanish(el) {
      const c = centerOf(el);
      Sound.vanish();
      burst(c.x, c.y, 'sparkle', '*vanished*');
      particles(c.x, c.y, ['✨', '✧', '⋆', '✦'], 12, 120);
      el.classList.add('vanishing');
      setTimeout(() => el.classList.add('collapse'), 560);
    },
    splat(el) {
      const c = centerOf(el);
      Sound.splat();
      burst(c.x, c.y, 'splat', pick(['SPLAT!', 'SPLOT!', 'SPLAT!']));
      particles(c.x, c.y, ['●', '•', '◉'], 10, 130);
      el.classList.add('crossed', 'inked');
    },
    shake(el) {
      const c = centerOf(el);
      Sound.nope();
      retrigger(el, 'shake');
      burst(c.x, c.y - c.h / 2, 'nope', pick(['NOPE!', 'NAH!', 'OOPS!', 'UH-OH!']));
      setTimeout(() => el.classList.add('crossed'), 300);
    },
  };

  function playWrong(el, effect) {
    const name = WRONG_EFFECTS.includes(effect) ? effect : pick(WRONG_EFFECTS);
    wrong[name](el);
    return name;
  }

  function playCorrect(el, firstTry) {
    const c = centerOf(el);
    Sound.yay();
    el.classList.add('correct');
    layer('fx-stamp', c.x, c.y, esc(firstTry ? pick(['NAILED IT!', 'GENIUS!', 'BOOM, CORRECT!', 'WOOHOO!']) : pick(['GOT IT!', 'THERE YOU GO!', 'YESSS!'])), 1000);
    confetti(c.x, c.y, firstTry ? 50 : 26);
    particles(c.x, c.y, ['⭐', '✨', '🎉', '★'], 10, 140);
  }

  // Circle the right answer with a marker scribble + a bouncing pointer.
  function showHint(el, text) {
    if (el.classList.contains('hint')) return;
    Sound.hint();
    const label = el.querySelector('.text')?.textContent.trim() || '';
    el.classList.add('hint');
    el.insertAdjacentHTML(
      'beforeend',
      `<svg class="circle-mark" viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
         <path d="M20 55 C 10 15, 150 2, 270 18 C 305 30, 300 80, 230 92 C 150 104, 30 98, 12 70 C 4 52, 30 30, 60 24" fill="none" stroke="#ff5c8a" stroke-width="5" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
       </svg>
       <span class="hint-bubble">${esc(text)}</span>
       <span class="hint-hand" aria-hidden="true">👈</span>`
    );
    el.setAttribute('aria-label', `${label} — this is the correct answer`);
  }

  return { playWrong, playCorrect, showHint, confetti, particles, burst };
})();
