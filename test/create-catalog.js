#!/usr/bin/env node

/**
 * Creates a test app catalog Hyperdrive and two sample apps.
 * Prints the catalog key for use in PearBrowser.
 *
 * Run from hiverelay dir:
 *   node /Users/localllm/Desktop/PearBrowser/test/create-catalog.js
 */

import Hyperswarm from 'hyperswarm'
import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import path from 'path'

const storage = path.join(tmpdir(), 'pearbrowser-catalog-' + randomBytes(4).toString('hex'))

async function main () {
  const store = new Corestore(storage)
  const swarm = new Hyperswarm()
  swarm.on('connection', c => store.replicate(c))

  // --- App 1: Simple Calculator ---
  const calcDrive = new Hyperdrive(store)
  await calcDrive.ready()
  await calcDrive.put('/index.html', Buffer.from(`<!DOCTYPE html>
<html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>P2P Calculator</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,sans-serif;background:#0a0a0a;color:#e0e0e0;display:flex;flex-direction:column;align-items:center;padding:40px 20px}
h1{color:#ff9500;margin-bottom:20px}
.calc{background:#1a1a1a;border-radius:16px;padding:20px;width:100%;max-width:320px}
input{width:100%;padding:16px;font-size:24px;background:#2a2a2a;border:none;border-radius:8px;color:#fff;text-align:right;margin-bottom:12px}
.row{display:flex;gap:8px;margin-bottom:8px}
button{flex:1;padding:16px;font-size:20px;border:none;border-radius:8px;background:#333;color:#e0e0e0;cursor:pointer}
button:active{background:#444}
button.op{background:#ff9500;color:#000}
button.eq{background:#4ade80;color:#000}
</style></head><body>
<h1>P2P Calculator</h1>
<div class="calc">
<input id="display" readonly value="0">
<div class="row"><button onclick="press('7')">7</button><button onclick="press('8')">8</button><button onclick="press('9')">9</button><button class="op" onclick="press('+')">+</button></div>
<div class="row"><button onclick="press('4')">4</button><button onclick="press('5')">5</button><button onclick="press('6')">6</button><button class="op" onclick="press('-')">-</button></div>
<div class="row"><button onclick="press('1')">1</button><button onclick="press('2')">2</button><button onclick="press('3')">3</button><button class="op" onclick="press('*')">x</button></div>
<div class="row"><button onclick="press('C')">C</button><button onclick="press('0')">0</button><button onclick="press('.')">.</button><button class="eq" onclick="calc()">=</button></div>
</div>
<script>
let expr = '';
function press(v) { if(v==='C'){expr='';document.getElementById('display').value='0'}else{expr+=v;document.getElementById('display').value=expr} }
function calc() { try{document.getElementById('display').value=eval(expr);expr=String(eval(expr))}catch{document.getElementById('display').value='Error';expr=''} }
</script></body></html>`))
  swarm.join(calcDrive.discoveryKey, { server: true, client: false })

  // --- App 2: Notes App ---
  const notesDrive = new Hyperdrive(store)
  await notesDrive.ready()
  await notesDrive.put('/index.html', Buffer.from(`<!DOCTYPE html>
<html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>P2P Notes</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,sans-serif;background:#0a0a0a;color:#e0e0e0;padding:20px;max-width:600px;margin:0 auto}
h1{color:#ff9500;margin-bottom:16px;font-size:1.5em}
textarea{width:100%;height:200px;background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:16px;color:#e0e0e0;font-size:16px;resize:vertical;margin-bottom:12px}
button{background:#ff9500;color:#000;border:none;padding:12px 24px;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer}
.notes{margin-top:20px}
.note{background:#1a1a1a;border-radius:12px;padding:16px;margin-bottom:8px;position:relative}
.note .time{color:#666;font-size:12px;margin-bottom:4px}
.note .del{position:absolute;right:12px;top:12px;color:#666;cursor:pointer;font-size:18px}
</style></head><body>
<h1>P2P Notes</h1>
<textarea id="input" placeholder="Write a note..."></textarea>
<button onclick="addNote()">Save Note</button>
<div class="notes" id="notes"></div>
<script>
let notes = JSON.parse(localStorage.getItem('p2p-notes')||'[]');
function render() { document.getElementById('notes').innerHTML = notes.map((n,i) =>
  '<div class="note"><div class="time">'+new Date(n.t).toLocaleString()+'</div><span class="del" onclick="delNote('+i+')">x</span>'+n.text.replace(/</g,'&lt;')+'</div>'
).reverse().join(''); }
function addNote() { const t=document.getElementById('input').value.trim(); if(!t)return; notes.push({text:t,t:Date.now()}); localStorage.setItem('p2p-notes',JSON.stringify(notes)); document.getElementById('input').value=''; render(); }
function delNote(i) { notes.splice(i,1); localStorage.setItem('p2p-notes',JSON.stringify(notes)); render(); }
render();
</script></body></html>`))
  swarm.join(notesDrive.discoveryKey, { server: true, client: false })

  // --- Catalog ---
  const catalogDrive = new Hyperdrive(store)
  await catalogDrive.ready()

  const catalog = {
    version: 1,
    name: 'PearBrowser App Store',
    apps: [
      {
        id: 'p2p-calculator',
        name: 'Calculator',
        description: 'A simple calculator running on the P2P web',
        author: 'PearBrowser',
        version: '1.0.0',
        driveKey: calcDrive.key.toString('hex'),
        icon: '/apps/p2p-calculator/icon.png',
        categories: ['utilities']
      },
      {
        id: 'p2p-notes',
        name: 'Notes',
        description: 'Save notes locally — runs entirely on your device via P2P',
        author: 'PearBrowser',
        version: '1.0.0',
        driveKey: notesDrive.key.toString('hex'),
        icon: '/apps/p2p-notes/icon.png',
        categories: ['productivity']
      }
    ]
  }

  await catalogDrive.put('/catalog.json', Buffer.from(JSON.stringify(catalog, null, 2)))
  swarm.join(catalogDrive.discoveryKey, { server: true, client: false })

  await swarm.flush()

  console.log('=== App Store Catalog ===')
  console.log()
  console.log('Catalog key: ' + catalogDrive.key.toString('hex'))
  console.log('Calculator:  ' + calcDrive.key.toString('hex'))
  console.log('Notes:       ' + notesDrive.key.toString('hex'))
  console.log()
  console.log('All drives serving. Ctrl+C to stop.')

  process.on('SIGINT', async () => {
    await swarm.destroy()
    await store.close()
    process.exit(0)
  })
}

main().catch(err => { console.error(err); process.exit(1) })
