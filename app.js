/* ============================================================
   OMQ QR Studio
   ============================================================ */

const $ = (id) => document.getElementById(id);

/* Rendered at this size and scaled down by CSS, so the preview stays crisp
   in the wide desktop column as well as on a phone. */
const PREVIEW_SIZE = 480;

let activeType = 'url';
let logoDataUrl = null;

/* Short link currently encoded in the QR, and the destination it was made for. */
let shortLink = null;
let shortLinkFor = null;

/* ---------- QR instance (preview) ---------- */
const qr = new QRCodeStyling(buildOptions(PREVIEW_SIZE));
qr.append($('qrPreview'));

/* ---------- Content builders ---------- */
const wifiEscape = (s) => s.replace(/([\\;,:"])/g, '\\$1');

function buildData() {
  switch (activeType) {
    case 'url': {
      const v = $('urlInput').value.trim();
      if (!v || v === 'https://') return '';
      /* A short link only stands in for the address it was created for. */
      if (shortLink && shortLinkFor === v) return shortLink;
      return v;
    }
    case 'text':
      return $('textInput').value.trim();
    case 'wifi': {
      const ssid = $('wifiSsid').value.trim();
      if (!ssid) return '';
      const type = $('wifiType').value;
      const pass = $('wifiPass').value;
      const hidden = $('wifiHidden').checked ? 'H:true;' : '';
      const passPart = type === 'nopass' ? '' : `P:${wifiEscape(pass)};`;
      return `WIFI:T:${type};S:${wifiEscape(ssid)};${passPart}${hidden};`;
    }
    case 'email': {
      const to = $('emailTo').value.trim();
      if (!to) return '';
      const params = new URLSearchParams();
      if ($('emailSubject').value.trim()) params.set('subject', $('emailSubject').value.trim());
      if ($('emailBody').value.trim()) params.set('body', $('emailBody').value.trim());
      const qs = params.toString();
      return `mailto:${to}${qs ? '?' + qs : ''}`;
    }
    case 'phone': {
      const n = $('phoneNumber').value.trim();
      return n ? `tel:${n}` : '';
    }
    case 'sms': {
      const n = $('smsNumber').value.trim();
      if (!n) return '';
      return `SMSTO:${n}:${$('smsBody').value.trim()}`;
    }
    case 'vcard': {
      const first = $('vcFirst').value.trim();
      const last = $('vcLast').value.trim();
      if (!first && !last) return '';
      const lines = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `N:${last};${first};;;`,
        `FN:${[first, last].filter(Boolean).join(' ')}`,
      ];
      if ($('vcOrg').value.trim()) lines.push(`ORG:${$('vcOrg').value.trim()}`);
      if ($('vcPhone').value.trim()) lines.push(`TEL;TYPE=CELL:${$('vcPhone').value.trim()}`);
      if ($('vcEmail').value.trim()) lines.push(`EMAIL:${$('vcEmail').value.trim()}`);
      if ($('vcUrl').value.trim()) lines.push(`URL:${$('vcUrl').value.trim()}`);
      lines.push('END:VCARD');
      return lines.join('\n');
    }
  }
  return '';
}

/* ---------- Options builder ---------- */
function buildOptions(size) {
  const data = buildData();
  const scale = size / PREVIEW_SIZE;

  const colorOpts = $('useGradient').checked
    ? {
        gradient: {
          type: 'linear',
          rotation: Math.PI / 4,
          colorStops: [
            { offset: 0, color: $('fgColor').value },
            { offset: 1, color: $('fgColor2').value },
          ],
        },
      }
    : { color: $('fgColor').value };

  return {
    width: size,
    height: size,
    type: 'canvas',
    data: data || ' ',
    margin: Math.round(Number($('qrMargin').value) * scale),
    image: logoDataUrl || undefined,
    qrOptions: { errorCorrectionLevel: logoDataUrl ? 'H' : $('errorLevel').value },
    imageOptions: {
      crossOrigin: 'anonymous',
      imageSize: Number($('logoSize').value) / 100,
      margin: Math.round(4 * scale),
      hideBackgroundDots: true,
    },
    dotsOptions: { type: $('dotStyle').value, ...colorOpts },
    cornersSquareOptions: { type: $('cornerSquareStyle').value, ...colorOpts },
    cornersDotOptions: { type: $('cornerDotStyle').value, ...colorOpts },
    backgroundOptions: {
      color: $('bgTransparent').checked ? 'transparent' : $('bgColor').value,
    },
  };
}

function currentFileName() {
  return (
    ($('fileName').value.trim() || 'omq-qr-code')
      .replace(/[^\w\- ]+/g, '')
      .replace(/\s+/g, '-') || 'omq-qr-code'
  );
}

/* ---------- Live preview (debounced) ---------- */
let debounceTimer = null;

function refresh() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const data = buildData();
    qr.update(buildOptions(PREVIEW_SIZE));
    $('statusText').textContent = data
      ? 'Live preview — scan it with your phone to test.'
      : 'Type something to see your QR code.';
    prepareShareFile();
  }, 150);
}

/* ---------- Type tabs ---------- */
$('typeTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  activeType = btn.dataset.type;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === btn));
  document.querySelectorAll('.type-form').forEach((f) =>
    f.classList.toggle('active', f.dataset.form === activeType)
  );
  btn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  refresh();
});

/* ---------- Wire inputs to the live preview ---------- */
document.querySelectorAll('input, textarea, select').forEach((el) => {
  /* The logo controls redraw themselves once the image is ready — refreshing
     here as well would render one frame with the previous logo. */
  if (el.type === 'file' || el.id === 'useOmqLogo') return;
  el.addEventListener('input', refresh);
});

$('useGradient').addEventListener('input', () => {
  $('fgColor2Wrap').classList.toggle('hidden', !$('useGradient').checked);
});

$('qrMargin').addEventListener('input', () => {
  $('marginVal').textContent = $('qrMargin').value;
});

$('logoSize').addEventListener('input', () => {
  $('logoSizeVal').textContent = $('logoSize').value + '%';
});

/* ============================================================
   Short links — the QR page is just a client of the shortener
   service. Everything about creating one lives in api.js.
   ============================================================ */
const API = window.OMQ_API;

function clearShortLink() {
  shortLink = null;
  shortLinkFor = null;
  $('makeShortBtn').disabled = false;
  $('makeShortBtn').textContent = 'Create short link';
}

/* The same session as every other tool — signing in on the shortener or
   the Brand Kit means this box is already unlocked when you get here. */
API.mountSession({
  gate: $('authGate'),
  account: $('authAccount'),
  blurb: (domain) =>
    `Continue with your ${domain} Google account to create a short link.`,
  onIn: () => {
    $('makeShortBtn').classList.remove('hidden');
    $('shortStatus').textContent = '';
  },
  onOut: () => {
    $('makeShortBtn').classList.add('hidden');
  },
});

$('useShortLink').addEventListener('change', () => {
  const on = $('useShortLink').checked;
  $('shortBox').classList.toggle('hidden', !on);

  if (!on) {
    clearShortLink();
    $('shortStatus').textContent = '';
    refresh();
  }
});

/* Editing the address invalidates a short link made for the old one. */
$('urlInput').addEventListener('input', () => {
  if (shortLink && shortLinkFor !== $('urlInput').value.trim()) {
    clearShortLink();
    $('shortStatus').textContent = 'Address changed — create a new short link for it.';
  }
});

$('makeShortBtn').addEventListener('click', async () => {
  const btn = $('makeShortBtn');
  const status = $('shortStatus');
  const raw = $('urlInput').value.trim();

  try {
    const destination = API.normalizeUrl(raw);
    btn.disabled = true;
    btn.textContent = 'Creating…';

    const { link } = await API.create({ url: destination, label: '' });

    shortLink = link.short;
    shortLinkFor = raw;
    btn.textContent = '✓ Short link created';

    status.innerHTML =
      `QR now points at <b>${link.short.replace(/^https?:\/\//, '')}</b>. ` +
      `<a href="short.html">Change its destination</a> any time.`;
    refresh();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Create short link';
    status.textContent =
      err.status === 401
        ? 'Your sign-in expired — continue with Google again.'
        : '⚠ ' + err.message;
  }
});

/* Arriving from the shortener with a URL to encode. */
const presetUrl = new URLSearchParams(location.search).get('url');
if (presetUrl) {
  $('urlInput').value = presetUrl;
}

/* ============================================================
   Logo
   ============================================================ */

/* The QR clears a block of dots for the logo, sized from the image's aspect
   ratio against a fixed area budget. Transparent padding is charged for at
   full price: the OMQ mark is a 192x464 glyph on a 512x512 canvas, so two
   thirds of the cleared block goes to empty space and the mark comes out
   small. Trim to the artwork's real bounds — same budget, all of it used —
   and set it on an opaque tile so it stays legible on any background. */
function trimBounds(imageData, w, h) {
  const { data } = imageData;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null; /* fully transparent */
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function fitLogo(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('not an image'));
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) return reject(new Error('empty image'));

      const src = document.createElement('canvas');
      src.width = w;
      src.height = h;
      const sctx = src.getContext('2d');
      sctx.drawImage(img, 0, 0);

      const box = trimBounds(sctx.getImageData(0, 0, w, h), w, h) || { x: 0, y: 0, w, h };

      /* Keep the trimmed aspect ratio — padding it back out to a square would
         hand the wasted space straight back. */
      const pad = Math.round(Math.min(box.w, box.h) * 0.1);
      const out = document.createElement('canvas');
      out.width = box.w + pad * 2;
      out.height = box.h + pad * 2;
      const octx = out.getContext('2d');

      octx.fillStyle = '#ffffff';
      octx.beginPath();
      const radius = Math.min(out.width, out.height) * 0.18;
      if (octx.roundRect) octx.roundRect(0, 0, out.width, out.height, radius);
      else octx.rect(0, 0, out.width, out.height);
      octx.fill();

      octx.drawImage(img, box.x, box.y, box.w, box.h, pad, pad, box.w, box.h);

      resolve(out.toDataURL('image/png'));
    };
    img.src = dataUrl;
  });
}

/* A logo forces the highest error correction (see buildOptions), so remember
   what the user picked and hand it back when the logo goes away. */
let errorLevelBeforeLogo = null;

function setLogo(dataUrl) {
  logoDataUrl = dataUrl || null;

  if (logoDataUrl) {
    if (errorLevelBeforeLogo === null) errorLevelBeforeLogo = $('errorLevel').value;
    $('errorLevel').value = 'H';
  } else if (errorLevelBeforeLogo !== null) {
    $('errorLevel').value = errorLevelBeforeLogo;
    errorLevelBeforeLogo = null;
  }

  $('logoSizeWrap').classList.toggle('hidden', !logoDataUrl);
  refresh();
}

/* ---------- Built-in OMQ logo ---------- */
let omqLogo = null;
let uploadedLogo = null;

function loadOmqLogo() {
  return fetch('IMG/omq-logo.png')
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    })
    .then(
      (blob) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('could not read the logo'));
          reader.readAsDataURL(blob);
        })
    );
}

$('useOmqLogo').addEventListener('change', async () => {
  const box = $('useOmqLogo');

  if (!box.checked) {
    /* Fall back to the user's own logo if they still have one loaded. */
    setLogo(uploadedLogo);
    return;
  }

  if (!omqLogo) {
    box.disabled = true;
    try {
      omqLogo = await fitLogo(await loadOmqLogo());
    } catch {
      box.checked = false;
      box.disabled = false;
      $('statusText').textContent = '⚠ Could not load the OMQ logo (IMG/omq-logo.png).';
      return;
    }
    box.disabled = false;
    /* The toggle was ticked while the fetch was in flight and then unticked. */
    if (!box.checked) return;
  }

  setLogo(omqLogo);
});

/* ---------- Custom logo upload ---------- */
$('logoInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      uploadedLogo = await fitLogo(reader.result);
    } catch {
      $('logoInput').value = '';
      $('statusText').textContent = '⚠ That file could not be read as an image.';
      return;
    }
    $('useOmqLogo').checked = false;
    $('logoBtnText').textContent = '✓ ' + file.name;
    $('removeLogoBtn').classList.remove('hidden');
    setLogo(uploadedLogo);
  };
  reader.onerror = () => {
    $('statusText').textContent = '⚠ That file could not be read.';
  };
  reader.readAsDataURL(file);
});

$('removeLogoBtn').addEventListener('click', () => {
  uploadedLogo = null;
  $('logoInput').value = '';
  $('logoBtnText').textContent = 'Upload your own logo';
  $('removeLogoBtn').classList.add('hidden');
  setLogo($('useOmqLogo').checked ? omqLogo : null);
});

/* ---------- Desktop downloads ---------- */
function download(extension) {
  if (!buildData()) {
    $('statusText').textContent = '⚠ Add some content first.';
    return;
  }
  const size = Number($('exportSize').value);
  const name = currentFileName();

  new QRCodeStyling({
    ...buildOptions(size),
    type: extension === 'svg' ? 'svg' : 'canvas',
  }).download({ name, extension });

  $('statusText').textContent = `Downloaded ${name}.${extension}`;
}

$('downloadPng').addEventListener('click', () => download('png'));
$('downloadSvg').addEventListener('click', () => download('svg'));
$('downloadJpeg').addEventListener('click', () => download('jpeg'));

/* ============================================================
   Mobile save
   Only the button that actually works on the device is shown.
   ============================================================ */

const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function supportsFileShare() {
  try {
    const probe = new File([new Blob(['x'], { type: 'image/png' })], 'p.png', {
      type: 'image/png',
    });
    return !!(navigator.canShare && navigator.canShare({ files: [probe] }));
  } catch {
    return false;
  }
}

/* 'share'    → native share sheet (Save to Photos / Files) — iOS + Android
   'download' → normal file download — Android browsers without share
   'longpress'→ no reliable button, tell the user to long-press the QR instead */
const saveMode = supportsFileShare() ? 'share' : isIOS ? 'longpress' : 'download';

const mobileSaveBtn = $('mobileSaveBtn');

if (saveMode === 'longpress') {
  $('mobileBar').style.display = 'none';
  $('iosHint').classList.remove('hidden');
} else {
  mobileSaveBtn.textContent = saveMode === 'share' ? 'Save QR to phone' : 'Download QR (PNG)';
}

/* The share sheet must open inside the tap handler, so the PNG is
   generated ahead of time and kept ready. */
let shareFile = null;
let shareTimer = null;

const mobileView = window.matchMedia('(max-width: 720px)');

function prepareShareFile() {
  if (saveMode !== 'share' || !mobileView.matches) return;
  shareFile = null;
  clearTimeout(shareTimer);
  if (!buildData()) return;

  shareTimer = setTimeout(async () => {
    const name = currentFileName();
    try {
      const blob = await new QRCodeStyling(
        buildOptions(Number($('exportSize').value))
      ).getRawData('png');
      if (blob) shareFile = new File([blob], `${name}.png`, { type: 'image/png' });
    } catch {
      shareFile = null;
    }
  }, 400);
}

mobileSaveBtn.addEventListener('click', async () => {
  if (!buildData()) {
    $('statusText').textContent = '⚠ Add some content first.';
    return;
  }

  if (saveMode === 'download') {
    download('png');
    return;
  }

  if (shareFile && navigator.canShare({ files: [shareFile] })) {
    try {
      await navigator.share({ files: [shareFile], title: shareFile.name });
      $('statusText').textContent = '✓ QR saved.';
    } catch (err) {
      if (err && err.name !== 'AbortError') {
        $('statusText').textContent = 'Save cancelled — try again.';
      }
    }
    return;
  }

  /* Not ready yet (still rendering) — build it now, then share. */
  $('statusText').textContent = 'Preparing your QR…';
  try {
    const blob = await new QRCodeStyling(
      buildOptions(Number($('exportSize').value))
    ).getRawData('png');
    const file = new File([blob], `${currentFileName()}.png`, { type: 'image/png' });
    await navigator.share({ files: [file], title: file.name });
    $('statusText').textContent = '✓ QR saved.';
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    $('iosHint').classList.remove('hidden');
    $('statusText').textContent = 'Press and hold the QR code to save it.';
  }
});

/* ---------- Init ---------- */
refresh();
