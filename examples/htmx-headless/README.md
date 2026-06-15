# Headless htmx over streamx

Run an htmx app with **no HTTP server**. `XMLHttpRequest` is shimmed onto a
**streamx** handler, so htmx thinks it's talking to a server — but it's actually
a stream into the worklet / a peer / a Hyperdrive. Same front-end, zero TCP.

```sh
node examples/htmx-headless/run.js
```

```
GET /items            (htmx "Load items" button):
  <li>1. buy milk</li><li>2. ship PearBrowser</li>
POST /items text=...  (htmx form submit):
  <li>1. buy milk</li><li>2. ship PearBrowser</li><li>3. ship headless</li>
✓ htmx app served over streamx — no HTTP server, no browser.
```

| file | role |
|---|---|
| `index.html` | a normal htmx app (`hx-get`/`hx-post`) — drop it in a WebView and it works the same |
| `server.js` | the app's data layer as a **streamx handler** — reusable in the worklet *and* headless |
| `run.js` | runs it headless, firing the exact requests htmx makes |

The shim is `backend/xhr-streamx.js`.

## Credit

**Idea & approach: [Dominic Cassidy](https://github.com/Drache93) (@Drache93)** — hook `XMLHttpRequest`; htmx thinks it's a server,
it's actually streamx. This is the server-less, streamx-everywhere shape that
PearBrowser's [Holepunch alignment](../../docs/HOLEPUNCH_ALIGNMENT_PLAN.md) is
built around.
