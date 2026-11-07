// sonda_spawnpoints.js (2026-11-06) - SOMENTE LEITURA: lista no host os pontos de spawn e as portas de teleporte carregados,
// com posicao (metros) e o nivel (Outer). Para o bug "cai no limbo ao voltar do terreno para Woodberry".
(function () {
'use strict';
const CLASSES = (typeof SONDA_CLASSES !== 'undefined') ? SONDA_CLASSES : ['BP_PlayerSpawnPoint_C', 'BP_HouseGateTeleport_C', 'BP_DoorTeleport_C', 'BP_TeleporterDoorMaster_C', 'PlayerStart'];
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send({ tdb: '[spawnp] ' + m }); }
const pool = B.add(0x7c27980);
function fn(i) { try { const b = pool.add(0x10).add((i >>> 16) * 8).readPointer(); const e = b.add((i & 0xffff) * 2); const h = e.readU16(); const l = h >>> 6; return (h & 1) ? e.add(2).readUtf16String(l) : e.add(2).readUtf8String(l); } catch (x) { return '?'; } }
function nome(o) { const n = fn(o.add(0x18).readU32()), k = o.add(0x1c).readU32(); return k ? n + '_' + (k - 1) : n; }
function classe(o) { return nome(o.add(0x10).readPointer()); }
function loc(a) { try { const r = a.add(0x198).readPointer(); if (r.isNull()) return '?'; const p = r.add(0x128); return [p.readDouble(), p.add(8).readDouble(), p.add(16).readDouble()].map(x => (x / 100).toFixed(1)).join(', '); } catch (e) { return 'nao-ator'; } }
setTimeout(function () {
  const arr = B.add(0x7ccda10), objs = arr.readPointer(), num = arr.add(0x14).readS32(), nch = arr.add(0x1c).readS32();
  const cont = {}; let n = 0;
  for (let i = 0; i < num; i++) {
    const ch = (i / 0x10000) | 0; if (ch >= nch) break;
    try {
      const chunk = objs.add(ch * 8).readPointer(); if (chunk.isNull()) continue;
      const o = chunk.add((i % 0x10000) * 0x18).readPointer(); if (o.isNull()) continue;
      const c = classe(o); if (CLASSES.indexOf(c) < 0) continue;
      const nm = nome(o); if (nm.indexOf('Default__') === 0) continue;
      cont[c] = (cont[c] || 0) + 1;
      const lvl = o.add(0x20).readPointer(); const pkg = lvl.isNull() ? null : lvl.add(0x20).readPointer();
      if (++n <= 120) log(c + ' ' + nm + ' (' + loc(o) + ') nivel=' + (pkg && !pkg.isNull() ? nome(pkg) : '?'));
    } catch (e) {}
  }
  log('fim: ' + JSON.stringify(cont) + ' (' + num + ' objetos)');
}, 0);
})();

