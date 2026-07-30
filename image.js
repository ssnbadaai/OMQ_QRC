/* ============================================================
   OMQ Image Tools — palette extraction and font comparison.

   One page rather than two: both start by getting pixels out of an
   image (or a video frame), so they share the loader, the canvas and
   the frame the user has scrubbed to.
   ============================================================ */

const $ = (id) => document.getElementById(id);
const API = window.OMQ_API;

let source = null; // { el, kind: 'image' | 'video' }
let palette = [];
let brandFonts = [];

/* ---------- helpers ---------- */
function say(el, message, kind) {
  el.textContent = message;
  el.className = 'status' + (kind ? ' status-' + kind : '');
}

const hex = (r, g, b) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

/* Perceived brightness, so label text stays readable on its swatch. */
const isLight = ([r, g, b]) => (r * 299 + g * 587 + b * 114) / 1000 > 140;

async function copy(text, statusEl) {
  try {
    await navigator.clipboard.writeText(text);
    say(statusEl, '✓ Copied ' + text, 'ok');
  } catch {
    say(statusEl, text, null);
  }
}

/* ============================================================
   Loading a source
   ============================================================ */
function loadFile(file) {
  if (!file) return;

  const url = URL.createObjectURL(file);
  const isVideo = file.type.startsWith('video/');

  $('sourceText').textContent = '✓ ' + file.name;
  $('stage').classList.remove('hidden');
  $('sourceImg').classList.toggle('hidden', isVideo);
  $('sourceVideo').classList.toggle('hidden', !isVideo);
  $('frameHint').textContent = isVideo
    ? 'Pause on the frame you want, then read the palette from it.'
    : '';

  if (isVideo) {
    const video = $('sourceVideo');
    video.src = url;
    video.onloadeddata = () => {
      source = { el: video, kind: 'video' };
      say($('sourceStatus'), 'Video loaded. Pause where you want and read the frame.', 'ok');
      revealTools();
      extract();
    };
    video.onerror = () => say($('sourceStatus'), '⚠ That video could not be read.', 'warn');
    /* Re-read whenever the visible frame settles. */
    video.onseeked = extract;
    video.onpause = extract;
  } else {
    const img = $('sourceImg');
    img.src = url;
    img.onload = () => {
      source = { el: img, kind: 'image' };
      say($('sourceStatus'), `Loaded — ${img.naturalWidth}×${img.naturalHeight}.`, 'ok');
      revealTools();
      extract();
    };
    img.onerror = () => say($('sourceStatus'), '⚠ That image could not be read.', 'warn');
  }
}

function revealTools() {
  $('palettePanel').classList.remove('hidden');
  $('fontPanel').classList.remove('hidden');
}

$('sourceFile').addEventListener('change', (e) => loadFile(e.target.files[0]));

/* Drag and drop onto the picker. */
const drop = $('dropZone');
['dragenter', 'dragover'].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add('is-over');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
  })
);
drop.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));

/* Draw whatever is on screen now into a canvas we can read.
   Capped: a 4K frame is 8M pixels and quantising them all buys nothing
   a scaled-down read does not. */
function readPixels(maxSide = 320) {
  if (!source) return null;

  const el = source.el;
  const w = source.kind === 'video' ? el.videoWidth : el.naturalWidth;
  const h = source.kind === 'video' ? el.videoHeight : el.naturalHeight;
  if (!w || !h) return null;

  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(el, 0, 0, cw, ch);
  return ctx.getImageData(0, 0, cw, ch);
}

/* ============================================================
   Palette — median cut

   Repeatedly split the box of colours along its widest channel. It
   keeps distinct-but-uncommon colours that a plain frequency count
   would bury under a large flat background.
   ============================================================ */
function medianCut(pixels, wanted) {
  let boxes = [pixels];

  while (boxes.length < wanted) {
    /* Split whichever box still spans the most colour. */
    let target = -1;
    let widest = -1;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const range = channelRange(box);
      if (range.span > widest) {
        widest = range.span;
        target = i;
      }
    });
    if (target < 0) break;

    const box = boxes[target];
    const { channel } = channelRange(box);
    box.sort((a, b) => a[channel] - b[channel]);
    const mid = box.length >> 1;
    boxes.splice(target, 1, box.slice(0, mid), box.slice(mid));
  }

  return boxes
    .filter((b) => b.length)
    .map((box) => {
      const sum = box.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
      return {
        rgb: sum.map((v) => v / box.length),
        share: box.length / pixels.length,
      };
    })
    .sort((a, b) => b.share - a.share);
}

function channelRange(box) {
  const min = [255, 255, 255];
  const max = [0, 0, 0];
  for (const p of box) {
    for (let c = 0; c < 3; c++) {
      if (p[c] < min[c]) min[c] = p[c];
      if (p[c] > max[c]) max[c] = p[c];
    }
  }
  const spans = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const channel = spans.indexOf(Math.max(...spans));
  return { channel, span: spans[channel] };
}

function extract() {
  const data = readPixels();
  if (!data) return;

  const pixels = [];
  const d = data.data;
  /* Every 4th pixel is plenty at this scale, and four times faster. */
  for (let i = 0; i < d.length; i += 16) {
    if (d[i + 3] < 125) continue; // skip transparent
    pixels.push([d[i], d[i + 1], d[i + 2]]);
  }

  if (!pixels.length) {
    say($('paletteStatus'), '⚠ That frame is fully transparent.', 'warn');
    return;
  }

  palette = medianCut(pixels, Number($('swatchCount').value));
  renderSwatches();
  say($('paletteStatus'), '');
}

function renderSwatches() {
  const wrap = $('swatches');
  wrap.innerHTML = '';

  palette.forEach((entry) => {
    const code = hex(...entry.rgb);

    const sw = document.createElement('button');
    sw.className = 'swatch plain';
    sw.style.background = code;
    sw.title = 'Copy ' + code;
    if (isLight(entry.rgb)) sw.classList.add('on-light');

    const label = document.createElement('span');
    label.className = 'swatch-hex';
    label.textContent = code;

    const share = document.createElement('span');
    share.className = 'swatch-share';
    share.textContent = Math.round(entry.share * 100) + '%';

    sw.append(label, share);
    sw.addEventListener('click', () => copy(code, $('paletteStatus')));
    wrap.appendChild(sw);
  });
}

$('swatchCount').addEventListener('input', () => {
  $('swatchCountVal').textContent = $('swatchCount').value;
  extract();
});

$('recomputeBtn').addEventListener('click', extract);

$('copyAllBtn').addEventListener('click', () =>
  copy(palette.map((p) => hex(...p.rgb)).join('\n'), $('paletteStatus'))
);

/* ---------- save a palette into the Brand Kit ---------- */
$('saveToBrandBtn').addEventListener('click', async () => {
  const btn = $('saveToBrandBtn');
  const base = (prompt('Name these colours (they will be numbered):', 'Extracted') || '').trim();
  if (!base) return;

  btn.disabled = true;
  btn.textContent = 'Saving…';
  let saved = 0;
  try {
    for (let i = 0; i < palette.length; i++) {
      await API.assets.colour({
        name: `${base} ${i + 1}`,
        value: hex(...palette[i].rgb),
        notes: 'Extracted from an image',
      });
      saved++;
    }
    say($('paletteStatus'), `✓ ${saved} colours added to the Brand Kit.`, 'ok');
  } catch (err) {
    say($('paletteStatus'), `⚠ Saved ${saved} of ${palette.length}: ${err.message}`, 'warn');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save to Brand Kit';
  }
});

/* ============================================================
   Font comparison

   Not identification. The brand fonts are loaded and rendered beside
   the image so the eye can do the matching — which answers the
   question that actually comes up: "is this one of ours, and which?"
   ============================================================ */
function renderFontSamples() {
  const wrap = $('fontSamples');
  wrap.innerHTML = '';

  if (!brandFonts.length) {
    wrap.innerHTML =
      '<p class="muted-copy">No fonts in the Brand Kit yet. ' +
      'Add them under <a href="brand.html">Brand Kit → Fonts</a>.</p>';
    return;
  }

  const text = $('sampleText').value || 'Handgloves 123';
  const px = $('sampleSize').value;

  brandFonts.forEach((font, i) => {
    const family = 'omq-brand-' + i;

    const row = document.createElement('div');
    row.className = 'font-row';

    const name = document.createElement('span');
    name.className = 'font-name';
    name.textContent = font.name;

    const sample = document.createElement('div');
    sample.className = 'font-sample';
    sample.style.fontFamily = `"${family}", sans-serif`;
    sample.style.fontSize = px + 'px';
    sample.textContent = text;

    row.append(name, sample);
    wrap.appendChild(row);

    /* FontFace loads any format the browser supports, straight from the
       stored asset — no @font-face rule to write. Declared after the
       elements it reports failure into. */
    new FontFace(family, `url(${JSON.stringify(font.url)})`)
      .load()
      .then((loaded) => document.fonts.add(loaded))
      .catch(() => {
        row.classList.add('font-failed');
        sample.textContent = 'Could not load this font file.';
      });
  });
}

$('sampleText').addEventListener('input', renderFontSamples);
$('sampleSize').addEventListener('input', () => {
  $('sampleSizeVal').textContent = $('sampleSize').value + ' px';
  document.querySelectorAll('.font-sample').forEach((el) => {
    el.style.fontSize = $('sampleSize').value + 'px';
  });
});

/* Export what is on screen, ready to hand to an external identifier. */
$('cropBtn').addEventListener('click', () => {
  const data = readPixels(1400);
  if (!data) {
    say($('fontStatus'), '⚠ Load an image first.', 'warn');
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = data.width;
  canvas.height = data.height;
  canvas.getContext('2d').putImageData(data, 0, 0);
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'font-sample.png';
    a.click();
    URL.revokeObjectURL(a.href);
    say($('fontStatus'), '✓ Saved. Upload that file to WhatTheFont or Matcherator.', 'ok');
  }, 'image/png');
});

/* ============================================================
   Sign-in — optional, and only for the Brand Kit parts
   ============================================================ */
API.loadConfig()
  .then(() => {
    $('domainName').textContent = API.ALLOWED_DOMAIN;
  })
  .catch(() => {});

async function loadBrandFonts() {
  const data = await API.assets.list();
  brandFonts = (data.assets || []).filter((a) => a.kind === 'font');
  renderFontSamples();

  const user = API.getUser();
  $('whoami').textContent = (user && user.email) || '';
  $('whoami').classList.remove('hidden');
  $('signInPanel').classList.add('hidden');
  $('saveToBrandBtn').classList.remove('hidden');
}

API.mountButton($('googleBtn'), {
  onSignIn: async () => {
    say($('signInStatus'), '');
    try {
      await loadBrandFonts();
    } catch (err) {
      API.signOut();
      say($('signInStatus'), '⚠ ' + err.message, 'warn');
    }
  },
  onSignOut: () => {
    brandFonts = [];
    renderFontSamples();
    $('signInPanel').classList.remove('hidden');
    $('saveToBrandBtn').classList.add('hidden');
    $('whoami').classList.add('hidden');
  },
}).catch((err) => say($('signInStatus'), '⚠ ' + err.message, 'warn'));

/* ---------- init ---------- */
renderFontSamples();

if (API.isSignedIn()) {
  loadBrandFonts().catch(() => API.signOut());
}
