/* ============================================================
   OMQ Archives — reading a crawl back.

   The scraper produces a JSON document; this turns it into something
   you can actually read. A WordPress REST record already carries the
   whole article in `content.rendered`, so most archives never needed
   the slow page-by-page phase to have their content.

   The archived markup belongs to another site and is not trusted. It
   is rendered in an iframe with no `allow-scripts` and no
   `allow-same-origin`, so nothing in it can run, reach this page, or
   read the token in localStorage. Sanitising by stripping tags is the
   alternative, and it is the one that fails quietly the first time
   somebody finds a tag the stripper forgot.
   ============================================================ */

const API = window.OMQ_API;

/* Long enough to find anything, short enough that the browser is not
   laying out ten thousand rows nobody scrolled to. */
const LIST_LIMIT = 400;

/* Per item, for the search index only — never for display. */
const HAYSTACK_CAP = 6000;

let archives = [];
let current = null;   // { name, site, items, sections }
let items = [];
let shown = [];
let chosen = null;

/* ---------- helpers ---------- */

/* WordPress hands back entity-encoded titles — "&#8211;", "&amp;".
   DOMParser decodes them without running anything, which the usual
   innerHTML round-trip cannot promise. */
const decode = (value) =>
  new DOMParser().parseFromString(String(value ?? ''), 'text/html').documentElement.textContent || '';

/* `{rendered: "…"}` is how the REST API wraps most text fields. */
const rendered = (field) =>
  field && typeof field === 'object' && 'rendered' in field ? String(field.rendered ?? '') : '';

/* Good enough to search over, and never rendered — so a regex is the
   right tool rather than a parser run over every record up front. */
const flatten = (html) => String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const isArabic = (text) => /[؀-ۿ]/.test(String(text).slice(0, 400));

const size = (bytes) =>
  bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.round(bytes / 1024) + ' KB';

function when(value) {
  if (!value) return '';
  const date = new Date(String(value).replace(' ', 'T').replace(/Z?$/, 'Z'));
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

function handle(err, statusEl) {
  if (err && err.status === 401) {
    location.replace(API.loginUrl());
    return;
  }
  say(statusEl, '⚠ ' + err.message, 'warn');
}

/* ---------- session ---------- */
API.requireSession({
  account: $('authAccount'),
  onIn: async () => {
    try {
      await refresh();
      /* archive.html?id=3 opens straight into the reader, so an
         archive can be linked to like any other page. */
      const wanted = parseInt(new URLSearchParams(location.search).get('id') || '', 10);
      if (wanted) await open(wanted);
    } catch (err) {
      handle(err, $('libraryStatus'));
    }
  },
});

/* ---------- the library ---------- */
async function refresh() {
  const data = await API.archives.list();
  archives = data.archives || [];
  renderLibrary();
}

$('reloadBtn').addEventListener('click', async () => {
  try {
    await refresh();
  } catch (err) {
    handle(err, $('libraryStatus'));
  }
});

function renderLibrary() {
  const list = $('archiveList');
  $('archiveCount').textContent = archives.length;
  list.innerHTML = '';

  if (!archives.length) {
    list.innerHTML =
      '<p class="muted-copy">Nothing saved yet. Run a crawl in the ' +
      '<a href="scrape.html">Scraper</a> and choose <b>Save as project</b>.</p>';
    return;
  }

  archives.forEach((archive) => {
    const row = document.createElement('div');
    row.className = 'link-row';

    const rowStatus = document.createElement('p');
    rowStatus.className = 'status';

    const head = document.createElement('div');
    head.className = 'link-head';

    const name = document.createElement('button');
    name.className = 'link-code plain';
    name.textContent = archive.name;
    name.title = 'Open';
    name.addEventListener('click', () => open(archive.id).catch((e) => handle(e, rowStatus)));

    const meta = document.createElement('span');
    meta.className = 'link-meta';
    meta.textContent = [when(archive.created), size(archive.bytes), archive.by]
      .filter(Boolean)
      .join(' · ');

    head.append(name, meta);

    const summary = document.createElement('p');
    summary.className = 'muted-copy';
    summary.textContent =
      (archive.summary || 'empty') + (archive.complete ? '' : ' · stopped before it finished');

    const openBtn = document.createElement('button');
    openBtn.className = 'secondary';
    openBtn.textContent = 'Open';
    openBtn.addEventListener('click', () => open(archive.id).catch((e) => handle(e, rowStatus)));

    const renameBtn = document.createElement('button');
    renameBtn.className = 'ghost';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', async () => {
      const next = prompt('Name this archive', archive.name);
      if (next === null) return;
      try {
        const res = await API.archives.rename({ id: archive.id, name: next.trim() });
        Object.assign(archive, res.archive);
        renderLibrary();
      } catch (err) {
        handle(err, rowStatus);
      }
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'ghost';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Delete "${archive.name}"?\n\nThe crawl would have to be run again. This cannot be undone.`)) {
        return;
      }
      try {
        await API.archives.remove(archive.id);
        archives = archives.filter((a) => a.id !== archive.id);
        renderLibrary();
      } catch (err) {
        handle(err, rowStatus);
      }
    });

    const actions = document.createElement('div');
    actions.className = 'link-actions';
    actions.append(openBtn, renameBtn, delBtn);

    row.append(head, summary, actions, rowStatus);
    list.appendChild(row);
  });
}

/* ---------- opening ---------- */
async function open(id) {
  say($('libraryStatus'), 'Loading…');
  const archive = await API.archives.get(id);
  const row = archives.find((a) => a.id === id);
  say($('libraryStatus'), '');
  load(archive, row ? row.name : archive.site || 'Archive');
}

wireDropZone($('dropZone'), (file) => file && readFile(file));
$('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) readFile(file);
});

function readFile(file) {
  $('fileText').textContent = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      load(JSON.parse(String(reader.result)), file.name.replace(/\.json$/i, ''));
    } catch {
      say($('libraryStatus'), '⚠ That file is not a readable archive.', 'warn');
    }
  };
  reader.onerror = () => say($('libraryStatus'), '⚠ That file could not be read.', 'warn');
  reader.readAsText(file);
}

/* ---------- turning an archive into readable items ----------
   Deliberately generic. Posts, pages, comments, media, categories and
   any custom post type the site had all keep their content in the same
   few field shapes, so one mapping serves collections this code has
   never heard of — which is the point, since the scraper discovers
   them at run time. */
function buildItems(archive) {
  const built = [];
  const sections = new Set();

  Object.entries(archive.api || {}).forEach(([section, records]) => {
    if (!Array.isArray(records) || !records.length) return;
    sections.add(section);

    records.forEach((record) => {
      const html = rendered(record.content) || rendered(record.description) || '';
      const title =
        decode(rendered(record.title) || record.name || record.slug || '') || `#${record.id ?? '?'}`;

      built.push({
        section,
        title,
        date: record.date || record.date_gmt || '',
        link: record.link || record.source_url || record.url || '',
        html,
        text: '',
        excerpt: decode(flatten(rendered(record.excerpt) || html)).slice(0, 220),
        hay: (title + ' ' + flatten(html)).slice(0, HAYSTACK_CAP).toLowerCase(),
      });
    });
  });

  /* Pages fetched as text rather than through the API. */
  (archive.pages || []).forEach((page) => {
    sections.add('page text');
    built.push({
      section: 'page text',
      title: page.title || page.url || '(untitled)',
      date: page.published || page.modified || '',
      link: page.url || '',
      html: '',
      text: page.text || '',
      excerpt: String(page.description || page.text || '').slice(0, 220),
      hay: ((page.title || '') + ' ' + (page.text || '')).slice(0, HAYSTACK_CAP).toLowerCase(),
    });
  });

  return { built, sections: [...sections] };
}

function load(archive, name) {
  const { built, sections } = buildItems(archive);

  if (!built.length) {
    say($('libraryStatus'), '⚠ That archive has nothing readable in it.', 'warn');
    return;
  }

  current = { name, site: archive.site || '' };
  items = built;
  chosen = null;

  $('readerTitle').textContent = name;
  $('readerMeta').textContent = [
    archive.site || '',
    `${built.length.toLocaleString()} items`,
    archive.complete === false ? 'stopped early' : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const filter = $('sectionFilter');
  filter.innerHTML = '<option value="">Everything</option>';
  sections.forEach((section) => {
    const option = document.createElement('option');
    option.value = section;
    option.textContent = section;
    filter.appendChild(option);
  });

  $('searchInput').value = '';
  $('libraryPanel').classList.add('hidden');
  $('readerPanel').classList.remove('hidden');
  renderItems();
  window.scrollTo(0, 0);
}

$('backBtn').addEventListener('click', () => {
  $('readerPanel').classList.add('hidden');
  $('libraryPanel').classList.remove('hidden');
});

/* ---------- the item list ---------- */
$('searchInput').addEventListener('input', renderItems);
$('sectionFilter').addEventListener('change', renderItems);

function renderItems() {
  const needle = $('searchInput').value.trim().toLowerCase();
  const section = $('sectionFilter').value;

  shown = items.filter(
    (item) => (!section || item.section === section) && (!needle || item.hay.includes(needle))
  );

  const list = $('itemList');
  list.innerHTML = '';

  $('itemCount').textContent = shown.length
    ? `${shown.length.toLocaleString()} of ${items.length.toLocaleString()}` +
      (shown.length > LIST_LIMIT ? ` · showing the first ${LIST_LIMIT}` : '')
    : 'Nothing matches that.';

  shown.slice(0, LIST_LIMIT).forEach((item) => {
    const row = document.createElement('button');
    row.className = 'item-row plain' + (item === chosen ? ' is-open' : '');
    if (isArabic(item.title)) row.dir = 'rtl';

    const title = document.createElement('b');
    title.textContent = item.title;

    const meta = document.createElement('span');
    meta.className = 'item-meta';
    meta.textContent = [item.section, when(item.date)].filter(Boolean).join(' · ');

    row.append(title, meta);
    row.addEventListener('click', () => show(item));
    list.appendChild(row);
  });
}

/* ---------- the article ----------
   The srcdoc is a whole document rather than a fragment so it can
   carry its own direction and styling. No allow-scripts and no
   allow-same-origin on the frame, so none of it can run or reach out;
   `base target="_blank"` is what keeps a link usable anyway. */
function frameDoc(html, rtl) {
  return `<!DOCTYPE html><html dir="${rtl ? 'rtl' : 'ltr'}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; padding: 4px 2px 24px;
    background: transparent; color: #eef0fa;
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    font-size: 15.5px; line-height: 1.85; overflow-wrap: break-word;
  }
  a { color: #5573f5; }
  img, video, iframe { max-width: 100%; height: auto; border-radius: 8px; }
  figure { margin: 16px 0; }
  figcaption { font-size: 13px; color: #9aa3c7; }
  h1, h2, h3, h4 { line-height: 1.4; margin: 22px 0 10px; }
  blockquote {
    margin: 16px 0; padding: 2px 16px;
    border-inline-start: 3px solid #2c3355; color: #c8cee8;
  }
  pre, code { background: #1f2440; border-radius: 6px; }
  pre { padding: 12px; overflow-x: auto; }
  code { padding: 1px 5px; }
  table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
  td, th { border: 1px solid #2c3355; padding: 6px 9px; }
  /* The archived page's own layout wrappers assume its stylesheet,
     which is not here — let them be plain blocks instead. */
  * { float: none !important; position: static !important; width: auto !important; }
</style></head><body>${html}</body></html>`;
}

function show(item) {
  chosen = item;
  renderItems();

  $('readerEmpty').classList.add('hidden');
  $('articleWrap').classList.remove('hidden');

  const rtl = isArabic(item.title + ' ' + (item.text || flatten(item.html)));

  const heading = $('articleTitle');
  heading.textContent = item.title;
  heading.dir = rtl ? 'rtl' : 'ltr';

  $('articleMeta').textContent = [item.section, when(item.date)].filter(Boolean).join(' · ');

  const original = $('articleOriginal');
  if (item.link) {
    original.href = item.link;
    original.classList.remove('hidden');
  } else {
    original.classList.add('hidden');
  }

  const frame = $('articleFrame');
  const plain = $('articleText');

  if (item.html) {
    frame.srcdoc = frameDoc(item.html, rtl);
    frame.classList.remove('hidden');
    plain.classList.add('hidden');
  } else {
    /* Text collected by the page phase has no markup to render, and
       putting it through the frame would only add a scrollbar. */
    frame.srcdoc = '';
    frame.classList.add('hidden');
    plain.textContent = item.text || '(nothing was collected for this one)';
    plain.dir = rtl ? 'rtl' : 'ltr';
    plain.classList.remove('hidden');
  }

  $('readerPage').scrollTop = 0;
}

$('copyTextBtn').addEventListener('click', () => {
  if (!chosen) return;
  const text = chosen.text || decode(flatten(chosen.html));
  copy(`${chosen.title}\n${chosen.link}\n\n${text}`);
});
