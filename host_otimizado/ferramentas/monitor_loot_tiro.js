// monitor_loot_tiro.js (2026-11-07) - SOMENTE LEITURA no host: acompanha LOOT e TIRO entre jogadores para o teste com 2 pessoas.
// Analise estatica (Aprendizados\APRENDIZADO_TDB_2026-11-07_loot_tiro_estatico.md):
//  - LOOT: o cliente pede SERVER_RequestContainerData(baú); o servidor gera/guarda os itens (GetReplicatedData OnlyServer) e responde so
//    a ele com Client_BuildMPContainerData. Pegar item = Server_deleteFromContainerAddToPlayer. Abrir/fechar = ServerCallOpenLoot /
//    ServerCallCloseLoot (LootOpened replicado + FlushNetDormancy + MultiCallOpen/CloseLootPoint). O VISUAL "aberto" depende do canal
//    do baú no cliente; os baús sao bAlwaysRelevant e a nossa lista de sempre relevantes tem LIMITE de 150 -> suspeita principal.
//  - TIRO: o cliente calcula o acerto e manda SendDamage(TArray<FBPS_DamageInfo>) com HitComponent + dano; o servidor faz
//    ApplyPointDamage(dono do HitComponent) -> ReceivePointDamage na vitima -> TakedDamageEvent (RPC para a vitima).
// Por evento: jogador, alvo/baú, estado do baú e QUANTAS CONEXOES TEM CANAL ABERTO para ele. Prefixo [lt]. Carregar:
//   VPS: bash linux/carregar_ferramenta.sh host/ferramentas/monitor_loot_tiro.js     PC: carregar_script_no_host.py <PID> <este arquivo>
(function () {
'use strict';
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send({ tdb: '[lt] ' + m }); }
const pool = B.add(0x7c27980);
function fn(i) { try { const b = pool.add(0x10).add((i >>> 16) * 8).readPointer(); const e = b.add((i & 0xffff) * 2); const h = e.readU16(); const l = h >>> 6; return (h & 1) ? e.add(2).readUtf16String(l) : e.add(2).readUtf8String(l); } catch (x) { return '?'; } }
function nome(o) { try { return fn(o.add(0x18).readU32()); } catch (e) { return '?'; } }
function classe(o) { try { return nome(o.add(0x10).readPointer()); } catch (e) { return '?'; } }
function fstr(p) { try { const d = p.readPointer(), n = p.add(8).readS32(); if (d.isNull() || n <= 0 || n > 200) return '?'; return d.readUtf16String(n - 1); } catch (e) { return '?'; } }
function loc(a) { try { const r = a.add(0x198).readPointer(); if (r.isNull()) return null; const p = r.add(0x128); return [p.readDouble(), p.add(8).readDouble(), p.add(16).readDouble()]; } catch (e) { return null; } }
function dist(a, b) { const p = loc(a), q = loc(b); return (p && q) ? (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / 100).toFixed(1) + ' m' : '?'; }

// conexoes e nomes
function conexoes() {
  const r = [];
  try {
    const w = B.add(0x7e20ea8).readPointer().add(0xec0).readPointer().readPointer().add(0x2c0).readPointer();
    const d = w.add(0x38).readPointer(); const cs = d.add(0xa0).readPointer(), n = d.add(0xa8).readS32();
    for (let i = 0; i < n && i < 16; i++) { const c = cs.add(i * 8).readPointer(); if (c.isNull()) continue; const pc = c.add(0x30).readPointer(); if (pc.isNull()) continue;
      const ps = pc.add(0x298).readPointer(); r.push({ c, pc, pawn: pc.add(0x2d0).readPointer(), nome: ps.isNull() ? 'conn' + i : fstr(ps.add(0x388)) }); }
  } catch (e) {}
  return r;
}
function quem(pawn) { for (const x of conexoes()) if (x.pawn.equals(pawn)) return x.nome; return classe(pawn) + '@' + pawn; }
const fWeak = new NativeFunction(B.add(0x24382c0), 'pointer', ['pointer', 'pointer']);
const fFind = new NativeFunction(B.add(0x4052f30), 'pointer', ['pointer', 'pointer']);
const weak = Memory.alloc(16);
function canais(a) {   // "2/2" = conexoes com canal aberto para o ator / conexoes
  const cs = conexoes(); let n = 0;
  for (const x of cs) { try { fWeak(weak, a); if (!fFind(x.c, weak).isNull()) n++; } catch (e) {} }
  return n + '/' + cs.length;
}
function bau(b) {   // AMPMainContainerBox_C: LootOpened +0x404, DataBuilt +0x388, MPContainerItems TArray +0x300, bAlwaysRelevant (flags58 bit3)
  if (b.isNull()) return 'NULO';
  try { return classe(b) + '@' + b + ' aberto=' + b.add(0x404).readU8() + ' dados=' + b.add(0x388).readU8() + ' itens=' + b.add(0x308).readS32() +
    ' sempreRelev=' + ((b.add(0x58).readU8() >> 3) & 1) + ' canais=' + canais(b); } catch (e) { return '?' + e; }
}

// ---- alvos (classe dona -> funcoes) ----
const ALVOS = {
  'SurvivalPlayer_C': ['SendDamage', 'ReceivePointDamage', 'TakedDamageEvent', 'SERVER_RequestContainerData', 'Client_BuildMPContainerData',
    'ServerCallOpenLoot', 'ServerCallCloseLoot', 'Server_deleteFromContainerAddToPlayer'],
  'SurvivalPlayer_V2_C': ['ReceivePointDamage'],
  'LootPoint_C': ['MultiCallOpenLootPoint', 'MultiCallCloseLootPoint'],
};
const porPtr = new Map();
const alvosArr = Memory.alloc(32 * 8), nAlvos = Memory.alloc(8); nAlvos.writeS32(0);
const notify = new NativeCallback(function (obj, f, parms) { try { tratar(obj, porPtr.get(f.toString()), parms); } catch (e) { log('erro: ' + e); } }, 'void', ['pointer', 'pointer', 'pointer']);
const cm = new CModule(`
#include <gum/guminterceptor.h>
extern void notify (void * obj, void * fn, void * parms);
extern void * alvos[32];
extern int nalvos;
void onEnter (GumInvocationContext * ic)
{
  void * f = gum_invocation_context_get_nth_argument (ic, 1);
  int i;
  for (i = 0; i < nalvos; i++)
    if (alvos[i] == f) { notify (gum_invocation_context_get_nth_argument (ic, 0), f, gum_invocation_context_get_nth_argument (ic, 2)); return; }
}
`, { notify, alvos: alvosArr, nalvos: nAlvos });
globalThis.__tdbMonLootTiro = { cm, notify, alvosArr, nAlvos, weak };   // o Frida libera o que perde referencia (coleta de lixo)

function procurarAlvos() {
  const arr = B.add(0x7ccda10), objs = arr.readPointer(), num = arr.add(0x14).readS32(), nch = arr.add(0x1c).readS32();
  for (let i = 0; i < num; i++) {
    const ch = (i / 0x10000) | 0; if (ch >= nch) break;
    try {
      const chunk = objs.add(ch * 8).readPointer(); if (chunk.isNull()) continue;
      const o = chunk.add((i % 0x10000) * 0x18).readPointer(); if (o.isNull()) continue;
      const nf = nome(o); let cls = null;
      for (const c in ALVOS) if (ALVOS[c].indexOf(nf) >= 0) { const outer = o.add(0x20).readPointer(); if (!outer.isNull() && nome(outer) === c) { cls = c; break; } }
      if (!cls || classe(o) !== 'Function') continue;
      const k = o.toString(); if (porPtr.has(k)) continue;
      const n = nAlvos.readS32(); if (n >= 32) break;
      alvosArr.add(n * 8).writePointer(o); nAlvos.writeS32(n + 1); porPtr.set(k, cls + '.' + nf);
    } catch (e) {}
  }
  log('vigiando ' + porPtr.size + ' funcoes: ' + [...porPtr.values()].map(s => s.split('.')[1]).join(', '));
}

function tratar(obj, qual, p) {
  if (!qual) return;
  const f = qual.split('.')[1];
  if (f === 'SendDamage') {
    const arr = p.readPointer(), n = p.add(8).readS32(), partes = [];
    for (let i = 0; i < n && i < 8; i++) {
      const e = arr.add(i * 0x98), comp = e.add(0x60).readPointer(), alvo = comp.isNull() ? ptr(0) : comp.add(0x20).readPointer();
      partes.push('dano=' + e.readDouble().toFixed(1) + ' alvo=' + (comp.isNull() ? 'NULO (sem canal no atirador?)' : classe(alvo) + (classe(alvo).indexOf('SurvivalPlayer') === 0 ? '(' + quem(alvo) + ') canais=' + canais(alvo) : '') + ' a ' + dist(obj, alvo)));
    }
    log('TIRO ' + quem(obj) + ': SendDamage x' + n + ' | ' + partes.join(' | '));
  } else if (f === 'ReceivePointDamage') {
    log('DANO RECEBIDO ' + quem(obj) + ': ' + p.readFloat().toFixed(1) + ' (osso ' + fn(p.add(0x48).readU32()) + ', causador ' + classe(p.add(0x70).readPointer()) + ')');
  } else if (f === 'TakedDamageEvent') {
    const k = p.add(0x48).readPointer();
    log('AVISO DE DANO para ' + quem(obj) + ': ' + p.readDouble().toFixed(1) + (k.isNull() ? '' : ' de ' + quem(k)) + ' zumbi=' + p.add(0x69).readU8());
  } else if (f === 'SERVER_RequestContainerData') {
    log('LOOT pedido por ' + quem(obj) + ': ' + bau(p.readPointer()) + ' a ' + dist(obj, p.readPointer()));
  } else if (f === 'Client_BuildMPContainerData') {
    log('LOOT enviado a ' + quem(obj) + ': ' + bau(p.readPointer()));
  } else if (f === 'ServerCallOpenLoot' || f === 'ServerCallCloseLoot') {
    log((f === 'ServerCallOpenLoot' ? 'ABRIU' : 'FECHOU') + ' ' + quem(obj) + ': ' + bau(p.readPointer()));
  } else if (f === 'Server_deleteFromContainerAddToPlayer') {
    log('PEGOU ITEM ' + quem(obj) + ': uid=' + p.readS32() + ' restam=' + p.add(0x14).readS32() + ' de ' + bau(p.add(8).readPointer()));
  } else if (f === 'MultiCallOpenLootPoint' || f === 'MultiCallCloseLootPoint') {
    log(f + ' (chega a quem tem canal): ' + bau(obj));
  }
}

Interceptor.attach(B.add(0x24077b0), cm);
setTimeout(function () { try { procurarAlvos(); } catch (e) { log('erro procurando alvos: ' + e); } }, 0);
setTimeout(function () { try { procurarAlvos(); } catch (e) {} }, 30000);   // classes de Blueprint podem carregar depois
log('pronto: loot e tiro (somente leitura)');
})();
