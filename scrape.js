/* ============================================================
   OMQ Scraper — the loop.

   scrape.php fetches one thing per call and returns. This decides
   what to ask for next, holds everything collected so far, and hands
   it over as a file. Keeping the loop here rather than on the server
   is what lets a crawl of any size run without a single long request,
   and what lets Stop actually stop — between two calls there is
   nothing running to interrupt.

   The cost is that the result lives in this tab. Download is offered
   as soon as there is anything to download, not at the end, because
   the tab closing is the one failure that loses work.
   ============================================================ */

const API = window.OMQ_API;

/* Server-side cap in scrape.php. Matched here so a batch is never
   silently truncated. */
const BATCH = 5;

/* Enough to see what is happening without giving the browser tens of
   thousands of nodes to lay out. */
const LOG_LIMIT = 300;

let run = null;
let stopping = false;

/* ---------- session ---------- */
['probeBtn', 'startBtn', 'saveBtn', 'downloadBtn', 'downloadTextBtn'].forEach((id) => {
  $(id).dataset.label = $(id).textContent;
});

API.requireSession({
  account: $('authAccount'),
  onIn: () => $('siteInput').focus(),
});

function handle(err, statusEl) {
  if (err && err.status === 401) {
    location.replace(API.loginUrl());
    return;
  }
  say(statusEl, '⚠ ' + err.message, 'warn');
}

/* ---------- log and progress ---------- */
function note(message, kind) {
  const line = document.createElement('p');
  line.className = 'log-line' + (kind ? ' log-' + kind : '');
  line.textContent = message;
  const box = $('log');
  box.appendChild(line);
  while (box.childElementCount > LOG_LIMIT) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}

/* `done` of `total`, or an indeterminate note when the total is not
   knowable yet — which it is not until a collection reports how many
   pages it has. */
function progress(text, done, total) {
  $('progressNote').textContent = text;
  const known = total > 0;
  $('progressFill').style.width = known ? Math.round((done / total) * 100) + '%' : '0%';
  $('progress').classList.toggle('is-waiting', !known);
}

function tally() {
  const rows = [];
  const apiTotal = Object.values(run.result.api).reduce((sum, items) => sum + items.length, 0);
  if (apiTotal) rows.push(['API records', apiTotal]);
  if (run.result.urls.length) rows.push(['Addresses', run.result.urls.length]);
  if (run.result.pages.length) rows.push(['Pages read', run.result.pages.length]);
  if (run.skipped) rows.push(['Skipped', run.skipped]);

  $('tally').innerHTML = '';
  rows.forEach(([label, value]) => {
    const cell = document.createElement('div');
    cell.className = 'tally-cell';
    const n = document.createElement('b');
    n.textContent = value.toLocaleString();
    const l = document.createElement('span');
    l.textContent = label;
    cell.append(n, l);
    $('tally').appendChild(cell);
  });

  if (apiTotal || run.result.urls.length || run.result.pages.length) {
    $('resultPanel').classList.remove('hidden');
    summarise();
  }
}

/* ---------- step 1: what is there ---------- */
async function probe() {
  const statusEl = $('probeStatus');
  try {
    const site = API.normalizeUrl($('siteInput').value);
    busy($('probeBtn'), true, 'Checking…');
    say(statusEl, '');

    const delay = parseFloat($('delayInput').value);
    const cookie = $('cookieInput').value.trim();
    const obeyRobots = $('obeyRobots').checked;

    const report = await API.scrape.probe({ site, delay, cookie, obeyRobots });

    run = {
      site,
      origin: report.origin,
      delay,
      cookie,
      obeyRobots,
      rules: report.robots.rules || [],
      cap: Math.max(0, parseInt($('capInput').value, 10) || 0),
      endpoints: report.endpoints || [],
      sitemaps: report.sitemaps || [],
      skipped: 0,
      result: {
        site: report.origin,
        collectedBy: (API.getUser() || {}).email || '',
        api: {},
        urls: [],
        pages: [],
      },
    };

    /* A site that asks for a slower pace gets it. Asking and then
       ignoring the answer is worse than never asking. */
    const asked = report.robots.crawlDelay;
    if (asked && asked > run.delay) {
      run.delay = Math.min(asked, 30);
      note(`robots.txt asks for ${asked}s between requests — using that.`, 'warn');
    }

    /* A new target means the previous save no longer describes what is
       in hand, so the button goes back to offering to save. */
    saved = null;
    $('saveBtn').textContent = $('saveBtn').dataset.label;

    renderPlan(report);
    $('runPanel').classList.remove('hidden');
    say(statusEl, '✓ Checked.', 'ok');
  } catch (err) {
    handle(err, statusEl);
  } finally {
    busy($('probeBtn'), false);
  }
}

function renderPlan(report) {
  const body = $('planBody');
  body.innerHTML = '';

  const add = (label, value, kind) => {
    const row = document.createElement('p');
    row.className = 'plan-row' + (kind ? ' plan-' + kind : '');
    const b = document.createElement('b');
    b.textContent = label;
    const s = document.createElement('span');
    s.textContent = value;
    row.append(b, s);
    body.appendChild(row);
  };

  add(
    'robots.txt',
    report.robots.found
      ? `${report.robots.rules.length} rules${report.robots.crawlDelay ? `, ${report.robots.crawlDelay}s delay` : ''}`
      : 'none — nothing excluded',
    report.robots.found ? null : 'muted'
  );
  add(
    'REST API',
    report.endpoints.length ? `${report.endpoints.length} collections` : 'not available',
    report.endpoints.length ? 'ok' : 'muted'
  );
  add(
    'Sitemap',
    report.sitemaps.length ? report.sitemaps[0].replace(report.origin, '') : 'not found',
    report.sitemaps.length ? 'ok' : 'muted'
  );

  (report.notes || []).forEach((text) => add('Note', text, 'muted'));
  $('planCard').classList.remove('hidden');
}

/* The warning is only a warning once the box is unticked. Shown
   permanently it reads as boilerplate and stops being read at all. */
function syncRobotsWarning() {
  $('robotsWarning').classList.toggle('hidden', $('obeyRobots').checked);
}
$('obeyRobots').addEventListener('change', syncRobotsWarning);
syncRobotsWarning();

/* ---------- step 2: collect ----------
   Every phase checks `stopping` between calls, so Stop takes effect
   within one request rather than at the end of the phase. */
const common = () => ({
  site: run.site,
  delay: run.delay,
  cookie: run.cookie,
  obeyRobots: run.obeyRobots,
  rules: run.rules,
});

async function collectApi() {
  note('— REST API —');
  for (const endpoint of run.endpoints) {
    if (stopping) return;

    const items = [];
    let page = 1;
    let pages = 1;

    while (page <= pages && !stopping) {
      progress(`REST API · ${endpoint} · page ${page} of ${pages}`, page - 1, pages);
      const res = await API.scrape.api({ ...common(), endpoint, page });

      if (res.blocked) {
        note(`${endpoint}: excluded by robots.txt`, 'warn');
        break;
      }
      if (res.status !== 200) {
        /* 401 and 403 here are the site's answer, not ours — a private
           collection is normal and not worth stopping for. */
        note(
          `${endpoint}: ${res.status === 401 || res.status === 403 ? 'needs an account' : 'HTTP ' + res.status}`,
          res.status === 404 ? 'muted' : 'warn'
        );
        break;
      }
      if (!res.items.length) break;

      items.push(...res.items);
      /* X-WP-TotalPages is the reliable answer. Without it — some
         caching layers drop the header — a full page is taken as
         reason to ask for one more, and the empty-page check above
         is what ends it. */
      pages = res.totalPages || (res.items.length >= 100 ? page + 1 : page);
      page += 1;
      tally();

      /* A server that keeps answering "full page" forever would
         otherwise loop until the tab dies. */
      if (page > 500) {
        note(`${endpoint}: stopped at 50,000 records.`, 'warn');
        break;
      }
    }

    if (items.length) {
      run.result.api[endpoint] = items;
      note(`${endpoint}: ${items.length.toLocaleString()} records`, 'ok');
      tally();
    }
  }
}

async function collectSitemap() {
  note('— Sitemaps —');
  if (!run.sitemaps.length) {
    note('No sitemap to read.', 'muted');
    return;
  }

  const queue = [...run.sitemaps];
  const seen = new Set(queue);
  const found = new Map();

  while (queue.length && !stopping) {
    const url = queue.shift();
    progress(`Sitemap · ${found.size.toLocaleString()} addresses · ${queue.length} left to read`, 0, 0);

    const res = await API.scrape.sitemap({ ...common(), url });
    if (res.blocked || res.status !== 200) {
      note(`${url.replace(run.origin, '')}: ${res.blocked ? 'excluded by robots.txt' : 'HTTP ' + res.status}`, 'warn');
      continue;
    }

    (res.children || []).forEach((child) => {
      if (!seen.has(child)) {
        seen.add(child);
        queue.push(child);
      }
    });
    /* Keyed by URL: sitemaps overlap, and the same address listed in
       two of them is one page, not two. */
    (res.urls || []).forEach((entry) => found.set(entry.url, entry));

    if (res.children && res.children.length) {
      note(`${url.replace(run.origin, '')}: ${res.children.length} child sitemaps`);
    }
    if (res.urls && res.urls.length) {
      note(`${url.replace(run.origin, '')}: ${res.urls.length} addresses`, 'ok');
    }
    tally();
  }

  run.result.urls = [...found.values()];
  tally();
}

async function collectPages() {
  note('— Page text —');

  let queue = run.result.urls.map((entry) => entry.url);
  if (!queue.length) {
    note('No addresses to read — run the sitemap step first.', 'warn');
    return;
  }

  if (run.cap && queue.length > run.cap) {
    note(`${queue.length.toLocaleString()} addresses found; stopping after ${run.cap.toLocaleString()}.`, 'warn');
    queue = queue.slice(0, run.cap);
  }

  const total = queue.length;
  let done = 0;

  while (queue.length && !stopping) {
    const batch = queue.splice(0, BATCH);
    progress(`Page text · ${done.toLocaleString()} of ${total.toLocaleString()}`, done, total);

    const res = await API.scrape.pages({ ...common(), urls: batch });

    (res.pages || []).forEach((page) => {
      done += 1;
      if (page.status === 200 && !page.skipped) {
        run.result.pages.push(page);
      } else {
        run.skipped += 1;
        const why = page.blocked
          ? 'excluded by robots.txt'
          : page.skipped
            ? page.skipped
            : page.error || 'HTTP ' + page.status;
        note(`${page.url.replace(run.origin, '')}: ${why}`, 'muted');
      }
    });

    tally();
  }

  progress(`Page text · ${done.toLocaleString()} of ${total.toLocaleString()}`, done, total);
}

async function start() {
  stopping = false;
  $('stopBtn').classList.remove('hidden');
  busy($('startBtn'), true, 'Running…');
  $('log').innerHTML = '';
  run.result.startedAt = new Date().toISOString();

  try {
    if ($('wantApi').checked) await collectApi();
    if ($('wantSitemap').checked && !stopping) await collectSitemap();
    if ($('wantPages').checked && !stopping) await collectPages();

    run.result.finishedAt = new Date().toISOString();
    run.result.complete = !stopping;
    progress(stopping ? 'Stopped.' : 'Done.', 1, 1);
    note(stopping ? 'Stopped — what was collected is still yours to download.' : 'Finished.', 'ok');
  } catch (err) {
    progress('Stopped by an error.', 0, 0);
    note('⚠ ' + err.message, 'warn');
    handle(err, $('resultStatus'));
  } finally {
    stopping = false;
    $('stopBtn').classList.add('hidden');
    busy($('startBtn'), false);
    tally();
  }
}

$('probeBtn').addEventListener('click', probe);
$('siteInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') probe();
});
$('startBtn').addEventListener('click', start);
$('stopBtn').addEventListener('click', () => {
  stopping = true;
  note('Stopping after this request…', 'warn');
  $('stopBtn').classList.add('hidden');
});

/* Half an hour of crawling is worth a confirmation dialog. */
window.addEventListener('beforeunload', (e) => {
  if (!run || (!run.result.pages.length && !run.result.urls.length)) return;
  e.preventDefault();
  e.returnValue = '';
});

/* ---------- step 3: take it away ---------- */
function summarise() {
  const apiTotal = Object.values(run.result.api).reduce((sum, items) => sum + items.length, 0);
  const parts = [];
  if (apiTotal) parts.push(`${apiTotal.toLocaleString()} API records`);
  if (run.result.urls.length) parts.push(`${run.result.urls.length.toLocaleString()} addresses`);
  if (run.result.pages.length) parts.push(`${run.result.pages.length.toLocaleString()} pages of text`);
  $('resultSummary').textContent = parts.length ? parts.join(' · ') : 'Nothing collected yet.';
}

const stamp = () => new Date().toISOString().slice(0, 10);
const host = () => safeName((run.origin || '').replace(/^https?:\/\//, ''), 'site');

/* Saved once and then linked to, rather than passed around as a file
   nobody else has. `saved` is what stops a second click making a
   duplicate of a crawl that took all afternoon. */
let saved = null;

$('saveBtn').addEventListener('click', async () => {
  const statusEl = $('resultStatus');
  try {
    if (saved) {
      location.href = 'archive.html?id=' + saved.id;
      return;
    }
    busy($('saveBtn'), true, 'Saving…');

    const res = await API.archives.save({
      name: $('projectName').value.trim(),
      archive: run.result,
    });
    saved = res.archive;

    busy($('saveBtn'), false);
    $('saveBtn').textContent = 'Open in Archives →';
    say(statusEl, `✓ Saved as "${saved.name}".`, 'ok');
  } catch (err) {
    busy($('saveBtn'), false);
    handle(err, statusEl);
  }
});

$('downloadBtn').addEventListener('click', () => {
  const json = JSON.stringify(run.result, null, 2);
  saveBlob(new Blob([json], { type: 'application/json' }), `${host()}-${stamp()}.json`);
  say($('resultStatus'), `✓ ${(json.length / 1048576).toFixed(1)} MB saved.`, 'ok');
});

/* The same crawl as something a person can read, for when the point
   was the writing rather than the structure. */
$('downloadTextBtn').addEventListener('click', () => {
  if (!run.result.pages.length) {
    say($('resultStatus'), '⚠ No page text collected — tick "Page text" and run again.', 'warn');
    return;
  }
  const text = run.result.pages
    .map((page) => [page.title || '(untitled)', page.url, '', page.text || ''].join('\n'))
    .join('\n\n' + '─'.repeat(60) + '\n\n');
  saveBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${host()}-${stamp()}.txt`);
  say($('resultStatus'), `✓ ${run.result.pages.length.toLocaleString()} pages saved.`, 'ok');
});
