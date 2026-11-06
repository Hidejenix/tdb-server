(function () {
'use strict';
/**
 * Diagnóstico do cliente (somente leitura): registra chamadas de UFunction de travel/join
 * (OpenLevel, ServerTravel, ClientTravel, JoinToServer, ServerSelectd, Browse) via ProcessEvent,
 * e procura nos parâmetros textos com o endereço do servidor (127.0.0.1 / 7777 / 46.148).
 * Não altera argumentos nem retorno.
 */
function plog(msg) { console.log('[pe] ' + msg); send({ tdb: '[pe] ' + msg }); }
const main = Process.getModuleByName('TheDayBefore.exe');
const fnamePool = main.base.add(0x7c27980);
const processEvent = main.base.add(0x24077b0);
const RE = /OpenLevel|Travel|JoinToServer|ServerSelectd|Browse|Connect|Server/i;
function fname(idx) {
  try {
    const block = (idx >>> 16) & 0xffff, off = idx & 0xffff;
    const bp = fnamePool.add(0x10).add(block * 8).readPointer();
    const e = bp.add(off * 2); const h = e.readU16(); const len = h >>> 6;
    if (len <= 0 || len > 1024) return '?';
    return (h & 1) ? e.add(2).readUtf16String(len) : e.add(2).readUtf8String(len);
  } catch (x) { return '?'; }
}
function objName(p) { try { return fname(p.add(0x18).readU32()); } catch (x) { return '?'; } }
let n = 0;
Interceptor.attach(processEvent, {
  onEnter(args) {
    const fn = objName(args[1]);
    if (!RE.test(fn)) return;
    n++;
    if (n > 300) return;
    const parms = args[2];
    const achados = [];
    for (let off = 0; off < 0x100; off += 8) {
      try {
        const p = parms.add(off).readPointer();
        if (p.isNull() || p.compare(0x10000) < 0) continue;
        const s = p.readUtf16String(60);
        if (s && /127\.0\.0\.1|7777|46\.148|NewCity|Mainmenu|:/.test(s)) achados.push('+' + off.toString(16) + '="' + s + '"');
      } catch (e) {}
    }
    plog('UFunction ' + fn + ' ' + (achados.length ? achados.join(' ') : '(sem texto de servidor)'));
  }
});
plog('monitor de UFunction de travel armado');
})();
