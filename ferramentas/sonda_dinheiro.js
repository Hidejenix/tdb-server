// sonda_dinheiro.js (2026-11-06) - leitura: chama a funcao pura GetTotalMoneyCount(out int32) do pawn de cada cliente
// (na thread do jogo, TickFlush) e loga o total. O dinheiro do TDB sao ITENS do tipo 12 no PocketContainer/ProtectiveCaseContainer.
(function () {
'use strict';
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send({ tdb: '[dinheiro?] ' + m }); }
const pool = B.add(0x7c27980);
function fn(i) { try { const b = pool.add(0x10).add((i >>> 16) * 8).readPointer(); const e = b.add((i & 0xffff) * 2); const h = e.readU16(); const l = h >>> 6; return (h & 1) ? e.add(2).readUtf16String(l) : e.add(2).readUtf8String(l); } catch (x) { return '?'; } }
function nome(o) { return fn(o.add(0x18).readU32()); }
function classe(o) { return nome(o.add(0x10).readPointer()); }
const processEvent = new NativeFunction(B.add(0x24077b0), 'void', ['pointer', 'pointer', 'pointer']);
const parms = Memory.alloc(64);
function acharFuncao(obj, nomeF) {
  let cls = obj.add(0x10).readPointer();
  for (let n = 0; n < 8 && !cls.isNull(); n++) { let f = cls.add(0x48).readPointer(); for (let k = 0; k < 3000 && !f.isNull(); k++) { if (nome(f) === nomeF) return f; f = f.add(0x28).readPointer(); } cls = cls.add(0x40).readPointer(); }
  return ptr(0);
}
let drv = ptr(0), feito = false;
const l = Interceptor.attach(B.add(0x42f3650), {
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
        const f = acharFuncao(pawn, 'GetTotalMoneyCount'); if (f.isNull()) { log('GetTotalMoneyCount nao achada'); continue; }
        parms.writeByteArray(new Array(64).fill(0)); processEvent(pawn, f, parms);
        log('pawn ' + pawn + ': GetTotalMoneyCount = ' + parms.readS32() + ' | CashMoney(var) = ' + pawn.add(0x1668).readS32());
      }
      setTimeout(function () { try { l.detach(); } catch (e) {} }, 0);
    } catch (e) { log('erro: ' + e); }
  }
});
})();
