'use strict'
/**
 * Run the htmx app HEADLESS — no browser, no HTTP server.
 *
 * We install the XHR-over-streamx shim globally, point it at the app's streamx
 * handler (server.js), and fire the exact requests htmx makes on the page.
 * Same app, same handler, zero TCP. Idea & approach: Dominic.
 *
 *   node examples/htmx-headless/run.js
 */
const { installXHR } = require('../../backend/xhr-streamx.js')
const handler = require('./server.js')

installXHR(globalThis, { handler })

function xhr (method, url, body, headers) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest()
    x.open(method, url)
    for (const k of Object.keys(headers || {})) x.setRequestHeader(k, headers[k])
    x.addEventListener('load', () => resolve(x.responseText))
    x.addEventListener('error', () => reject(x._lastError || new Error('xhr error')))
    x.send(body)
  })
}

;(async () => {
  console.log('GET /items            (htmx "Load items" button):')
  console.log('  ' + await xhr('GET', '/items'))
  console.log('\nPOST /items text=...  (htmx form submit):')
  console.log('  ' + await xhr('POST', '/items', 'text=ship+headless', { 'content-type': 'application/x-www-form-urlencoded' }))
  console.log('\n✓ htmx app served over streamx — no HTTP server, no browser.')
})().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
