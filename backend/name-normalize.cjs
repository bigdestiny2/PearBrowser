// Mobile port (Mission B3): copied verbatim from pearbrowser-desktop/backend/name-normalize.cjs.
// Pure name normalization + confusable-skeleton (homograph defense) for the
// naming layer. No deps → Node-testable. See docs/research/naming.md.
//
//   normalize(name) → NFKC + lowercase + invisible-char strip: the canonical
//     comparison form. Two inputs that normalize-equal are "the same name".
//   skeleton(name)  → normalize + fold confusable codepoints to a Latin
//     canonical, so visually-identical names from other scripts COLLIDE (e.g.
//     Cyrillic 'раypal' → 'paypal'), surfacing homograph squats at registration.

// Zero-width spaces, BiDi controls, soft hyphen, BOM, AND blank/filler glyphs
// (Hangul fillers U+115F/U+1160 + their NFKC sources U+3164/U+FFA0, Braille blank
// U+2800, Mongolian vowel separator U+180E) — invisible/blank characters an
// attacker inserts to make two distinct names render identically and dodge both
// name-dedup and the skeleton fold. Stripped AFTER NFKC, so the filler forms that
// NFKC-collapse to U+1160 are caught too.
const INVISIBLE_RE = /[­ᅟᅠ᠎​-‏‪-‮⁠-⁤⠀ㅤ﻿ﾠ]/g

// Confusable → Latin skeleton: a curated subset of the Unicode confusables that
// attack ASCII identifiers (Cyrillic + Greek look-alikes). Not exhaustive — the
// goal is to catch common brand-squat homographs, not every codepoint. Keys are
// lowercase (skeleton runs after normalize(), which lowercases).
const CONFUSABLES = {
  // Cyrillic → Latin
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y', ѕ: 's', і: 'i',
  ј: 'j', ԁ: 'd', һ: 'h', ո: 'n', м: 'm', т: 't', к: 'k', в: 'b', н: 'n',
  // Greek → Latin
  ο: 'o', ν: 'v', α: 'a', ρ: 'p', τ: 't', ι: 'i', κ: 'k', ϲ: 'c',
  β: 'b', η: 'n', γ: 'y', ε: 'e', χ: 'x'
}

function normalize (name) {
  if (typeof name !== 'string') return ''
  return name.normalize('NFKC').replace(INVISIBLE_RE, '').trim().toLowerCase()
}

function skeleton (name) {
  const n = normalize(name)
  let out = ''
  for (const ch of n) out += (Object.prototype.hasOwnProperty.call(CONFUSABLES, ch) ? CONFUSABLES[ch] : ch)
  return out
}

module.exports = { normalize, skeleton }
