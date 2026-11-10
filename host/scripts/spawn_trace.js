// spawn_trace.js (2026-11-10) - HOST, so leitura: por que o jogador nasce na sala do doutor (ponto ForBeginner).
// PlayerPlaceholder.PickSpawnPoint usa a sala se SurvPC.GetIsBeginner (NOT TutorialCompleted OR etapa != "DoctorSequence") E a
// etapa estiver vazia ou em KomnataStages; senao usa SurvPC.PlayerLocSave (char.PlayerPosition do save).
// Hipotese: o spawn e decidido antes de o SurvPC carregar o "char" do Firestore (TutorialCompleted=false, etapa ""). Este script
// registra, a cada 1 s, as MUDANCAS desses campos em cada SurvPC; com o [pos] (TROCOU PAWN) da para ver a ordem. Prefixo [spawn].
(function () {
'use strict';
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send({ tdb: '[spawn] ' + m }); }
const pool = B.add(0x7c27980);
function fn(i) { try { const b = pool.add(0x10).add((i >>> 16) * 8).readPointer(); const e = b.add((i & 0xffff) * 2); const h = e.readU16(); const l = h >>> 6; return (h & 1) ? e.add(2).readUtf16String(l) : e.add(2).readUtf8String(l); } catch (x) { return '?'; } }
function nome(o) { try { return fn(o.add(0x18).readU32()); } catch (e) { return '?'; } }
function classe(o) { try { return nome(o.add(0x10).readPointer()); } catch (e) { return '?'; } }
function fstr(p) { try { const d = p.readPointer(), n = p.add(8).readS32(); return (d.isNull() || n <= 0) ? '' : d.readUtf16String(Math.min(n, 400)); } catch (e) { return '?'; } }
const MORTO = (1 << 28) | (1 << 29) | (1 << 21);
// SurvPC_C (Dumper-7): TutorialProgressIndex 0xC70, TutorialCompleted 0xC88, CurrentTutorialStage 0xD70, TutorCheatCompleted 0xE20,
// SuccessfulExits 0xE24, NewCharacterCreated 0xF80, PlayerLocSave 0xFA8. PlayerPlaceholder_C: SpawnedChar 0x370, LoginCompleted 0x3C8.
const ultimo = new Map();

function varrer() {
  const g = B.add(0x7ccda10), objs = g.readPointer(), num = g.add(0x14).readS32(), nch = g.add(0x1c).readS32();
  const pcs = [], pps = [];
  for (let i = 0; i < num; i++) {
    const ch = (i / 0x10000) | 0; if (ch >= nch) break;
    try {
      const it = objs.add(ch * 8).readPointer().add((i % 0x10000) * 0x18);
      const o = it.readPointer(); if (o.isNull()) continue;
      if (it.add(8).readS32() & MORTO) continue;
      const c = classe(o);
      if (c === 'SurvPC_C' && nome(o).indexOf('Default__') !== 0) pcs.push(o);
      else if (c === 'PlayerPlaceholder_C' && nome(o).indexOf('Default__') !== 0) pps.push(o);
    } catch (e) {}
  }
  return { pcs, pps };
}

let rodada = 0;
setInterval(function () {
  try {
    rodada++;
    if (rodada % 2 === 0 && ultimo.size === 0) return;   // sem jogador: varre a cada 2 s
    const v = varrer();
    for (const pc of v.pcs) {
      const k = pc.toString();
      const loc = fstr(pc.add(0xFA8));
      const s = 'completo=' + pc.add(0xC88).readU8() + ' etapa="' + fstr(pc.add(0xD70)) + '" indice=' + pc.add(0xC70).readS32() +
                ' cheat=' + pc.add(0xE20).readU8() + ' saidas=' + pc.add(0xE24).readS32() + ' novo=' + pc.add(0xF80).readU8() +
                ' posSalva=' + (loc ? loc.replace(/Rotation:.*/, '').trim() : '(vazia)');
      if (ultimo.get(k) !== s) { log('SurvPC ' + k + ': ' + s); ultimo.set(k, s); }
    }
    for (const pp of v.pps) {
      const k = pp.toString();
      const s = 'SpawnedChar=' + pp.add(0x370).readPointer() + ' LoginCompleted=' + pp.add(0x3C8).readU8();
      if (ultimo.get(k) !== s) { log('Placeholder ' + k + ': ' + s); ultimo.set(k, s); }
    }
  } catch (e) { log('erro: ' + e); }
}, 1000);
log('pronto: registra tutorial/posicao salva de cada SurvPC (so leitura)');
})();
