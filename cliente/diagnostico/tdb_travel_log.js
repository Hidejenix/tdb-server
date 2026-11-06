(function () {
'use strict';
/**
 * Diagnóstico do cliente (somente leitura): registra Browse, a decisão de rede (FUN_1446db640),
 * a criação do driver (FUN_144683f90), LoadMap e a inicialização do driver (FUN_1443f49d0).
 * RVAs do mesmo executável (base 0x140000000). Não altera retorno nem argumentos.
 */
function tlog(msg) { console.log('[travel] ' + msg); send({ tdb: '[travel] ' + msg }); }
const main = Process.getModuleByName('TheDayBefore.exe');
Interceptor.attach(main.base.add(0x467e880), {
  onEnter(args) {
    let url = '?';
    try {
      const d = args[2].add(0x28).readPointer();
      url = d.isNull() ? '(vazio)' : d.readUtf16String();
    } catch (e) { url = 'erro ' + e; }
    tlog('Browse ENTER url="' + url + '" a0=' + args[0] + ' a1=' + args[1] + ' a3=' + args[3]);
  },
  onLeave(r) { tlog('Browse LEAVE ret=' + r); }
});
Interceptor.attach(main.base.add(0x46db640), {
  onLeave(r) { tlog('decisao rede (FUN_1446db640) ret=' + r + ' (1=local, 0=rede)'); }
});
Interceptor.attach(main.base.add(0x4717f80), {
  onEnter() { tlog('LoadMap ENTER'); },
  onLeave(r) { tlog('LoadMap LEAVE ret=' + r); }
});
Interceptor.attach(main.base.add(0x4683f90), {
  onLeave(r) { tlog('driver criado (FUN_144683f90) ret=' + r); }
});
Interceptor.attach(main.base.add(0x43f49d0), {
  onEnter() { tlog('init driver ENTER (FUN_1443f49d0)'); },
  onLeave(r) { tlog('init driver LEAVE'); }
});
tlog('monitor de travel do cliente armado');
})();

