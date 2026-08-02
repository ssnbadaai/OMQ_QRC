/* ============================================================
   OMQ Email Cards

   The card is real HTML, not a picture of one: the address is a
   mailto link, the text can be selected, translated and read aloud,
   and it reflows to the screen it is opened on.

   Which means writing for email clients, not browsers. Outlook still
   renders with Word, and Gmail strips much of what it is given, so:
   tables for layout, styles inline, and width driven by
   width:100% + max-width so it adapts even where media queries are
   thrown away.

   Adding a card type is one entry in TEMPLATES.
   ============================================================ */

const API = window.OMQ_API;

const WIDTH = 600; // the width every email design settled on, long ago

/* Stacks are per-glyph: a Latin face that has no Arabic simply falls
   through to the next entry for those characters, so one list can
   serve both scripts if the Latin faces lead and the Naskh ones
   follow.

   `zarid` is as close as installed fonts get to 29LT Zarid Text, which
   is licensed and cannot be embedded. Its Latin is a humanist old-style
   serif with calligraphic roots — Palatino and Book Antiqua are the
   nearest thing on Windows and macOS, with Constantia behind them — and
   its Arabic is a modern Naskh, which Sakkal Majalla and Traditional
   Arabic approximate on Windows and Geeza Pro on Apple. */
const FAMILIES = {
  zarid:
    "'Palatino Linotype', Palatino, 'Book Antiqua', Constantia, " +
    "'Sakkal Majalla', 'Traditional Arabic', 'Geeza Pro', 'Noto Naskh Arabic', " +
    'Georgia, serif',
  serif: "Georgia, 'Times New Roman', 'Noto Naskh Arabic', serif",
  sans: "Arial, Helvetica, 'Segoe UI', 'Noto Sans Arabic', sans-serif",
};

const FAMILY_LABELS = {
  zarid: 'Closest to 29LT Zarid Text',
  serif: 'Serif — Georgia',
  sans: 'Sans — Arial / Helvetica',
};

/* Gmail and Outlook on Windows discard @font-face outright, so a brand
   font is an enhancement for the clients that do honour it — Apple
   Mail, iOS Mail, Thunderbird, Samsung Mail. Everyone else has to land
   somewhere deliberate, which is what the fallback picker is for: the
   stack always ends in a font the recipient certainly has. */
const FONT_SUPPORT =
  'Shown in Apple Mail, iOS Mail, Thunderbird and Samsung Mail. ' +
  'Gmail and Outlook ignore uploaded fonts and use the fallback — ' +
  'no email tool can change that.';

function fontOf(id) {
  const brand = brandFonts.find((f) => 'brand-' + f.id === id);
  if (!brand) return FAMILIES[id] || FAMILIES.zarid;
  /* The custom face first, the chosen fallback immediately behind it. */
  const fallback = FAMILIES[$('fontFallback').value] || FAMILIES.zarid;
  return `'${brand.family}', ${fallback}`;
}

const FORMATS = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };

/* Only emitted into the full document: a pasted fragment has no head
   to carry it, and the clients that would honour it read it there. */
function fontFaceRule() {
  const brand = brandFonts.find((f) => 'brand-' + f.id === $('fontFamily').value);
  if (!brand) return '';
  const ext = (brand.original.split('.').pop() || 'woff2').toLowerCase();
  return `
    @font-face {
      font-family: '${brand.family}';
      src: url('${absolute(brand.url)}') format('${FORMATS[ext] || 'woff2'}');
      font-display: swap;
    }`;
}

/* ============================================================
   Templates
   ============================================================ */
const TEMPLATES = {
  welcome: {
    label: 'Welcome on board',
    file: 'welcome-card',
    fields: [
      { id: 'heading', label: 'Heading', type: 'text',
        en: 'Welcome aboard,', ar: 'أهلاً بك معنا،' },
      { id: 'person', label: 'Name', type: 'text',
        en: 'Nooralhuda', ar: 'نور الهدى' },
      { id: 'body', label: 'Message', type: 'textarea',
        en: "We're excited to have you join us and can't wait to see the great contributions you'll bring to the team. Wishing you every success in this new journey!",
        ar: 'يسعدنا انضمامك إلينا، ونتطلع إلى ما ستضيفينه للفريق. نتمنى لك كل التوفيق في هذه الرحلة الجديدة!' },
      { id: 'contactLabel', label: 'Contact label', type: 'text',
        en: 'Reach her through:', ar: 'للتواصل معها:' },
      { id: 'contact', label: 'Email, phone or link', type: 'text',
        en: 'nooralhuda@omqpro.com', ar: 'nooralhuda@omqpro.com' },
    ],
  },

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
      { id: 'contact', label: 'Email, phone or link', type: 'text',
        en: 'nooralhuda@omqpro.com', ar: 'nooralhuda@omqpro.com' },
    ],
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
      { id: 'contact', label: 'Email, phone or link', type: 'text',
        en: 'hello@omqpro.com', ar: 'hello@omqpro.com' },
    ],
  },
};

/* ============================================================
   State
   ============================================================ */
let template = 'welcome';
let lang = 'en';
let values = {};
let photoUrl = '';
let brandFonts = [];

const isRTL = () => lang === 'ar';

/* Mail clients need somewhere to fetch an image from, so every URL in
   the markup has to be absolute. */
const absolute = (u) => (!u ? '' : /^https?:\/\//i.test(u) ? u : new URL(u, location.href).href);

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* The whole point of not shipping a picture: this has to be clickable,
   and what it should do depends on what was typed. */
function linkFor(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'mailto:' + v;
  if (/^[+\d][\d\s()-]{5,}$/.test(v)) return 'tel:' + v.replace(/[^\d+]/g, '');
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(v)) return 'https://' + v;
  return '';
}

/* ============================================================
   Artwork

   Two things cannot go into an email as they are: the logo is an SVG,
   which Gmail and Outlook refuse to render, and the wave is drawn
   rather than stored. Both become PNGs at a public address — a data:
   URI previews fine here and then fails in the inbox.

   Rasterised once and remembered, so this is not paid on every edit.
   ============================================================ */
const LOGO_SVG = 'IMG/OMQNewLogo512.svg';
const RASTER_KEY = 'omq-card-rasters';

let art = { logo: '', wave: '', hosted: false };

function rasters() {
  try {
    return JSON.parse(localStorage.getItem(RASTER_KEY)) || {};
  } catch {
    return {};
  }
}

function rememberRaster(key, url) {
  const all = rasters();
  all[key] = url;
  localStorage.setItem(RASTER_KEY, JSON.stringify(all));
}

/* Returns a hosted URL, or a data: URI when signed out so the preview
   still shows the design. The caller reports which it got. */
async function hostRaster(key, canvas) {
  const cached = rasters()[key];
  if (cached) return { url: cached, hosted: true };

  if (!API.isSignedIn()) return { url: canvas.toDataURL('image/png'), hosted: false };

  try {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    const form = new FormData();
    form.append('kind', 'photo');
    form.append('name', key);
    form.append('file', new File([blob], key + '.png', { type: 'image/png' }));

    const { asset } = await API.assets.upload(form);
    const url = absolute(asset.url);
    rememberRaster(key, url);
    return { url, hosted: true };
  } catch {
    return { url: canvas.toDataURL('image/png'), hosted: false };
  }
}

function svgToCanvas(src, height) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ratio = (img.naturalWidth || 1) / (img.naturalHeight || 1);
      const canvas = document.createElement('canvas');
      canvas.height = height;
      canvas.width = Math.max(1, Math.round(height * ratio));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('Could not read ' + src));
    img.src = src;
  });
}

/* The wave: stacked chevron runs, matching the brand mark. */
function waveCanvas(colour, w = 300, rows = 3) {
  const step = w / 6;
  const amp = step * 0.5;
  const stroke = step * 0.3;
  const rowGap = amp + stroke * 1.15;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = Math.ceil(rowGap * (rows - 1) + amp + stroke * 2);

  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = colour;
  ctx.lineWidth = stroke;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';

  for (let r = 0; r < rows; r++) {
    const top = stroke + r * rowGap;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const px = i * step;
      const py = top + (i % 2 ? amp : 0);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  return canvas;
}

async function ensureArt() {
  const accent = $('accentColor').value.toUpperCase();
  let hosted = true;

  try {
    const logo = await hostRaster('omq-logo-v2', await svgToCanvas(LOGO_SVG, 180));
    art.logo = logo.url;
    hosted = hosted && logo.hosted;
  } catch {
    /* Fall back to the PNG that has always been there. */
    art.logo = absolute('IMG/omq-logo.png');
  }

  /* Keyed by colour, so a new accent produces a new wave rather than
     quietly reusing the old one. */
  const wave = await hostRaster('omq-wave-' + accent.replace('#', ''), waveCanvas(accent));
  art.wave = wave.url;
  hosted = hosted && wave.hosted;

  art.hosted = hosted;
  say(
    $('artStatus'),
    hosted ? '' : 'Logo and wave are preview-only until you sign in — mail clients cannot show them inline.',
    hosted ? null : 'warn'
  );
  refresh();
}

/* ============================================================
   The email
   ============================================================ */
function cardHtml(s) {
  const dir = isRTL() ? 'rtl' : 'ltr';
  const side = isRTL() ? 'right' : 'left';
  const family = s.family;
  const h1 = s.headingSize;
  const bodySize = Math.max(15, Math.round(h1 * 0.47));
  const radius = s.round ? 14 : 0;

  /* The name sits on its own line rather than wherever the wrap
     happens to fall, so the greeting reads the same at every width. */
  const heading = [s.heading, s.person]
    .filter(Boolean)
    .map(esc)
    .join('<br />');
  const href = linkFor(s.contact);

  /* Full bleed: the photo is the top of the card, not a picture sitting
     on it. Only the top corners are rounded — email clients widely
     ignore overflow:hidden, so the image has to round its own. */
  const topCorners = radius ? `border-radius:${radius}px ${radius}px 0 0;` : '';

  const photo = s.photo
    ? `<img src="${esc(s.photo)}" width="${WIDTH}" alt=""
             style="display:block;width:100%;max-width:${WIDTH}px;height:auto;border:0;
                    outline:none;text-decoration:none;${topCorners}" />`
    : `<div style="padding:104px 16px;color:rgba(255,255,255,.55);
                   font:15px ${family};text-align:center;${topCorners}">
         Add a photo
       </div>`;

  /* Paragraphs, not <br>, so the text reflows on a narrow screen. */
  const body = String(s.body || '')
    .split(/\n+/)
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font:${bodySize}px/1.62 ${family};color:${s.ink};">${esc(p)}</p>`
    )
    .join('');

  const contact = href
    ? `<a href="${esc(href)}" style="color:${s.accent};text-decoration:none;">${esc(s.contact)}</a>`
    : esc(s.contact);

  /* A one-row table, so the pieces sit apart without flexbox. The
     leading and trailing cells swap in Arabic, so each stays on the
     side the text reads away from. */
  const badgeCell = s.badge
    ? `<img src="${esc(s.badge)}" height="52" alt="" style="display:block;border:0;height:52px;width:auto;" />`
    : '&nbsp;';
  const waveCell = s.wave && s.waveUrl
    ? `<img src="${esc(s.waveUrl)}" width="118" alt="" style="display:block;border:0;width:118px;height:auto;" />`
    : '&nbsp;';
  const logoCell = s.logo && s.logoUrl
    ? `<img src="${esc(s.logoUrl)}" height="54" alt="OMQ" style="display:block;border:0;height:54px;width:auto;" />`
    : '&nbsp;';

  const lead = isRTL() ? waveCell : badgeCell;
  const trail = isRTL() ? badgeCell : waveCell;

  const footer = `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" width="33%">${lead}</td>
                  <td align="center" width="34%">${logoCell}</td>
                  <td align="right" width="33%">${trail}</td>
                </tr>
              </table>`;

  const rule = s.rule
    ? `<tr><td style="padding:0 32px;">
         <div style="height:4px;background:${s.accent};border-radius:3px;font-size:0;line-height:0;">&nbsp;</div>
       </td></tr>`
    : '';

  /* Outlook renders with Word and ignores max-width, so it is given a
     fixed-width table of its own inside a conditional comment. Every
     other client sees only the fluid one. */
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="width:100%;background:${s.page};margin:0;padding:0;" dir="${dir}">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <!--[if mso]><table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0"
             class="omq-card"
             style="width:100%;max-width:${WIDTH}px;background:${s.paper};border-radius:${radius}px;
                    overflow:hidden;border-collapse:separate;">
        <tr>
          <td align="center" style="background:${s.dark};padding:0;font-size:0;line-height:0;">
            ${photo}
          </td>
        </tr>
        <tr>
          <td class="omq-pad" align="${side}" style="padding:34px 32px 6px;" dir="${dir}">
            <h1 style="margin:0 0 14px;font:${h1}px/1.2 ${family};font-weight:400;color:${s.ink};">${heading}</h1>
            ${body}
            <p style="margin:16px 0 0;font:${bodySize}px/1.6 ${family};color:${s.ink};">
              <strong>${esc(s.contactLabel)}</strong>
              <span style="white-space:nowrap;">${contact}</span>
            </p>
          </td>
        </tr>
        ${rule}
        <tr>
          <td class="omq-pad" style="padding:22px 32px 28px;">
${footer}
          </td>
        </tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>`;
}

/* The media query is an improvement, never the mechanism — Gmail on a
   non-Google account throws it away, and the fluid widths still hold. */
const MEDIA = `
    @media only screen and (max-width:600px) {
      .omq-card h1 { font-size: 26px !important; }
      .omq-pad { padding-left: 20px !important; padding-right: 20px !important; }
    }`;

function fullDocument(s) {
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${isRTL() ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>${esc(state().heading)}</title>
<style>
    body { margin:0; padding:0; width:100% !important; background:${s.page}; }
    img { -ms-interpolation-mode:bicubic; }
    a { text-decoration:none; }${fontFaceRule()}${MEDIA}
</style>
</head>
<body style="margin:0;padding:0;background:${s.page};">
${cardHtml(s)}
</body>
</html>`;
}

/* ============================================================
   State and preview
   ============================================================ */
function state() {
  const v = (values[template] && values[template][lang]) || {};
  const paper = $('paperColor').value;
  const light = isLight(paper);
  return {
    ...v,
    photo: absolute(photoUrl),
    badge: absolute($('badgeUrl').value.trim()),
    logo: $('showLogo').checked,
    logoUrl: art.logo,
    wave: $('showWave').checked,
    waveUrl: art.wave,
    rule: $('showRule').checked,
    round: $('roundCard').checked,
    paper,
    page: $('pageColor').value,
    dark: $('darkColor').value,
    accent: $('accentColor').value,
    ink: light ? '#14171f' : '#f4f6ff',
    muted: light ? '#6a7080' : '#aab',
    family: fontOf($('fontFamily').value),
    headingSize: Number($('headingSize').value),
  };
}

let pending = null;
function refresh() {
  clearTimeout(pending);
  pending = setTimeout(() => {
    $('cardFrame').srcdoc = fullDocument(state());
  }, 80);
}

/* ============================================================
   Controls
   ============================================================ */
Object.entries(TEMPLATES).forEach(([id, spec]) => {
  const o = document.createElement('option');
  o.value = id;
  o.textContent = spec.label;
  $('templateSelect').appendChild(o);
});

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
    input.dir = isRTL() ? 'rtl' : 'ltr'; // read the way it will print
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

['darkColor', 'paperColor', 'pageColor', 'fontFamily', 'fontFallback',
 'showLogo', 'showWave', 'showRule', 'roundCard', 'badgeUrl'].forEach((id) =>
  $(id).addEventListener('input', refresh)
);

/* The wave is baked at its colour, so a new accent needs a new one.
   On `change`, not `input` — dragging a colour picker would otherwise
   rasterise and upload on every intermediate shade. */
$('accentColor').addEventListener('input', refresh);
$('accentColor').addEventListener('change', ensureArt);

/* Both selects are built from FAMILIES, so adding a stack adds it in
   both places. Only the first offers uploaded fonts — the second is
   what happens when those are refused. */
function buildFontSelects() {
  [['fontFamily', true], ['fontFallback', false]].forEach(([id, withBrand]) => {
    const sel = $(id);
    const chosen = sel.value;
    sel.innerHTML = '';

    const add = (value, text) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      sel.appendChild(o);
    };

    Object.keys(FAMILIES).forEach((key) => add(key, FAMILY_LABELS[key]));
    if (withBrand) brandFonts.forEach((f) => add('brand-' + f.id, f.name + ' — uploaded'));

    sel.value = chosen || 'zarid';
  });
  showFontNote();
}

function showFontNote() {
  const value = $('fontFamily').value;
  if (value.startsWith('brand-')) {
    $('fontNote').textContent = FONT_SUPPORT;
    return;
  }
  if (value === 'zarid') {
    $('fontNote').textContent =
      '29LT Zarid Text is licensed and cannot be embedded, so this is the ' +
      'nearest installed match: Palatino or Book Antiqua for Latin, Sakkal ' +
      'Majalla or Geeza Pro for Arabic. Licensed the real thing? Add the web ' +
      'font under Brand Kit → Fonts and pick it above.';
    return;
  }
  $('fontNote').textContent = brandFonts.length
    ? 'Upload fonts under Brand Kit → Fonts to use them here.'
    : 'Sign in and add fonts to the Brand Kit to use your own.';
}

$('fontFamily').addEventListener('change', showFontNote);

$('headingSize').addEventListener('input', () => {
  $('headingSizeVal').textContent = $('headingSize').value + ' px';
  refresh();
});

/* ---------- device toggle ---------- */
$('deviceToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('#deviceToggle .tab').forEach((t) => t.classList.toggle('active', t === btn));
  $('cardStage').classList.toggle('is-phone', btn.dataset.device === 'phone');
});

/* ---------- photo ----------
   Uploaded to the server rather than inlined: a data: URI shows fine
   in this preview and then fails in the recipient's inbox, which is
   the worst possible time to find out. */
$('photoInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (!API.isSignedIn()) {
    say($('photoStatus'),
      'Sign in to host the photo — mail clients will not show one pasted inline.', 'warn');
    $('photoStatus').innerHTML +=
      ` <a href="${API.loginUrl()}">Sign in</a>`;
    $('photoInput').value = '';
    return;
  }

  $('photoText').textContent = 'Uploading…';
  try {
    const form = new FormData();
    form.append('kind', 'photo');
    form.append('name', file.name);
    form.append('file', file);

    const { asset } = await API.assets.upload(form);
    photoUrl = asset.url;
    $('photoUrl').value = absolute(asset.url);
    $('photoText').textContent = '✓ ' + file.name;
    say($('photoStatus'), '✓ Hosted — recipients will see it.', 'ok');
    refresh();
  } catch (err) {
    $('photoText').textContent = 'Choose a photo';
    say($('photoStatus'), '⚠ ' + err.message, 'warn');
  }
});

$('photoUrl').addEventListener('input', () => {
  photoUrl = $('photoUrl').value.trim();
  refresh();
});

/* ---------- export ---------- */
function fileName() {
  return (TEMPLATES[template].file || 'omq-card') + (isRTL() ? '-ar' : '');
}

/* text/html on the clipboard is what makes a paste into Gmail arrive
   as a card rather than as a wall of angle brackets. */
$('copyRichBtn').addEventListener('click', async () => {
  const html = cardHtml(state());
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([stripTags(html)], { type: 'text/plain' }),
      }),
    ]);
    say($('exportStatus'), '✓ Copied. Paste into Gmail or Outlook.', 'ok');
  } catch {
    say($('exportStatus'),
      'This browser will not copy rich text. Use Copy HTML, or download the file.', 'warn');
  }
});

function stripTags(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return (d.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

$('copyHtmlBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(fullDocument(state()));
    say($('exportStatus'), '✓ HTML copied — paste into your mail template.', 'ok');
  } catch {
    say($('exportStatus'), 'Could not reach the clipboard. Download the file instead.', 'warn');
  }
});

$('downloadBtn').addEventListener('click', () => {
  const name = fileName() + '.html';
  saveBlob(new Blob([fullDocument(state())], { type: 'text/html' }), name);
  say($('exportStatus'), '✓ Downloaded ' + name, 'ok');
});

/* ---------- optional Brand Kit ---------- */
API.optionalSession({
  account: $('authAccount'),
  onIn: async () => {
    try {
      const { assets } = await API.assets.list();

      brandFonts = (assets || [])
        .filter((a) => a.kind === 'font')
        .map((f) => ({ ...f, family: 'OMQ Card ' + f.id }));

      /* Load them here too, so the preview shows what a client that
         honours the face would show. */
      brandFonts.forEach((f) => {
        new FontFace(f.family, `url(${JSON.stringify(absolute(f.url))})`)
          .load()
          .then((face) => {
            document.fonts.add(face);
            refresh();
          })
          .catch(() => {});
      });
      buildFontSelects();

      const colours = (assets || []).filter((a) => a.kind === 'colour');
      if (!colours.length) return;

      $('brandColours').classList.remove('hidden');
      $('brandColours').textContent = 'Brand Kit: ';
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
    } catch {
      /* The card tool works perfectly well without the Brand Kit. */
    }
  },
});

/* ---------- init ---------- */
seed();
buildFields();
buildFontSelects();
refresh();
ensureArt();
