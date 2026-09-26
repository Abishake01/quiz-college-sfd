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

  function postText({ quiz, solved, first, total, code, fullScore }) {
    const scoreLine = fullScore ? `✅ ${solved}/${total} answered correctly` : `✅ ${first}/${total} correct answers`;
    const line =
      first === total
        ? 'Not a single wrong click — flawless run! 🏆'
        : fullScore && solved === total
          ? 'Took a few wrong turns, but I got every single one right in the end 💪'
          : 'Learned a bunch of new things along the way 📚';
    // Link to the exact game this player played, on whatever site it's hosted.
    const link = code ? `\n👉 Play it here: ${location.origin}/play/${encodeURIComponent(code)}` : '';
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

  const linkedInUrl = (text) => `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`;
  const tagTip = () => `🏷 <b>Tag the quiz makers:</b> type <b>@</b> and pick ${CREDITS.map((name) => `<b>${esc(name)}</b>`).join(' and ')} from LinkedIn’s list (typed @names don’t become tags on their own).`;

  async function open(data) {
    const text = postText(data);
    let canvas = null;
    try {
      canvas = await drawCard(data);
    } catch {}
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
       <div class="card green hidden li-steps" id="liSteps"></div>
       <p class="small muted" style="margin:12px 0 0">💡 <b>Post on LinkedIn</b> copies your score card image — just paste it into the post.</p>`;

    const mobileActions = `
       ${
         canNativeShare
           ? `<button class="btn big linkedin block" type="button" id="nativeShare"><span class="in-logo">in</span> Share to LinkedIn</button>
              <p class="small muted" style="margin:8px 0 0">Pick <b>LinkedIn</b> in the share menu — your score card goes with it. The post text is copied too: if it’s missing, long-press the post and tap <b>Paste</b>.</p>
              <div class="or-line"><span>or do it in 3 quick steps</span></div>`
           : '<p style="margin:0 0 8px"><b>Post it in 3 quick steps 👇</b></p>'
       }
       <ol class="m-steps">
         <li><button class="btn white block" type="button" id="mCopy">📋 Copy post text</button></li>
         ${
           blob
             ? `<li><button class="btn white block" type="button" id="mSave">⬇ Save score card</button>
                <span class="small muted">Or long-press the picture above → <b>Save to Photos</b></span></li>`
             : ''
         }
         <li><button class="btn linkedin block" type="button" id="mOpen"><span class="in-logo">in</span> Open LinkedIn</button>
             <span class="small muted">Tap <b>Start a post</b> → long-press → <b>Paste</b> → tap 🖼 and pick your score card</span></li>
       </ol>
       <p class="small" style="margin:10px 0 0">${tagTip()}</p>`;

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
          const openLinkedIn = () => {
            const win = window.open(linkedInUrl(current()), '_blank');
            if (win) win.opener = null;
            else location.href = linkedInUrl(current());
          };

          // ----- phones -----
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
            copyText(current()); // copy again in case step 1 was skipped
            openLinkedIn();
          });

          // ----- desktop -----
          const copyImage = async () => {
            try {
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
              return true;
            } catch {
              return false;
            }
          };
          $('#postLi', el)?.addEventListener('click', async () => {
            // LinkedIn fills the text from ?text= but never accepts an image from a website,
            // so the card goes on the clipboard (or to downloads) for the player to paste in.
            const copied = blob ? await copyImage() : false;
            if (blob && !copied) download();
            openLinkedIn();
            const key = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ Cmd + V' : 'Ctrl + V';
            const steps = $('#liSteps', el);
            steps.innerHTML = copied
              ? `<b>Almost there! 🖼</b> Your post text is filled in on LinkedIn. Click inside the post and press <span class="kbd">${key}</span> to paste your score card image.`
              : `<b>Almost there! 🖼</b> Your post text is filled in on LinkedIn. We saved <b>my-quiz-score.png</b> to your downloads — click the 🖼 photo button in the post to add it.`;
            steps.innerHTML += `<br>${tagTip()} Then hit <b>Post</b>!`;
            steps.classList.remove('hidden');
            steps.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          });
          $('#copyText', el)?.addEventListener('click', async () => toast((await copyText(current())) ? 'Copied! 📋' : 'Select the text and copy it', 'ok'));
          $('#dlImg', el)?.addEventListener('click', download);
        },
      }
    );
  }

  return { open, postText };
})();
