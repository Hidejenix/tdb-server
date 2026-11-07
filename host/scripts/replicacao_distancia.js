// replicacao_distancia.js (2026-11-06) - COMPLEMENTO do replicacao.js / replicacao_donos.js: relevancia POR DISTANCIA.
// Problema (medido 06/11 11:33, sonda_zumbis.js): os 150 Zombie_C do servidor sao replicaveis (bReplicates=1, RemoteRole=1, NetCull 150 m,
// NetUpdateFrequency 5) mas nao sao bAlwaysRelevant nem do cliente -> nenhum laco nosso os replicava. No cliente existem as copias de nivel
// (atores de inicializacao do mapa) paradas onde o mapa as poe; os do servidor andam e atacam sem o cliente ver ("imoveis" + "invisiveis").
// Regra do motor imitada (AActor::IsNetRelevantFor): ator replicavel, nao "so do dono", a menos de sqrt(NetCullDistanceSquared) do viewer.
// Como funciona (tudo incremental para nao travar a thread do jogo):
//   1) varredura dos niveis, LOTE_VARR atores/quadro -> lista de CANDIDATOS (replicavel, nao always, nao onlyOwner, com RootComponent);
//   2) avaliacao de distancia, LOTE_DIST candidatos/quadro, por conexao (viewer = pawn do cliente) -> conjunto PERTO (entra a < cull,
//      sai a > 1.2*cull); 3) a cada CAD_REPL quadros replica o conjunto PERTO de cada conexao (ate MAX_PERTO).
// Mesmo caminho por ator do replicacao.js: PreReplication -> FindActorChannelRef -> CreateChannelByName -> SetChannelActor -> ReplicateActor.
// Ao sair do alcance (1,2x cull) o canal e FECHADO (v2), e o cliente apaga a copia.
(function () {
'use strict';
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send({ tdb: '[dist] ' + m }); }
const RVA = { fnamePool: 0x7c27980, gEngine: 0x7e20ea8, tickFlush: 0x42f3650, callPreReplication: 0x3d3beb0, makeWeak: 0x24382c0,
  findActorChannelRef: 0x4052f30, createChannelByName: 0x42d10a0, setChannelActor: 0x4033210, isActorReady: 0x40227a0,
  initReplicatedComponents: 0x3d70170, replicateActor: 0x402ec70 };
const OFF = { objClass: 0x10, objName: 0x18, engWorldList: 0xec0, engWorldListNum: 0xec8, ctxWorld: 0x2c0, worldNetDriver: 0x38, worldLevels: 0x170,
  drvServerConn: 0x98, drvClientConns: 0xa0, vtIsLevelInit: 0x438, connPC: 0x30, pcPawn: 0x2d0,
  actFlags58: 0x58, actFlags5b: 0x5b, actFlags5d: 0x5d, actRemoteRole: 0x68, actCullSq: 0x168, actRoot: 0x198, sceneRelLoc: 0x128, chFlags: 0x30 };
const PAUSA_VARR = 300;   // ~10-20 s no tick atual entre varreduras completas
let fimVarr = 0;
const LOTE_VARR = 1000, LOTE_DIST = 400, CAD_REPL = 2, MAX_PERTO = 250, MAX_CAND = 20000, MAX_ERROS = 50, SAI = 1.2;

const pool = B.add(RVA.fnamePool);
function findFName(target) {
  for (let block = 0; block < 512; block++) {
    const bp = pool.add(0x10).add(block * 8).readPointer(); if (bp.isNull()) break;
    let units = 0;
    while (units < 65536) {
      const e = bp.add(units * 2), h = e.readU16(), wide = (h & 1) !== 0, len = h >>> 6;
      if (len <= 0 || len > 1024) break;
      if (len === target.length) { let s = null; try { s = wide ? e.add(2).readUtf16String(len) : e.add(2).readUtf8String(len); } catch (x) {} if (s === target) return ((block << 16) | units) >>> 0; }
      units += ((2 + len * (wide ? 2 : 1)) + 1) >> 1;
    }
  }
  return -1;
}
function fnameStr(i) { try { const b = pool.add(0x10).add((i >>> 16) * 8).readPointer(); const e = b.add((i & 0xffff) * 2); const h = e.readU16(); const l = h >>> 6; return (h & 1) ? e.add(2).readUtf16String(l) : e.add(2).readUtf8String(l); } catch (x) { return '?'; } }
function classe(o) { try { return fnameStr(o.add(OFF.objClass).readPointer().add(OFF.objName).readU32()); } catch (x) { return '?'; } }

const fPre = new NativeFunction(B.add(RVA.callPreReplication), 'void', ['pointer', 'pointer']);
const fWeak = new NativeFunction(B.add(RVA.makeWeak), 'pointer', ['pointer', 'pointer']);
const fFind = new NativeFunction(B.add(RVA.findActorChannelRef), 'pointer', ['pointer', 'pointer']);
const fCreate = new NativeFunction(B.add(RVA.createChannelByName), 'pointer', ['pointer', 'pointer', 'uint32', 'int32']);
const fSetActor = new NativeFunction(B.add(RVA.setChannelActor), 'void', ['pointer', 'pointer', 'uint32']);
const fReady = new NativeFunction(B.add(RVA.isActorReady), 'uint8', ['pointer']);
const fInitComps = new NativeFunction(B.add(RVA.initReplicatedComponents), 'void', ['pointer']);
const fRepl = new NativeFunction(B.add(RVA.replicateActor), 'int64', ['pointer']);

const weak = Memory.alloc(16), nomeActor = Memory.alloc(8);
let idxActor = -1, idxWorld = -1, drv = ptr(0), world = ptr(0), quadros = 0, erros = 0, desligado = false, offActors = -1;
let candidatos = [];                 // lista pronta (ultima varredura completa)
let candSet = new Set();             // mesmos atores, para checar rapido se ainda valem
let varr = null;                     // varredura em curso { nivel, idx, lista, total, t0 }
let iDist = 0;                       // cursor da avaliacao de distancia
const perto = new Map();             // conn(str) -> Map(ator(str) -> ator)
const stats = { repl: 0, canais: 0, semNivel: 0, porClasse: {}, fechados: 0, fechPorClasse: {} };

function acharDriver() {
  const eng = B.add(RVA.gEngine).readPointer();
  if (eng.isNull() || eng.add(OFF.engWorldListNum).readS32() < 1) return false;
  const w = eng.add(OFF.engWorldList).readPointer().readPointer().add(OFF.ctxWorld).readPointer();
  if (w.isNull() || w.add(OFF.objClass).readPointer().add(OFF.objName).readU32() !== idxWorld) return false;
  const d = w.add(OFF.worldNetDriver).readPointer();
  if (d.isNull() || classe(d) !== 'IpNetDriver' || !d.add(OFF.drvServerConn).readPointer().isNull()) return false;
  world = w; drv = d; log('driver de listen: ' + d + ' mundo ' + w); return true;
}
function acharOffActors() {
  const L = world.add(0x30).readPointer();
  for (let o = 0x80; o <= 0x120; o += 8) {
    try { const d = L.add(o).readPointer(), n = L.add(o + 8).readS32();
      if (n > 0 && n < 200000 && !d.isNull()) { const a0 = d.readPointer(); if (!a0.isNull() && classe(a0).indexOf('WorldSettings') >= 0) { offActors = o; log('ULevel::Actors em +0x' + o.toString(16)); return; } } } catch (e) {}
  }
  log('ULevel::Actors nao achado'); desligado = true;
}
function replicavel(a) {
  if (a.isNull()) return false;
  if ((a.add(OFF.actFlags5d).readU8() & 1) !== 0) return false;
  if (((a.add(OFF.actFlags5b).readU8() >> 3) & 1) === 0) return false;
  return a.add(OFF.actRemoteRole).readU8() !== 0;
}
function local(a) { const r = a.add(OFF.actRoot).readPointer(); if (r.isNull()) return null; const p = r.add(OFF.sceneRelLoc); return [p.readDouble(), p.add(8).readDouble(), p.add(16).readDouble()]; }

function passoVarredura() {
  const v = varr;
  const lv = world.add(OFF.worldLevels).readPointer(), nl = world.add(OFF.worldLevels + 8).readS32();
  let feitos = 0;
  while (v.nivel < nl && v.nivel < 8192 && feitos < LOTE_VARR) {
    const L = lv.add(v.nivel * 8).readPointer();
    if (L.isNull()) { v.nivel++; v.idx = 0; continue; }
    const arr = L.add(offActors).readPointer(), n = L.add(offActors + 8).readS32();
    if (v.idx >= n || v.idx >= 200000) { v.nivel++; v.idx = 0; continue; }
    const j = v.idx++; feitos++; v.total++;
    try {
      const a = arr.add(j * 8).readPointer(); if (a.isNull()) continue;
      const f58 = a.add(OFF.actFlags58).readU8();
      if ((f58 >> 3) & 1) continue;            // bAlwaysRelevant: ja e do replicacao.js
      if ((f58 >> 2) & 1) continue;            // bOnlyRelevantToOwner: e do replicacao_donos.js
      if (!replicavel(a)) continue;
      if (a.add(OFF.actRoot).readPointer().isNull()) continue;
      if (v.lista.length < MAX_CAND) v.lista.push(a);
    } catch (e) {}
  }
  if (v.nivel >= nl || v.nivel >= 8192) {
    const antes = candidatos.length; candidatos = v.lista; iDist = 0; varr = null;
    candSet = new Set(candidatos.map(a => a.toString()));
    if (antes !== candidatos.length) {
      const pc = {}; for (const a of candidatos) { const c = classe(a); pc[c] = (pc[c] || 0) + 1; }
      const top = Object.keys(pc).sort((x, y) => pc[y] - pc[x]).slice(0, 12).map(k => k + ':' + pc[k]).join(', ');
      log('candidatos: ' + candidatos.length + ' (varridos ' + v.total + ' em ' + (Date.now() - v.t0) + ' ms) | ' + top);
    }
  }
}
function passoDistancia(conexoes) {
  if (!candidatos.length) return;
  const viewers = [];
  for (const x of conexoes) { if (x.pawn.isNull()) continue; try { const p = local(x.pawn); if (p) viewers.push({ k: x.c.toString(), c: x.c, pc: x.pc, pawn: x.pawn, p }); } catch (e) {} }
  if (!viewers.length) return;
  for (let n = 0; n < LOTE_DIST && n < candidatos.length; n++) {
    if (iDist >= candidatos.length) iDist = 0;
    const a = candidatos[iDist++];
    try {
      if (!replicavel(a)) { for (const v of viewers) { const m = perto.get(v.k); if (m) m.delete(a.toString()); } continue; }
      const p = local(a); if (!p) continue;
      const cull = Math.sqrt(a.add(OFF.actCullSq).readFloat());
      for (const v of viewers) {
        let m = perto.get(v.k); if (!m) { m = new Map(); perto.set(v.k, m); }
        const d = Math.hypot(p[0] - v.p[0], p[1] - v.p[1], p[2] - v.p[2]), s = a.toString();
        const kp = v.k + '|' + s;
        if (d <= cull) { if (!m.has(s) && m.size < MAX_PERTO) m.set(s, a); if (pendentes.has(kp)) pendentes.delete(kp); }
        else if (d > cull * SAI && m.has(s)) { m.delete(s); if (!preservado(a)) pendentes.set(kp, { t: Date.now(), v, a }); }
      }
    } catch (e) {}
  }
}
// v2 (06/11 15:10): FECHA o canal quando o ator sai do alcance (motivo Relevancy = 3), como o ServerReplicateActors do motor faria.
// Sem isso o cliente ficava com a copia congelada na ultima posicao: zumbis do pool que voltavam ao deposito continuavam "parados" na
// tela do jogador, que atirava neles e o dano ia para o zumbi verdadeiro, longe (medido 15:07: ReceivePointDamage em zumbis que nao eram
// os que atacavam). UChannel::Close e o virtual +0x2c8 (achado no Ghidra em FUN_1445011c0: Close(bTearOff ? 4 : 0)).
// Nao fecha atores do proprio jogador (dono = PC/pawn), que o replicacao_donos.js reabriria logo em seguida.
// v3 (06/11 22:20): bug "cai no limbo ao voltar do terreno para Woodberry" (medido 22:05 e 22:10, monitor_posicao.js): no teleporte o
// pawn some de perto da porta e o canal da BP_HouseGateTeleport era fechado na hora (viewer = pawn), apagando a porta no cliente no meio
// da sequencia dela (cutscene/tela preta/timer/PickSpawnPointLocal); o cliente nao carregava Woodberry, caia e o save gravava a queda.
// O motor mede pela camera e so fecha depois de RelevantTimeout (5 s). Agora: (1) portas/saidas/teleportes nunca tem o canal fechado;
// (2) os demais so fecham depois de GRACA_MS fora do alcance (cancelado se voltar).
const GRACA_MS = 8000;
const PRESERVAR = /Teleport|Door|Gate|Exit/;
const pendentes = new Map();         // conn|ator -> { t, v, a }
const cachePreserv = new Map();      // classe -> bool
function preservado(a) {
  const c = classe(a); let r = cachePreserv.get(c);
  if (r === undefined) { r = PRESERVAR.test(c); cachePreserv.set(c, r); if (r) log('classe preservada (canal nao fecha): ' + c); }
  return r;
}
function processarPendentes(conexoes) {
  if (!pendentes.size) return;
  const agora = Date.now();
  const vivas = new Map(); for (const x of conexoes) vivas.set(x.c.toString(), x);
  for (const [k, p] of pendentes) {
    if (agora - p.t < GRACA_MS) continue;
    pendentes.delete(k);
    const x = vivas.get(p.v.k); if (!x) continue;                  // conexao caiu: nada a fechar (e o ponteiro nao vale mais)
    if (!candSet.has(p.a.toString())) continue;                    // ator saiu da lista de candidatos (pode ter sido destruido)
    fecharCanal({ k: p.v.k, c: x.c, pc: x.pc, pawn: x.pawn }, p.a);
  }
}
function fecharCanal(v, a) {
  try {
    const dono = a.add(0x140).readPointer();
    if (!dono.isNull() && (dono.equals(v.pawn) || dono.equals(v.pc))) return;
    fWeak(weak, a);
    const ch = fFind(v.c, weak);
    if (ch.isNull() || (ch.add(OFF.chFlags).readU8() & 2) !== 0) return;
    new NativeFunction(ch.readPointer().add(0x2c8).readPointer(), 'int64', ['pointer', 'uint8'])(ch, 3);
    stats.fechados = (stats.fechados || 0) + 1;
    const c = classe(a); stats.fechPorClasse[c] = (stats.fechPorClasse[c] || 0) + 1;
    if (stats.fechPorClasse[c] <= 3) log('canal FECHADO (saiu do alcance): ' + c + ' @' + a);
  } catch (e) { log('erro fechando canal de ' + classe(a) + ': ' + e); }
}
function replicar(conn, a) {
  try {
    if (!replicavel(a)) return;
    fPre(a, drv); fWeak(weak, a);
    let ch = fFind(conn, weak);
    if (ch.isNull()) {
      const ok = new NativeFunction(drv.readPointer().add(OFF.vtIsLevelInit).readPointer(), 'uint8', ['pointer', 'pointer', 'pointer'])(drv, a, conn);
      if (!ok) { stats.semNivel++; return; }
      ch = fCreate(conn, nomeActor, 2, -1);
      if (ch.isNull()) { log('CreateChannelByName nulo para ' + classe(a)); return; }
      fSetActor(ch, a, 0); stats.canais++;
      const c = classe(a); stats.porClasse[c] = (stats.porClasse[c] || 0) + 1;
      if (stats.porClasse[c] <= 3) log('canal aberto (distancia): ' + c + ' @' + a);
    }
    if ((ch.add(OFF.chFlags).readU8() & 2) !== 0) return;
    if (!fReady(ch)) fInitComps(a);
    fRepl(ch); stats.repl++;
  } catch (e) {
    erros++; log('erro replicando ' + classe(a) + ': ' + e);
    if (erros >= MAX_ERROS) { desligado = true; log('DESLIGADO: erros demais'); }
  }
}

Interceptor.attach(B.add(RVA.tickFlush), {
  onEnter(args) {
    if (desligado) return;
    try {
      if (idxActor < 0 || idxWorld < 0) { idxActor = findFName('Actor'); idxWorld = findFName('World'); nomeActor.writeU32(idxActor); nomeActor.add(4).writeU32(0); if (idxActor < 0) { desligado = true; log('FName Actor nao achado'); } return; }
      if (drv.isNull()) { if (!acharDriver()) return; acharOffActors(); if (desligado) return; }
      if (!args[0].equals(drv)) return;
      quadros++;
      const conns = drv.add(OFF.drvClientConns).readPointer(), nc = drv.add(OFF.drvClientConns + 8).readS32();
      const conexoes = [];
      for (let i = 0; i < nc && i < 16; i++) { const c = conns.add(i * 8).readPointer(); if (c.isNull()) continue; const pc = c.add(OFF.connPC).readPointer(); if (pc.isNull()) continue; conexoes.push({ c, pc, pawn: pc.add(OFF.pcPawn).readPointer() }); }
      // 06/11 (leve): uma varredura completa, depois pausa de PAUSA_VARR quadros antes da proxima (antes varria sem parar).
      if (varr === null && (candidatos.length === 0 || quadros - fimVarr >= PAUSA_VARR)) varr = { nivel: 0, idx: 0, lista: [], total: 0, t0: Date.now() };
      if (varr !== null) { passoVarredura(); if (varr === null) fimVarr = quadros; }
      if (conexoes.length) passoDistancia(conexoes);
      processarPendentes(conexoes);
      if (quadros % CAD_REPL === 0) for (const x of conexoes) { const m = perto.get(x.c.toString()); if (m) for (const a of m.values()) replicar(x.c, a); }
      if (quadros % 1800 === 1) {
        let tam = ''; for (const [k, m] of perto) tam += ' ' + k + '=' + m.size;
        log('quadro ' + quadros + ': candidatos=' + candidatos.length + ' perto:' + (tam || ' -') + ' ReplicateActor=' + stats.repl + ' canais=' + stats.canais + ' fechados=' + stats.fechados + ' semNivel=' + stats.semNivel + ' erros=' + erros);
      }
    } catch (e) { erros++; log('erro no laco: ' + e); if (erros >= MAX_ERROS) { desligado = true; log('DESLIGADO: erros demais'); } }
  }
});
log('pronto: relevancia por distancia (TickFlush 0x' + RVA.tickFlush.toString(16) + ')');
})();
