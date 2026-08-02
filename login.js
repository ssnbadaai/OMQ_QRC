/* ============================================================
   The one sign-in screen.

   Tools do not render their own; they send you here with ?next= and
   api.js returns you there once the server has accepted the account.
   ============================================================ */

const API = window.OMQ_API;

const status = $('loginStatus');

/* A tool redirects here with ?why= when it had a token the server
   refused — an expired hour, or an account outside the domain. */
const why = new URLSearchParams(location.search).get('why');
if (why) {
  status.textContent = '⚠ ' + why;
  status.className = 'status status-warn';
}

API.loadConfig()
  .then(() => {
    $('domainName').textContent = API.ALLOWED_DOMAIN;
  })
  .catch(() => {});

API.mountLogin({
  slot: $('googleBtn'),
  status,
}).catch((err) => {
  status.textContent = '⚠ ' + err.message;
  status.className = 'status status-warn';
});
