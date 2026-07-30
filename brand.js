/* ============================================================
   OMQ Brand Kit — logos, icons, colours, fonts and templates.

   One library rather than two: an icon set and a logo set differ only
   in what they contain, so they share the storage, the browser and the
   download path, and differ by a tab.
   ============================================================ */

const $ = (id) => document.getElementById(id);
const API = window.OMQ_API;

const KINDS = {
  logo:     { label: 'logos',     accept: '.svg,.png,.jpg,.jpeg,.webp,.pdf,.eps,.ai', allowed: 'SVG, PNG, JPG, WebP, PDF, EPS, AI' },
  icon:     { label: 'icons',     accept: '.svg,.png,.webp',                          allowed: 'SVG, PNG, WebP' },
  colour:   { label: 'colours',   accept: '',                                         allowed: '' },
  font:     { label: 'fonts',     accept: '.woff2,.woff,.ttf,.otf',                    allowed: 'WOFF2, WOFF, TTF, OTF' },
  template: { label: 'templates', accept: '.pdf,.png,.jpg,.jpeg,.svg,.ai,.psd,.indd,.sketch,.fig,.zip', allowed: 'PDF, PNG, JPG, SVG, AI, PSD, INDD, Sketch, Fig, ZIP' },
};

let assets = [];
let kind = 'logo';
let filter = '';

/* ---------- helpers ---------- */
function say(el, message, kindOfMessage) {
  el.textContent = message;
  el.className = 'status' + (kindOfMessage ? ' status-' + kindOfMessage : '');
}

function busy(button, isBusy, label) {
  button.disabled = isBusy;
  button.textContent = isBusy ? label : button.dataset.label;
}

function size(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

const isImage = (a) => /\.(svg|png|jpe?g|webp)$/i.test(a.url);

function handle(err, statusEl) {
  if (err && err.status === 401) {
    showSignedOut();
    say($('signInStatus'), 'Your sign-in expired. Continue with Google again.', 'warn');
    return;
  }
  say(statusEl, '⚠ ' + err.message, 'warn');
}

async function copy(text, statusEl) {
  try {
    await navigator.clipboard.writeText(text);
    say(statusEl, '✓ Copied ' + text, 'ok');
  } catch {
    say(statusEl, text, null);
  }
}

/* ---------- sign in ---------- */
$('addBtn').dataset.label = $('addBtn').textContent;

API.loadConfig()
  .then(() => {
    $('domainName').textContent = API.ALLOWED_DOMAIN;
  })
  .catch(() => {});

function showSignedIn() {
  const user = API.getUser();
  $('signInPanel').classList.add('hidden');
  $('libraryPanel').classList.remove('hidden');
  $('addPanel').classList.remove('hidden');
  $('signOutBtn').classList.remove('hidden');
  $('whoami').classList.remove('hidden');
  $('whoami').textContent = (user && user.email) || '';
}

function showSignedOut() {
  assets = [];
  $('signInPanel').classList.remove('hidden');
  $('libraryPanel').classList.add('hidden');
  $('addPanel').classList.add('hidden');
  $('signOutBtn').classList.add('hidden');
  $('whoami').classList.add('hidden');
}

API.mountButton($('googleBtn'), {
  onSignIn: async () => {
    say($('signInStatus'), '');
    try {
      await refresh();
      showSignedIn();
    } catch (err) {
      API.signOut();
      say($('signInStatus'), '⚠ ' + err.message, 'warn');
    }
  },
  onSignOut: showSignedOut,
}).catch((err) => say($('signInStatus'), '⚠ ' + err.message, 'warn'));

$('signOutBtn').addEventListener('click', () => {
  API.signOut();
  say($('signInStatus'), 'Signed out.', 'ok');
});

/* ---------- load ---------- */
async function refresh() {
  const data = await API.assets.list();
  assets = data.assets || [];
  render();
}

$('reloadBtn').addEventListener('click', async () => {
  try {
    await refresh();
  } catch (err) {
    handle(err, $('listStatus'));
  }
});

/* ---------- tabs ---------- */
$('kindTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  kind = btn.dataset.kind;
  document.querySelectorAll('#kindTabs .tab').forEach((t) => t.classList.toggle('active', t === btn));
  syncAddForm();
  render();
});

function syncAddForm() {
  const spec = KINDS[kind];
  const isColour = kind === 'colour';

  $('addKindName').textContent = spec.label;
  $('fileForm').classList.toggle('hidden', isColour);
  $('colourForm').classList.toggle('hidden', !isColour);

  if (!isColour) {
    $('assetFile').accept = spec.accept;
    $('allowedHint').textContent = 'Accepted: ' + spec.allowed + '. Up to 20 MB.';
    $('assetFile').value = '';
    $('assetFileText').textContent = 'Choose a file';
  }
  say($('addStatus'), '');
}

$('assetFile').addEventListener('change', () => {
  const file = $('assetFile').files[0];
  $('assetFileText').textContent = file ? '✓ ' + file.name : 'Choose a file';
});

/* Keep the picker and the hex field showing the same colour. */
$('colourValue').addEventListener('input', () => {
  $('colourHex').value = $('colourValue').value.toUpperCase();
});
$('colourHex').addEventListener('input', () => {
  const v = $('colourHex').value.trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(v)) {
    $('colourValue').value = v[0] === '#' ? v : '#' + v;
  }
});

/* ---------- add ---------- */
$('addBtn').addEventListener('click', async () => {
  const statusEl = $('addStatus');
  busy($('addBtn'), true, 'Adding…');

  try {
    let created;
    if (kind === 'colour') {
      created = await API.assets.colour({
        name: $('colourName').value.trim(),
        value: $('colourHex').value.trim(),
        notes: $('colourNotes').value.trim(),
      });
      $('colourName').value = '';
      $('colourNotes').value = '';
    } else {
      const file = $('assetFile').files[0];
      if (!file) throw new Error('Choose a file first.');

      const form = new FormData();
      form.append('kind', kind);
      form.append('name', $('assetName').value.trim());
      form.append('notes', $('assetNotes').value.trim());
      form.append('file', file);

      created = await API.assets.upload(form);
      $('assetFile').value = '';
      $('assetFileText').textContent = 'Choose a file';
      $('assetName').value = '';
      $('assetNotes').value = '';
    }

    assets.push(created.asset);
    render();
    say(statusEl, `✓ ${created.asset.name} added.`, 'ok');
  } catch (err) {
    handle(err, statusEl);
  } finally {
    busy($('addBtn'), false);
  }
});

/* ---------- list ---------- */
$('searchInput').addEventListener('input', () => {
  filter = $('searchInput').value.trim().toLowerCase();
  render();
});

function matches(a) {
  if (a.kind !== kind) return false;
  if (!filter) return true;
  return (
    a.name.toLowerCase().includes(filter) ||
    (a.notes || '').toLowerCase().includes(filter) ||
    (a.value || '').toLowerCase().includes(filter)
  );
}

function preview(a) {
  const box = document.createElement('div');
  box.className = 'asset-preview';

  if (a.kind === 'colour') {
    box.classList.add('is-colour');
    box.style.background = a.value;
    return box;
  }
  if (isImage(a)) {
    const img = document.createElement('img');
    img.src = a.url;
    img.alt = a.name;
    img.loading = 'lazy';
    box.appendChild(img);
    return box;
  }
  /* Fonts and binary templates have nothing to show — name the format. */
  const ext = (a.original.split('.').pop() || '?').toUpperCase();
  box.classList.add('is-file');
  box.textContent = ext;
  return box;
}

function render() {
  const grid = $('assetGrid');
  const shown = assets.filter(matches);
  grid.innerHTML = '';
  say($('listStatus'), '');

  if (!shown.length) {
    grid.innerHTML = `<p class="muted-copy">${
      filter ? 'Nothing matches that search.' : 'No ' + KINDS[kind].label + ' yet.'
    }</p>`;
    return;
  }

  shown.forEach((a) => {
    const card = document.createElement('div');
    card.className = 'asset-card';

    card.appendChild(preview(a));

    const name = document.createElement('h3');
    name.className = 'asset-name';
    name.textContent = a.name;

    const meta = document.createElement('p');
    meta.className = 'asset-meta';
    meta.textContent =
      a.kind === 'colour' ? a.value : [a.original, size(a.bytes)].filter(Boolean).join(' · ');

    const body = document.createElement('div');
    body.className = 'asset-body';
    body.append(name, meta);

    if (a.notes) {
      const note = document.createElement('p');
      note.className = 'asset-note';
      note.textContent = a.notes;
      body.appendChild(note);
    }

    const actions = document.createElement('div');
    actions.className = 'asset-actions';

    if (a.kind === 'colour') {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'secondary';
      copyBtn.textContent = 'Copy hex';
      copyBtn.addEventListener('click', () => copy(a.value, $('listStatus')));
      actions.appendChild(copyBtn);
    } else {
      const dl = document.createElement('a');
      dl.className = 'btn-link';
      dl.href = a.url;
      dl.download = a.original || a.name;
      dl.textContent = 'Download';
      actions.appendChild(dl);

      const open = document.createElement('a');
      open.className = 'btn-link';
      open.href = a.url;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      open.textContent = 'Open';
      actions.appendChild(open);
    }

    const del = document.createElement('button');
    del.className = 'ghost';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      if (!confirm(`Delete "${a.name}" from the brand kit?\n\nThis cannot be undone.`)) return;
      try {
        await API.assets.remove(a.id);
        assets = assets.filter((x) => x.id !== a.id);
        render();
      } catch (err) {
        handle(err, $('listStatus'));
      }
    });
    actions.appendChild(del);

    body.appendChild(actions);
    card.appendChild(body);
    grid.appendChild(card);
  });
}

/* ---------- init ---------- */
syncAddForm();

if (API.isSignedIn()) {
  refresh()
    .then(showSignedIn)
    .catch(() => {
      API.signOut();
      showSignedOut();
    });
}
