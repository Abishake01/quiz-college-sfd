// Shared helpers for player + admin pages.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
  del(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    const err = new Error('Can’t reach the server — check your connection');
    err.status = 0;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function toast(message, kind = '') {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(10px)';
    setTimeout(() => el.remove(), 320);
  }, 2600);
}

function modal(html, { onMount } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal card tape" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => back.remove();
  back.addEventListener('click', (e) => {
    if (e.target === back || e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onKey);
    }
  });
  document.body.appendChild(back);
  onMount?.(back.firstElementChild, close);
  return close;
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

// ---------- tiny synth sound effects (no audio files needed) ----------
const Sound = (() => {
  let ctx = null;
  let muted = store.get('dq:muted', false);
  const ac = () => {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  function tone(freq, dur, { type = 'sine', vol = 0.18, slideTo, delay = 0 } = {}) {
    const c = ac();
    if (!c || muted) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  function noise(dur, { vol = 0.3, filter = 'lowpass', from = 3000, to = 100 } = {}) {
    const c = ac();
    if (!c || muted) return;
    const t = c.currentTime;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t);
  }
  return {
    get muted() {
      return muted;
    },
    toggle() {
      muted = !muted;
      store.set('dq:muted', muted);
      return muted;
    },
    boom() {
      noise(0.7, { vol: 0.5, from: 1800, to: 60 });
      tone(120, 0.5, { type: 'sine', vol: 0.35, slideTo: 40 });
    },
    poof() {
      noise(0.35, { vol: 0.25, filter: 'highpass', from: 800, to: 4000 });
    },
    vanish() {
      tone(900, 0.35, { type: 'triangle', vol: 0.15, slideTo: 1800 });
      tone(1400, 0.25, { type: 'sine', vol: 0.1, slideTo: 2600, delay: 0.1 });
    },
    splat() {
      noise(0.25, { vol: 0.35, from: 900, to: 150 });
      tone(200, 0.2, { type: 'square', vol: 0.08, slideTo: 80 });
    },
    nope() {
      tone(220, 0.15, { type: 'square', vol: 0.1 });
      tone(180, 0.25, { type: 'square', vol: 0.1, delay: 0.15 });
    },
    yay() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.16, delay: i * 0.09 }));
    },
    pop() {
      tone(600, 0.08, { type: 'sine', vol: 0.15, slideTo: 1200 });
    },
    hint() {
      tone(880, 0.12, { type: 'sine', vol: 0.12 });
      tone(1175, 0.18, { type: 'sine', vol: 0.12, delay: 0.12 });
    },
  };
})();
