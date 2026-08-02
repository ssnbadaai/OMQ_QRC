/* ============================================================
   OMQ Logo Lab — clean up, enlarge, vectorise.

   Three jobs in one pipeline because they are the same job: a raster
   goes in, a better file comes out, and each stage feeds the next.
   Knocking the background out first is what makes the trace clean,
   and tracing is what actually makes a logo resolution-independent —
   an upscale only ever guesses.

   Everything runs on the pixels in this page. Nothing is uploaded
   unless you ask for it to be saved.
   ============================================================ */

const $ = (id) => document.getElementById(id);
const API = window.OMQ_API;

let source = null;      // ImageData of the file as loaded
let working = null;     // ImageData after background + scale
let svg = '';           // last trace result
let busy = false;
let queued = false;

/* ============================================================
   Small helpers
   ============================================================ */
function say(el, message, kind) {
  el.textContent = message;
  el.className = 'status' + (kind ? ' status-' + kind : '');
}

function imageDataOf(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
  return c.getContext('2d').getImageData(0, 0, c.width, c.height);
}

function canvasOf(data) {
  const c = document.createElement('canvas');
  c.width = data.width;
  c.height = data.height;
  c.getContext('2d').putImageData(data, 0, 0);
  return c;
}

const hex = (r, g, b) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

/* ============================================================
   1. Background removal

   Spreads inwards from the border, clearing anything close enough to
   what it started on. Connectivity is the whole trick: a global
   "delete every white pixel" would punch holes through the middle of
   an O and through any white shape inside the mark. Reaching in from
   the edges can only remove background that is actually connected to
   the edge.
   ============================================================ */
function removeBackground(src, tolerance, feather) {
  const { width: w, height: h } = src;
  const d = new Uint8ClampedArray(src.data);
  const seen = new Uint8Array(w * h);
  const stack = [];

  /* Seed from every border pixel, so a logo on a two-tone backdrop
     still clears completely. */
  const seed = (x, y) => {
    const p = y * w + x;
    if (!seen[p]) {
      seen[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x, 0);
    seed(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    seed(0, y);
    seed(w - 1, y);
  }

  /* Reference colours are the four corners: enough for a flat or
     lightly graded background, and cheap. */
  const refs = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => {
    const i = (y * w + x) * 4;
    return [d[i], d[i + 1], d[i + 2]];
  });

  /* Squared distance to the nearest corner colour. */
  const distance = (i) => {
    let best = Infinity;
    for (const [r, g, b] of refs) {
      const dr = d[i] - r;
      const dg = d[i + 1] - g;
      const db = d[i + 2] - b;
      const v = dr * dr + dg * dg + db * db;
      if (v < best) best = v;
    }
    return Math.sqrt(best);
  };

  const hard = tolerance;
  /* Beyond `hard`, alpha ramps down over `soft` instead of stopping
     dead — which is what keeps antialiased edges from turning into a
     staircase of hard pixels. */
  const soft = Math.max(1, (tolerance * feather) / 100);

  const out = [];
  while (stack.length) {
    const p = stack.pop();
    const i = p * 4;
    const dist = distance(i);
    if (dist > hard + soft) continue;

    out.push([i, dist]);

    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0 && !seen[p - 1]) (seen[p - 1] = 1), stack.push(p - 1);
    if (x < w - 1 && !seen[p + 1]) (seen[p + 1] = 1), stack.push(p + 1);
    if (y > 0 && !seen[p - w]) (seen[p - w] = 1), stack.push(p - w);
    if (y < h - 1 && !seen[p + w]) (seen[p + w] = 1), stack.push(p + w);
  }

  for (const [i, dist] of out) {
    const alpha = dist <= hard ? 0 : Math.min(1, (dist - hard) / soft);
    d[i + 3] = Math.min(d[i + 3], Math.round(alpha * 255));
  }

  return new ImageData(d, w, h);
}

/* Crop to what is actually drawn. */
function trim(src) {
  const { width: w, height: h, data } = src;
  let minX = w, minY = h, maxX = -1, maxY = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return src;

  const c = canvasOf(src);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out.getContext('2d').getImageData(0, 0, out.width, out.height);
}

/* ============================================================
   2. Upscale — Lanczos-3

   The browser's own resampling is fine shrinking and mushy growing.
   Lanczos keeps edges crisp, which is what a logo is mostly made of.

   Alpha is premultiplied first: resampling colour and alpha
   separately drags the colour of transparent pixels into the visible
   edge, which shows up as a dark or white halo.
   ============================================================ */
function lanczosKernel(x, a) {
  if (x === 0) return 1;
  if (x >= a || x <= -a) return 0;
  const px = Math.PI * x;
  return (a * Math.sin(px) * Math.sin(px / a)) / (px * px);
}

function resample(src, dstW, dstH, a = 3) {
  const { width: sw, height: sh, data: sd } = src;

  /* premultiply */
  const pm = new Float32Array(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    const al = sd[i * 4 + 3] / 255;
    pm[i * 4] = sd[i * 4] * al;
    pm[i * 4 + 1] = sd[i * 4 + 1] * al;
    pm[i * 4 + 2] = sd[i * 4 + 2] * al;
    pm[i * 4 + 3] = sd[i * 4 + 3];
  }

  const pass = (input, iw, ih, ow, horizontal) => {
    const oh = horizontal ? ih : ow;
    const outW = horizontal ? ow : iw;
    const outH = horizontal ? ih : ow;
    const out = new Float32Array(outW * outH * 4);
    const ratio = (horizontal ? iw / ow : ih / ow);
    const scale = Math.max(1, ratio);
    const support = a * scale;

    for (let o = 0; o < ow; o++) {
      const centre = (o + 0.5) * ratio - 0.5;
      const start = Math.max(0, Math.ceil(centre - support));
      const end = Math.min((horizontal ? iw : ih) - 1, Math.floor(centre + support));

      const weights = [];
      let total = 0;
      for (let s = start; s <= end; s++) {
        const wgt = lanczosKernel((s - centre) / scale, a);
        weights.push(wgt);
        total += wgt;
      }
      if (!total) continue;

      const other = horizontal ? ih : iw;
      for (let q = 0; q < other; q++) {
        let r = 0, g = 0, b = 0, al = 0;
        for (let s = start, k = 0; s <= end; s++, k++) {
          const idx = (horizontal ? q * iw + s : s * iw + q) * 4;
          const wgt = weights[k];
          r += input[idx] * wgt;
          g += input[idx + 1] * wgt;
          b += input[idx + 2] * wgt;
          al += input[idx + 3] * wgt;
        }
        const oi = (horizontal ? q * outW + o : o * outW + q) * 4;
        out[oi] = r / total;
        out[oi + 1] = g / total;
        out[oi + 2] = b / total;
        out[oi + 3] = al / total;
      }
    }
    return out;
  };

  const horiz = pass(pm, sw, sh, dstW, true);
  const vert = pass(horiz, dstW, sh, dstH, false);

  /* unpremultiply */
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  for (let i = 0; i < dstW * dstH; i++) {
    const al = Math.max(0, Math.min(255, vert[i * 4 + 3]));
    const f = al > 0 ? 255 / al : 0;
    out[i * 4] = vert[i * 4] * f;
    out[i * 4 + 1] = vert[i * 4 + 1] * f;
    out[i * 4 + 2] = vert[i * 4 + 2] * f;
    out[i * 4 + 3] = al;
  }
  return new ImageData(out, dstW, dstH);
}

/* Unsharp mask, applied only where there is something to sharpen. */
function sharpen(src, amount) {
  if (amount <= 0) return src;
  const { width: w, height: h, data } = src;
  const out = new Uint8ClampedArray(data);
  const k = amount / 100;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] === 0) continue;
      for (let c = 0; c < 3; c++) {
        const centre = data[i + c];
        const around =
          (data[i - 4 + c] + data[i + 4 + c] + data[i - w * 4 + c] + data[i + w * 4 + c]) / 4;
        out[i + c] = centre + (centre - around) * k;
      }
    }
  }
  return new ImageData(out, w, h);
}

/* ============================================================
   3. Vectorise

   Posterise to a few flat colours, then walk the outline of each
   colour's region and write it as a path.

   The outline is built from pixel edges rather than by marching
   squares: for every filled pixel, an edge whose neighbour is empty
   is a boundary edge. Emitted in a consistent direction, those edges
   chain into closed loops, and a hole comes out wound the opposite
   way — which `fill-rule="evenodd"` then renders as a hole with no
   special handling.
   ============================================================ */
function posterise(src, levels) {
  const { width: w, height: h, data } = src;
  const pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 128) pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (!pixels.length) return { palette: [], index: new Int16Array(w * h).fill(-1) };

  /* Median cut, same idea as the palette extractor: split the widest
     channel until there are enough boxes. */
  let boxes = [pixels];
  while (boxes.length < levels) {
    let target = -1, widest = -1;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const span = channelSpan(box);
      if (span.range > widest) {
        widest = span.range;
        target = i;
      }
    });
    if (target < 0) break;
    const box = boxes[target];
    const { channel } = channelSpan(box);
    box.sort((p, q) => p[channel] - q[channel]);
    const mid = box.length >> 1;
    boxes.splice(target, 1, box.slice(0, mid), box.slice(mid));
  }

  const palette = boxes
    .filter((b) => b.length)
    .map((box) => {
      const sum = box.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
      return sum.map((v) => Math.round(v / box.length));
    });

  const index = new Int16Array(w * h).fill(-1);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (data[i + 3] <= 128) continue;
    let best = 0, bestD = Infinity;
    for (let c = 0; c < palette.length; c++) {
      const dr = data[i] - palette[c][0];
      const dg = data[i + 1] - palette[c][1];
      const db = data[i + 2] - palette[c][2];
      const v = dr * dr + dg * dg + db * db;
      if (v < bestD) {
        bestD = v;
        best = c;
      }
    }
    index[p] = best;
  }
  return { palette, index };
}

function channelSpan(box) {
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
  return { channel, range: spans[channel] };
}

/* All closed boundary loops of one colour's region. */
function traceLoops(index, colour, w, h) {
  const filled = (x, y) => x >= 0 && y >= 0 && x < w && y < h && index[y * w + x] === colour;

  /* key: "x,y" of the segment start -> list of segment ends */
  const edges = new Map();
  const add = (ax, ay, bx, by) => {
    const key = ax + ',' + ay;
    if (!edges.has(key)) edges.set(key, []);
    edges.get(key).push([bx, by]);
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!filled(x, y)) continue;
      /* Wound clockwise, so holes come out anticlockwise. */
      if (!filled(x, y - 1)) add(x, y, x + 1, y);
      if (!filled(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!filled(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!filled(x - 1, y)) add(x, y + 1, x, y);
    }
  }

  const loops = [];
  for (const [startKey, list] of edges) {
    while (list.length) {
      const loop = [];
      let [cx, cy] = startKey.split(',').map(Number);
      let next = list.pop();

      while (next) {
        loop.push([cx, cy]);
        [cx, cy] = next;
        const key = cx + ',' + cy;
        const outs = edges.get(key);
        if (!outs || !outs.length) break;
        /* Prefer carrying straight on, so a corner is a corner and not
           an arbitrary turn. */
        next = outs.pop();
        if (loop.length > 4 && cx === loop[0][0] && cy === loop[0][1]) break;
      }
      if (loop.length > 3) loops.push(loop);
    }
  }
  return loops;
}

/* Ramer–Douglas–Peucker: drop points that are already on the line. */
function simplify(points, epsilon) {
  if (points.length < 3 || epsilon <= 0) return points;

  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop();
    let worst = 0, index = -1;
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;

    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      const dist = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (dist > worst) {
        worst = dist;
        index = i;
      }
    }
    if (worst > epsilon && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/* Straight segments, or quadratics through the midpoints when
   smoothing is asked for — which rounds corners without wandering
   away from the outline. */
function pathOf(points, smoothing) {
  if (points.length < 2) return '';
  const p = points.map(([x, y]) => [x, y]);

  if (smoothing <= 0) {
    return 'M' + p.map(([x, y]) => `${x} ${y}`).join('L') + 'Z';
  }

  const t = smoothing / 100;
  const mid = (a, b) => [a[0] + (b[0] - a[0]) * 0.5, a[1] + (b[1] - a[1]) * 0.5];
  const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

  let d = '';
  const start = mid(p[p.length - 1], p[0]);
  d += `M${round(start[0])} ${round(start[1])}`;
  for (let i = 0; i < p.length; i++) {
    const cur = p[i];
    const next = p[(i + 1) % p.length];
    const end = mid(cur, next);
    /* Pull the control point back towards the line for less rounding. */
    const ctrl = lerp(mid(start, end), cur, t);
    d += `Q${round(ctrl[0])} ${round(ctrl[1])} ${round(end[0])} ${round(end[1])}`;
    start[0] = end[0];
    start[1] = end[1];
  }
  return d + 'Z';
}

const round = (n) => Math.round(n * 10) / 10;

function vectorise(src, levels, detail, smoothing) {
  const { width: w, height: h } = src;
  const { palette, index } = posterise(src, levels);
  if (!palette.length) return '';

  /* detail 100 = keep everything, 0 = only the broad shape */
  const epsilon = (1 - detail / 100) * 2.4 + 0.15;

  let paths = '';
  let count = 0;
  palette.forEach((colour, c) => {
    const loops = traceLoops(index, c, w, h)
      .map((loop) => simplify(loop, epsilon))
      .filter((loop) => loop.length > 2);
    if (!loops.length) return;

    count += loops.length;
    const d = loops.map((loop) => pathOf(loop, smoothing)).join(' ');
    paths += `\n  <path fill="${hex(...colour)}" fill-rule="evenodd" d="${d}"/>`;
  });

  say($('vectorStatus'), `${count} shapes in ${palette.length} colours.`, count ? 'ok' : 'warn');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${paths}\n</svg>`;
}

/* ============================================================
   Pipeline
   ============================================================ */
async function run() {
  if (!source) return;
  if (busy) {
    queued = true;
    return;
  }
  busy = true;
  say($('exportStatus'), 'Working…');

  /* Let the status paint before the main thread is tied up. */
  await new Promise((r) => setTimeout(r, 0));

  try {
    let data = source;

    if ($('removeBg').checked) {
      data = removeBackground(data, Number($('tolerance').value), Number($('feather').value));
    }
    if ($('trim').checked) data = trim(data);

    const scale = Number($('scale').value);
    if (scale > 1) {
      data = resample(data, Math.round(data.width * scale), Math.round(data.height * scale));
      data = sharpen(data, Number($('sharpen').value));
    }

    working = data;

    if ($('vectorize').checked) {
      svg = vectorise(
        data,
        Number($('colours').value),
        Number($('detail').value),
        Number($('smooth').value)
      );
      $('resultImg').src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      $('downloadSvg').classList.remove('hidden');
    } else {
      svg = '';
      $('resultImg').src = canvasOf(data).toDataURL('image/png');
      $('downloadSvg').classList.add('hidden');
    }

    $('sizeLabel').textContent = `${data.width} × ${data.height}`;
    say($('exportStatus'), svg ? 'Traced. Check the edges before you use it.' : 'Ready.', 'ok');
  } catch (err) {
    say($('exportStatus'), '⚠ ' + err.message, 'warn');
  } finally {
    busy = false;
    if (queued) {
      queued = false;
      run();
    }
  }
}

let pending = null;
function refresh() {
  clearTimeout(pending);
  pending = setTimeout(run, 180);
}

/* ============================================================
   Controls
   ============================================================ */
function load(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      source = imageDataOf(img);
      $('sourceText').textContent = '✓ ' + file.name;
      $('fileName').placeholder = file.name.replace(/\.[^.]+$/, '');
      say($('sourceStatus'), `${img.naturalWidth} × ${img.naturalHeight}`, 'ok');
      $('saveKitBtn').classList.toggle('hidden', !API.isSignedIn());
      run();
    };
    img.onerror = () => say($('sourceStatus'), '⚠ That file could not be read as an image.', 'warn');
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

$('sourceFile').addEventListener('change', (e) => load(e.target.files[0]));

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
drop.addEventListener('drop', (e) => load(e.dataTransfer.files[0]));

[['tolerance', 'toleranceVal'], ['feather', 'featherVal'], ['sharpen', 'sharpenVal'],
 ['colours', 'coloursVal'], ['detail', 'detailVal'], ['smooth', 'smoothVal']].forEach(
  ([id, out]) => {
    $(id).addEventListener('input', () => {
      $(out).textContent = $(id).value;
      refresh();
    });
  }
);

['removeBg', 'trim', 'scale', 'vectorize'].forEach((id) =>
  $(id).addEventListener('input', () => {
    if (id === 'vectorize') {
      $('vectorControls').classList.toggle('is-off', !$('vectorize').checked);
    }
    refresh();
  })
);

/* ---------- export ---------- */
const fileName = () =>
  ($('fileName').value.trim() || $('fileName').placeholder || 'logo')
    .replace(/[^\w\- ]+/g, '')
    .replace(/\s+/g, '-') || 'logo';

function download(blob, extension) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName() + '.' + extension;
  a.click();
  URL.revokeObjectURL(a.href);
  say($('exportStatus'), '✓ Downloaded ' + a.download, 'ok');
}

$('downloadPng').addEventListener('click', () => {
  if (!working) return;
  canvasOf(working).toBlob((blob) => download(blob, 'png'), 'image/png');
});

$('downloadSvg').addEventListener('click', () => {
  if (!svg) return;
  download(new Blob([svg], { type: 'image/svg+xml' }), 'svg');
});

$('saveKitBtn').addEventListener('click', async () => {
  if (!working) return;
  const btn = $('saveKitBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const name = fileName();
    const blob = svg
      ? new Blob([svg], { type: 'image/svg+xml' })
      : await new Promise((r) => canvasOf(working).toBlob(r, 'image/png'));

    const form = new FormData();
    form.append('kind', 'logo');
    form.append('name', name);
    form.append('file', new File([blob], name + (svg ? '.svg' : '.png'), { type: blob.type }));

    await API.assets.upload(form);
    say($('exportStatus'), '✓ Saved to the Brand Kit.', 'ok');
  } catch (err) {
    say($('exportStatus'), '⚠ ' + err.message, 'warn');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save to Brand Kit';
  }
});

/* ---------- optional sign-in, only to save ---------- */
API.optionalSession({
  account: $('authAccount'),
  onIn: () => {
    if (working) $('saveKitBtn').classList.remove('hidden');
  },
  onOut: () => $('saveKitBtn').classList.add('hidden'),
});

/* ---------- init ---------- */
$('vectorControls').classList.add('is-off');
