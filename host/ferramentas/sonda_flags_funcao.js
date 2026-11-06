// sonda_flags_funcao.js (2026-11-06) - SOMENTE LEITURA: FunctionFlags (+0xb0) de funcoes do pawn do 1o cliente.
(function () {
'use strict';
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send({ tdb: '[flags] ' + m }); }
const pool = B.add(0x7c27980);
function fn(i) { try { const b = pool.add(0x10).add((i >>> 16) * 8).readPointer(); const e = b.add((i & 0xffff) * 2); const h = e.readU16(); const l = h >>> 6; return (h & 1) ? e.add(2).readUtf16String(l) : e.add(2).readUtf8String(l); } catch (x) { return '?'; } }
function nome(o) { return fn(o.add(0x18).readU32()); }
const ALVOS = /Money|Budget|Cash/;
function txt(f) { const t = []; if (f & 0x40) t.push('Net'); if (f & 0x80) t.push('NetReliable'); if (f & 0x4000) t.push('NetMulticast'); if (f & 0x200000) t.push('NetServer'); if (f & 0x1000000) t.push('NetClient'); if (f & 0x800) t.push('Event'); if (f & 0x400) t.push('Native'); return t.join('|') + ' 0x' + (f >>> 0).toString(16); }
setTimeout(function () {
  try {
    const eng = B.add(0x7e20ea8).readPointer();
    const w = eng.add(0xec0).readPointer().readPointer().add(0x2c0).readPointer();
    const pawn = w.add(0x38).readPointer().add(0xa0).readPointer().readPointer().add(0x30).readPointer().add(0x2d0).readPointer();
    log('pawn ' + pawn + ' CashMoney=' + pawn.add(0x1668).readS32() + ' Role=' + pawn.add(0x150).readU8() + ' RemoteRole=' + pawn.add(0x68).readU8());
    let cls = pawn.add(0x10).readPointer();
    for (let n = 0; n < 8 && !cls.isNull(); n++) {
      let f = cls.add(0x48).readPointer();
      for (let k = 0; k < 3000 && !f.isNull(); k++) { const nm = nome(f); if (ALVOS.test(nm)) log(nome(cls) + '.' + nm + ' flags=' + txt(f.add(0xb0).readU32())); f = f.add(0x28).readPointer(); }
      cls = cls.add(0x40).readPointer();
    }
    log('fim');
  } catch (e) { log('erro: ' + e); }
}, 0);
})();
