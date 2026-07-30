# Deploying to cPanel from GitHub

The repository **is** the document root. Clone it straight into the subdomain's
folder and the site is live; updating later is one *Pull* click.

Requires **PHP 7.4+** with PDO MySQL, `mod_rewrite`, and HTTPS — Google will
not sign anyone in over plain http.

There is exactly **one** file to configure, `config.php`, and it is gitignored,
so pulling can never overwrite it or refuse to run because of it.

---

## 1. Empty the document root

cPanel → **File Manager** → open the folder it made for `qr.omqpro.com`
(usually `/home/omqpro/qr.omqpro.com`). Note the exact path.

**Delete everything inside it.** cPanel drops a placeholder `index.html` and
sometimes a `cgi-bin` in a new domain's folder, and Git refuses to clone into a
folder that is not empty. Keep the folder itself.

## 2. If the repo is private, give cPanel a key

Skip this if `ssnbadaai/OMQ_QRC` is public — cloning over `https://` needs no
credentials.

1. cPanel → **SSH Access → Manage SSH Keys → Generate a New Key**. Leave the
   passphrase **empty**; cPanel cannot type one during a pull.
2. Back on that page, **Manage → Authorize** the key.
3. **View/Download** the *public* key and copy it.
4. GitHub → the repo → **Settings → Deploy keys → Add deploy key** → paste.
   Read-only access is enough; leave "Allow write access" unticked.

## 3. Clone it

cPanel → **Git™ Version Control** → **Create**.

| Field | Value |
| --- | --- |
| Clone a Repository | **on** |
| Clone URL | `https://github.com/ssnbadaai/OMQ_QRC.git` — or `git@github.com:ssnbadaai/OMQ_QRC.git` if you did step 2 |
| Repository Path | the document root from step 1, e.g. `/home/omqpro/qr.omqpro.com` |
| Repository Name | anything, e.g. `OMQ Tools` |

Click **Create**. cPanel clones and the files are live immediately — no build,
no deploy step.

> Point the *Repository Path* at the document root itself, not a folder inside
> it. This puts `.git/` in the web root, which `.htaccess` already denies over
> HTTP, along with `config.php`, `*.sql`, `*.md` and every dotfile.

## 4. The database

cPanel → **MySQL Databases**:

1. Create a database, e.g. `links` — cPanel names it `omqpro_links`.
2. Create a user, e.g. `links`, with a generated password. Keep it.
3. Add the user to the database with **All Privileges**.

The table is created on first use. To do it up front, import
[`schema.sql`](schema.sql) in phpMyAdmin.

## 5. SSL

Do this **before** touching Google. Google Identity Services refuses to run
over plain http, so without a certificate sign-in cannot work, and it fails
with errors that look like a configuration problem.

**Check DNS first.** AutoSSL proves control of the domain by fetching a token
from `http://qr.omqpro.com/.well-known/...`, so the name has to already resolve
to this server. If it still points at GitHub Pages, issuance fails every time —
no amount of retrying helps.

```
ping qr.omqpro.com
```

Compare that address to the one in cPanel's sidebar under *Shared IP Address*.
They must match before you continue.

**Issue it.** cPanel → **Security → SSL/TLS Status** → tick `qr.omqpro.com`
(and its `www.` and `mail.` entries if listed) → **Run AutoSSL**. It takes a
few minutes; the page reports success or the reason it failed.

**Force HTTPS afterwards.** cPanel → **Domains** → the toggle **Force HTTPS
Redirect** on `qr.omqpro.com`. Use the toggle rather than adding a redirect to
`.htaccess`: editing a tracked file on the server is exactly what would make
the next `git pull` conflict.

Only turn it on **after** the certificate is issued — forcing HTTPS with no
valid certificate makes the site unreachable rather than merely insecure.

**Verify:** open `https://qr.omqpro.com/` and check the padlock. The
certificate should name `qr.omqpro.com` and be issued by Sectigo or Let's
Encrypt — *not* "cPanel, Inc. Certification Authority", which is the
self-signed placeholder and means AutoSSL has not actually succeeded.

### If AutoSSL fails

| Message | Cause |
| --- | --- |
| "DCV failed", "does not resolve to this server" | DNS still points elsewhere. Fix DNS, wait for it to propagate, run again. |
| Token fetch returns the "Link not found" page | The `.well-known` passthrough in `.htaccess` is missing — it must be the **first** rewrite rule. |
| "rate limit" / "too many certificates" | You deleted and recreated the domain repeatedly. Both providers cap duplicate certificates per week; wait it out. |
| Nothing happens at all | AutoSSL may be disabled account-wide — only the host can enable it. |

## 6. Google sign-in

[Google Cloud Console](https://console.cloud.google.com/apis/credentials) →
**Credentials → Create credentials → OAuth client ID → Web application**.

Under **Authorised JavaScript origins** add, exactly — scheme included, no
trailing slash, no path:

```
https://qr.omqpro.com
```

Copy the client ID.

> **Check this before anything else:** the `@omqpro.com` restriction reads the
> `hd` claim, which Google sets **only for Google Workspace accounts**. If
> omqpro.com mail is not Workspace, no account will ever carry `hd` and nobody
> will get in. In that case list the people in `allowed_emails` instead — it
> replaces the domain rule rather than narrowing it.

## 7. Create `config.php`

File Manager → in the document root, **+ File** → `config.php`. Open
`config.example.php`, copy its contents in, and fill in:

- the database name, user and password from step 4,
- `google_client_id` from step 6,
- `short_base` — `https://qr.omqpro.com/`, with the trailing slash.

That is the whole configuration. The front end asks the server for what it
needs, so nothing in the repo has to be edited on the server — which is why
`git pull` stays clean forever.

## 8. Check it

| Open | Expect |
| --- | --- |
| `https://qr.omqpro.com/` | the hub, two cards |
| `/qr.html` and `/qr` | the QR generator |
| `/api.php?action=config` | your client ID and domain as JSON |
| `/api.php?action=list` | `{"error":"Sign in to continue."}` |
| `/config.php` | **403** — if you see PHP or a blank page, stop and fix `.htaccess` |
| `/nope` | the styled "Link not found" page |
| Continue with Google on `/short.html` | the shorten form appears |
| Shorten something, open the short link | lands on the destination |

## Updating later

Push to GitHub, then cPanel → **Git™ Version Control → Manage → Pull**.

`config.php` is gitignored, so it is never touched. Nothing else on the server
is hand-edited, so a pull can never conflict.

**Bump the `?v=N` cache buster in every HTML file whenever `styles.css` or a
script changes.** Browsers otherwise keep serving the old copy, which looks
exactly like the CSS being broken.

---

## When it goes wrong

**Clone fails, "directory not empty"** — step 1. The placeholder `index.html`
is still there.

**Everything says *Sign in to continue* even though sign-in worked** — Apache is
dropping the `Authorization` header. Confirm `.htaccess` actually cloned;
File Manager hides dotfiles until you turn that on in its settings.

**`/nope` gives Apache's own 404 instead of the styled page** — `mod_rewrite`
is off, or `AllowOverride` is not letting `.htaccess` run. Ask the host.

**Google says `origin_mismatch`** — the origin in the console does not match
exactly. `https://qr.omqpro.com` — not `http://`, not `www.`, no trailing
slash.

**Sign-in button never appears** — open `/api.php?action=config`. If it errors,
`config.php` is missing or malformed; PHP syntax errors show in cPanel's
**Errors** page.

**"Could not reach the database"** — the user was created but not *added to*
the database in step 4.3, or the name lacks the `omqpro_` prefix.

## How the auth works

The browser gets an ID token from Google and sends it as
`Authorization: Bearer <token>` on every API call. `auth.php` checks it with
Google's `tokeninfo` endpoint and requires a valid unexpired token, `aud` equal
to **our** client ID — otherwise a token minted for any other Google app would
be accepted — a verified email, and an allowed `hd` or listed address.

Verified tokens are cached in the system temp directory for their remaining
life, so it is one call to Google per person per hour, not per click.

There is no session cookie, so there is nothing to fixate and no CSRF surface.
Signing out drops the token; access ends when it expires, within the hour.
