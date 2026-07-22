/**
 * Every backend/*.js must be parseable by Node. This is the baseline
 * "smoke test" — it catches typos and syntax errors introduced by refactors
 * before they reach the worklet build.
 *
 * Mission B4b: walks subdirectories too (backend/ai/, backend/tab-assets/)
 * so the ported Ask Browser / TabRuntime modules get the same smoke test.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const backendDir = path.join(__dirname, '..', 'backend')

function * walk (dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield * walk(full)
    else yield full
  }
}

for (const file of walk(backendDir)) {
  if (!file.endsWith('.js') && !file.endsWith('.cjs')) continue
  const rel = path.relative(backendDir, file)
  test(`backend/${rel} parses cleanly`, () => {
    const source = fs.readFileSync(file, 'utf-8')
    assert.doesNotThrow(() => new vm.Script(source, { filename: rel }), `parse error in backend/${rel}`)
  })
}
