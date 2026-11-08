// teste_queda.js (2026-11-06) - ESCRITA no host, SO PARA TESTE: joga o pawn dos jogadores DESCER metros abaixo de onde estao
// (no vazio, sem chao), para ver o resgate_queda.js agir. Filtro por nome em ALVO ('' = todos). Executa uma vez, na thread do jogo.
(function () {
'use strict';
const ALVO = 'D724', DESCER = 500;   // metros
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send({ tdb: '[teste-queda] ' + m }); }
const pool = B.add(0x7c27980);
function fn(i) { try { const b = pool.add(0x10).add((i >>> 16) * 8).readPointer(); const e = b.add((i & 0xffff) * 2); const h = e.readU16(); const l = h >>> 6; return (h & 1) ? e.add(2).readUtf16String(l) : e.add(2).readUtf8String(l); } catch (x) { return '?'; } }
function nome(o) { return fn(o.add(0x18).readU32()); }
function classe(o) { return nome(o.add(0x10).readPointer()); }
function fstr(p) { try { const d = p.readPointer(), n = p.add(8).readS32(); if (d.isNull() || n <= 0 || n > 200) return '?'; return d.readUtf16String(n - 1); } catch (e) { return '?'; } }
const processEvent = new NativeFunction(B.add(0x24077b0), 'void', ['pointer', 'pointer', 'pointer']);
const parms = Memory.alloc(0x100);
function acharFuncao(obj, nomeF) {
  let cls = obj.add(0x10).readPointer();
  for (let n = 0; n < 12 && !cls.isNull(); n++) { let f = cls.add(0x48).readPointer(); for (let k = 0; k < 4000 && !f.isNull(); k++) { if (nome(f) === nomeF) return f; f = f.add(0x28).readPointer(); } cls = cls.add(0x40).readPointer(); }
  return ptr(0);
}
let drv = ptr(0), feito = false;
const h = Interceptor.attach(B.add(0x42f3650), {
  onEnter(a) {
    if (feito) return;
    try {
      if (drv.isNull()) { if (classe(a[0]) !== 'IpNetDriver' || !a[0].add(0x98).readPointer().isNull()) return; drv = a[0]; }
      if (!a[0].equals(drv)) return;
      feito = true;
      const conns = drv.add(0xa0).readPointer(), nc = drv.add(0xa8).readS32();
      for (let i = 0; i < nc && i < 16; i++) {
        const pc = conns.add(i * 8).readPointer().add(0x30).readPointer(); if (pc.isNull()) continue;
        const pawn = pc.add(0x2d0).readPointer(); if (pawn.isNull() || classe(pawn).indexOf('SurvivalPlayer') !== 0) continue;
        const ps = pc.add(0x298).readPointer(); const nj = ps.isNull() ? '?' : fstr(ps.add(0x388));
        if (ALVO && nj.indexOf(ALVO) < 0) continue;
        const r = pawn.add(0x198).readPointer().add(0x128);
        const p = [r.readDouble(), r.add(8).readDouble(), r.add(16).readDouble()];
        const f = acharFuncao(pawn, 'K2_TeleportTo'); if (f.isNull()) { log('K2_TeleportTo nao achada'); continue; }
        for (let k = 0; k < 0x100; k += 8) parms.add(k).writeU64(0);
        parms.writeDouble(p[0]); parms.add(8).writeDouble(p[1]); parms.add(16).writeDouble(p[2] - DESCER * 100);
        processEvent(pawn, f, parms);
        const okT = parms.add(0x30).readU8();
        // v2: o movimento e do cliente (o servidor aceita a posicao dele) -> mandar o teleporte tambem ao cliente (RPC do PC)
        const fc = acharFuncao(pc, 'ClientSetLocation');
        if (!fc.isNull()) { for (let k = 0; k < 0x100; k += 8) parms.add(k).writeU64(0); parms.writeDouble(p[0]); parms.add(8).writeDouble(p[1]); parms.add(16).writeDouble(p[2] - DESCER * 100); processEvent(pc, fc, parms); }
        log(nj + ': de (' + p.map(x => (x / 100).toFixed(1)).join(', ') + ') para ' + DESCER + ' m abaixo; K2_TeleportTo=' + okT + ' ClientSetLocation=' + (fc.isNull() ? 'nao achada' : 'enviado'));
      }
      setTimeout(function () { try { h.detach(); } catch (e) {} }, 0);
    } catch (e) { log('erro: ' + e); }
  }
});
log('pronto: vai jogar ' + (ALVO || 'todos') + ' ' + DESCER + ' m para baixo');
})();
