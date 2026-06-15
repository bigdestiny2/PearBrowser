'use strict'
/**
 * The htmx app's data layer — as a streamx handler, NOT an HTTP server.
 * The same handler works headless (run.js) and inside the worklet (a WebView
 * app), because htmx only ever sees XMLHttpRequest. Idea & approach: Dominic.
 */
const { serveRoutes, drain } = require('../../backend/xhr-streamx.js')
const b4a = require('b4a')

const items = ['buy milk', 'ship PearBrowser']

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const render = () => items.length
  ? items.map((t, i) => `<li>${i + 1}. ${escapeHtml(t)}</li>`).join('')
  : '<li><em>no items yet</em></li>'

function parseForm (s) {
  const out = {}
  for (const kv of String(s).split('&')) {
    const [k, v] = kv.split('=')
    if (k) out[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' '))
  }
  return out
}

module.exports = serveRoutes({
  'GET /items': () => ({ headers: { 'content-type': 'text/html' }, body: render() }),
  'POST /items': async (req) => {
    const form = parseForm(b4a.toString(await drain(req.body)))
    if (form.text && form.text.trim()) items.push(form.text.trim())
    return { headers: { 'content-type': 'text/html' }, body: render() }
  }
})
