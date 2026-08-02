/* ============================================================
   OMQ Image Tools — palette extraction and font comparison.

   One page rather than two: both start by getting pixels out of an
   image (or a video frame), so they share the loader, the canvas and
   the frame the user has scrubbed to.
   ============================================================ */

const API = window.OMQ_API;

let source = null; // { el, kind: 'image' | 'video' }
let palette = [];
let nodes = [];      // the DOM for each entry, so a drag can repaint in place
let sampleData = null; // read at a higher resolution than the palette pass
let brandFonts = [];

/* ---------- helpers ---------- */

/* ============================================================
   Colours out of a PDF brand guideline

   A guideline states its palette twice: once as the fill colours it
   actually paints with, and once as text — "#24A8AC", "C0 M0 Y0 K100".
   Both are read here, because either alone misses cases. The written
   values are the more trustworthy of the two, so they are kept first.

   The content streams are almost always Flate-compressed, which the
   browser can undo on its own — no PDF library involved.
   ============================================================ */
async function inflate(bytes) {
  for (const format of ['deflate', 'deflate-raw']) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      /* Wrong wrapper, or not compressed at all — try the next. */
    }
  }
  return bytes;
}

function pdfStreams(bytes) {
  /* Latin-1 keeps byte values intact, so offsets found in the text map
     straight back onto the array. */
  const text = new TextDecoder('latin1').decode(bytes);
  const out = [];
  let at = 0;

  while (true) {
    const start = text.indexOf('stream', at);
    if (start < 0) break;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;

    let from = start + 6;
    if (text[from] === '\r') from++;
    if (text[from] === '\n') from++;

    out.push(bytes.subarray(from, end));
    at = end + 9;
  }
  return out;
}

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
const cmykToRgb = (c, m, y, k) => [
  clamp255(255 * (1 - c) * (1 - k)),
  clamp255(255 * (1 - m) * (1 - k)),
  clamp255(255 * (1 - y) * (1 - k)),
];

function coloursFromContent(content, counts) {
  const bump = (rgb, weight) => {
    /* Near-white and near-black are page and body text, not brand. */
    const [r, g, b] = rgb;
    if (r > 246 && g > 246 && b > 246) return;
    const key = hex(r, g, b);
    counts.set(key, (counts.get(key) || 0) + weight);
  };

  const num = '(-?[\\d.]+)';
  const sp = '\\s+';

  /* Written down in the document — the authoritative statement. */
  for (const m of content.matchAll(/#([0-9A-Fa-f]{6})\b/g)) {
    const n = parseInt(m[1], 16);
    bump([(n >> 16) & 255, (n >> 8) & 255, n & 255], 40);
  }
  for (const m of content.matchAll(
    /C\s*:?\s*(\d{1,3})\D{1,4}M\s*:?\s*(\d{1,3})\D{1,4}Y\s*:?\s*(\d{1,3})\D{1,4}K\s*:?\s*(\d{1,3})/gi
  )) {
    bump(cmykToRgb(+m[1] / 100, +m[2] / 100, +m[3] / 100, +m[4] / 100), 40);
  }

  /* Painted with — weaker evidence, but catches swatches that carry no
     printed value. */
  for (const m of content.matchAll(new RegExp(num + sp + num + sp + num + sp + 'rg\\b', 'gi'))) {
    bump([+m[1] * 255, +m[2] * 255, +m[3] * 255], 1);
  }
  for (const m of content.matchAll(
    new RegExp(num + sp + num + sp + num + sp + num + sp + 'k\\b', 'gi')
  )) {
    bump(cmykToRgb(+m[1], +m[2], +m[3], +m[4]), 1);
  }
}

async function coloursFromPdf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const counts = new Map();

  /* Values are often written in an uncompressed part of the file. */
  coloursFromContent(new TextDecoder('latin1').decode(bytes), counts);

  const streams = pdfStreams(bytes);
  for (const raw of streams.slice(0, 400)) {
    const text = new TextDecoder('latin1').decode(await inflate(raw));
    /* Skip anything that decoded to binary — images, fonts. */
    if (!/[a-zA-Z]/.test(text.slice(0, 200))) continue;
    coloursFromContent(text, counts);
  }

  const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([code, weight]) => {
      const n = parseInt(code.slice(1), 16);
      return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], share: weight / total };
    });
}

async function loadPdf(file) {
  say($('sourceStatus'), 'Reading the PDF…');
  $('stage').classList.add('hidden');
  $('fontPanel').classList.add('hidden');

  try {
    palette = await coloursFromPdf(file);
    if (!palette.length) {
      say($('sourceStatus'),
        'No colours found. The file may be encrypted, or built entirely from images.', 'warn');
      return;
    }
    $('palettePanel').classList.remove('hidden');
    /* Nothing to re-read a frame from, and no count to vary. */
    $('recomputeBtn').classList.add('hidden');
    $('swatchCount').closest('label').classList.add('hidden');
    renderSwatches();
    say($('sourceStatus'), `${palette.length} colours found in ${file.name}.`, 'ok');
  } catch (err) {
    say($('sourceStatus'), '⚠ Could not read that PDF: ' + err.message, 'warn');
  }
}

/* ============================================================
   Loading a source
   ============================================================ */
function loadFile(file) {
  if (!file) return;

  /* A PDF has no frame to read, so it takes its own path to the same
     palette panel. */
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    $('sourceText').textContent = '✓ ' + file.name;
    loadPdf(file);
    return;
  }

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
  /* Undo whatever a PDF hid, in case one was loaded first. */
  $('recomputeBtn').classList.remove('hidden');
  $('swatchCount').closest('label').classList.remove('hidden');
}

$('sourceFile').addEventListener('change', (e) => loadFile(e.target.files[0]));

/* Drag and drop onto the picker. */
wireDropZone($('dropZone'), loadFile);

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
      const rgb = sum.map((v) => v / box.length);

      /* Point at the pixel that best represents the box, so a swatch
         can say where in the picture it came from. The average colour
         may not exist anywhere in the image; a real member does. */
      let at = null;
      let best = Infinity;
      for (const p of box) {
        const v = (p[0] - rgb[0]) ** 2 + (p[1] - rgb[1]) ** 2 + (p[2] - rgb[2]) ** 2;
        if (v < best) {
          best = v;
          at = [p[3], p[4]];
        }
      }

      return { rgb, share: box.length / pixels.length, at };
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

  /* Quantising is happy with a small read; picking a colour by hand is
     not, so keep a finer one to sample from. */
  sampleData = readPixels(1024);

  const pixels = [];
  const d = data.data;
  /* Every 4th pixel is plenty at this scale, and four times faster.
     Position rides along in slots 3 and 4, normalised, so it survives
     the sorting median cut does and can be placed over the picture at
     any display size. */
  for (let i = 0; i < d.length; i += 16) {
    if (d[i + 3] < 125) continue; // skip transparent
    const p = i >> 2;
    pixels.push([
      d[i], d[i + 1], d[i + 2],
      (p % data.width) / data.width,
      Math.floor(p / data.width) / data.height,
    ]);
  }

  if (!pixels.length) {
    say($('paletteStatus'), '⚠ That frame is fully transparent.', 'warn');
    return;
  }

  palette = medianCut(pixels, Number($('swatchCount').value));
  renderSwatches();
  say($('paletteStatus'), '');
}



/* ============================================================
   The strip, live

   The download can put the palette beside or under the picture, and
   choosing between those without seeing them is guesswork. The same
   arrangement is built here out of elements, so the preview is the
   thing being exported rather than a description of it.

   It is sized from the media's rendered box rather than given a fixed
   width, because the markers are placed as a percentage of that box —
   letting the layout stretch it would move every pin.
   ============================================================ */
function renderStrip() {
  const strip = $('stageStrip');
  strip.innerHTML = '';

  palette.forEach((e, i) => {
    const block = document.createElement('div');
    block.className = 'strip-block';

    const tag = document.createElement('span');
    block.appendChild(tag);
    strip.appendChild(block);

    if (nodes[i]) Object.assign(nodes[i], { block, tag });
    paintStrip(i);
  });
  layoutStrip();
}

function paintStrip(i) {
  const e = palette[i];
  const n = nodes[i];
  if (!n || !n.block) return;

  const code = hex(...e.rgb);
  n.block.style.background = code;
  n.tag.textContent = code;
  n.tag.style.color = isLight(e.rgb) ? 'rgba(20,23,31,0.9)' : 'rgba(255,255,255,0.95)';
}

function layoutStrip() {
  const mode = $('stripMode').value;
  const strip = $('stageStrip');
  const media = $('stageMedia');
  const composite = $('stageComposite');

  composite.classList.toggle('is-side', mode === 'side');
  composite.classList.toggle('is-below', mode === 'below');

  const off = mode === 'none' || !palette.length || !source;
  strip.classList.toggle('hidden', off);
  if (off) return;

  const rect = media.getBoundingClientRect();
  if (!rect.width) return;

  /* The same proportions the export uses, so what is on screen is what
     lands in the file. */
  if (mode === 'side') {
    strip.style.width = Math.max(56, Math.round(rect.width * 0.2)) + 'px';
    strip.style.height = rect.height + 'px';
  } else {
    strip.style.width = rect.width + 'px';
    strip.style.height = Math.max(34, Math.round(rect.height * 0.14)) + 'px';
  }
}

/* ============================================================
   Export — the picture with its colours marked on it

   Drawn at the source resolution rather than at preview size, so the
   file is worth keeping. Everything scales off the image's short
   side, which is what keeps a marker the same visual weight on a
   phone screenshot and on a 4000px photograph.
   ============================================================ */
const EXPORT_MAX = 2400;
const STUDY_FONT = '"Segoe UI", system-ui, -apple-system, Arial, sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function drawMarkers(ctx, iw, ih) {
  const r = Math.max(9, Math.round(Math.min(iw, ih) * 0.016));
  const font = Math.round(r * 1.5);
  const gap = r * 0.75;

  ctx.textBaseline = 'middle';
  ctx.font = `600 ${font}px ${STUDY_FONT}`;

  palette.forEach((e) => {
    if (!e.at) return;
    const x = e.at[0] * iw;
    const y = e.at[1] * ih;
    const code = hex(...e.rgb);

    const tw = ctx.measureText(code).width;
    const padX = font * 0.5;
    const boxW = tw + padX * 2;
    const boxH = font * 1.7;

    /* Past the right edge the label would hang off the picture. */
    const flip = x + r + gap + boxW > iw;
    const bx = flip ? x - r - gap - boxW : x + r + gap;
    const by = y - boxH / 2;

    ctx.fillStyle = 'rgba(12, 14, 24, 0.82)';
    roundRect(ctx, bx, by, boxW, boxH, boxH * 0.28);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText(code, bx + padX, y + 1);

    /* Two rings, light over dark, so the dot reads on any photograph. */
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = code;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.09);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r - ctx.lineWidth * 1.5, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, r * 0.18);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.stroke();
  });
}

/* Blocks of equal size, not sized by share: once a marker has been
   dragged its share no longer describes anything. */
function drawStrip(ctx, x, y, w, h, vertical) {
  const n = palette.length;
  if (!n) return;

  const font = Math.max(11, Math.round((vertical ? w : h) * 0.115));
  ctx.font = `600 ${font}px ${STUDY_FONT}`;
  ctx.textBaseline = 'middle';

  palette.forEach((e, i) => {
    const bx = vertical ? x : x + (w / n) * i;
    const by = vertical ? y + (h / n) * i : y;
    const bw = vertical ? w : w / n;
    const bh = vertical ? h / n : h;

    const code = hex(...e.rgb);
    ctx.fillStyle = code;
    ctx.fillRect(bx, by, Math.ceil(bw), Math.ceil(bh));

    ctx.fillStyle = isLight(e.rgb) ? 'rgba(20,23,31,0.9)' : 'rgba(255,255,255,0.95)';
    ctx.textAlign = 'left';
    ctx.fillText(code, bx + font * 0.7, by + bh / 2);
  });
}

function buildStudy() {
  const wantMarkers = $('showMarkers').checked;
  const strip = $('stripMode').value;

  let iw = 0;
  let ih = 0;
  if (source) {
    const el = source.el;
    const sw = source.kind === 'video' ? el.videoWidth : el.naturalWidth;
    const sh = source.kind === 'video' ? el.videoHeight : el.naturalHeight;
    const scale = Math.min(1, EXPORT_MAX / Math.max(sw, sh));
    iw = Math.round(sw * scale);
    ih = Math.round(sh * scale);
  }

  /* A PDF brings no picture, so the strip becomes the whole thing. */
  if (!iw) {
    const w = 420;
    const rowH = 84;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = rowH * palette.length;
    const ctx = canvas.getContext('2d');
    drawStrip(ctx, 0, 0, w, canvas.height, true);
    return canvas;
  }

  const stripW = strip === 'side' ? Math.max(150, Math.round(iw * 0.2)) : 0;
  const stripH = strip === 'below' ? Math.max(90, Math.round(ih * 0.14)) : 0;

  const canvas = document.createElement('canvas');
  canvas.width = iw + stripW;
  canvas.height = ih + stripH;

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source.el, 0, 0, iw, ih);

  if (wantMarkers) drawMarkers(ctx, iw, ih);
  if (stripW) drawStrip(ctx, iw, 0, stripW, ih, true);
  if (stripH) drawStrip(ctx, 0, ih, iw, stripH, false);

  return canvas;
}

/* Averaged over three by three, the way an eyedropper does: a single
   pixel on a photograph is as likely to be sensor noise as colour. */
function sampleAt(u, v) {
  if (!sampleData) return null;
  const { width: w, height: h, data } = sampleData;
  const cx = Math.round(u * (w - 1));
  const cy = Math.round(v * (h - 1));

  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = (y * w + x) * 4;
      if (data[i + 3] < 125) continue;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  return n ? [r / n, g / n, b / n] : null;
}

/* Repaints one entry without rebuilding anything — a drag updates many
   times a second, and re-rendering the list would tear the pointer
   capture away mid-gesture. */
function paint(i) {
  const e = palette[i];
  const n = nodes[i];
  if (!n) return;

  const code = hex(...e.rgb);
  const light = isLight(e.rgb);

  n.sw.style.background = code;
  n.sw.title = 'Copy ' + code;
  n.sw.classList.toggle('on-light', light);
  n.label.textContent = code;
  /* The share was this colour's portion of the picture. Once the pin
     has been moved by hand it is no longer that, so it stops claiming
     to be. */
  n.share.textContent = e.picked ? 'picked' : Math.round(e.share * 100) + '%';

  if (!n.pin) return;
  n.pin.style.left = e.at[0] * 100 + '%';
  n.pin.style.top = e.at[1] * 100 + '%';
  n.pin.title = 'Drag to sample elsewhere · click to copy';
  n.pin.classList.toggle('on-light', light);
  n.pin.classList.toggle('flip', e.at[0] > 0.72);
  n.dot.style.background = code;
  n.markerTag.textContent = code;
}

function renderSwatches() {
  const wrap = $('swatches');
  const pins = $('markers');
  wrap.innerHTML = '';
  pins.innerHTML = '';
  nodes = [];

  palette.forEach((entry, i) => {
    const code = hex(...entry.rgb);
    const light = isLight(entry.rgb);

    const sw = document.createElement('button');
    sw.className = 'swatch plain';
    sw.style.background = code;
    sw.title = 'Copy ' + code;
    if (light) sw.classList.add('on-light');

    const label = document.createElement('span');
    label.className = 'swatch-hex';
    label.textContent = code;

    const share = document.createElement('span');
    share.className = 'swatch-share';
    share.textContent = Math.round(entry.share * 100) + '%';

    sw.append(label, share);
    sw.addEventListener('click', () => copy(hex(...palette[i].rgb), $('paletteStatus')));
    wrap.appendChild(sw);

    nodes[i] = { sw, label, share };

    /* A PDF has no picture to point at. */
    if (!entry.at) return;

    const pin = document.createElement('button');
    pin.className = 'marker plain';

    const dot = document.createElement('span');
    dot.className = 'marker-dot';

    const markerTag = document.createElement('span');
    markerTag.className = 'marker-hex';

    pin.append(dot, markerTag);
    pins.appendChild(pin);
    Object.assign(nodes[i], { pin, dot, markerTag });

    /* ---- drag to re-sample ----
       Pointer capture keeps the gesture with this marker even when the
       pointer outruns it, which it will: the dot is 20px and a hand is
       not that precise. */
    let moved = false;

    pin.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      pin.setPointerCapture(ev.pointerId);
      pin.classList.add('is-dragging');
      moved = false;
    });

    pin.addEventListener('pointermove', (ev) => {
      if (!pin.hasPointerCapture(ev.pointerId)) return;

      const rect = $('stageMedia').getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const u = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const v = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));

      const e = palette[i];
      if (Math.abs(u - e.at[0]) > 0.003 || Math.abs(v - e.at[1]) > 0.003) moved = true;

      e.at = [u, v];
      const rgb = sampleAt(u, v);
      if (rgb) {
        e.rgb = rgb;
        e.picked = true;
      }
      paint(i);
      paintStrip(i);
    });

    const finish = (ev) => {
      if (pin.hasPointerCapture(ev.pointerId)) pin.releasePointerCapture(ev.pointerId);
      pin.classList.remove('is-dragging');

      const code = hex(...palette[i].rgb);
      /* A press that went nowhere was meant as a click. */
      if (!moved) copy(code, $('paletteStatus'));
      else say($('paletteStatus'), '✓ Picked ' + code + ' from that spot.', 'ok');
    };
    pin.addEventListener('pointerup', finish);
    pin.addEventListener('pointercancel', finish);

    /* Hovering either half lights the other, so it is obvious which
       swatch belongs to which spot. */
    const pair = (on) => {
      pin.classList.toggle('is-lit', on);
      sw.classList.toggle('is-lit', on);
    };
    pin.addEventListener('mouseenter', () => pair(true));
    pin.addEventListener('mouseleave', () => pair(false));
    sw.addEventListener('mouseenter', () => pair(true));
    sw.addEventListener('mouseleave', () => pair(false));

    paint(i);
  });

  renderStrip();

  /* The download works for a PDF too — there the strip becomes the
     whole file — but the composite settings need a picture. */
  $('exportRow').classList.toggle('hidden', !palette.length);
  $('compositeControls').classList.toggle('hidden', !source);
}

$('swatchCount').addEventListener('input', () => {
  $('swatchCountVal').textContent = $('swatchCount').value;
  extract();
});

$('recomputeBtn').addEventListener('click', extract);

$('stripMode').addEventListener('input', layoutStrip);
$('showMarkers').addEventListener('input', () => {
  $('markers').classList.toggle('hidden', !$('showMarkers').checked);
});

/* The media's rendered size drives both the strip and the markers, so
   follow it rather than guessing when it might have changed. */
if (window.ResizeObserver) {
  new ResizeObserver(layoutStrip).observe($('stageMedia'));
} else {
  window.addEventListener('resize', layoutStrip);
}

$('downloadStudyBtn').addEventListener('click', () => {
  if (!palette.length) {
    say($('paletteStatus'), '⚠ Nothing to export yet.', 'warn');
    return;
  }
  buildStudy().toBlob((blob) => {
    saveBlob(blob, 'palette.png');
    say($('paletteStatus'), '✓ Downloaded palette.png', 'ok');
  }, 'image/png');
});

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
    saveBlob(blob, 'font-sample.png');
    say($('fontStatus'), '✓ Saved. Upload that file to WhatTheFont or Matcherator.', 'ok');
  }, 'image/png');
});

/* ============================================================
   Session — optional. Palette extraction needs nobody's permission;
   the Brand Kit parts do.
   ============================================================ */
async function loadBrandFonts() {
  const data = await API.assets.list();
  brandFonts = (data.assets || []).filter((a) => a.kind === 'font');
  renderFontSamples();
}

API.optionalSession({
  account: $('authAccount'),
  onIn: async () => {
    $('signInPanel').classList.add('hidden');
    $('saveToBrandBtn').classList.remove('hidden');
    try {
      await loadBrandFonts();
    } catch (err) {
      say($('fontStatus'), '⚠ ' + err.message, 'warn');
    }
  },
  onOut: () => {
    brandFonts = [];
    renderFontSamples();
    $('signInPanel').classList.remove('hidden');
    $('saveToBrandBtn').classList.add('hidden');
    /* Carry the way back, so signing in returns to this page. */
    $('signInLink').href = API.loginUrl();
  },
});

/* ---------- init ---------- */
renderFontSamples();
