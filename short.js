/* ============================================================
   OMQ Short Links — the link shortener itself.
   Standalone: shorten anything, for any purpose. QR codes are one
   thing you can do with a link afterwards, not the point of it.
   ============================================================ */

const $ = (id) => document.getElementById(id);
const API = window.OMQ_API;

let links = [];
let filter = '';

/* ---------- helpers ---------- */
function say(el, message, kind) {
  el.textContent = message;
  el.className = 'status' + (kind ? ' status-' + kind : '');
}

function busy(button, isBusy, label) {
  button.disabled = isBusy;
  button.textContent = isBusy ? label : button.dataset.label;
}

const bare = (url) => String(url).replace(/^https?:\/\//, '');

async function copy(text, statusEl) {
  try {
    await navigator.clipboard.writeText(text);
    if (statusEl) say(statusEl, '✓ Copied ' + bare(text), 'ok');
    return true;
  } catch {
    /* Blocked without a user gesture, or over plain http. */
    if (statusEl) say(statusEl, text, null);
    return false;
  }
}

/* A rejected token means the hour is up — drop back to the sign-in
   screen instead of showing an error the user cannot act on. */
function handle(err, statusEl) {
  /* The hour is up. Back to the one login screen, and back here after. */
  if (err && err.status === 401) {
    location.replace(API.loginUrl());
    return;
  }
  say(statusEl, '⚠ ' + err.message, 'warn');
}

/* ---------- session ----------
   No gate here: api.js sends anyone signed out to login.html and
   brings them back. */
$('createBtn').dataset.label = $('createBtn').textContent;

API.requireSession({
  account: $('authAccount'),
  onIn: async () => {
    $('basePrefix').textContent = bare(API.SHORT_BASE);
    try {
      await refresh();
      $('destInput').focus();
    } catch (err) {
      say($('createStatus'), '⚠ ' + err.message, 'warn');
    }
  },
});

/* ---------- load ---------- */
async function refresh() {
  const data = await API.list();
  links = data.links || [];
  /* The server is the authority on the prefix, so correct the label
     once it has told us. */
  $('basePrefix').textContent = bare(API.SHORT_BASE);
  render();
}

$('reloadBtn').addEventListener('click', async () => {
  try {
    await refresh();
  } catch (err) {
    handle(err, $('createStatus'));
  }
});

/* ---------- shorten ---------- */
function showResult(link) {
  $('resultLink').textContent = bare(link.short);
  $('resultLink').onclick = () => copy(link.short, $('createStatus'));
  $('copyResultBtn').onclick = () => copy(link.short, $('createStatus'));
  $('resultOpen').href = link.short;
  $('resultQr').href = 'qr.html?url=' + encodeURIComponent(link.short);
  $('resultCard').classList.remove('hidden');
}

async function create() {
  const statusEl = $('createStatus');
  try {
    const url = API.normalizeUrl($('destInput').value);
    const custom = $('codeInput').value.trim();
    if (custom) API.validateCode(custom);

    busy($('createBtn'), true, 'Saving…');

    const { link } = await API.create({
      url,
      code: custom,
      label: $('labelInput').value.trim(),
    });

    $('destInput').value = '';
    $('codeInput').value = '';
    $('labelInput').value = '';

    links.unshift(link);
    render();
    showResult(link);

    const copied = await copy(link.short);
    say(statusEl, `✓ ${bare(link.short)} created${copied ? ' and copied' : ''}.`, 'ok');
  } catch (err) {
    $('resultCard').classList.add('hidden');
    handle(err, statusEl);
  } finally {
    busy($('createBtn'), false);
  }
}

$('createBtn').addEventListener('click', create);

/* Enter anywhere in the form shortens — it is a one-field tool most of the time. */
['destInput', 'codeInput', 'labelInput'].forEach((id) => {
  $(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') create();
  });
});

/* ---------- list ---------- */
$('searchInput').addEventListener('input', () => {
  filter = $('searchInput').value.trim().toLowerCase();
  render();
});

function matches(link) {
  if (!filter) return true;
  return (
    link.code.includes(filter) ||
    (link.label || '').toLowerCase().includes(filter) ||
    (link.url || '').toLowerCase().includes(filter)
  );
}

function describe(link) {
  const parts = [];
  if (link.label) parts.push(link.label);
  /* MySQL hands back "2026-07-30 09:15:00"; only the T-separated form
     is portably parseable, and the server stores UTC. */
  if (link.created) {
    parts.push(new Date(link.created.replace(' ', 'T') + 'Z').toLocaleDateString());
  }
  parts.push(link.hits === 1 ? '1 scan' : `${link.hits} scans`);
  return parts.join(' · ');
}

function render() {
  const list = $('linkList');
  $('linkCount').textContent = links.length;

  const shown = links.filter(matches);
  list.innerHTML = '';

  if (!shown.length) {
    list.innerHTML = links.length
      ? '<p class="muted-copy">Nothing matches that search.</p>'
      : '<p class="muted-copy">No short links yet.</p>';
    return;
  }

  shown.forEach((link) => {
    const row = document.createElement('div');
    row.className = 'link-row';

    const rowStatus = document.createElement('p');
    rowStatus.className = 'status';

    const head = document.createElement('div');
    head.className = 'link-head';

    const codeEl = document.createElement('button');
    codeEl.className = 'link-code plain';
    codeEl.textContent = bare(link.short);
    codeEl.title = 'Copy short link';
    codeEl.addEventListener('click', () => copy(link.short, rowStatus));

    const meta = document.createElement('span');
    meta.className = 'link-meta';
    meta.textContent = describe(link);

    head.append(codeEl, meta);

    const destWrap = document.createElement('div');
    destWrap.className = 'link-dest';

    const dest = document.createElement('input');
    dest.type = 'url';
    dest.value = link.url;
    dest.spellcheck = false;

    const saveBtn = document.createElement('button');
    saveBtn.className = 'secondary';
    saveBtn.textContent = 'Save';
    saveBtn.disabled = true;

    dest.addEventListener('input', () => {
      saveBtn.disabled = dest.value.trim() === link.url;
    });

    saveBtn.addEventListener('click', async () => {
      try {
        const next = API.normalizeUrl(dest.value);
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        const res = await API.update({ code: link.code, url: next });
        Object.assign(link, res.link);
        say(rowStatus, '✓ Destination updated — live now.', 'ok');
        render();
      } catch (err) {
        saveBtn.textContent = 'Save';
        saveBtn.disabled = false;
        handle(err, rowStatus);
      }
    });

    destWrap.append(dest, saveBtn);

    const openBtn = document.createElement('a');
    openBtn.className = 'btn-link';
    openBtn.href = link.short;
    openBtn.target = '_blank';
    openBtn.rel = 'noopener noreferrer';
    openBtn.textContent = 'Open';

    const qrBtn = document.createElement('a');
    qrBtn.className = 'btn-link';
    qrBtn.href = 'qr.html?url=' + encodeURIComponent(link.short);
    qrBtn.textContent = 'QR';

    const delBtn = document.createElement('button');
    delBtn.className = 'ghost';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      if (
        !confirm(
          `Delete ${bare(link.short)}?\n\nEverywhere this link has been shared ` +
            `or printed will stop working. This cannot be undone.`
        )
      )
        return;
      try {
        await API.remove(link.code);
        links = links.filter((l) => l.code !== link.code);
        render();
      } catch (err) {
        handle(err, rowStatus);
      }
    });

    const actions = document.createElement('div');
    actions.className = 'link-actions';
    actions.append(openBtn, qrBtn, delBtn);

    row.append(head, destWrap, actions, rowStatus);
    list.appendChild(row);
  });
}
