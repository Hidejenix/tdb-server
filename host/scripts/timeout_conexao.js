// timeout_conexao.js (2026-11-10) - HOST: jogador caia ao ir para o terreno (tela preta e desconexao).
// Medido (18:45 VPS Brasil, 20:05 VPS EUA): ao entrar no terreno, a tela de carregamento passa, fica preta e o servidor fecha a
// conexao (`Close na conexao`, rva 0x42f2d70) sem nenhum erro antes. O cliente fica parado carregando a area e nao manda pacotes;
// o servidor desiste depois de ConnectionTimeout = 60 s (UNetDriver +0x8C, lido em runtime em 03/11).
// Correcao: ConnectionTimeout do driver de listen = 300 s (o congelamento vira so uma pausa). So leitura/escrita de 1 float, a cada
// 10 s (o driver e criado no F8/listen e pode ser recriado). Prefixo [timeout].
(function () {
'use strict';
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send({ tdb: '[timeout] ' + m }); }
const NOVO = 300.0;
const OFF_INICIAL = 0x88, OFF_CONEXAO = 0x8C;   // UNetDriver: InitialConnectTimeout, ConnectionTimeout (float)
let ultimo = null;
setInterval(function () {
  try {
    const eng = B.add(0x7e20ea8).readPointer(); if (eng.isNull()) return;
    const w = eng.add(0xec0).readPointer().readPointer().add(0x2c0).readPointer(); if (w.isNull()) return;
    const d = w.add(0x38).readPointer(); if (d.isNull()) return;
    const atual = d.add(OFF_CONEXAO).readFloat();
    if (atual < NOVO - 1) {
      d.add(OFF_CONEXAO).writeFloat(NOVO);
      log('driver ' + d + ': ConnectionTimeout ' + atual + ' -> ' + NOVO + ' s (InitialConnectTimeout=' + d.add(OFF_INICIAL).readFloat() + ')');
    } else if (ultimo === null || !ultimo.equals(d)) {
      log('driver ' + d + ': ConnectionTimeout ja ' + atual + ' s');
    }
    ultimo = d;
  } catch (e) {}
}, 10000);
log('pronto: tempo de espera da conexao vai para ' + NOVO + ' s quando o servidor abrir o listen');
})();
