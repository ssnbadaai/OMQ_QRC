/* ============================================================
   OMQ Email Cards

   Cards are drawn on a canvas rather than laid out in HTML. Two
   reasons: what you see is exactly what exports, and email clients
   mangle CSS but never mangle a PNG.

   Adding a card type is one entry in TEMPLATES — a list of fields and
   a draw function. Everything else (photo, colours, type, language,
   export) is shared.

   Arabic is a layout direction, not a translation: the canvas text
   engine shapes and orders the glyphs, and `mirror` below flips the
   alignment and the footer order to match.
   ============================================================ */

const $ = (id) => document.getElementById(id);
const API = window.OMQ_API;

/* All geometry is expressed against this width and scaled on export,
   so one set of numbers describes every output size. */
const BASE_W = 1200;

const FONTS = [
  { id: 'serif', label: 'Serif', stack: 'Georgia, "Times New Roman", "Noto Naskh Arabic", serif' },
  { id: 'sans', label: 'Sans', stack: '"Segoe UI", system-ui, -apple-system, "Noto Sans Arabic", Arial, sans-serif' },
  { id: 'mono', label: 'Mono', stack: '"Courier New", ui-monospace, monospace' },
];

/* ============================================================
   Templates
   ============================================================ */
const TEMPLATES = {
  welcome: {
    label: 'Welcome on board',
    file: 'welcome-card',
    fields: [
      { id: 'heading', label: 'Heading', type: 'text',
        en: 'Welcome on aboard', ar: 'أهلاً بك على متن الفريق' },
      { id: 'person', label: 'Name', type: 'text',
        en: 'Nooralhuda', ar: 'نور الهدى' },
      { id: 'body', label: 'Message', type: 'textarea',
        en: "We're excited to have you join us and can't wait to see the great contributions you'll bring to the team. Wishing you every success in this new journey!",
        ar: 'يسعدنا انضمامك إلينا، ونتطلع إلى ما ستضيفينه للفريق. نتمنى لك كل التوفيق في هذه الرحلة الجديدة!' },
      { id: 'contactLabel', label: 'Contact label', type: 'text',
        en: 'Reach her through:', ar: 'للتواصل معها:' },
      { id: 'contact', label: 'Email or phone', type: 'text',
        en: 'nooralhuda@omqpro.com', ar: 'nooralhuda@omqpro.com' },
    ],
    draw: drawStackedCard,
  },

  /* Same furniture, different words — which is the point of the
     registry. Add the next card here. */
  farewell: {
    label: 'Farewell',
    file: 'farewell-card',
    fields: [
      { id: 'heading', label: 'Heading', type: 'text',
        en: 'Thank you and farewell', ar: 'شكراً لك ووداعاً' },
      { id: 'person', label: 'Name', type: 'text', en: 'Nooralhuda', ar: 'نور الهدى' },
      { id: 'body', label: 'Message', type: 'textarea',
        en: 'Thank you for everything you brought to the team. We wish you every success in what comes next, and hope our paths cross again.',
        ar: 'شكراً على كل ما قدمته للفريق. نتمنى لك التوفيق في خطوتك القادمة، ونأمل أن تجمعنا الطرق مرة أخرى.' },
      { id: 'contactLabel', label: 'Contact label', type: 'text',
        en: 'Stay in touch:', ar: 'للبقاء على تواصل:' },
      { id: 'contact', label: 'Email or phone', type: 'text',
        en: 'nooralhuda@omqpro.com', ar: 'nooralhuda@omqpro.com' },
    ],
    draw: drawStackedCard,
  },

  announcement: {
    label: 'Announcement',
    file: 'announcement-card',
    fields: [
      { id: 'heading', label: 'Heading', type: 'text',
        en: 'A new chapter', ar: 'فصل جديد' },
      { id: 'person', label: 'Subtitle', type: 'text', en: 'for OMQ', ar: 'في OMQ' },
      { id: 'body', label: 'Message', type: 'textarea',
        en: 'Share the news here. Keep it to a few lines — an email card is read at a glance, not studied.',
        ar: 'اكتب الخبر هنا. اجعله في أسطر قليلة — بطاقة البريد تُقرأ بنظرة سريعة.' },
      { id: 'contactLabel', label: 'Contact label', type: 'text',
        en: 'Find out more:', ar: 'لمعرفة المزيد:' },
      { id: 'contact', label: 'Email or link', type: 'text',
        en: 'hello@omqpro.com', ar: 'hello@omqpro.com' },
    ],
    draw: drawStackedCard,
  },
};

/* ============================================================
   State
   ============================================================ */
let template = 'welcome';
let lang = 'en';
let values = {}; // values[template][lang][fieldId]
let photo = null;
let badge = null;
let logo = null;
let brandFonts = [];

const isRTL = () => lang === 'ar';

/* ============================================================
   Canvas helpers
   ============================================================ */
function font(stack, size, weight) {
  return `${weight || 400} ${size}px ${stack}`;
}

/* Word wrap by measurement. Splitting on whitespace works for Arabic
   as well — the shaping happens inside a run, not across spaces. */
function wrap(ctx, text, maxWidth) {
  const out = [];
  for (const para of String(text).split(/\n+/)) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (line && ctx.measureText(test).width > maxWidth) {
        out.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    out.push(line);
  }
  return out;
}

/* One place decides which edge text starts from, so no drawing code
   has to think about direction. */
function align(ctx, box) {
  if (isRTL()) {
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    return box.x + box.w;
  }
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  return box.x;
}

function drawLines(ctx, lines, x, y, lineHeight) {
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
  return y + lines.length * lineHeight;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/* Cover-fit, the CSS object-fit: cover rule done by hand. */
function drawCover(ctx, img, x, y, w, h, offsetY, zoom) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;

  const scale = Math.max(w / iw, h / ih) * zoom;
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = x + (w - dw) / 2;
  /* offsetY 0..1 chooses which slice of a tall photo shows. */
  const dy = y + (h - dh) * offsetY;

  ctx.save();
  roundRect(ctx, x, y, w, h, 0);
  ctx.clip();
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

function zigzag(ctx, x, y, w, rows, colour) {
  const step = w / 7;
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = step * 0.28;
  ctx.lineCap = 'square';
  for (let r = 0; r < rows; r++) {
    const top = y + r * step * 0.95;
    ctx.beginPath();
    for (let i = 0; i <= 7; i++) {
      const px = x + i * step;
      const py = top + (i % 2 === 0 ? 0 : step * 0.55);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/* ============================================================
   The card

   Header band with the photo, then the message, then a footer strip.
   Only the alignment and the footer order change for Arabic.
   ============================================================ */
function drawStackedCard(ctx, s, measureOnly) {
  const W = BASE_W;
  const pad = 72;
  const inner = W - pad * 2;

  const headFont = fontStack($('headingFont').value);
  const bodyFont = fontStack($('bodyFont').value);
  const headSize = Number($('headingSize').value);
  const bodySize = Math.round(headSize * 0.44);

  /* ---- measure the text so the card grows with its content ---- */
  ctx.font = font(headFont, headSize, 400);
  const headingLines = wrap(ctx, [s.heading, s.person].filter(Boolean).join(' '), inner);

  ctx.font = font(bodyFont, bodySize, 400);
  const bodyLines = wrap(ctx, s.body, inner);

  const headLH = headSize * 1.16;
  const bodyLH = bodySize * 1.5;

  const bandH = Math.round(W * 0.39);
  const textTop = bandH + 64;
  const contactH = bodySize * 2.4;
  const footerH = 150;

  const height = Math.round(
    textTop + headingLines.length * headLH + 26 + bodyLines.length * bodyLH + contactH + footerH
  );

  if (measureOnly) return height;

  /* ---- header band ---- */
  ctx.fillStyle = s.paper;
  ctx.fillRect(0, 0, W, height);

  ctx.fillStyle = s.dark;
  ctx.fillRect(0, 0, W, bandH);

  if (s.showGlow) {
    /* Soft blooms behind the photo, as in the reference. */
    const blob = (cx, cy, r, colour) => {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, colour);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, bandH);
    };
    blob(W * 0.06, bandH * 0.34, W * 0.3, hexToRgba(s.accent, 0.75));
    blob(W * 0.94, bandH * 0.2, W * 0.26, hexToRgba(s.accent, 0.45));
    blob(W * 0.5, -bandH * 0.2, W * 0.42, 'rgba(255,255,255,0.14)');
  }

  const photoBox = { x: pad, y: 44, w: inner, h: bandH - 130 };
  ctx.save();
  if (s.mono && photo) ctx.filter = 'grayscale(1)';
  if (photo) {
    drawCover(ctx, photo, photoBox.x, photoBox.y, photoBox.w, photoBox.h, s.photoY, s.photoZoom);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.fillRect(photoBox.x, photoBox.y, photoBox.w, photoBox.h);
    ctx.filter = 'none';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = font(FONTS[1].stack, 26, 400);
    ctx.direction = 'ltr';
    ctx.textAlign = 'center';
    ctx.fillText('Add a photo', W / 2, photoBox.y + photoBox.h / 2);
  }
  ctx.restore();

  /* ---- message ---- */
  const box = { x: pad, y: textTop, w: inner };
  let x = align(ctx, box);
  let y = textTop;

  ctx.fillStyle = s.ink;
  ctx.font = font(headFont, headSize, 400);
  ctx.textBaseline = 'top';
  y = drawLines(ctx, headingLines, x, y, headLH) + 26;

  ctx.font = font(bodyFont, bodySize, 400);
  ctx.fillStyle = hexToRgba(s.ink, 0.86);
  y = drawLines(ctx, bodyLines, x, y, bodyLH) + bodySize * 0.7;

  /* ---- contact line: bold label, accent value ---- */
  const labelFont = font(bodyFont, bodySize, 700);
  const valueFont = font(bodyFont, bodySize, 400);

  ctx.font = labelFont;
  const labelW = ctx.measureText(s.contactLabel).width;
  ctx.font = valueFont;
  const valueW = ctx.measureText(s.contact).width;
  const gap = bodySize * 0.4;

  /* Laid out as one run so the two parts stay together when mirrored. */
  ctx.textAlign = 'left';
  ctx.direction = isRTL() ? 'rtl' : 'ltr';
  const runStart = isRTL() ? pad + inner - (labelW + gap + valueW) : pad;

  ctx.font = labelFont;
  ctx.fillStyle = s.ink;
  ctx.fillText(s.contactLabel, runStart, y);

  ctx.font = valueFont;
  ctx.fillStyle = s.accent;
  ctx.fillText(s.contact, runStart + labelW + gap, y);

  /* ---- footer ---- */
  const fy = height - footerH + 24;
  const badgeH = 96;

  /* Mirrored: badge and zigzag swap sides so the card reads outward
     from the text edge in both directions. */
  const badgeX = isRTL() ? W - pad - badgeH * 2 : pad;
  const zigX = isRTL() ? pad : W - pad - 190;

  if (badge) {
    const ratio = (badge.naturalWidth || 1) / (badge.naturalHeight || 1);
    ctx.drawImage(badge, badgeX, fy, badgeH * ratio, badgeH);
  }
  if (s.showLogo && logo) {
    const ratio = (logo.naturalWidth || 1) / (logo.naturalHeight || 1);
    const lh = 104;
    ctx.drawImage(logo, W / 2 - (lh * ratio) / 2, fy - 4, lh * ratio, lh);
  }
  if (s.showZigzag) {
    zigzag(ctx, zigX, fy + 18, 190, 3, s.accent);
  }

  return height;
}

function fontStack(id) {
  const brand = brandFonts.find((f) => 'brand-' + f.id === id);
  if (brand) return `"omq-card-${brand.id}", Georgia, serif`;
  return (FONTS.find((f) => f.id === id) || FONTS[0]).stack;
}

function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/* ============================================================
   Render
   ============================================================ */
function state() {
  const v = (values[template] && values[template][lang]) || {};
  const paper = $('paperColor').value;
  return {
    ...v,
    paper,
    dark: $('darkColor').value,
    accent: $('accentColor').value,
    /* Readable text on whatever paper colour was chosen. */
    ink: isLight(paper) ? '#14171f' : '#f4f6ff',
    mono: $('photoMono').checked,
    photoY: Number($('photoY').value) / 100,
    photoZoom: Number($('photoZoom').value) / 100,
    showGlow: $('showGlow').checked,
    showZigzag: $('showZigzag').checked,
    showLogo: $('showLogo').checked,
  };
}

function isLight(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 145;
}

function render(target, width) {
  const canvas = target || $('cardCanvas');
  const scale = (width || BASE_W) / BASE_W;
  const ctx = canvas.getContext('2d');
  const s = state();
  const spec = TEMPLATES[template];

  /* Measure at base scale, then draw once at the real size. */
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const height = spec.draw(ctx, s, true);

  canvas.width = Math.round(BASE_W * scale);
  canvas.height = Math.round(height * scale);

  const c2 = canvas.getContext('2d');
  c2.setTransform(scale, 0, 0, scale, 0, 0);
  c2.textBaseline = 'top';
  spec.draw(c2, s, false);

  return canvas;
}

let pending = null;
function refresh() {
  clearTimeout(pending);
  pending = setTimeout(() => render(), 60);
}

/* ============================================================
   Controls
   ============================================================ */
function buildTemplateSelect() {
  $('templateSelect').innerHTML = '';
  Object.entries(TEMPLATES).forEach(([id, spec]) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = spec.label;
    $('templateSelect').appendChild(opt);
  });
}

function buildFontSelects() {
  [$('headingFont'), $('bodyFont')].forEach((sel, i) => {
    const chosen = sel.value;
    sel.innerHTML = '';
    FONTS.forEach((f) => {
      const o = document.createElement('option');
      o.value = f.id;
      o.textContent = f.label;
      sel.appendChild(o);
    });
    brandFonts.forEach((f) => {
      const o = document.createElement('option');
      o.value = 'brand-' + f.id;
      o.textContent = f.name + ' — Brand Kit';
      sel.appendChild(o);
    });
    sel.value = chosen || (i === 0 ? 'serif' : 'sans');
  });
}

/* Each template keeps its own text per language, so switching to
   Arabic and back does not lose what was typed. */
function seed() {
  Object.entries(TEMPLATES).forEach(([id, spec]) => {
    values[id] = values[id] || {};
    ['en', 'ar'].forEach((code) => {
      values[id][code] = values[id][code] || {};
      spec.fields.forEach((f) => {
        if (values[id][code][f.id] === undefined) values[id][code][f.id] = f[code];
      });
    });
  });
}

function buildFields() {
  const host = $('fields');
  host.innerHTML = '';

  TEMPLATES[template].fields.forEach((f) => {
    const label = document.createElement('label');
    label.textContent = f.label;

    const input =
      f.type === 'textarea' ? document.createElement('textarea') : document.createElement('input');
    if (f.type === 'textarea') input.rows = 4;
    else input.type = 'text';

    input.value = values[template][lang][f.id] || '';
    /* Let the field itself read the way it will print. */
    input.dir = isRTL() ? 'rtl' : 'ltr';
    input.addEventListener('input', () => {
      values[template][lang][f.id] = input.value;
      refresh();
    });

    label.appendChild(input);
    host.appendChild(label);
  });
}

$('templateSelect').addEventListener('change', () => {
  template = $('templateSelect').value;
  buildFields();
  refresh();
});

$('langSelect').addEventListener('change', () => {
  lang = $('langSelect').value;
  buildFields();
  refresh();
});

['accentColor', 'darkColor', 'paperColor', 'photoMono', 'showGlow', 'showZigzag', 'showLogo',
 'headingFont', 'bodyFont'].forEach((id) => $(id).addEventListener('input', refresh));

[['photoY', 'photoYVal', '%'], ['photoZoom', 'photoZoomVal', '%'], ['headingSize', 'headingSizeVal', '']]
  .forEach(([id, out, unit]) => {
    $(id).addEventListener('input', () => {
      $(out).textContent = $(id).value + unit;
      refresh();
    });
  });

/* ---------- images ---------- */
function loadImage(file, onload) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => onload(img);
    img.onerror = () => say('⚠ That file could not be read as an image.', 'warn');
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

$('photoInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  loadImage(file, (img) => {
    photo = img;
    $('photoText').textContent = '✓ ' + file.name;
    $('removePhotoBtn').classList.remove('hidden');
    refresh();
  });
});

$('removePhotoBtn').addEventListener('click', () => {
  photo = null;
  $('photoInput').value = '';
  $('photoText').textContent = 'Choose a photo';
  $('removePhotoBtn').classList.add('hidden');
  refresh();
});

$('badgeInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  loadImage(file, (img) => {
    badge = img;
    $('badgeText').textContent = '✓ ' + file.name;
    $('removeBadgeBtn').classList.remove('hidden');
    refresh();
  });
});

$('removeBadgeBtn').addEventListener('click', () => {
  badge = null;
  $('badgeInput').value = '';
  $('badgeText').textContent = 'Corner badge — optional artwork';
  $('removeBadgeBtn').classList.add('hidden');
  refresh();
});

/* ---------- export ---------- */
function say(message, kind) {
  $('exportStatus').textContent = message;
  $('exportStatus').className = 'status' + (kind ? ' status-' + kind : '');
}

function fileName() {
  const typed = $('fileName').value.trim();
  const base = typed || TEMPLATES[template].file;
  return base.replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') || 'omq-card';
}

function exportCanvas() {
  const out = document.createElement('canvas');
  return render(out, Number($('exportWidth').value));
}

$('downloadBtn').addEventListener('click', () => {
  exportCanvas().toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName() + '.png';
    a.click();
    URL.revokeObjectURL(a.href);
    say('✓ Downloaded ' + a.download, 'ok');
  }, 'image/png');
});

$('copyBtn').addEventListener('click', () => {
  exportCanvas().toBlob(async (blob) => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      say('✓ Copied — paste it into your email.', 'ok');
    } catch {
      /* Firefox and older Safari have no image clipboard write. */
      say('This browser cannot copy images. Download it instead.', 'warn');
    }
  }, 'image/png');
});

/* ---------- optional Brand Kit ---------- */
API.optionalSession({
  account: $('authAccount'),
  onIn: async () => {
    try {
      const { assets } = await API.assets.list();

      brandFonts = (assets || []).filter((a) => a.kind === 'font');
      brandFonts.forEach((f) => {
        new FontFace(`omq-card-${f.id}`, `url(${JSON.stringify(f.url)})`)
          .load()
          .then((face) => {
            document.fonts.add(face);
            refresh();
          })
          .catch(() => {});
      });
      buildFontSelects();

      const colours = (assets || []).filter((a) => a.kind === 'colour');
      if (colours.length) {
        $('brandColours').classList.remove('hidden');
        $('brandColours').innerHTML = 'Brand Kit: ';
        colours.forEach((c) => {
          const chip = document.createElement('button');
          chip.className = 'brand-chip plain';
          chip.style.background = c.value;
          chip.title = `${c.name} — ${c.value}, click to use as accent`;
          chip.addEventListener('click', () => {
            $('accentColor').value = c.value.toLowerCase();
            refresh();
          });
          $('brandColours').appendChild(chip);
        });
      }
    } catch {
      /* The card tool works perfectly well without the Brand Kit. */
    }
  },
});

/* ---------- init ---------- */
buildTemplateSelect();
buildFontSelects();
seed();
buildFields();

logo = new Image();
logo.onload = refresh;
logo.src = 'IMG/omq-logo.png';

render();
