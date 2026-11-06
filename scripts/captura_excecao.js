// captura_excecao.js (2026-11-06) - SOMENTE LEITURA. Registra excecoes C++ lancadas (RaiseException 0xE06D7363) com o tipo,
// a mensagem what() (se for std::exception) e o backtrace. Motivo: 2a instancia na mesma conta cai com 0xe06d7363 em KERNELBASE+0xc408a.
// Layout MSVC x64: ExceptionInformation = [magic, pObject, pThrowInfo, imageBase]; ThrowInfo+0x0C = RVA CatchableTypeArray;
// CatchableTypeArray = {int n; int rva[n]}; CatchableType+0x04 = RVA TypeDescriptor; TypeDescriptor+0x10 = nome decorado (".?AV...").
(function () {
'use strict';
function log(m) { send({ tdb: '[exc] ' + m }); }
const raise = Process.getModuleByName('KERNELBASE.dll').getExportByName('RaiseException');
let n = 0;
Interceptor.attach(raise, {
  onEnter(a) {
    try {
      if ((a[0].toUInt32() >>> 0) !== 0xE06D7363) return;
      if (++n > 30) return;
      const info = a[3], obj = info.add(8).readPointer(), ti = info.add(16).readPointer(), base = info.add(24).readPointer();
      const tipos = [];
      try {
        const cta = base.add(ti.add(0x0c).readS32()), nt = cta.readS32();
        for (let i = 0; i < nt && i < 6; i++) { const ct = base.add(cta.add(4 + i * 4).readS32()); const td = base.add(ct.add(4).readS32()); tipos.push(td.add(0x10).readCString()); }
      } catch (e) { tipos.push('?(' + e + ')'); }
      let what = '';
      try { const p = obj.add(8).readPointer(); if (!p.isNull()) what = p.readCString(200); } catch (e) {}
      const mod = Process.findModuleByAddress(this.returnAddress);
      const bt = Thread.backtrace(this.context, Backtracer.ACCURATE).slice(0, 12).map(function (x) { const m = Process.findModuleByAddress(x); return m ? m.name + '+0x' + x.sub(m.base).toString(16) : x.toString(); }).join(' < ');
      log('#' + n + ' tipo=' + tipos.join(',') + (what ? ' what="' + what + '"' : '') + ' de ' + (mod ? mod.name : '?') + ' | bt: ' + bt);
    } catch (e) { log('erro: ' + e); }
  }
});
log('pronto: excecoes C++ (RaiseException 0xE06D7363)');
})();
