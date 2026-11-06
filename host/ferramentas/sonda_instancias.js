// sonda_instancias.js (2026-11-06) - SOMENTE LEITURA, thread do Frida: lista instancias de classes (por nome) na GObjects com o Outer.
(function () {
'use strict';
const CLASSES = ['InventoryWorker_C', 'SGInventoryWorker_C'];
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send({ tdb: '[inst] ' + m }); }
const pool = B.add(0x7c27980);
function fn(i) { try { const b = pool.add(0x10).add((i >>> 16) * 8).readPointer(); const e = b.add((i & 0xffff) * 2); const h = e.readU16(); const l = h >>> 6; return (h & 1) ? e.add(2).readUtf16String(l) : e.add(2).readUtf8String(l); } catch (x) { return '?'; } }
function nome(o) { return fn(o.add(0x18).readU32()); }
function classe(o) { return nome(o.add(0x10).readPointer()); }
setTimeout(function () {
  const arr = B.add(0x7ccda10), objs = arr.readPointer(), num = arr.add(0x14).readS32(), nch = arr.add(0x1c).readS32();
  let n = 0;
  for (let i = 0; i < num; i++) {
    const ch = (i / 0x10000) | 0; if (ch >= nch) break;
    try {
      const chunk = objs.add(ch * 8).readPointer(); if (chunk.isNull()) continue;
      const o = chunk.add((i % 0x10000) * 0x18).readPointer(); if (o.isNull()) continue;
      const c = classe(o); if (CLASSES.indexOf(c) < 0) continue;
      const out = o.add(0x20).readPointer();
      log(c + ' ' + nome(o) + ' @' + o + ' outer=' + (out.isNull() ? 'nulo' : classe(out) + ' ' + nome(out) + ' @' + out));
      if (++n > 40) break;
    } catch (e) {}
  }
  log('fim (' + num + ' objetos)');
}, 0);
})();
