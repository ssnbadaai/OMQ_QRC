/* ============================================================
   Shared GitHub helpers — reads and writes links.json in the repo.
   The token lives only in this browser's localStorage.
   ============================================================ */

(function (global) {
  const TOKEN_KEY = 'omq-gh-token';
  const REPO_KEY = 'omq-gh-repo';
  const DEFAULT_REPO = 'ssnbadaai/OMQ_QRC';
  const LINKS_PATH = 'links.json';

  /* The QR codes must resolve from anywhere, so short links always use
     the canonical domain rather than whatever host is serving this page. */
  const SHORT_BASE = 'https://qr.omqpro.com/';

  /* Codes that would collide with real files in the repo. */
  const RESERVED = new Set([
    'index', 'links', '404', 'app', 'gh', 'styles', 'lib', 'img',
    'cname', 'readme', 'robots', 'favicon', 'sitemap', 'admin', 'api',
  ]);

  const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no l/i/o/0/1 lookalikes

  const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
  const setToken = (t) => localStorage.setItem(TOKEN_KEY, t.trim());
  const clearToken = () => localStorage.removeItem(TOKEN_KEY);
  const getRepo = () => localStorage.getItem(REPO_KEY) || DEFAULT_REPO;
  const setRepo = (r) => localStorage.setItem(REPO_KEY, r.trim());

  /* ---------- base64 <-> UTF-8 ---------- */
  function encodeB64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function decodeB64(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ---------- validation ---------- */
  function normalizeUrl(raw) {
    let url = String(raw || '').trim();
    if (!url) throw new Error('Enter a destination URL.');
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('That does not look like a valid URL.');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only http and https links are allowed.');
    }
    if (!parsed.hostname.includes('.')) {
      throw new Error('That does not look like a valid URL.');
    }
    return parsed.href;
  }

  function validateCode(code, links, { allowExisting } = {}) {
    const c = String(code || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(c)) {
      throw new Error('Use 2–32 characters: letters, numbers or hyphens.');
    }
    if (RESERVED.has(c)) throw new Error(`"${c}" is reserved — pick another.`);
    if (!allowExisting && links[c]) throw new Error(`"${c}" is already taken.`);
    return c;
  }

  function makeCode(links, length = 5) {
    for (let attempt = 0; attempt < 40; attempt++) {
      let code = '';
      const rnd = crypto.getRandomValues(new Uint32Array(length));
      for (let i = 0; i < length; i++) code += ALPHABET[rnd[i] % ALPHABET.length];
      if (!links[code] && !RESERVED.has(code)) return code;
    }
    return makeCode(links, length + 1);
  }

  /* ---------- GitHub API ---------- */
  async function api(path, options = {}) {
    const token = getToken();
    if (!token) throw new Error('No access token saved. Open the Link manager to sign in.');

    const res = await fetch(`https://api.github.com/repos/${getRepo()}/${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });

    if (res.status === 401) throw new Error('Token rejected — it may be wrong or expired.');
    if (res.status === 403) throw new Error('Token lacks permission to write to this repository.');
    if (res.status === 404) throw new Error(`Repository or file not found (${getRepo()}).`);
    if (res.status === 409) throw new Error('The file changed elsewhere — reload and try again.');
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.json()).message || '';
      } catch {}
      throw new Error(`GitHub error ${res.status}${detail ? ': ' + detail : ''}`);
    }
    return res.json();
  }

  /* Reads through the API (not the published site) so edits made a
     moment ago are always visible. */
  async function loadLinks() {
    const file = await api(`contents/${LINKS_PATH}?ref=main&t=${Date.now()}`, {
      cache: 'no-store',
    });
    let data = { version: 1, links: {} };
    try {
      data = JSON.parse(decodeB64(file.content));
    } catch {}
    return { links: data.links || {}, sha: file.sha };
  }

  async function saveLinks(links, sha, message) {
    const body = JSON.stringify({ version: 1, links }, null, 2) + '\n';
    const res = await api(`contents/${LINKS_PATH}`, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: encodeB64(body),
        sha,
        branch: 'main',
      }),
    });
    return res.content.sha;
  }

  async function verifyToken() {
    const repo = await api('');
    return {
      repo: repo.full_name,
      canWrite: !!(repo.permissions && repo.permissions.push),
    };
  }

  global.OMQ_GH = {
    SHORT_BASE,
    getToken,
    setToken,
    clearToken,
    getRepo,
    setRepo,
    loadLinks,
    saveLinks,
    verifyToken,
    normalizeUrl,
    validateCode,
    makeCode,
    shortUrl: (code) => SHORT_BASE + code,
  };
})(window);
