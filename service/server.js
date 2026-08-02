/* ============================================================
   OMQ helper service — optional.

   Two jobs the browser does adequately and a library does properly:

     POST /trace        PNG/JPEG  -> SVG   (potrace)
     POST /pdf-colours  PDF       -> JSON  (pdfjs)

   Optional is the important word. The browser keeps its own
   implementation of both, and only calls here when SERVICE_BASE is
   configured and answering. If this is never deployed, or is down, or
   times out, the tools carry on exactly as they did — quality drops
   back, nothing breaks. That is why there is no database access here
   and no state: it can be restarted or removed at any moment.

   It is also why it does not authenticate. It holds nothing and can
   reach nothing; the worst an outsider can do is spend CPU. Bind it
   to localhost and let the front door stay the front door.
   ============================================================ */

'use strict';

const http = require('http');
const { Potrace, Posterizer } = require('potrace');

const PORT = Number(process.env.PORT) || 8071;
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BYTES = 25 * 1024 * 1024;

/* ---------- plumbing ---------- */
function readBody(req, limit = MAX_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, payload, type = 'application/json') {
  const body = type === 'application/json' ? JSON.stringify(payload) : payload;
  res.writeHead(status, {
    'Content-Type': type + '; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/* ============================================================
   Tracing

   The browser's tracer walks pixel edges and simplifies the polygon.
   That is honest but it produces corners where a curve belongs.
   Potrace fits curves, which is what makes a traced logo look drawn
   rather than sampled.
   ============================================================ */
function trace(buffer, options) {
  return new Promise((resolve, reject) => {
    const colours = Math.max(1, Math.min(8, Number(options.colours) || 2));

    /* One colour is a plain threshold; more than one needs the
       posterising tracer, which is a different class in potrace. */
    const tracer =
      colours > 1
        ? new Posterizer({
            steps: colours,
            threshold: Potrace.THRESHOLD_AUTO,
            fillStrategy: Posterizer.FILL_DOMINANT,
            rangeDistribution: Posterizer.RANGES_AUTO,
            optCurve: true,
            alphaMax: Number(options.smooth) || 1,
            turdSize: Number(options.speckle) || 2,
          })
        : new Potrace({
            threshold: Potrace.THRESHOLD_AUTO,
            optCurve: true,
            alphaMax: Number(options.smooth) || 1,
            turdSize: Number(options.speckle) || 2,
          });

    tracer.loadImage(buffer, (err) => {
      if (err) return reject(err);
      try {
        resolve(tracer.getSVG());
      } catch (e) {
        reject(e);
      }
    });
  });
}

/* ============================================================
   PDF colours

   The browser reads content streams with a regular expression, which
   finds plenty but cannot see inside object streams or an encrypted
   file. pdfjs walks the operator list properly, so a swatch drawn in
   a nested form is found like any other.
   ============================================================ */
const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
const toHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('').toUpperCase();

async function pdfColours(buffer) {
  /* Imported here so the service still starts, and still traces, if
     pdfjs is missing or fails to load on this Node version. */
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    isEvalSupported: false,
  }).promise;

  const counts = new Map();
  const bump = (rgb, weight) => {
    const [r, g, b] = rgb;
    if (r > 246 && g > 246 && b > 246) return; // the page, not the brand
    const key = toHex(r, g, b);
    counts.set(key, (counts.get(key) || 0) + weight);
  };

  const pages = Math.min(doc.numPages, 40);
  for (let p = 1; p <= pages; p++) {
    const page = await doc.getPage(p);

    /* Written values are the document stating its palette, which beats
       inferring it from what happens to be painted. */
    const text = (await page.getTextContent()).items.map((i) => i.str).join(' ');
    for (const m of text.matchAll(/#([0-9A-Fa-f]{6})\b/g)) {
      const n = parseInt(m[1], 16);
      bump([(n >> 16) & 255, (n >> 8) & 255, n & 255], 40);
    }
    for (const m of text.matchAll(
      /C\s*:?\s*(\d{1,3})\D{1,4}M\s*:?\s*(\d{1,3})\D{1,4}Y\s*:?\s*(\d{1,3})\D{1,4}K\s*:?\s*(\d{1,3})/gi
    )) {
      const [c, mm, y, k] = [+m[1] / 100, +m[2] / 100, +m[3] / 100, +m[4] / 100];
      bump([255 * (1 - c) * (1 - k), 255 * (1 - mm) * (1 - k), 255 * (1 - y) * (1 - k)], 40);
    }

    /* And what it actually paints with. */
    const ops = await page.getOperatorList();
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      if (fn === pdfjs.OPS.setFillRGBColor || fn === pdfjs.OPS.setStrokeRGBColor) {
        const a = ops.argsArray[i];
        bump([a[0], a[1], a[2]], 1);
      }
    }
    page.cleanup();
  }
  await doc.destroy();

  const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([code, weight]) => {
      const n = parseInt(code.slice(1), 16);
      return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], share: weight / total };
    });
}

/* ---------- routes ---------- */
const server = http.createServer(async (req, res) => {
  /* The page calling this is served from another origin. */
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, 'http://localhost');

  /* The browser asks this before offering the better path, so a
     service that is down is simply never used. */
  if (url.pathname === '/health') {
    return send(res, 200, { ok: true, features: ['trace', 'pdf-colours'] });
  }

  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

  try {
    const body = await readBody(req);
    if (!body.length) return send(res, 400, { error: 'Empty body' });

    if (url.pathname === '/trace') {
      const svg = await trace(body, Object.fromEntries(url.searchParams));
      return send(res, 200, svg, 'image/svg+xml');
    }
    if (url.pathname === '/pdf-colours') {
      return send(res, 200, { colours: await pdfColours(body) });
    }
    return send(res, 404, { error: 'Unknown endpoint' });
  } catch (err) {
    console.error(req.url, err);
    return send(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`OMQ helper service on http://${HOST}:${PORT}`);
});
