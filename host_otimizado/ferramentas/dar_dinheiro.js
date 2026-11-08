// dar_dinheiro.js (2026-11-06, v5) - ESCRITA no host: entrega dinheiro ao(s) cliente(s) conectado(s).
// O dinheiro do TDB e ITEM ("Trade_Money", tipo 12). O inventario e de widgets (JigsawInventory: PocketContainer etc. sao UJSIContainer_C),
// que so existem no cliente: no servidor GetTotalMoneyCount da 0 e AddMoney/JSAddItem nao tem onde por o item (v1-v4, ver aprendizado).
// v5: o servidor manda o item pelo RPC do proprio jogo SurvivalPlayer.AddItemToPlayer_Client(FFItemInfo) (NetClient, so para o dono).
// FFItemInfo (0x220 bytes) = linha "Trade_Money" do DataTable ItemsDataTable (RowMap: TMap<FName,uint8*> em +0x30 do UDataTable),
// copiada e com Count (+0x50) = VALOR. Chamado via ProcessEvent na thread do jogo (TickFlush), uma vez.
(function () {
'use strict';
const VALOR = 50000;
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send({ tdb: '[dinheiro] ' + m }); }
const pool = B.add(0x7c27980);
function fn(i) { try { const b = pool.add(0x10).add((i >>> 16) * 8).readPointer(); const e = b.add((i & 0xffff) * 2); const h = e.readU16(); const l = h >>> 6; return (h & 1) ? e.add(2).readUtf16String(l) : e.add(2).readUtf8String(l); } catch (x) { return '?'; } }
function nome(o) { return fn(o.add(0x18).readU32()); }
function classe(o) { return nome(o.add(0x10).readPointer()); }
const processEvent = new NativeFunction(B.add(0x24077b0), 'void', ['pointer', 'pointer', 'pointer']);
const parms = Memory.alloc(0x240);
function acharFuncao(obj, nomeF) {
  let cls = obj.add(0x10).readPointer();
  for (let n = 0; n < 8 && !cls.isNull(); n++) { let f = cls.add(0x48).readPointer(); for (let k = 0; k < 3000 && !f.isNull(); k++) { if (nome(f) === nomeF) return f; f = f.add(0x28).readPointer(); } cls = cls.add(0x40).readPointer(); }
  return ptr(0);
}
let linha = null;   // ponteiro para a linha Trade_Money
setTimeout(function () {
  try {
    const arr = B.add(0x7ccda10), objs = arr.readPointer(), num = arr.add(0x14).readS32(), nch = arr.add(0x1c).readS32();
    let dt = ptr(0);
    for (let i = 0; i < num && dt.isNull(); i++) {
      const ch = (i / 0x10000) | 0; if (ch >= nch) break;
      try { const chunk = objs.add(ch * 8).readPointer(); if (chunk.isNull()) continue;
        const o = chunk.add((i % 0x10000) * 0x18).readPointer(); if (o.isNull()) continue;
        if (nome(o) === 'ItemsDataTable' && classe(o) === 'DataTable') dt = o; } catch (e) {}
    }
    if (dt.isNull()) { linha = ptr(0); log('DataTable ItemsDataTable nao achado'); return; }
    const rm = dt.add(0x30), dados = rm.readPointer(), max = rm.add(0xc).readS32();
    log('ItemsDataTable ' + dt + ' RowStruct=' + nome(dt.add(0x28).readPointer()) + ' linhas(max)=' + max);
    for (let i = 0; i < max && i < 20000; i++) {
      const e = dados.add(i * 24);
      try { if (fn(e.readU32()) === 'Trade_Money' && e.add(4).readU32() === 0) { linha = e.add(8).readPointer(); break; } } catch (x) {}
    }
    if (linha === null) { linha = ptr(0); log('linha Trade_Money nao achada'); return; }
    log('linha Trade_Money em ' + linha + ': ItemID=' + linha.readS32() + ' Type=' + linha.add(8).readU8() + ' MaxStack=' + linha.add(0xc).readS32() + ' Count=' + linha.add(0x50).readS32() + ' Name=' + fn(linha.add(0x78).readU32()));
  } catch (e) { linha = ptr(0); log('erro achando a linha: ' + e); }
}, 0);
let drv = ptr(0), feito = false;
const listener = Interceptor.attach(B.add(0x42f3650), {
  onEnter(a) {
    if (feito || linha === null) return;
    try {
      if (linha.isNull()) { feito = true; return; }
      if (drv.isNull()) { if (classe(a[0]) !== 'IpNetDriver' || !a[0].add(0x98).readPointer().isNull()) return; drv = a[0]; }
      if (!a[0].equals(drv)) return;
      feito = true;
      const conns = drv.add(0xa0).readPointer(), nc = drv.add(0xa8).readS32();
      for (let i = 0; i < nc && i < 16; i++) {
        const pc = conns.add(i * 8).readPointer().add(0x30).readPointer(); if (pc.isNull()) continue;
        const pawn = pc.add(0x2d0).readPointer(); if (pawn.isNull() || classe(pawn).indexOf('SurvivalPlayer') !== 0) continue;
        const f = acharFuncao(pawn, 'AddItemToPlayer_Client'); if (f.isNull()) { log('AddItemToPlayer_Client nao achada'); continue; }
        parms.writeByteArray(linha.readByteArray(0x220));
        parms.add(0x50).writeS32(VALOR);
        processEvent(pawn, f, parms);
        log('pawn ' + pawn + ': AddItemToPlayer_Client(Trade_Money x' + VALOR + ') enviado ao cliente');
      }
      setTimeout(function () { try { listener.detach(); } catch (e) {} }, 0);
    } catch (e) { log('erro: ' + e); }
  }
});
log('pronto v5: procurando a linha Trade_Money; depois AddItemToPlayer_Client');
})();
