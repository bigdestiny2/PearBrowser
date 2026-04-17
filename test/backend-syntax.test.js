/**
 * Every backend/*.js must be parseable by Node. This is the baseline
 * "smoke test" — it catches typos and syntax errors introduced by refactors
 * before they reach the worklet build.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const backendDir = path.join(__dirname, '..', 'backend')

for (const file of fs.readdirSync(backendDir)) {
  if (!file.endsWith('.js')) continue
  test(`backend/${file} parses cleanly`, () => {
    const source = fs.readFileSync(path.join(backendDir, file), 'utf-8')
    assert.doesNotThrow(() => new vm.Script(source, { filename: file }), `parse error in backend/${file}`)
  })
}
