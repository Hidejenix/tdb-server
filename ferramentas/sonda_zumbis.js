// sonda_zumbis.js (2026-11-06) - SOMENTE LEITURA, 1 vez, na thread do Frida (nao trava o tick). Host.
// Lista atores dos niveis cuja classe contem "Zomb": quantidade por classe, flags de replicacao e distancia ao pawn do 1o cliente.
// AActor: flags58 (bit2 bOnlyRelevantToOwner, bit3 bAlwaysRelevant), flags5b bit3 bReplicates, RemoteRole +0x68, Role +0x150,
// NetDormancy +0x151, NetCullDistanceSquared +0x168, NetUpdateFrequency +0x170, RootComponent +0x198 (USceneComponent.RelativeLocation +0x128, 3 doubles).
(function () {
'use strict';
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send({ tdb: '[zumbis] ' + m }); }
const pool = B.add(0x7c27980);
function fnameStr(i) { try { const b = pool.add(0x10).add((i >>> 16) * 8).readPointer(); const e = b.add((i & 0xffff) * 2); const h = e.readU16(); const l = h >>> 6; return (h & 1) ? e.add(2).readUtf16String(l) : e.add(2).readUtf8String(l); } catch (x) { return '?'; } }
function classe(o) { try { return fnameStr(o.add(0x10).readPointer().add(0x18).readU32()); } catch (x) { return '?'; } }
function loc(a) { try { const r = a.add(0x198).readPointer(); if (r.isNull()) return null; const p = r.add(0x128); return [p.readDouble(), p.add(8).readDouble(), p.add(16).readDouble()]; } catch (e) { return null; } }
setTimeout(function () {
  try {
    const eng = B.add(0x7e20ea8).readPointer();
    const w = eng.add(0xec0).readPointer().readPointer().add(0x2c0).readPointer();
    const drv = w.add(0x38).readPointer();
    let pl = null;
    try { const c = drv.add(0xa0).readPointer().readPointer(); const pawn = c.add(0x30).readPointer().add(0x2d0).readPointer(); pl = loc(pawn); log('pawn do cliente em ' + (pl ? pl.map(v => v.toFixed(0)).join(',') : '?')); } catch (e) { log('sem cliente: ' + e); }
    const lv = w.add(0x170).readPointer(), nl = w.add(0x178).readS32();
    const porClasse = {};
    let total = 0;
    for (let i = 0; i < nl; i++) {
      const L = lv.add(i * 8).readPointer(); if (L.isNull()) continue;
      const arr = L.add(0x98).readPointer(), n = L.add(0xa0).readS32();
      for (let j = 0; j < n && j < 200000; j++) {
        total++;
        try {
          const a = arr.add(j * 8).readPointer(); if (a.isNull()) continue;
          const c = classe(a); if (c.indexOf('Zomb') < 0) continue;
          const f58 = a.add(0x58).readU8(), f5b = a.add(0x5b).readU8();
          const chave = c + ' rep=' + ((f5b >> 3) & 1) + ' always=' + ((f58 >> 3) & 1) + ' onlyOwner=' + ((f58 >> 2) & 1) + ' remoteRole=' + a.add(0x68).readU8() +
            ' role=' + a.add(0x150).readU8() + ' dorm=' + a.add(0x151).readU8() + ' cull=' + Math.sqrt(a.add(0x168).readFloat()).toFixed(0) + ' freq=' + a.add(0x170).readFloat().toFixed(0);
          const e = porClasse[chave] || (porClasse[chave] = { n: 0, perto: 0, ex: null, dmin: 1e12 });
          e.n++;
          const p = loc(a);
          if (p && pl) { const d = Math.hypot(p[0] - pl[0], p[1] - pl[1], p[2] - pl[2]); if (d < e.dmin) { e.dmin = d; e.ex = a; } if (d < 5000) e.perto++; }
        } catch (e) {}
      }
    }
    log('atores varridos: ' + total + ' em ' + nl + ' niveis');
    for (const k of Object.keys(porClasse)) { const e = porClasse[k]; log(e.n + 'x ' + k + ' | a <50 m do cliente: ' + e.perto + ' | mais perto: ' + (e.dmin < 1e12 ? (e.dmin / 100).toFixed(0) + ' m (' + e.ex + ')' : '?')); }
    log('fim');
  } catch (e) { log('erro: ' + e); }
}, 0);
})();
