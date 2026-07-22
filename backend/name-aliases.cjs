// Mobile port (Mission B3): copied verbatim from pearbrowser-desktop/backend/name-aliases.cjs.
// Curated bootstrap name aliases — the typed successor to ui/shell.js
// FEATURED_APPS / Holepunch pear-aliases (https://github.com/holepunchto/pear-aliases).
//
// The "decaying" floor of the naming resolver: these resolve a bare word on day
// one (Tier 3, provenance 'curated'), but rank BELOW the user's own petnames and
// their contacts' bindings — so as the real trust graph grows they are
// overridden, never displacing the key. Pure data + lookup (Node-testable).
const { normalize } = require('./name-normalize.cjs')

// name → launch target. `link` is a pear://… (or hyper://…) the nav layer can
// open directly; `label` is the display name. Multiple names may point at one
// target (e.g. 'pass' → PearPass).
const NAME_ALIASES = [
  { name: 'keet', label: 'Keet', link: 'pear://oeeoz3w6fjjt7bym3ndpa6hhicm8f8naxyk11z4iypeoupn6jzpo' },
  { name: 'pearpass', label: 'PearPass', link: 'pear://tywsat7gz8m65ejx4zjn3773pbdc4j8m66tukis8dgzekraymtzo' },
  { name: 'pass', label: 'PearPass', link: 'pear://tywsat7gz8m65ejx4zjn3773pbdc4j8m66tukis8dgzekraymtzo' },
  { name: 'peercord', label: 'Peercord', link: 'pear://wmir47w7mai3b1skj66mx7fzso6k6o91kipaney7gtt69npimouy' },
  { name: 'peerit', label: 'peerit', link: 'hyper://ec6e2d6d9d22b9d6b40e11a9ca3042be3197e4bdca9e9a7f079be6ee830761b4/' },
  { name: 'hiveworm', label: 'HiveWorm', link: 'pear://d1xbkcpcbi1xa8dexp49rsendra5r67w3qh5a9k8t44oemm4k16y' },
  { name: 'anongpt', label: 'anonGPT', link: 'pear://rpzh3fsgg38kfir9nmae7x3o8ubofddzzixr5js4mxd6a6drb6wo' }
]

// Pre-normalize once so lookups are O(1) and canonical.
const _byNorm = new Map()
for (const a of NAME_ALIASES) _byNorm.set(normalize(a.name), a)

// Resolve a curated alias. Returns { name, label, link, provenance:'curated' } or null.
function lookupAlias (name) {
  const n = normalize(name)
  if (!n) return null
  const hit = _byNorm.get(n)
  return hit ? { name: hit.name, label: hit.label, link: hit.link, provenance: 'curated' } : null
}

module.exports = { NAME_ALIASES, lookupAlias }
