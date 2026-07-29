/* ============================================================
   OMQ Link Manager — create and edit short links stored in the repo
   ============================================================ */

const $ = (id) => document.getElementById(id);
const GH = window.OMQ_GH;

let links = {};
let sha = null;

/* ---------- helpers ---------- */
function say(el, message, kind) {
  el.textContent = message;
  el.className = 'status' + (kind ? ' status-' + kind : '');
}

function busy(button, isBusy, label) {
  button.disabled = isBusy;
  button.textContent = isBusy ? label : button.dataset.label;
}

function shortOf(code) {
  return GH.shortUrl(code);
}

async function copy(text, statusEl) {
  try {
    await navigator.clipboard.writeText(text);
    if (statusEl) say(statusEl, '✓ Copied ' + text, 'ok');
  } catch {
    if (statusEl) say(statusEl, text, null);
  }
}

/* ---------- sign in ---------- */
$('repoInput').value = GH.getRepo();
$('basePrefix').textContent = GH.SHORT_BASE.replace(/^https?:\/\//, '');

['signInBtn', 'createBtn'].forEach((id) => {
  $(id).dataset.label = $(id).textContent;
});

async function signIn(silent) {
  const token = $('tokenInput').value.trim() || GH.getToken();
  if (!token) {
    if (!silent) say($('signInStatus'), 'Paste your access token first.', 'warn');
    return false;
  }

  GH.setToken(token);
  if ($('repoInput').value.trim()) GH.setRepo($('repoInput').value.trim());

  busy($('signInBtn'), true, 'Checking…');
  try {
    const info = await GH.verifyToken();
    if (!info.canWrite) throw new Error('This token can read the repo but not write to it.');

    await refresh();
    $('signInPanel').classList.add('hidden');
    $('createPanel').classList.remove('hidden');
    $('listPanel').classList.remove('hidden');
    $('tokenInput').value = '';
    return true;
  } catch (err) {
    if (!silent) say($('signInStatus'), '⚠ ' + err.message, 'warn');
    else GH.clearToken();
    return false;
  } finally {
    busy($('signInBtn'), false);
  }
}

$('signInBtn').addEventListener('click', () => signIn(false));

$('tokenInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') signIn(false);
});

$('signOutBtn').addEventListener('click', () => {
  GH.clearToken();
  links = {};
  sha = null;
  $('signInPanel').classList.remove('hidden');
  $('createPanel').classList.add('hidden');
  $('listPanel').classList.add('hidden');
  say($('signInStatus'), 'Signed out. The token was removed from this browser.', 'ok');
});

/* ---------- load ---------- */
async function refresh() {
  const data = await GH.loadLinks();
  links = data.links;
  sha = data.sha;
  render();
}

$('reloadBtn').addEventListener('click', async () => {
  try {
    await refresh();
  } catch (err) {
    say($('createStatus'), '⚠ ' + err.message, 'warn');
  }
});

/* ---------- create ---------- */
$('createBtn').addEventListener('click', async () => {
  const statusEl = $('createStatus');
  try {
    const url = GH.normalizeUrl($('destInput').value);
    const custom = $('codeInput').value.trim();
    const code = custom ? GH.validateCode(custom, links) : GH.makeCode(links);
    const label = $('labelInput').value.trim();

    busy($('createBtn'), true, 'Saving…');

    links[code] = {
      url,
      label: label || '',
      created: new Date().toISOString(),
    };
    sha = await GH.saveLinks(links, sha, `Add short link /${code}`);

    $('destInput').value = '';
    $('codeInput').value = '';
    $('labelInput').value = '';
    render();

    await copy(shortOf(code));
    say(statusEl, `✓ ${shortOf(code)} created and copied. It goes live in about a minute.`, 'ok');
  } catch (err) {
    say(statusEl, '⚠ ' + err.message, 'warn');
  } finally {
    busy($('createBtn'), false);
  }
});

/* ---------- list ---------- */
function render() {
  const list = $('linkList');
  const codes = Object.keys(links).sort(
    (a, b) => new Date(links[b].created || 0) - new Date(links[a].created || 0)
  );

  $('linkCount').textContent = codes.length;
  list.innerHTML = '';

  if (!codes.length) {
    list.innerHTML = '<p class="muted-copy">No short links yet.</p>';
    return;
  }

  codes.forEach((code) => {
    const entry = links[code];
    const url = typeof entry === 'string' ? entry : entry.url;
    const label = (typeof entry === 'object' && entry.label) || '';
    const created = (typeof entry === 'object' && entry.created) || '';

    const row = document.createElement('div');
    row.className = 'link-row';

    const head = document.createElement('div');
    head.className = 'link-head';

    const codeEl = document.createElement('button');
    codeEl.className = 'link-code';
    codeEl.textContent = shortOf(code).replace(/^https?:\/\//, '');
    codeEl.title = 'Copy short link';
    codeEl.addEventListener('click', () => copy(shortOf(code), rowStatus));

    const meta = document.createElement('span');
    meta.className = 'link-meta';
    meta.textContent =
      (label ? label + ' · ' : '') +
      (created ? new Date(created).toLocaleDateString() : '');

    head.append(codeEl, meta);

    const destWrap = document.createElement('div');
    destWrap.className = 'link-dest';

    const dest = document.createElement('input');
    dest.type = 'url';
    dest.value = url;
    dest.spellcheck = false;

    const saveBtn = document.createElement('button');
    saveBtn.className = 'secondary';
    saveBtn.textContent = 'Save';
    saveBtn.disabled = true;

    dest.addEventListener('input', () => {
      saveBtn.disabled = dest.value.trim() === url;
    });

    saveBtn.addEventListener('click', async () => {
      try {
        const next = GH.normalizeUrl(dest.value);
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        links[code] = { ...(typeof entry === 'object' ? entry : {}), url: next };
        sha = await GH.saveLinks(links, sha, `Update short link /${code}`);
        say(rowStatus, '✓ Destination updated — live in about a minute.', 'ok');
        render();
      } catch (err) {
        saveBtn.textContent = 'Save';
        saveBtn.disabled = false;
        say(rowStatus, '⚠ ' + err.message, 'warn');
      }
    });

    const openBtn = document.createElement('a');
    openBtn.className = 'btn-link';
    openBtn.href = url;
    openBtn.target = '_blank';
    openBtn.rel = 'noopener noreferrer';
    openBtn.textContent = 'Open';

    const qrBtn = document.createElement('a');
    qrBtn.className = 'btn-link';
    qrBtn.href = 'index.html?url=' + encodeURIComponent(shortOf(code));
    qrBtn.textContent = 'QR';

    const delBtn = document.createElement('button');
    delBtn.className = 'ghost';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      if (
        !confirm(
          `Delete ${shortOf(code)}?\n\nEvery QR code and printed copy using this ` +
            `short link will stop working. This cannot be undone.`
        )
      )
        return;
      try {
        delete links[code];
        sha = await GH.saveLinks(links, sha, `Delete short link /${code}`);
        render();
      } catch (err) {
        say(rowStatus, '⚠ ' + err.message, 'warn');
        await refresh();
      }
    });

    destWrap.append(dest, saveBtn);

    const actions = document.createElement('div');
    actions.className = 'link-actions';
    actions.append(openBtn, qrBtn, delBtn);

    const rowStatus = document.createElement('p');
    rowStatus.className = 'status';

    row.append(head, destWrap, actions, rowStatus);
    list.appendChild(row);
  });
}

/* ---------- init ---------- */
if (GH.getToken()) signIn(true);
