// "Share on LinkedIn": builds a ready-to-post message plus a sketchbook score-card image.
const Share = (() => {
  const W = 1200;
  const H = 627; // LinkedIn's recommended 1.91:1 image size

  function hashtag(quiz) {
    const words = quiz.split(/[^A-Za-z0-9]+/).filter((w) => w && !/^(quiz|test|game|round)$/i.test(w));
    const tag = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
    return tag && tag.length <= 30 ? `#${tag}` : '';
  }

  // Event details for the post and score card — edit here for future events.
  const EVENT = {
    name: 'Software Freedom Day 2026',
    short: 'JEC SFD 2026',
    college: 'Jaya Engineering College',
    workshop: 'Open Source workshop',
    tags: ['#SFD2026', '#SoftwareFreedomDay', '#JECSFD2026', '#JayaEngineeringCollege', '#OpenSource', '#FOSS'],
  };
  // Workshop hosts tagged in every shared post.
  const CREDITS = ['Abishake T', 'Nagi Pragalathan'];

  function postText({ quiz, solved, first, total, code, fullScore, shareUrl }) {
    const scoreLine = fullScore ? `✅ ${solved}/${total} answered correctly` : `✅ ${first}/${total} correct answers`;
    const line =
      first === total
        ? 'Not a single wrong click — flawless run! 🏆'
        : fullScore && solved === total
          ? 'Took a few wrong turns, but I got every single one right in the end 💪'
          : 'Learned a bunch of new things along the way 📚';
    // Link to the exact game this player played (with their share id, so LinkedIn previews their score card).
    const gameUrl = shareUrl || (code ? `${location.origin}/play/${encodeURIComponent(code)}` : '');
    const link = gameUrl ? `\n👉 Play it here: ${gameUrl}` : '';
    const tags = [...new Set([...EVENT.tags, hashtag(quiz), '#Quiz', '#KeepLearning'].filter(Boolean))].join(' ');
    return `🐧 Celebrating ${EVENT.name} at ${EVENT.college}! (${EVENT.short})

Today I attended the ${EVENT.workshop} and just finished the “${quiz}”${/quiz/i.test(quiz) ? '' : ' quiz'} 🎉

${scoreLine}

${line}

Huge thanks to ${CREDITS.map((name) => `@${name}`).join(' & ')} for the workshop and the quiz 🙌 Loved learning how open source powers the software we use every day.

Think you can beat my score? 🧠✏️${link}

${tags}`;
  }

  // ---------- canvas helpers ----------
  const jitter = (n) => (Math.random() - 0.5) * n;
  function roughRect(ctx, x, y, w, h, j = 6) {
    const pts = [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ];
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0] + jitter(j), pts[0][1] + jitter(j));
      for (let i = 1; i <= 4; i++) {
        const [px, py] = pts[i - 1];
        const [nx, ny] = pts[i % 4];
        ctx.quadraticCurveTo((px + nx) / 2 + jitter(j * 1.5), (py + ny) / 2 + jitter(j * 1.5), nx + jitter(j), ny + jitter(j));
      }
      ctx.stroke();
    }
  }
  function fitText(ctx, text, maxWidth, size, family) {
    let s = size;
    do {
      ctx.font = `${s}px ${family}`;
      s -= 2;
    } while (ctx.measureText(text).width > maxWidth && s > 14);
  }

  async function drawCard({ name, quiz, solved, first, total, fullScore }) {
    const shown = fullScore ? solved : first;
    const MARKER = '"Permanent Marker", "Comic Sans MS", cursive';
    const HAND = '"Patrick Hand", "Comic Sans MS", cursive';
    try {
      await Promise.all([document.fonts.load(`40px ${MARKER}`), document.fonts.load(`40px ${HAND}`)]);
    } catch {}

    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    const INK = '#2a2a2a';

    // notebook paper
    ctx.fillStyle = '#fdfbf2';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#cfe0f1';
    ctx.lineWidth = 2;
    for (let y = 40; y < H; y += 36) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.strokeStyle = '#f3a6a6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(78, 0);
    ctx.lineTo(78, H);
    ctx.stroke();

    // corner doodles
    ctx.fillStyle = 'rgba(42,42,42,.14)';
    ctx.font = `64px ${HAND}`;
    ctx.fillText('★', 18, 110);
    ctx.fillText('✿', 1110, 580);
    ctx.fillText('☁', 1100, 110);

    // sticky note
    ctx.save();
    ctx.translate(W / 2, H / 2 + 6);
    ctx.rotate(-0.025);
    const nw = 900;
    const nh = 480;
    ctx.fillStyle = INK;
    ctx.fillRect(-nw / 2 + 12, -nh / 2 + 14, nw, nh);
    ctx.fillStyle = '#fff1a0';
    ctx.fillRect(-nw / 2, -nh / 2, nw, nh);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    roughRect(ctx, -nw / 2, -nh / 2, nw, nh, 5);
    // tape
    ctx.save();
    ctx.rotate(0.05);
    ctx.fillStyle = 'rgba(255, 226, 120, .8)';
    ctx.fillRect(-90, -nh / 2 - 22, 180, 44);
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = INK;
    fitText(ctx, `${name} just finished`, 780, 46, MARKER);
    ctx.fillText(`${name} just finished`, 0, -nh / 2 + 88);

    // quiz name with highlighter
    fitText(ctx, `“${quiz}”`, 760, 40, HAND);
    const qw = ctx.measureText(`“${quiz}”`).width;
    ctx.fillStyle = '#ff9ec0';
    ctx.globalAlpha = 0.55;
    ctx.fillRect(-qw / 2 - 14, -nh / 2 + 108, qw + 28, 40);
    ctx.globalAlpha = 1;
    ctx.fillStyle = INK;
    ctx.fillText(`“${quiz}”`, 0, -nh / 2 + 140);

    // big score in a scribbled circle
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(0, 18, 190, 104, 0.04, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(4, 20, 196, 100, -0.03, 0.2, Math.PI * 1.9);
    ctx.stroke();
    ctx.font = `120px ${MARKER}`;
    ctx.fillText(`${shown}/${total}`, 0, 48);
    ctx.font = `32px ${HAND}`;
    ctx.fillText(fullScore ? 'answered correctly' : 'correct answers', 0, 92);

    // stars + percentage
    const ratio = total ? shown / total : 0;
    const stars = ratio >= 0.9 ? 3 : ratio >= 0.6 ? 2 : ratio > 0 ? 1 : 0;
    ctx.font = `50px ${HAND}`;
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = i < stars ? 1 : 0.22;
      ctx.fillText('⭐', (i - 1) * 70, 172);
    }
    ctx.globalAlpha = 1;
    ctx.font = `34px ${HAND}`;
    ctx.fillText(`${Math.round((shown / Math.max(total, 1)) * 100)}% score`, 0, 222);
    ctx.restore();

    // footer
    ctx.textAlign = 'right';
    ctx.fillStyle = INK;
    ctx.font = `30px ${MARKER}`;
    ctx.fillText('✏️ Doodle Quiz', W - 36, H - 24);
    ctx.textAlign = 'left';
    ctx.font = `24px ${HAND}`;
    ctx.fillText(`🐧 ${EVENT.short} · ${EVENT.workshop} · ${EVENT.college}`, 96, H - 26);
    return c;
  }

  const isMobile = () =>
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

  // Works on plain http:// too (phones on the local Wi-Fi), where navigator.clipboard doesn't exist.
  function copyTextSync(str) {
    const ta = document.createElement('textarea');
    ta.value = str;
    ta.setAttribute('readonly', '');
    Object.assign(ta.style, { position: 'fixed', top: '0', left: '0', opacity: '0' });
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, str.length);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {}
    ta.remove();
    return ok;
  }
  async function copyText(str) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(str);
        return true;
      } catch {}
    }
    return copyTextSync(str);
  }

  const feedUrl = (text) => `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`;
  // LinkedIn's official share link: opens a new post (never a DM) with the page's Open Graph preview.
  const offsiteUrl = (link) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`;
  const tagTip = () => `🏷 <b>Tag the quiz makers:</b> type <b>@</b> and pick ${CREDITS.map((name) => `<b>${esc(name)}</b>`).join(' and ')} from LinkedIn’s list (typed @names don’t become tags on their own).`;

  // Saves the card on the server so the shared link gets it as its og:image preview.
  async function uploadCard(canvas, data) {
    if (!canvas || !data.runId || !data.playerId) return null;
    try {
      const { id } = await api('/api/play/share-card', {
        method: 'POST',
        body: {
          runId: data.runId,
          playerId: data.playerId,
          image: canvas.toDataURL('image/jpeg', 0.9),
          description: `${EVENT.short} · ${EVENT.workshop} at ${EVENT.college}. Think you can beat it? Tap to play the quiz!`,
        },
      });
      return `${location.origin}/play/${encodeURIComponent(data.code)}?s=${id}`;
    } catch {
      return null;
    }
  }

  async function open(data) {
    let canvas = null;
    try {
      canvas = await drawCard(data);
    } catch {}
    const shareUrl = await uploadCard(canvas, data);
    const text = postText({ ...data, shareUrl });
    const blob = canvas ? await new Promise((r) => canvas.toBlob(r, 'image/png')) : null;
    const file = blob ? new File([blob], 'my-quiz-score.png', { type: 'image/png' }) : null;
    // Web Share with files only exists on https pages.
    const canNativeShare = !!(file && window.isSecureContext && navigator.canShare?.({ files: [file] }));
    const mobile = isMobile();

    const desktopActions = `
       <div class="share-actions">
         <button class="btn linkedin" type="button" id="postLi"><span class="in-logo">in</span> Post on LinkedIn</button>
         <button class="btn white" type="button" id="copyText">📋 Copy text</button>
         ${blob ? '<button class="btn white" type="button" id="dlImg">⬇ Download image</button>' : ''}
       </div>
       <div class="card green hidden li-steps" id="liSteps"></div>`;

    const mobileActions = `
       <button class="btn big linkedin block" type="button" id="mPost"><span class="in-logo">in</span> Post on LinkedIn</button>
       <p class="small muted" style="margin:8px 0 0">Opens a new LinkedIn post${shareUrl ? ' with your score card preview' : ''}. Your text is copied — in the post, long-press → <b>Paste</b>.</p>
       <div class="card green hidden li-steps" id="mAfter"></div>
       <div class="or-line"><span>other ways to share</span></div>
       ${
         canNativeShare
           ? `<button class="btn blue block" type="button" id="nativeShare">📱 Share the image…</button>
              <p class="small muted" style="margin:6px 0 12px">In the menu pick <b>LinkedIn (Share in a post)</b> — not “Private message”. Swipe the app row or tap <b>More</b> if you don’t see it.</p>`
           : ''
       }
       <ol class="m-steps">
         <li><button class="btn white block" type="button" id="mCopy">📋 Copy post text</button></li>
         ${
           blob
             ? `<li><button class="btn white block" type="button" id="mSave">⬇ Save score card</button>
                <span class="small muted">Or long-press the picture above → <b>Save to Photos</b></span></li>`
             : ''
         }
         <li><button class="btn white block" type="button" id="mOpen"><span class="in-logo" style="background:#0a66c2;color:#fff">in</span> Open LinkedIn</button>
             <span class="small muted">Tap <b>Start a post</b> → long-press → <b>Paste</b> → tap 🖼 and pick your score card</span></li>
       </ol>`;

    modal(
      `<h2>Share your score 🎉</h2>
       ${canvas ? `<img class="share-img" alt="Your score card" src="${canvas.toDataURL('image/png')}" />` : ''}
       <label class="field" style="margin-top:14px"><span>Your LinkedIn post <span class="small muted">(edit anything you like)</span></span>
         <textarea class="input share-text" id="shareText" rows="${mobile ? 7 : 10}">${esc(text)}</textarea>
       </label>
       ${mobile ? mobileActions : desktopActions}
       <div class="row end" style="margin-top:10px"><button class="btn small white" type="button" data-close>Close</button></div>`,
      {
        onMount(el) {
          const current = () => $('#shareText', el).value;
          const markDone = (btn, label) => {
            btn.classList.add('done');
            btn.innerHTML = `✅ ${label}`;
          };
          const download = () => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'my-quiz-score.png';
            a.target = '_blank';
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            a.remove();
          };
          const go = (url) => {
            const win = window.open(url, '_blank');
            if (win) win.opener = null;
            else location.href = url;
          };
          const showSteps = (box, html) => {
            box.innerHTML = html;
            box.classList.remove('hidden');
            box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          };

          // ----- phones -----
          $('#mPost', el)?.addEventListener('click', () => {
            copyTextSync(current()); // synchronous: must happen inside the tap
            go(shareUrl ? offsiteUrl(shareUrl) : feedUrl(current()));
            showSteps(
              $('#mAfter', el),
              `<b>In the LinkedIn post:</b> long-press the text area → <b>Paste</b> to add your message${shareUrl ? ' (your score card preview is already attached)' : ''}.<br>${tagTip()} Then tap <b>Post</b>!`
            );
          });
          $('#nativeShare', el)?.addEventListener('click', async () => {
            copyText(current());
            try {
              await navigator.share({ files: [file], text: current(), title: 'My quiz score' });
            } catch {}
          });
          $('#mCopy', el)?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            if (await copyText(current())) markDone(btn, 'Post text copied');
            else {
              $('#shareText', el).select();
              toast('Long-press the text box → Select all → Copy', 'error');
            }
          });
          $('#mSave', el)?.addEventListener('click', (e) => {
            download();
            markDone(e.currentTarget, 'Score card saved');
          });
          $('#mOpen', el)?.addEventListener('click', () => {
            copyTextSync(current());
            go(feedUrl(current()));
          });

          // ----- desktop -----
          $('#postLi', el)?.addEventListener('click', () => {
            // Text is pre-filled; LinkedIn builds the score-card preview from the link inside it (og:image).
            go(feedUrl(current()));
            copyTextSync(current());
            showSteps(
              $('#liSteps', el),
              `<b>Almost there! 🎉</b> Your post is filled in on LinkedIn${shareUrl ? ' and your score card shows up as the link preview (give it a few seconds)' : ''}. Text missing? Click in the post and paste it.<br>${tagTip()} Then hit <b>Post</b>!`
            );
          });
          $('#copyText', el)?.addEventListener('click', async () => toast((await copyText(current())) ? 'Copied! 📋' : 'Select the text and copy it', 'ok'));
          $('#dlImg', el)?.addEventListener('click', download);
        },
      }
    );
  }

  return { open, postText };
})();
