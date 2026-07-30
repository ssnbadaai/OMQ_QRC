# OMQ Tools

Two tools for OMQ, served from **qr.omqpro.com** on cPanel:

- **QR Studio** ([`qr.html`](qr.html)) — the QR code generator. Runs entirely
  in the browser; no accounts, no server involved.
- **Short Links** ([`short.html`](short.html)) — the link shortener. A service
  in its own right: shorten anything, for any purpose. Sign in with a Google
  Workspace account; links live in MySQL.
- **Dev Tools** ([`dev.html`](dev.html)) — a second hub, so smaller tools can
  be added without the front page growing a card each time.

[`index.html`](index.html) is the hub pointing at all three.

## Dev Tools

Four ideas, built as two tools, because each pair shares a base.

**Brand Kit** ([`brand.html`](brand.html)) — logos, icons, colours, fonts and
templates. A brand asset library and an icon library differ only in what they
hold, so they share one store, one browser and one download path, and differ by
a tab. Unlike short links these are **shared, not per-account**: a brand library
exists so everyone works from the same approved files.

Uploads are restricted by an extension whitelist per category, stored under a
randomised name, and capped at 20 MB. `assets/.htaccess` refuses to serve or
execute anything script-like, and serves SVG under a CSP that denies it script
and network — an SVG is a document format, and one uploaded to our own origin
would otherwise be same-origin XSS.

**Image Tools** ([`image.html`](image.html)) — colour palette extraction and
font comparison. Both begin by getting pixels out of an image or a video frame,
so they share the loader, the canvas, and whichever frame you have scrubbed to.

Palettes come from a median-cut quantiser, which keeps distinct-but-uncommon
colours that a plain frequency count buries under a large flat background. It
works signed out; signing in adds *Save to Brand Kit*, which writes the palette
straight into the colours tab.

The font side **compares** rather than identifies: it loads the Brand Kit fonts
and renders your sample text beside the image, answering "is this one of ours,
and which". Identifying an arbitrary font needs a model trained on a large font
corpus — see [Known limits](#known-limits).

The two are deliberately independent. QR Studio can *offer* to make a short
link, so a printed code can be re-pointed later, but it does not need one and
the shortener knows nothing about QR codes.

**This repository is the document root.** It is cloned straight into the
subdomain's folder with cPanel's Git Version Control, so deploying an update is
one *Pull*. Pages, assets, API and redirects are all one domain, which is why
there is no CORS anywhere and why short links read `qr.omqpro.com/abc12`.

Exactly one file is configured on the server — `config.php` — and it is
gitignored, so a pull can never overwrite it or be blocked by it. Everything
the browser needs it asks the server for. Setup is in
**[DEPLOY.md](DEPLOY.md)**.

## QR generator

URL, plain text, Wi-Fi, email, phone, SMS and vCard. Dot and corner shapes,
solid or gradient colours, transparent background, an embedded logo (the OMQ
mark or your own), adjustable margin and error correction.

Logos are trimmed to their real alpha bounds before being embedded. The QR
clears a block of dots sized from the image's aspect ratio against a fixed area
budget, so transparent padding is charged for at full price — trimming spends
that budget on the artwork instead of on empty space.

Export is PNG, JPEG or SVG up to 4096 px on desktop. On phones the download row
is replaced by a single **Save QR** button that opens the native share sheet,
because file downloads are unreliable in mobile browsers.

## Short links

`.htaccess` sends any path that is not a real file to
[`redirect.php`](redirect.php), which looks the code up and redirects.

Redirects are **302, never 301**. A 301 is cached by browsers indefinitely, so
re-pointing a link would never reach anyone who had already followed it — which
is the entire reason these links exist.

Anyone with an `@omqpro.com` Google account can create links. No tokens to
issue, no passwords to keep: access is granted and revoked by adding or
removing the Google account. The domain test uses the `hd` claim, which only
Workspace accounts carry, so a personal account with a similar address cannot
get in.

**Links are private to the person who made them.** Each account lists, edits
and deletes only its own. Ownership is enforced in the `WHERE` clause of every
query, not by what the UI chose to show — codes are short and public, so anyone
could name one they do not own. A link that is not yours reads as not existing,
so the API cannot double as a way to probe which codes are taken.

The redirect itself is deliberately not scoped: a short link has to resolve for
whoever scans it. Codes also share one namespace, so a custom code already
taken by someone else is refused.

Scans are counted per link and shown in the list.

## Layout

| File | Purpose |
| --- | --- |
| `index.html` | Hub |
| `qr.html`, `app.js` | QR generator |
| `short.html`, `short.js` | Short link service (UI) |
| `dev.html` | Dev tools hub |
| `brand.html`, `brand.js` | Brand Kit (UI) |
| `image.html`, `image.js` | Image Tools — palette and fonts |
| `assets.php` | Brand Kit API — list / upload / colour / delete |
| `assets/` | Uploaded brand files. Contents gitignored; the folder and its `.htaccess` are tracked |
| `api.js` | Google sign-in + API client |
| `api.php` | `config` (public) / me / list / create / update / delete |
| `redirect.php` | The redirect itself |
| `auth.php` | Google ID token verification |
| `lib.php` | Config, database, validation |
| `config.php` | Database password and client ID — **gitignored**, created on the server |
| `schema.sql` | The `links` table |
| `.htaccess` | Routing, and denying everything not meant to be served |
| `styles.css` | Styles for every page |
| `lib/` | [qr-code-styling](https://github.com/kozakdenys/qr-code-styling), vendored so the QR generator works offline |
| `links.html` | Redirect to `short.html`, for old bookmarks |

## Known limits

**Font identification is not implemented, and cannot be here.** Recognising an
arbitrary typeface from a photograph is an image-classification problem over
thousands of typefaces; WhatTheFont does it with a trained model behind an API.
Nothing in a browser or in PHP substitutes for that.

What is built instead is comparison against the Brand Kit fonts, plus a button
that exports the current frame as a PNG ready to hand to WhatTheFont or Font
Squirrel Matcherator. If real identification is wanted, it needs a paid API
key wired into `image.js`; the upload and frame-grab plumbing is already there.

## History

This started as a static GitHub Pages site that kept its links in a committed
`links.json` and resolved them from `404.html`, with writes authorised by a
personal GitHub token. Moving to cPanel replaced all of that: MySQL is the
store, PHP does the redirect, and Google sign-in replaced the token. The old
files are in the history if the reasoning is ever needed.
