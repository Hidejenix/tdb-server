// teste_harness.js - roda DEPOIS do replicacao_otimizada.js (carregado com `var TDB_TESTE = true`) num processo qualquer.
// Monta um mundo falso (GObjects, driver, conexao, PC, pawn, arma, PlayerState, GameState, zumbi, porta, loot, ator sempre relevante),
// funcoes falsas do motor que contam chamadas, e roda quadros simulados a 40 q/s pelo tdb_tick_teste.
(function () {
'use strict';
const O = globalThis.TDB_OTIM;
const QPF = 10000000, FPS = 40;
function out(m) { send({ t: m }); }
let falhas = 0;
function confere(ok, txt) { out((ok ? 'OK    ' : 'FALHA ') + txt); if (!ok) falhas++; }
// tudo que o C le precisa continuar referenciado no JS (senao o Frida libera a memoria na coleta de lixo)
const GUARDA = []; globalThis.__guardaTeste = GUARDA;
function zerado(n) { const p = Memory.alloc(n); p.writeByteArray(new Uint8Array(n)); GUARDA.push(p); return p; }

function cenario(opts) {
  opts = opts || {};
  const mem = O.alocar(); globalThis.__ultMem = mem;
  // GObjects falsa
  const NOBJ = 4096, gobj = zerado(0x20), chunks = zerado(8), chunk = zerado(NOBJ * 0x18);
  chunks.writePointer(chunk); gobj.writePointer(chunks); gobj.add(0x14).writeS32(NOBJ); gobj.add(0x1c).writeS32(1);
  let prox = 0;
  function obj(n) { const o = zerado(n || 0x400); const i = prox++; o.add(0xc).writeS32(i); chunk.add(i * 0x18).writePointer(o); return o; }
  function matar(o) { chunk.add(o.add(0xc).readS32() * 0x18 + 8).writeS32(1 << 21); }
  const nomeCls = new Map();
  function cls(n) { const c = zerado(0x40); nomeCls.set(c.toString(), n); return c; }
  const nomeAtor = new Map();
  function ator(nome, o) {
    const a = obj(0x400);
    a.add(0x10).writePointer(cls(nome)); a.add(0x5b).writeU8(8); a.add(0x68).writeU8(1); a.add(0x58).writeU8(o.f58 || 0);
    const cull = o.cull || 15000; a.add(0x168).writeFloat(cull * cull); a.add(0x170).writeFloat(o.freq); if (o.dorm) a.add(0x151).writeU8(o.dorm);
    const r = zerado(0x200); a.add(0x198).writePointer(r);
    if (o.dono) a.add(0x140).writePointer(o.dono);
    nomeAtor.set(a.toString(), nome); mover(a, o.x || 0);
    return a;
  }
  function mover(a, x) { const r = a.add(0x198).readPointer().add(0x128); r.writeDouble(x); r.add(8).writeDouble(0); r.add(16).writeDouble(0); }

  // contadores das funcoes falsas do motor
  const repl = {}, abertos = {}, fechados = {}, eventos = {};
  const canais = new Map(), chAtor = new Map(), chConn = new Map();
  let criando = null;
  const nome = a => nomeAtor.get(a.toString()) || '?';
  const keep = [];
  let nomeCb = 0;
  function cb(f, r, a) {
    const id = ++nomeCb;
    const c = new NativeCallback(function () {
      try { return f.apply(null, arguments); }
      catch (e) { out('ERRO no callback #' + id + ' (' + a.join(',') + '): ' + e + ' args=' + Array.prototype.map.call(arguments, String).join(' ')); throw e; }
    }, r, a);
    keep.push(c); return c;
  }
  const vtCh = zerado(0x400);
  vtCh.add(0x2c8).writePointer(cb(function (ch, motivo) {
    const a = chAtor.get(ch.toString()); const n = nome(a);
    fechados[n] = (fechados[n] || 0) + 1; canais.delete(chConn.get(ch.toString()) + '|' + a); return 0;
  }, 'int64', ['pointer', 'uint8']));
  const vtDrv = zerado(0x500);
  vtDrv.add(0x438).writePointer(cb(function () { return 1; }, 'uint8', ['pointer', 'pointer', 'pointer']));
  const simb = {
    tdb_evento: cb(function (t) { eventos[t] = (eventos[t] || 0) + 1; }, 'void', ['int', 'int', 'pointer', 'int64']),
    tdb_classificar: cb(function (c) { return /Teleport|Door|Gate|Exit/.test(nomeCls.get(c.toString()) || '') ? 1 : 0; }, 'int', ['pointer']),
    tdb_pre: cb(function () {}, 'void', ['pointer', 'pointer']),
    tdb_weak: cb(function (o, a) { o.writePointer(a); return o; }, 'pointer', ['pointer', 'pointer']),
    tdb_find: cb(function (c, w) { return canais.get(c + '|' + w.readPointer()) || ptr(0); }, 'pointer', ['pointer', 'pointer']),
    tdb_create: cb(function (c) { const ch = zerado(0x40); ch.writePointer(vtCh); criando = c; return ch; }, 'pointer', ['pointer', 'pointer', 'uint32', 'int32']),
    tdb_setactor: cb(function (ch, a) { canais.set(criando + '|' + a, ch); chAtor.set(ch.toString(), a); chConn.set(ch.toString(), criando.toString()); const n = nome(a); abertos[n] = (abertos[n] || 0) + 1; }, 'void', ['pointer', 'pointer', 'uint32']),
    tdb_ready: cb(function () { return 1; }, 'uint8', ['pointer']),
    tdb_initcomps: cb(function () {}, 'void', ['pointer']),
    tdb_repl: cb(function (ch) { const n = nome(chAtor.get(ch.toString())); repl[n] = (repl[n] || 0) + 1; return 100; }, 'int64', ['pointer']),
    tdb_qpc: cb(function (p) { p.writeS64(0); return 1; }, 'int', ['pointer']),
  };
  const cm = O.montar(simb, mem);
  GUARDA.push(cm, mem, simb, keep);
  O.configurar(mem, QPF);
  const vset = (n, x) => { const p = mem.v.add(O.V[n] * 8); if (x instanceof NativePointer) p.writePointer(x); else p.writeS64(x); };
  const vget = n => mem.v.add(O.V[n] * 8).readS64().toNumber();
  if (opts.semFrequencia) vset('GATING', 0);
  if (opts.maxPerto) vset('MAXPERTO', opts.maxPerto);
  if (opts.maxNovos) vset('MAXNOVOS', opts.maxNovos);

  // mundo
  const pc = ator('PC', { freq: 100, f58: 4 });
  const pawn = ator('Pawn', { freq: 100, dono: pc });
  const arma = ator('Arma', { freq: 100, dono: pawn });
  const ps = ator('PlayerState', { freq: 1, f58: 8, dono: pc });
  const gs = ator('GameState', { freq: 10, f58: 8 });
  const extra = ator('SempreRelevante', { freq: 10, f58: 8 });
  const zumbi = ator('Zombie_C', { freq: 5, x: 1000 });
  const porta = ator('BP_HouseGateTeleport_C', { freq: 5, x: 1000 });
  const loot = ator('Loot', { freq: 5, x: 20000 });
  const bau = ator('Bau_LootPoint', { freq: 2, f58: 8, dorm: 2 });   // MPMainContainerBox: sempre relevante, DormantAll, 2/s
  const baus = [];
  for (let i = 0; i < (opts.baus || 0); i++) baus.push(ator('BauExtra' + i, { freq: 2, f58: 8, dorm: 2 }));
  const zumbisExtra = [];
  for (let i = 0; i < (opts.zumbisExtra || 0); i++) zumbisExtra.push(ator('ZumbiExtra' + i, { freq: 5, x: 500 + i * 1000 }));
  pc.add(0x2d0).writePointer(pawn); pc.add(0x298).writePointer(ps);
  const filhos = zerado(8); filhos.writePointer(arma); pawn.add(0x188).writePointer(filhos); pawn.add(0x190).writeS32(1);
  const lista = [pc, pawn, arma, ps, gs, extra, zumbi, porta, loot, bau].concat(zumbisExtra, baus);
  const atores = zerado(lista.length * 8); lista.forEach((a, i) => atores.add(i * 8).writePointer(a));
  const nivel = zerado(0x200); nivel.add(0x98).writePointer(atores); nivel.add(0xa0).writeS32(lista.length);
  const niveis = zerado(8); niveis.writePointer(nivel);
  const mundo = zerado(0x400); mundo.add(0x170).writePointer(niveis); mundo.add(0x178).writeS32(1); mundo.add(0x158).writePointer(gs);
  const conn = zerado(0x100); conn.add(0x30).writePointer(pc);
  const conns = zerado(8); conns.writePointer(conn);
  const drv = zerado(0x500); drv.writePointer(vtDrv); drv.add(0xa0).writePointer(conns); drv.add(0xa8).writeS32(1);
  mem.nome_actor.writeU32(1); mem.nome_actor.add(4).writeU32(0);
  vset('GOBJ', gobj); vset('DRV', drv); vset('WORLD', mundo); vset('OFFACT', 0x98);
  const tickF = new NativeFunction(cm.tdb_tick_teste, 'void', ['int64'], (typeof TDB_PROPAGA !== 'undefined') ? { exceptions: 'propagate' } : {});
  let quadro = 0;
  function rodar(n) { for (let i = 0; i < n; i++) { quadro++; tickF(Math.round(quadro * QPF / FPS)); } }
  function zerar() { for (const o of [repl, abertos, fechados]) for (const k in o) delete o[k]; }
  const acordar = new NativeFunction(cm.tdb_acordar, 'void', ['pointer']);
  return { cm, mem, rodar, zerar, repl, abertos, fechados, eventos, mover, matar, zumbi, porta, loot, arma, pawn, conn, drv, vget, zumbisExtra, keep, bau, baus, acordar };
}

if (typeof TDB_DEBUG !== 'undefined') { globalThis.__cenario = cenario; globalThis.__out = out; return; }
try {
  // 1) compila + tamanho do struct (montar() ja confere 32 bytes)
  const c = cenario();
  out('modulo C compilado; struct Ent = 40 bytes');

  // 2) 10 s com frequencia
  c.rodar(10 * FPS);
  const r = c.repl;
  out('10 s COM frequencia: ' + JSON.stringify(r));
  confere(r['Zombie_C'] >= 40 && r['Zombie_C'] <= 55, 'zumbi (5/s) replicado ~50x em 10 s: ' + r['Zombie_C']);
  confere(r['BP_HouseGateTeleport_C'] >= 40 && r['BP_HouseGateTeleport_C'] <= 55, 'porta (5/s) ~50x: ' + r['BP_HouseGateTeleport_C']);
  confere(!r['Loot'], 'loot a 200 m (fora dos 150 m) nao replicado');
  confere(r['Arma'] >= 190 && r['Arma'] <= 201, 'arma do jogador (100/s, lista donos a cada 2 quadros) ~200x: ' + r['Arma']);
  confere(r['Pawn'] >= 390 && r['Pawn'] <= 400, 'pawn (100/s, todo quadro; tambem esta em donos/perto) sem duplicar, <=400: ' + r['Pawn']);
  confere(r['PlayerState'] >= 35 && r['PlayerState'] <= 45, 'PlayerState (1/s -> piso 4/s) ~40x: ' + r['PlayerState']);
  confere(r['GameState'] >= 85 && r['GameState'] <= 101, 'GameState (10/s) ~100x: ' + r['GameState']);
  confere(r['SempreRelevante'] >= 35 && r['SempreRelevante'] <= 41, 'sempre relevante (10/s, lista a cada 10 quadros) ~40x: ' + r['SempreRelevante']);
  confere(c.drv.add(0x448).readS32() === 400, 'ReplicationFrame++ por quadro: ' + c.drv.add(0x448).readS32());
  confere(c.conn.add(0x90).readPointer().equals(c.pawn), 'ViewTarget da conexao = pawn');
  const totalCom = Object.values(r).reduce((x, y) => x + y, 0);

  // 3) zumbi e porta saem do alcance (300 m): zumbi fecha so depois de 8 s; porta nunca fecha
  c.zerar(); c.mover(c.zumbi, 30000); c.mover(c.porta, 30000);
  c.rodar(7 * FPS);
  confere(!c.fechados['Zombie_C'], 'zumbi longe: canal ainda aberto aos 7 s (carencia de 8 s)');
  const replLonge = c.repl['Zombie_C'] || 0;
  confere(replLonge <= 1, 'zumbi longe: parou de ser replicado (' + replLonge + ')');
  c.rodar(2 * FPS);
  confere(c.fechados['Zombie_C'] === 1, 'zumbi longe: canal fechado 1x depois de 8 s: ' + (c.fechados['Zombie_C'] || 0));
  confere(!c.fechados['BP_HouseGateTeleport_C'], 'porta/teleporte: canal NUNCA fechado');

  // 4) volta antes da carencia: nao fecha
  c.zerar(); c.mover(c.zumbi, 1000); c.rodar(2 * FPS);
  confere((c.abertos['Zombie_C'] || 0) === 1 && (c.repl['Zombie_C'] || 0) >= 1, 'zumbi voltou: canal reaberto na hora e replicado');
  c.zerar(); c.mover(c.zumbi, 30000); c.rodar(4 * FPS); c.mover(c.zumbi, 1000); c.rodar(8 * FPS);
  confere(!c.fechados['Zombie_C'], 'zumbi saiu e voltou em 4 s: canal NAO fechado');

  // 5) ator destruido (flag Garbage na GObjects): nao e mais tocado, sem quebrar
  c.zerar(); c.matar(c.zumbi); c.rodar(3 * FPS);
  confere(!c.repl['Zombie_C'] && !c.fechados['Zombie_C'], 'zumbi destruido: nenhuma chamada sobre ele');
  confere((c.repl['Arma'] || 0) > 0, 'o resto continua replicando depois do ator destruido');

  // 6) mesmo cenario SEM frequencia (como o host/ atual) para comparar
  const s = cenario({ semFrequencia: true });
  s.rodar(10 * FPS);
  out('10 s SEM frequencia: ' + JSON.stringify(s.repl));
  const totalSem = Object.values(s.repl).reduce((x, y) => x + y, 0);
  confere(s.repl['Zombie_C'] >= 195, 'sem frequencia o zumbi vai a cada 2 quadros (~200x): ' + s.repl['Zombie_C']);
  out('ReplicateActor em 10 s: SEM frequencia=' + totalSem + ', COM frequencia=' + totalCom + ' (' + (100 * (1 - totalCom / totalSem)).toFixed(0) + '% menos)');

  // 8) bau de loot dormente (DormantAll): 1 envio ao abrir o canal, depois so a releitura de 10 s; acordado = envio no quadro seguinte
  const d = cenario();
  d.rodar(9 * FPS);
  confere((d.repl['Bau_LootPoint'] || 0) === 1, 'bau dormente: 1 envio em 9 s (so ao abrir o canal): ' + (d.repl['Bau_LootPoint'] || 0));
  d.zerar(); d.acordar(d.bau); d.rodar(1);
  confere((d.repl['Bau_LootPoint'] || 0) === 1, 'bau acordado (FlushNetDormancy): reenviado no quadro seguinte: ' + (d.repl['Bau_LootPoint'] || 0));
  d.zerar(); d.rodar(2 * FPS);
  confere((d.repl['Bau_LootPoint'] || 0) <= 1, 'depois de acordado volta a dormir (<=1 envio em 2 s): ' + (d.repl['Bau_LootPoint'] || 0));
  d.zerar(); d.rodar(10 * FPS);
  confere((d.repl['Bau_LootPoint'] || 0) >= 1 && (d.repl['Bau_LootPoint'] || 0) <= 2, 'releitura de seguranca a cada 10 s: ' + (d.repl['Bau_LootPoint'] || 0));

  // 9) limite e freio: 300 baus sempre relevantes (antes o limite era 150), no maximo 8 canais novos por quadro
  const f = cenario({ baus: 300, maxNovos: 8 });
  f.rodar(1);
  const ab1 = Object.values(f.abertos).reduce((x, y) => x + y, 0);
  confere(ab1 <= 8, 'freio: no 1o quadro abriu ' + ab1 + ' canais (max 8)');
  f.rodar(60);
  const abBaus = Object.keys(f.abertos).filter(k => k.indexOf('BauExtra') === 0).length;
  confere(abBaus === 300, 'limite: os 300 baus sempre relevantes ganharam canal em 61 quadros: ' + abBaus);

  // 7) prioridade: lista cheia (MAXPERTO=4) fica com os mais perto
  const p = cenario({ maxPerto: 4, zumbisExtra: 6 });
  p.rodar(3 * FPS);
  const perto = []; const n = p.mem.perto_n.readS32();
  for (let i = 0; i < n; i++) perto.push(p.mem.perto.add(i * 8).readPointer());
  const dist = perto.map(a => a.add(0x198).readPointer().add(0x128).readDouble());
  out('lista perto (cap 4): distancias ' + JSON.stringify(dist));
  confere(n === 4 && Math.max.apply(null, dist) <= 1500, 'lista cheia guarda os 4 mais perto (<= 15 m)');

  out(falhas ? ('RESULTADO: ' + falhas + ' FALHA(S)') : 'RESULTADO: TUDO OK');
} catch (e) {
  const m = globalThis.__ultMem, vv = n => (m ? m.v.add(O.V[n] * 8).readS64() : '?');
  out('ERRO: ' + e + ' | PASSO=' + vv('PASSO') + ' FRAME=' + vv('FRAME') + ' NCAND=' + vv('NCAND') + ' SC_ATIVO=' + vv('SC_ATIVO') + ' SC_NIVEL=' + vv('SC_NIVEL') + ' SC_IDX=' + vv('SC_IDX') + '\n' + (e.stack || ''));
}
send({ fim: true });
})();
