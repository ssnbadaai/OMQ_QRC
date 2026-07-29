# OMQ QR Studio

QR code generator and short link service for OMQ, published at
**[qr.omqpro.com](https://qr.omqpro.com)** via GitHub Pages.

Everything runs in the browser. There is no backend, no database and no build
step — pushing to `main` publishes the site.

## QR generator

Supports URL, plain text, Wi-Fi, email, phone, SMS and vCard content. Codes can
be customised with dot and corner shapes, solid or gradient colours, a
transparent background, an embedded logo (the OMQ mark or your own), adjustable
margin and error correction.

Export is PNG, JPEG or SVG up to 4096 px on desktop. On phones the download row
is replaced by a single **Save QR** button that opens the native share sheet,
because file downloads are unreliable in mobile browsers.

## Short links

Short links live in [`links.json`](links.json), committed alongside the site.
When someone opens `qr.omqpro.com/<code>`, GitHub Pages serves
[`404.html`](404.html), which looks the code up and redirects. Destinations that
are not `http`/`https` are refused.

Because a link is just an entry in a file in this repository, it keeps working
for as long as the site is published — there is no service to expire or bill to
lapse. The trade-off is that a QR code containing a short link is no longer
self-contained: it depends on the site staying up, in exchange for a destination
you can change after printing. The generator therefore leaves short links **off
by default**.

### Managing links

[`links.html`](links.html) is the admin page. It needs a fine-grained GitHub
token with **Contents: Read and write** on this repository, which is stored only
in that browser's `localStorage` and never committed. From there you can create
a link, re-point an existing one, or delete it. Changes are commits, so every
edit is in the history — and they go live about a minute later, once Pages
rebuilds.

Note that `links.json` is public, like everything else in this repository.

## Layout

| File | Purpose |
| --- | --- |
| `index.html`, `app.js` | QR generator |
| `links.html`, `links.js` | Short link manager (admin) |
| `gh.js` | Shared GitHub API helpers |
| `404.html` | Short link resolver |
| `links.json` | The links themselves |
| `styles.css` | Styles for every page |
| `lib/` | [qr-code-styling](https://github.com/kozakdenys/qr-code-styling), vendored so the site works offline |
| `CNAME` | Custom domain for GitHub Pages |
