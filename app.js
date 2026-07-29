/* ============================================================
   OMQ QR Studio
   ============================================================ */

const $ = (id) => document.getElementById(id);

const PREVIEW_SIZE = 280;

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
   Short links — stored in the repo, so they keep working as long
   as the site is published. Creating one requires an admin token.
   ============================================================ */
const GH = window.OMQ_GH;

function clearShortLink() {
  shortLink = null;
  shortLinkFor = null;
  $('makeShortBtn').disabled = false;
  $('makeShortBtn').textContent = 'Create short link';
}

$('useShortLink').addEventListener('change', () => {
  const on = $('useShortLink').checked;
  $('shortBox').classList.toggle('hidden', !on);

  if (!on) {
    clearShortLink();
    $('shortStatus').textContent = '';
    refresh();
    return;
  }

  if (!GH.getToken()) {
    $('shortStatus').innerHTML =
      'Creating short links needs admin access. <a href="links.html">Sign in to the link manager</a>, then come back.';
    $('makeShortBtn').disabled = true;
  } else {
    $('shortStatus').textContent = '';
    $('makeShortBtn').disabled = false;
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
    const destination = GH.normalizeUrl(raw);
    btn.disabled = true;
    btn.textContent = 'Creating…';

    const { links, sha } = await GH.loadLinks();
    const code = GH.makeCode(links);
    links[code] = { url: destination, label: '', created: new Date().toISOString() };
    await GH.saveLinks(links, sha, `Add short link /${code}`);

    shortLink = GH.shortUrl(code);
    shortLinkFor = raw;
    btn.textContent = '✓ Short link created';

    status.innerHTML =
      `QR now points at <b>${shortLink.replace(/^https?:\/\//, '')}</b> — ` +
      `live in about a minute. <a href="links.html">Change its destination</a> any time.`;
    refresh();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Create short link';
    status.textContent = '⚠ ' + err.message;
  }
});

/* Arriving from the link manager with a URL to encode. */
const presetUrl = new URLSearchParams(location.search).get('url');
if (presetUrl) {
  $('urlInput').value = presetUrl;
}

/* ---------- Built-in OMQ logo toggle ---------- */
let omqLogoPromise = null;

function getOmqLogo() {
  if (!omqLogoPromise) {
    omqLogoPromise = fetch('IMG/omq-logo.png')
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      })
      .then(
        (blob) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          })
      );
  }
  return omqLogoPromise;
}

$('useOmqLogo').addEventListener('change', async () => {
  if ($('useOmqLogo').checked) {
    try {
      logoDataUrl = await getOmqLogo();
    } catch {
      omqLogoPromise = null;
      $('useOmqLogo').checked = false;
      $('statusText').textContent = '⚠ Could not load the OMQ logo (IMG/omq-logo.png).';
      return;
    }
    $('logoInput').value = '';
    $('logoBtnText').textContent = 'Upload your own logo';
    $('removeLogoBtn').classList.add('hidden');
    $('logoSizeWrap').style.display = 'flex';
    $('errorLevel').value = 'H';
  } else {
    logoDataUrl = null;
    $('logoSizeWrap').style.display = 'none';
  }
  refresh();
});

/* ---------- Custom logo upload ---------- */
$('logoInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    logoDataUrl = reader.result;
    $('useOmqLogo').checked = false;
    $('logoBtnText').textContent = '✓ ' + file.name;
    $('removeLogoBtn').classList.remove('hidden');
    $('logoSizeWrap').style.display = 'flex';
    $('errorLevel').value = 'H';
    refresh();
  };
  reader.readAsDataURL(file);
});

$('removeLogoBtn').addEventListener('click', () => {
  logoDataUrl = null;
  $('useOmqLogo').checked = false;
  $('logoInput').value = '';
  $('logoBtnText').textContent = 'Upload your own logo';
  $('removeLogoBtn').classList.add('hidden');
  $('logoSizeWrap').style.display = 'none';
  refresh();
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
