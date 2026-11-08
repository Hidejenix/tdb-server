// monitor_ping.js (2026-11-06) - SOMENTE LEITURA no host: ping de cada jogador conectado, a cada 15 s.
// Fonte: APlayerState.CompressedPing (+0x298, uint8 = ping/4 em ms; o servidor atualiza a partir do lag medido na conexao) e
// o nome (APlayerState.PlayerNamePrivate +0x388). PlayerController +0x298 -> PlayerState. Conexoes: driver+0xa0 (TArray).
(function () {
'use strict';
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send({ tdb: '[ping] ' + m }); }
function fstr(p) { try { const d = p.readPointer(), n = p.add(8).readS32(); if (d.isNull() || n <= 0 || n > 200) return '?'; return d.readUtf16String(n - 1); } catch (e) { return '?'; } }
setInterval(function () {
  try {
    const eng = B.add(0x7e20ea8).readPointer();
    const w = eng.add(0xec0).readPointer().readPointer().add(0x2c0).readPointer();
    const drv = w.add(0x38).readPointer(); if (drv.isNull()) return;
    const conns = drv.add(0xa0).readPointer(), nc = drv.add(0xa8).readS32();
    const partes = [];
    for (let i = 0; i < nc && i < 32; i++) {
      const c = conns.add(i * 8).readPointer(); if (c.isNull()) continue;
      const pc = c.add(0x30).readPointer(); if (pc.isNull()) { partes.push('conexao ' + i + ': entrando'); continue; }
      const ps = pc.add(0x298).readPointer(); if (ps.isNull()) { partes.push('conexao ' + i + ': sem PlayerState'); continue; }
      partes.push(fstr(ps.add(0x388)) + ' = ' + (ps.add(0x298).readU8() * 4) + ' ms');
    }
    log(nc + ' jogador(es): ' + (partes.join(' | ') || '-'));
  } catch (e) { log('erro: ' + e); }
}, 15000);
log('pronto: ping dos jogadores a cada 15 s');
})();
