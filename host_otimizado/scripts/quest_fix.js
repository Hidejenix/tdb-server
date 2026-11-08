// quest_fix.js (2026-11-07) - HOST: itens de quest nao apareciam (no loot de baus, zumbis e carros das areas de quest).
// Causa (bytecode de BP_QuestItemsSpawnZone, V5\QuestBP; diagnostico confirmado tambem por outro jogador no host dele):
//   ReceiveBeginPlay -> entrada 3025 (Delay 5 s) -> 15: GS.InitLootZones(self) e, so no servidor, UMA vez:
//     183: para cada LootPoint_C que encosta na esfera -> LootPoint.QuestList[quest] += SpawnChance;
//     depois de Delay 10 s: BP_ZombieSpawner_C / BP_CarWithZombie_C que encostam -> SetLinkedQuests(Quests).
//   No host headless o mapa (World Partition) ainda esta carregando 5 s depois do BeginPlay da zona: nenhum bau encosta, e
//   NENHUM LootPoint recebe QuestList -> o servidor nunca sorteia item de quest.
// Correcao: espera o mapa estabilizar (mesma contagem de zonas e de LootPoints em 3 varreduras seguidas, a cada 6 s) e, na thread
// do jogo (TickFlush), chama ExecuteUbergraph_BP_QuestItemsSpawnZone(EntryPoint=183) UMA vez por zona: so o laco que preenche os
// baus (e o que liga spawners/carros 10 s depois). Nao repete o InitLootZones (nada de zona duplicada no GameState), e cada zona e
// processada uma unica vez (cada chamada SOMA a chance no bau). Zonas que aparecerem depois sao processadas quando estabilizar de
// novo. Itens so entram no loot gerado depois disso (baus ja abertos/gerados nao mudam). Prefixo [qfix].
(function () {
'use strict';
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send({ tdb: '[qfix] ' + m }); }
const pool = B.add(0x7c27980);
function fn(i) { try { const b = pool.add(0x10).add((i >>> 16) * 8).readPointer(); const e = b.add((i & 0xffff) * 2); const h = e.readU16(); const l = h >>> 6; return (h & 1) ? e.add(2).readUtf16String(l) : e.add(2).readUtf8String(l); } catch (x) { return '?'; } }
function nome(o) { try { return fn(o.add(0x18).readU32()); } catch (e) { return '?'; } }
function classe(o) { try { return nome(o.add(0x10).readPointer()); } catch (e) { return '?'; } }
const processEvent = new NativeFunction(B.add(0x24077b0), 'void', ['pointer', 'pointer', 'pointer']);
const ENTRADA_BAUS = 183;          // ExecuteUbergraph_BP_QuestItemsSpawnZone: inicio do laco dos LootPoints (depois do InitLootZones)
const QUESTLIST = 0x460;           // AMPMainContainerBox_C.QuestList (TMap<UQuest*, double>); +8 = numero de elementos
const MORTO = (1 << 28) | (1 << 29) | (1 << 21);
const parms = Memory.alloc(16);
globalThis.__tdbQuestFix = { parms };

let fUber = null, fila = [], feitas = new Set(), ultimo = '', iguais = 0, rodadas = 0, ocupado = false;

function varrer() {   // {zonas: [ptr], loot: n, comLista: n}
  const g = B.add(0x7ccda10), objs = g.readPointer(), num = g.add(0x14).readS32(), nch = g.add(0x1c).readS32();
  const zonas = []; let loot = 0, comLista = 0;
  for (let i = 0; i < num; i++) {
    const ch = (i / 0x10000) | 0; if (ch >= nch) break;
    try {
      const it = objs.add(ch * 8).readPointer().add((i % 0x10000) * 0x18);
      const o = it.readPointer(); if (o.isNull()) continue;
      if (it.add(8).readS32() & MORTO) continue;
      const c = classe(o);
      if (c === 'BP_QuestItemsSpawnZone_C') { if (nome(o).indexOf('Default__') !== 0) zonas.push(o); }
      else if (c === 'LootPoint_C') { if (nome(o).indexOf('Default__') !== 0) { loot++; if (o.add(QUESTLIST + 8).readS32() > 0) comLista++; } }
    } catch (e) {}
  }
  return { zonas, loot, comLista };
}

function acharUber(zona) {
  let cls = zona.add(0x10).readPointer();
  for (let n = 0; n < 4 && !cls.isNull(); n++) { let x = cls.add(0x48).readPointer(); for (let k = 0; k < 2000 && !x.isNull(); k++) { if (nome(x) === 'ExecuteUbergraph_BP_QuestItemsSpawnZone') return x; x = x.add(0x28).readPointer(); } cls = cls.add(0x40).readPointer(); }
  return ptr(0);
}

// thread do Frida: espera estabilizar e enfileira as zonas novas
setInterval(function () {
  try {
    if (ocupado || fila.length) return;
    const v = varrer();
    const chave = v.zonas.length + '/' + v.loot;
    if (chave === ultimo) iguais++; else { iguais = 1; ultimo = chave; }
    const novas = v.zonas.filter(z => !feitas.has(z.toString()));
    if (iguais < 3 || v.loot < 100 || novas.length === 0) {
      if (rodadas === 0 && iguais <= 3) log('esperando o mapa estabilizar: zonas=' + v.zonas.length + ' LootPoints=' + v.loot + ' (estavel ' + iguais + '/3)');
      return;
    }
    if (fUber === null) { fUber = acharUber(novas[0]); log(fUber.isNull() ? 'ERRO: ExecuteUbergraph_BP_QuestItemsSpawnZone nao achada' : 'funcao ' + fUber); }
    if (fUber.isNull()) return;
    rodadas++;
    log('mapa estavel (zonas=' + v.zonas.length + ', LootPoints=' + v.loot + ', com QuestList=' + v.comLista + '): preenchendo baus de ' + novas.length + ' zona(s)');
    fila = novas.slice(); ocupado = true;
    setTimeout(function () {
      try { const r = varrer(); log('RESULTADO: LootPoints com QuestList: ' + r.comLista + ' de ' + r.loot + ' (zonas processadas: ' + feitas.size + ')'); } catch (e) {}
      ocupado = false;
    }, 25000);
  } catch (e) { log('erro na varredura: ' + e); }
}, 6000);

// thread do jogo: processa a fila, algumas zonas por quadro
Interceptor.attach(B.add(0x42f3650), {
  onEnter() {
    if (!fila.length || fUber === null || fUber.isNull()) return;
    for (let n = 0; n < 4 && fila.length; n++) {
      const z = fila.shift(); const k = z.toString();
      if (feitas.has(k)) continue;
      feitas.add(k);
      try {
        if (classe(z) !== 'BP_QuestItemsSpawnZone_C') continue;   // destruida entre a varredura e agora
        parms.writeS32(ENTRADA_BAUS);
        processEvent(z, fUber, parms);
      } catch (e) { log('erro na zona ' + z + ': ' + e); }
    }
  }
});
log('pronto: itens de quest (preenche QuestList dos baus quando o mapa estabilizar)');
})();
