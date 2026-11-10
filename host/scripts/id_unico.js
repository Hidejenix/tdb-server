// id_unico.js (2026-11-10) - HOST: itens sumindo do bau (IDs unicos repetidos entre sessoes do servidor).
// Causa (bytecode, ver Aprendizados\APRENDIZADO_TDB_2026-11-10_item_sumiu_bau.md):
//   o cliente pede ID para cada item movido (SurvivalPlayer.RequestUID, RPC no servidor) -> SurvGetUniqueID ->
//   TDB_GameMode.SurvGetUID: UniqueID = UniqueID + 1 (TDB_GameMode_C +0x400). O contador nunca e inicializado com nada salvo:
//   volta a 0 a cada subida do servidor, mas baus/inventarios guardam IDs de sessoes antigas -> dois itens com o mesmo ID ->
//   remover/mover por ID pega o item errado e um deles some (visto 10/11 10:10: Aid_AidKit e Aid_AidKit_Big, ambos ID 12).
// Correcao: assim que o TDB_GameMode existir, o contador passa a comecar de (segundos desde 2026-01-01) * 8, sempre maior que
// qualquer ID dado numa sessao anterior (a nao ser que uma sessao de mais de 8 IDs/s em media; nunca visto). So aumenta, nunca
// diminui. Revisado a cada 10 s porque o GameMode e recriado na viagem para o mapa do jogo. Prefixo [uid].
// IDs repetidos JA gravados no save continuam repetidos (corrigir no Firestore com o jogador desconectado).
(function () {
'use strict';
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send({ tdb: '[uid] ' + m }); }
const pool = B.add(0x7c27980);
function fn(i) { try { const b = pool.add(0x10).add((i >>> 16) * 8).readPointer(); const e = b.add((i & 0xffff) * 2); const h = e.readU16(); const l = h >>> 6; return (h & 1) ? e.add(2).readUtf16String(l) : e.add(2).readUtf8String(l); } catch (x) { return '?'; } }
function nome(o) { try { return fn(o.add(0x18).readU32()); } catch (e) { return '?'; } }
function classe(o) { try { return nome(o.add(0x10).readPointer()); } catch (e) { return '?'; } }
const OFF_UID = 0x400;                       // TDB_GameMode_C.UniqueId (int32), dump do Dumper-7
const MORTO = (1 << 28) | (1 << 29) | (1 << 21);
const BASE_2026 = 1767225600;                // 2026-01-01 00:00:00 UTC
const vistos = new Set();

function semente() { return Math.floor((Date.now() / 1000 - BASE_2026) * 8); }

function acharGameModes() {
  const g = B.add(0x7ccda10), objs = g.readPointer(), num = g.add(0x14).readS32(), nch = g.add(0x1c).readS32();
  const r = [];
  for (let i = 0; i < num; i++) {
    const ch = (i / 0x10000) | 0; if (ch >= nch) break;
    try {
      const it = objs.add(ch * 8).readPointer().add((i % 0x10000) * 0x18);
      const o = it.readPointer(); if (o.isNull()) continue;
      if (it.add(8).readS32() & MORTO) continue;
      if (classe(o) === 'TDB_GameMode_C' && nome(o).indexOf('Default__') !== 0) r.push(o);
    } catch (e) {}
  }
  return r;
}

function revisar() {
  try {
    for (const gm of acharGameModes()) {
      if (vistos.has(gm.toString())) continue;   // uma vez por GameMode (depois o jogo so soma 1)
      const atual = gm.add(OFF_UID).readS32(), s = semente();
      if (atual < s) {
        gm.add(OFF_UID).writeS32(s);
        log('contador de ID do GameMode ' + gm + ': ' + atual + ' -> ' + s + ' (proximos IDs nao repetem os de sessoes anteriores)');
      } else {
        log('contador de ID do GameMode ' + gm + ' ja alto: ' + atual);
      }
      vistos.add(gm.toString());
    }
  } catch (e) { log('erro: ' + e); }
}
revisar();
setInterval(revisar, 10000);
log('pronto: contador de ID dos itens comeca de ' + semente() + ' (antes: 0 a cada subida do servidor)');
})();
