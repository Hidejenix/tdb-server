// monitor_posicao.js (2026-11-06) - SOMENTE LEITURA no host: posicao do pawn de cada jogador, no SERVIDOR, a cada 1 s.
// Para investigar "caiu no limbo" (o pawn do servidor cai? foi teleportado para onde?). Marca:
//   TELEPORTE  = andou > 50 m em 1 s;   CAINDO = Z desceu > 8 m em 1 s;   TROCOU PAWN = o PC passou a ter outro pawn.
// Linha normal a cada 10 s por jogador; linhas marcadas na hora. Conexoes: driver+0xa0; PC +0x2d0 pawn, +0x298 PlayerState.
(function () {
'use strict';
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send({ tdb: '[pos] ' + m }); }
function fstr(p) { try { const d = p.readPointer(), n = p.add(8).readS32(); if (d.isNull() || n <= 0 || n > 200) return '?'; return d.readUtf16String(n - 1); } catch (e) { return '?'; } }
function loc(a) { const r = a.add(0x198).readPointer(); if (r.isNull()) return null; const p = r.add(0x128); return [p.readDouble(), p.add(8).readDouble(), p.add(16).readDouble()]; }
function f(v) { return v.map(x => (x / 100).toFixed(1)).join(', '); }   // em metros
const ant = new Map();   // pc -> {pawn, p, t, normal}
let n = 0, erroVisto = false;
setInterval(function () {
  try {
    n++;
    const eng = B.add(0x7e20ea8).readPointer();
    const w = eng.add(0xec0).readPointer().readPointer().add(0x2c0).readPointer();
    const drv = w.add(0x38).readPointer(); if (drv.isNull()) return;
    const conns = drv.add(0xa0).readPointer(), nc = drv.add(0xa8).readS32();
    const vistos = new Set();
    for (let i = 0; i < nc && i < 32; i++) {
      const c = conns.add(i * 8).readPointer(); if (c.isNull()) continue;
      const pc = c.add(0x30).readPointer(); if (pc.isNull()) continue;
      const k = pc.toString(); vistos.add(k);
      const ps = pc.add(0x298).readPointer();
      const nome = ps.isNull() ? 'conn' + i : fstr(ps.add(0x388));
      const pawn = pc.add(0x2d0).readPointer();
      const a = ant.get(k);
      if (pawn.isNull()) { if (!a || !a.semPawn) log(nome + ': SEM PAWN'); ant.set(k, { semPawn: true }); continue; }
      const p = loc(pawn); if (!p) continue;
      const marcas = [];
      if (a && !a.semPawn) {
        if (!a.pawn.equals(pawn)) marcas.push('TROCOU PAWN ' + a.pawn + ' -> ' + pawn);
        else {
          const dx = p[0] - a.p[0], dy = p[1] - a.p[1], dz = p[2] - a.p[2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d > 5000) marcas.push('TELEPORTE ' + (d / 100).toFixed(0) + ' m de (' + f(a.p) + ')');
          else if (dz < -800) marcas.push('CAINDO dz=' + (dz / 100).toFixed(1) + ' m/s');
        }
      } else if (a && a.semPawn) marcas.push('GANHOU PAWN ' + pawn);
      if (marcas.length || !a || n % 10 === 0) log(nome + ' (' + f(p) + ')' + (marcas.length ? ' ' + marcas.join(' | ') : ''));
      ant.set(k, { pawn, p });
    }
    for (const k of Array.from(ant.keys())) if (!vistos.has(k)) { log('PC ' + k + ' saiu'); ant.delete(k); }
  } catch (e) { if (!erroVisto) { erroVisto = true; log('erro (mundo ainda carregando?): ' + e); } }
}, 1000);
log('pronto: posicao dos pawns no servidor a cada 1 s (metros)');
})();
