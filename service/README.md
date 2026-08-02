# OMQ helper service — optional

Two jobs the browser does adequately and a library does properly:

| Endpoint | Does | Instead of |
| --- | --- | --- |
| `POST /trace` | PNG/JPEG → SVG with fitted curves | the browser's edge-walking tracer, which corners where a curve belongs |
| `POST /pdf-colours` | PDF → palette, via the operator list | a regular expression over content streams, which cannot see into object streams or an encrypted file |
| `GET /health` | says it is alive | — |

**Optional is the point.** The browser keeps its own implementation of both and
only calls here when `SERVICE_BASE` is set in `config.php` *and* `/health`
answers. Never deployed, stopped, or slow — the tools carry on exactly as
before, at lower quality. Nothing breaks.

That is also why it holds no state and touches no database: it can be
restarted or deleted at any moment. And why it does not authenticate — it
holds nothing and can reach nothing, so the worst an outsider can do is spend
CPU. Bind it to localhost.

## Running it on cPanel

cPanel → **Setup Node.js App** (if your plan has it):

- Application root: `qr.omqpro.com/service`
- Application URL: `qr.omqpro.com/helper`
- Startup file: `server.js`
- Then **Run NPM Install**, then **Start**

Set `SERVICE_BASE` in `config.php` to the application URL, e.g.
`https://qr.omqpro.com/helper`. Leave it empty to disable.

Locally, or on a VPS:

```
npm install
PORT=8071 npm start
```

## Checking it

```
curl http://127.0.0.1:8071/health
curl -X POST --data-binary @logo.png  http://127.0.0.1:8071/trace
curl -X POST --data-binary @brand.pdf http://127.0.0.1:8071/pdf-colours
```

## Not verified here

This was written without the dependencies installed, so it has never been
run. `npm install && npm start`, then `/health`, before pointing the site at
it. The graceful fallback means a broken service costs you nothing but the
better output — but check it rather than assume it.
