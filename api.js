/* ============================================================
   OMQ Short Links — browser client.

   Google Identity Services hands us an ID token; every API call
   carries it as a bearer token and the server decides what the
   caller may do. Nothing is stored but that token, and only for
   the hour Google says it is good for.
   ============================================================ */

(function (global) {
  const API_BASE = 'api.php';
  const TOKEN_KEY = 'omq-google-token';

  let onSignedIn = null;
  let onSignedOut = null;
  let gisReady = null;
  let configPromise = null;

  /* Settings come from the server, not a committed file, so the only
     thing a deployment configures is config.php — see api.php. */
  function loadConfig() {
    if (!configPromise) {
      configPromise = fetch(API_BASE + '?action=config')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Could not load site settings.'))))
        .then((c) => {
          API.GOOGLE_CLIENT_ID = c.googleClientId || '';
          API.ALLOWED_DOMAIN = c.allowedDomain || '';
          API.SHORT_BASE = c.shortBase || location.origin + '/';
          return c;
        })
        .catch((err) => {
          configPromise = null; // let a later attempt retry
          throw err;
        });
    }
    return configPromise;
  }

  /* ---------- token ---------- */
  function readStored() {
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      /* Expire a minute early rather than let a request fail on the wire. */
      if (!saved.token || !saved.exp || saved.exp * 1000 < Date.now() + 60000) {
        localStorage.removeItem(TOKEN_KEY);
        return null;
      }
      return saved;
    } catch {
      return null;
    }
  }

  function store(token) {
    /* The payload is only read to know when to stop using the token —
       every claim that matters is verified server-side. */
    let claims = {};
    try {
      let part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      part += '='.repeat((4 - (part.length % 4)) % 4); // base64url has no padding
      const bin = atob(part);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      claims = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      claims = {};
    }
    const saved = {
      token,
      exp: claims.exp || Math.floor(Date.now() / 1000) + 3000,
      email: claims.email || '',
      name: claims.name || '',
      picture: claims.picture || '',
    };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(saved));
    return saved;
  }

  const getUser = () => readStored();
  const isSignedIn = () => !!readStored();

  function signOut() {
    const saved = readStored();
    localStorage.removeItem(TOKEN_KEY);
    try {
      if (global.google && saved && saved.email) {
        google.accounts.id.revoke(saved.email, () => {});
      }
      if (global.google) google.accounts.id.disableAutoSelect();
    } catch {}
    if (onSignedOut) onSignedOut();
  }

  /* ---------- Google Identity Services ---------- */
  function loadGis() {
    if (gisReady) return gisReady;
    gisReady = new Promise((resolve, reject) => {
      if (global.google && global.google.accounts) return resolve();
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Could not reach Google to sign in.'));
      document.head.appendChild(script);
    });
    return gisReady;
  }

  function handleCredential(response) {
    if (!response || !response.credential) return;
    const saved = store(response.credential);
    if (onSignedIn) onSignedIn(saved);
  }

  /* Renders Google's own button — the branding and the consent flow
     have to come from them, not from a lookalike of ours. */
  async function mountButton(element, { onSignIn, onSignOut } = {}) {
    onSignedIn = onSignIn || onSignedIn;
    onSignedOut = onSignOut || onSignedOut;

    await loadConfig();

    if (!API.GOOGLE_CLIENT_ID || API.GOOGLE_CLIENT_ID.startsWith('REPLACE_ME')) {
      throw new Error('Google sign-in is not configured yet (see config.php on the server).');
    }

    await loadGis();

    google.accounts.id.initialize({
      client_id: API.GOOGLE_CLIENT_ID,
      callback: handleCredential,
      /* A hint to the account chooser. The server is what actually
         enforces the domain. */
      hd: API.ALLOWED_DOMAIN,
      auto_select: false,
      cancel_on_tap_outside: true,
      ux_mode: 'popup',
    });

    google.accounts.id.renderButton(element, {
      theme: 'filled_blue',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      logo_alignment: 'left',
    });
  }

  /* ---------- API ---------- */
  async function call(action, body, method) {
    const saved = readStored();
    if (!saved) {
      const err = new Error('Sign in to continue.');
      err.status = 401;
      throw err;
    }

    let res;
    try {
      res = await fetch(`${API_BASE}?action=${encodeURIComponent(action)}`, {
        /* Same-origin: no credentials mode to set, no preflight. */
        method: method || (body ? 'POST' : 'GET'),
        headers: {
          Authorization: 'Bearer ' + saved.token,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('Could not reach the short link server.');
    }

    let data = {};
    try {
      data = await res.json();
    } catch {
      if (!res.ok) throw new Error(`Server error ${res.status}.`);
    }

    if (!res.ok) {
      /* The token lapsed or was rejected — make the UI ask again
         rather than let every later call fail the same way. */
      if (res.status === 401) localStorage.removeItem(TOKEN_KEY);
      const err = new Error(data.error || `Server error ${res.status}.`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* ---------- client-side validation ----------
     Repeated on the server, which is what counts. This only spares
     a round trip on an obvious typo. */
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

  function validateCode(code) {
    const c = String(code || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(c)) {
      throw new Error('Use 2–32 characters: letters, numbers or hyphens.');
    }
    return c;
  }

  const API = {
    /* Filled in by loadConfig(). The placeholders only ever appear as
       a label before the first response lands — every link that gets
       copied or printed is built server-side from `short_base`, so a
       stale value here can never produce a wrong link. */
    GOOGLE_CLIENT_ID: '',
    ALLOWED_DOMAIN: '',
    SHORT_BASE: location.origin + '/',

    loadConfig,
    mountButton,
    getUser,
    isSignedIn,
    signOut,

    async list() {
      const data = await call('list');
      if (data.base) API.SHORT_BASE = data.base;
      return data;
    },
    create: (link) => call('create', link),
    update: (link) => call('update', link),
    remove: (code) => call('delete', { code }),

    normalizeUrl,
    validateCode,
  };

  global.OMQ_API = API;
})(window);
