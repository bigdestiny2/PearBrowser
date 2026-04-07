/**
 * Site Manager
 *
 * Creates, edits, and publishes personal websites as writable Hyperdrives.
 * Users own the keypair — their site is theirs forever.
 */

const Hyperdrive = require('hyperdrive')
const b4a = require('b4a')

class SiteManager {
  constructor (store, swarm) {
    this.store = store
    this.swarm = swarm
    this.sites = new Map() // siteId → { drive, name, published, createdAt }
  }

  /**
   * Create a new site (writable Hyperdrive)
   */
  async createSite (name) {
    const drive = new Hyperdrive(this.store)
    await drive.ready()

    const keyHex = b4a.toString(drive.key, 'hex')
    const siteId = keyHex.slice(0, 16)

    // Write a default index.html
    await drive.put('/index.html', Buffer.from(this._defaultHtml(name)))
    await drive.put('/style.css', Buffer.from(this._defaultCss()))

    this.sites.set(siteId, {
      drive,
      keyHex,
      name: name || 'My Site',
      published: false,
      createdAt: Date.now()
    })

    return { siteId, keyHex, name: name || 'My Site' }
  }

  /**
   * Update files on a site
   */
  async updateSite (siteId, files) {
    const site = this.sites.get(siteId)
    if (!site) throw new Error('Site not found: ' + siteId)

    for (const { path, content } of files) {
      await site.drive.put(path, Buffer.from(content))
    }

    return { updated: files.length }
  }

  /**
   * Publish a site (start swarming so peers can access it)
   */
  async publishSite (siteId) {
    const site = this.sites.get(siteId)
    if (!site) throw new Error('Site not found: ' + siteId)

    this.swarm.join(site.drive.discoveryKey, { server: true, client: false })
    await this.swarm.flush()

    site.published = true

    return {
      siteId,
      keyHex: site.keyHex,
      url: `hyper://${site.keyHex}`
    }
  }

  /**
   * Unpublish (stop swarming)
   */
  async unpublishSite (siteId) {
    const site = this.sites.get(siteId)
    if (!site) throw new Error('Site not found: ' + siteId)

    try { await this.swarm.leave(site.drive.discoveryKey) } catch {}
    site.published = false
    return { siteId }
  }

  /**
   * Delete a site entirely
   */
  async deleteSite (siteId) {
    const site = this.sites.get(siteId)
    if (!site) return false

    if (site.published) {
      try { await this.swarm.leave(site.drive.discoveryKey) } catch {}
    }
    try { await site.drive.close() } catch {}
    this.sites.delete(siteId)
    return true
  }

  /**
   * List all user sites
   */
  listSites () {
    const result = []
    for (const [siteId, site] of this.sites) {
      result.push({
        siteId,
        keyHex: site.keyHex,
        name: site.name,
        published: site.published,
        createdAt: site.createdAt,
        url: `hyper://${site.keyHex}`
      })
    }
    return result
  }

  /**
   * Build a site from template + user content blocks
   */
  async buildFromBlocks (siteId, blocks, theme) {
    const site = this.sites.get(siteId)
    if (!site) throw new Error('Site not found: ' + siteId)

    const html = this._renderBlocks(blocks, site.name, theme)
    const css = this._renderThemeCss(theme)

    await site.drive.put('/index.html', Buffer.from(html))
    await site.drive.put('/style.css', Buffer.from(css))

    return { siteId }
  }

  _renderBlocks (blocks, siteName, theme) {
    const bodyHtml = blocks.map(block => {
      switch (block.type) {
        case 'heading':
          return `<h${block.level || 1}>${this._escapeHtml(block.text)}</h${block.level || 1}>`
        case 'text':
          return `<p>${this._escapeHtml(block.text)}</p>`
        case 'image':
          return `<img src="${this._escapeHtml(block.src)}" alt="${this._escapeHtml(block.alt || '')}">`
        case 'link':
          return `<a href="${this._escapeHtml(block.href)}">${this._escapeHtml(block.text || block.href)}</a>`
        case 'divider':
          return '<hr>'
        case 'code':
          return `<pre><code>${this._escapeHtml(block.text)}</code></pre>`
        case 'quote':
          return `<blockquote>${this._escapeHtml(block.text)}</blockquote>`
        default:
          return ''
      }
    }).join('\n')

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${this._escapeHtml(siteName)}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    ${bodyHtml}
  </main>
</body>
</html>`
  }

  _renderThemeCss (theme = {}) {
    const primary = theme.primaryColor || '#ff9500'
    const bg = theme.backgroundColor || '#0a0a0a'
    const text = theme.textColor || '#e0e0e0'
    const font = theme.fontFamily || '-apple-system, sans-serif'

    return `
:root {
  --primary: ${primary};
  --bg: ${bg};
  --text: ${text};
  --font: ${font};
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: var(--font); background: var(--bg); color: var(--text); line-height: 1.6; }
main { max-width: 680px; margin: 0 auto; padding: 40px 20px; }
h1, h2, h3 { color: var(--primary); margin-bottom: 16px; }
p { margin-bottom: 16px; }
a { color: var(--primary); }
img { max-width: 100%; border-radius: 8px; margin: 16px 0; }
hr { border: none; border-top: 1px solid #333; margin: 32px 0; }
pre { background: #1a1a1a; padding: 16px; border-radius: 8px; overflow-x: auto; margin: 16px 0; }
code { font-family: monospace; font-size: 14px; }
blockquote { border-left: 3px solid var(--primary); padding-left: 16px; color: #888; margin: 16px 0; }
`
  }

  _defaultHtml (name) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${this._escapeHtml(name || 'My Site')}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <h1>${this._escapeHtml(name || 'My Site')}</h1>
    <p>Welcome to my P2P website, served over Hyperdrive.</p>
    <p>Edit this page in PearBrowser's Site Builder.</p>
  </main>
</body>
</html>`
  }

  _defaultCss () {
    return this._renderThemeCss()
  }

  _escapeHtml (str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  export () {
    const out = {}
    for (const [siteId, site] of this.sites) {
      out[siteId] = {
        keyHex: site.keyHex,
        name: site.name,
        published: site.published,
        createdAt: site.createdAt
      }
    }
    return out
  }

  async close () {
    for (const [, site] of this.sites) {
      if (site.published) {
        try { await this.swarm.leave(site.drive.discoveryKey) } catch {}
      }
      try { await site.drive.close() } catch {}
    }
    this.sites.clear()
  }
}

module.exports = { SiteManager }
