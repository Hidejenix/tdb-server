(function () {
'use strict';
/**
 * Redirecionamento do join no pool de nomes (FName), em memoria. Reiniciar o cliente desfaz.
 * O OpenLevel do GI_Survival (JoinToServer) usa o nome fixo "46.148.232.119" (oficial, fora do ar).
 * Trocamos o TEXTO desse FName por "0.0.0.0:11111" (13 caracteres; no Windows 0.0.0.0 cai no
 * proprio computador), atualizando o tamanho no cabecalho. Nao altera arquivos do jogo.
 * Feito uma vez, no primeiro ServerSelectd (antes do OpenLevel).
 */

function flog(msg) {
  console.log('[fname] ' + msg);
  send({ tdb: '[fname] ' + msg });
}

const main = Process.getModuleByName('TheDayBefore.exe');
const fnamePool = main.base.add(0x7c27980);
const processEvent = main.base.add(0x24077b0);
const OLD = '46.148.232.119';
// Destino do join. Padrao: host no mesmo PC. Host remoto (VPS): o cliente_conecta.py injeta `var TDB_HOST = '<ip>';` antes deste
// script. O texto novo e gravado POR CIMA do FName antigo, entao nao pode passar de 14 caracteres (o tamanho de '46.148.232.119'):
// um IPv4 sozinho cabe (a porta padrao 7777 e usada); 'ip:porta' so cabe se o IP for curto.
let NEW = '127.0.0.1:7777';
if (typeof TDB_HOST !== 'undefined' && TDB_HOST) {
  if (TDB_HOST.length <= OLD.length) NEW = TDB_HOST;
  else flog('AVISO: host "' + TDB_HOST + '" tem mais de ' + OLD.length + ' caracteres; usando ' + NEW);
}
let done = false;

function asciiBytes(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
  return out;
}

function hexPattern(s) {
  return asciiBytes(s).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join(' ');
}

function patchFName() {
  const pattern = hexPattern(OLD);
  let found = 0;
  for (let block = 0; block < 8192; block++) {
    let blockPtr;
    try {
      blockPtr = fnamePool.add(0x10).add(block * 8).readPointer();
    } catch (e) {
      break;
    }
    if (blockPtr.isNull()) continue;
    let hits = [];
    try {
      hits = Memory.scanSync(blockPtr, 0x20000, pattern);
    } catch (e) {
      continue;
    }
    for (let h = 0; h < hits.length; h++) {
      const textAddr = hits[h].address;
      const headerAddr = textAddr.sub(2);
      const header = headerAddr.readU16();
      const len = header >>> 6;
      const isWide = (header & 1) !== 0;
      if (isWide || len !== OLD.length) continue;
      // Escreve o novo texto e ajusta o tamanho no cabecalho (mantem os bits baixos).
      const newBytes = asciiBytes(NEW);
      for (let i = 0; i < newBytes.length; i++) textAddr.add(i).writeU8(newBytes[i]);
      textAddr.add(newBytes.length).writeU8(0);
      headerAddr.writeU16(((NEW.length << 6) | (header & 0x3f)) & 0xffff);
      found++;
      flog('FName "' + OLD + '" trocado para "' + NEW + '" (bloco ' + block + ')');
    }
    if (found > 0) break;
  }
  if (found === 0) flog('FName "' + OLD + '" nao encontrado no pool');
  return found > 0;
}

// 06/11 (modo leve): solta o hook de ProcessEvent depois da troca (antes ficava chamando JS em toda UFunction do jogo).
const peListener = Interceptor.attach(processEvent, {
  onEnter(args) {
    if (done) return;
    let fn = '?';
    try {
      const idx = args[1].add(0x18).readS32();
      const block = (idx >>> 16) & 0xffff;
      const offset = idx & 0xffff;
      const blockPtr = fnamePool.add(0x10).add(block * 8).readPointer();
      const entry = blockPtr.add(offset * 2);
      const header = entry.readU16();
      const len = header >>> 6;
      fn = entry.add(2).readUtf8String(len);
    } catch (e) {}
    if (fn === 'ServerSelectd') {
      done = true;
      try {
        patchFName();
      } catch (e) {
        flog('erro: ' + e);
      }
      setTimeout(function () { try { peListener.detach(); flog('hook de ProcessEvent solto'); } catch (e) {} }, 0);
    }
  }
});

flog('redirecionamento por FName armado (gatilho: ServerSelectd)');
})();
