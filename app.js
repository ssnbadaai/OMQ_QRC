/* ============================================================
   OMQ QR Studio — static (forever) QR codes with customization
   ============================================================ */

const $ = (id) => document.getElementById(id);

const STORAGE_KEY = 'omq-qr-library-v2';
const PREVIEW_SIZE = 280;

let activeType = 'url';
let logoDataUrl = null;
let library = loadLibrary();

/* ---------- QR instance (preview) ---------- */
const qr = new QRCodeStyling(buildOptions(PREVIEW_SIZE));
qr.append($('qrPreview'));

/* ---------- Content builders ---------- */
const wifiEscape = (s) => s.replace(/([\\;,:"])/g, '\\$1');

function buildData() {
  switch (activeType) {
    case 'url': {
      const v = $('urlInput').value.trim();
      return v && v !== 'https://' ? v : '';
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
      const body = $('smsBody').value.trim();
      return `SMSTO:${n}:${body}`;
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
  const useGradient = $('useGradient').checked;
  const scale = size / PREVIEW_SIZE;

  const dotsColorOpts = useGradient
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
    qrOptions: {
      errorCorrectionLevel: logoDataUrl ? 'H' : $('errorLevel').value,
    },
    imageOptions: {
      crossOrigin: 'anonymous',
      imageSize: Number($('logoSize').value) / 100,
      margin: Math.round(4 * scale),
      hideBackgroundDots: true,
    },
    dotsOptions: { type: $('dotStyle').value, ...dotsColorOpts },
    cornersSquareOptions: { type: $('cornerSquareStyle').value, ...dotsColorOpts },
    cornersDotOptions: { type: $('cornerDotStyle').value, ...dotsColorOpts },
    backgroundOptions: {
      color: $('bgTransparent').checked ? 'transparent' : $('bgColor').value,
    },
  };
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
  refresh();
});

/* ---------- Wire every input to the live preview ---------- */
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

/* ---------- Logo upload ---------- */
$('logoInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    logoDataUrl = reader.result;
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
  $('logoInput').value = '';
  $('logoBtnText').textContent = 'Upload logo';
  $('removeLogoBtn').classList.add('hidden');
  $('logoSizeWrap').style.display = 'none';
  refresh();
});

/* ---------- Download ---------- */
function download(extension) {
  const data = buildData();
  if (!data) {
    $('statusText').textContent = '⚠ Add some content first.';
    return;
  }
  const size = Number($('exportSize').value);
  const name = ($('fileName').value.trim() || 'omq-qr-code').replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-');

  const exportQr = new QRCodeStyling({
    ...buildOptions(size),
    type: extension === 'svg' ? 'svg' : 'canvas',
  });
  exportQr.download({ name, extension });
  $('statusText').textContent = `Downloaded ${name}.${extension} at ${extension === 'svg' ? 'vector' : size + ' px'} quality.`;
}

$('downloadPng').addEventListener('click', () => download('png'));
$('downloadSvg').addEventListener('click', () => download('svg'));
$('downloadJpeg').addEventListener('click', () => download('jpeg'));

/* ---------- Library (localStorage) ---------- */
function loadLibrary() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveLibrary() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
  } catch {
    $('statusText').textContent = '⚠ Could not save — browser storage is full (large logos take space).';
  }
}

function snapshotSettings() {
  const settings = {};
  document.querySelectorAll('input, textarea, select').forEach((el) => {
    if (!el.id || el.type === 'file') return;
    settings[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  return settings;
}

function applySettings(settings) {
  Object.entries(settings).forEach(([id, value]) => {
    const el = $(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = value;
    else el.value = value;
  });
  $('fgColor2Wrap').classList.toggle('hidden', !$('useGradient').checked);
  $('marginVal').textContent = $('qrMargin').value;
  $('logoSizeVal').textContent = $('logoSize').value + '%';
}

$('saveDesignBtn').addEventListener('click', () => {
  const data = buildData();
  if (!data) {
    $('statusText').textContent = '⚠ Add some content before saving.';
    return;
  }
  const defaultName = $('fileName').value.trim() || `${activeType.toUpperCase()} — ${new Date().toLocaleDateString()}`;
  const name = prompt('Name this QR design:', defaultName);
  if (name === null) return;

  library.unshift({
    id: Date.now(),
    name: name.trim() || defaultName,
    type: activeType,
    createdAt: new Date().toISOString(),
    settings: snapshotSettings(),
    logo: logoDataUrl,
  });
  saveLibrary();
  renderLibrary();
  $('statusText').textContent = '✓ Saved to your library.';
});

$('clearLibraryBtn').addEventListener('click', () => {
  if (!library.length) return;
  if (!confirm('Delete ALL saved QR designs? This cannot be undone.')) return;
  library = [];
  saveLibrary();
  renderLibrary();
});

function renderLibrary() {
  const grid = $('libraryGrid');
  grid.innerHTML = '';

  if (!library.length) {
    grid.innerHTML = '<p class="library-empty">Nothing saved yet — build a QR and hit "Save to my library".</p>';
    return;
  }

  library.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'library-item';

    const thumb = document.createElement('div');
    thumb.className = 'thumb';

    const nameEl = document.createElement('div');
    nameEl.className = 'item-name';
    nameEl.textContent = item.name;
    nameEl.title = item.name;

    const meta = document.createElement('div');
    meta.className = 'item-meta';
    meta.textContent = `${item.type.toUpperCase()} · ${new Date(item.createdAt).toLocaleDateString()}`;

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const loadBtn = document.createElement('button');
    loadBtn.className = 'secondary';
    loadBtn.textContent = 'Load';
    loadBtn.addEventListener('click', () => loadDesign(item));

    const delBtn = document.createElement('button');
    delBtn.className = 'ghost';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      library = library.filter((x) => x.id !== item.id);
      saveLibrary();
      renderLibrary();
    });

    actions.append(loadBtn, delBtn);
    card.append(thumb, nameEl, meta, actions);
    grid.appendChild(card);

    renderThumb(item, thumb);
  });
}

function renderThumb(item, container) {
  const saved = { active: activeType, logo: logoDataUrl, settings: snapshotSettings() };

  activeType = item.type;
  logoDataUrl = item.logo || null;
  applySettings(item.settings);
  const opts = buildOptions(150);

  activeType = saved.active;
  logoDataUrl = saved.logo;
  applySettings(saved.settings);

  new QRCodeStyling(opts).append(container);
}

function loadDesign(item) {
  activeType = item.type;
  logoDataUrl = item.logo || null;
  applySettings(item.settings);

  document.querySelectorAll('.tab').forEach((t) =>
    t.classList.toggle('active', t.dataset.type === activeType)
  );
  document.querySelectorAll('.type-form').forEach((f) =>
    f.classList.toggle('active', f.dataset.form === activeType)
  );

  if (logoDataUrl) {
    $('logoBtnText').textContent = '✓ Saved logo';
    $('removeLogoBtn').classList.remove('hidden');
    $('logoSizeWrap').style.display = 'flex';
  } else {
    $('logoBtnText').textContent = 'Upload logo';
    $('removeLogoBtn').classList.add('hidden');
    $('logoSizeWrap').style.display = 'none';
  }

  refresh();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  $('statusText').textContent = `✓ Loaded "${item.name}" — edit or re-download it.`;
}

/* ---------- Init ---------- */
renderLibrary();
refresh();
