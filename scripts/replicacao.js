// replicacao.js (2026-11-05) - laco de replicacao que falta no exe (UNetDriver::ServerReplicateActors virou `xor eax,eax; ret`).
// Roda no TickFlush do driver de listen (thread do jogo), no mesmo ponto em que o motor chamaria ServerReplicateActors.
// Por ator, segue FReplayHelper::ReplicateActor (ReplayHelper.cpp:1816-1860) e InternalProcessRemoteFunctionPrivate (NetDriver.cpp:2000-2014):
//   CallPreReplication -> FindActorChannelRef -> (IsLevelInitializedForActor -> CreateChannelByName(Actor) -> SetChannelActor) -> ReplicateActor
// Atores: por conexao, PlayerController, Pawn, PlayerState e GameState (todo quadro); atores bAlwaysRelevant dos niveis (a cada N quadros).
// Requer o listen ja aberto (listen_nativo.js). Enderecos verificados no Ghidra em 05/11.
(function () {
'use strict';
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send({ tdb: '[repl] ' + m }); }

const RVA = {
  fnamePool: 0x7c27980, gEngine: 0x7e20ea8,
  tickFlush: 0x42f3650,            // UNetDriver::TickFlush (vtable +0x358)
  callPreReplication: 0x3d3beb0,   // AActor::CallPreReplication(Actor, Driver)
  makeWeak: 0x24382c0,             // FWeakObjectPtr(out, obj)
  findActorChannelRef: 0x4052f30,  // UNetConnection::FindActorChannelRef(conn, &weak)
  createChannelByName: 0x42d10a0,  // UNetConnection::CreateChannelByName(conn, &FName, flags, index)
  setChannelActor: 0x4033210,      // UActorChannel::SetChannelActor(ch, actor, flags)
  isActorReady: 0x40227a0,         // UActorChannel::IsActorReadyForReplication(ch)
  initReplicatedComponents: 0x3d70170, // FSubObjectRegistryGetter::InitReplicatedComponentsList(actor)
  replicateActor: 0x402ec70,       // UActorChannel::ReplicateActor(ch) -> int64 bits
};
const OFF = {
  objClass: 0x10, objName: 0x18,
  engWorldList: 0xec0, engWorldListNum: 0xec8, ctxWorld: 0x2c0,
  worldNetDriver: 0x38, worldGameState: 0x158, worldLevels: 0x170,
  drvServerConn: 0x98, drvClientConns: 0xa0, drvReplicationFrame: 0x448, vtIsLevelInit: 0x438,
  connPC: 0x30, connViewTarget: 0x90, connOpenChannels: 0x70,
  pcPawn: 0x2d0, pcPlayerState: 0x298,
  actFlags58: 0x58, actFlags5b: 0x5b, actFlags5d: 0x5d, actRemoteRole: 0x68,
  chFlags: 0x30,
};
const CAD_EXTRAS = 10;          // atores sempre relevantes: a cada 10 quadros do driver
const REFAZ_LISTA = 200;        // relista atores dos niveis a cada 200 quadros
const MAX_EXTRAS = 150;
const MAX_ERROS = 50;

const pool = B.add(RVA.fnamePool);
function findFName(target) {
  for (let block = 0; block < 512; block++) {
    const bp = pool.add(0x10).add(block * 8).readPointer();
    if (bp.isNull()) break;
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

const weak = Memory.alloc(16);
const nomeActor = Memory.alloc(8);
let idxActor = -1, idxWorld = -1;
let drv = ptr(0), world = ptr(0);
let quadros = 0, erros = 0, desligado = false;
let extras = [];
const visto = {};          // ator -> ja logado
const stats = { repl: 0, bits: 0, canais: 0, semNivel: 0 };

function acharDriver() {
  const eng = B.add(RVA.gEngine).readPointer();
  if (eng.isNull() || eng.add(OFF.engWorldListNum).readS32() < 1) return false;
  const ctx = eng.add(OFF.engWorldList).readPointer().readPointer();
  const w = ctx.add(OFF.ctxWorld).readPointer();
  if (w.isNull() || w.add(OFF.objClass).readPointer().add(OFF.objName).readU32() !== idxWorld) return false;
  const d = w.add(OFF.worldNetDriver).readPointer();
  if (d.isNull() || classe(d) !== 'IpNetDriver' || !d.add(OFF.drvServerConn).readPointer().isNull()) return false;
  world = w; drv = d;
  log('driver de listen: ' + d + ' mundo ' + w);
  return true;
}

function replicavel(a) {
  if (a.isNull()) return false;
  if ((a.add(OFF.actFlags5d).readU8() & 1) !== 0) return false;      // pending kill / tear off (mesmo teste do ProcessRemoteFunction)
  if (((a.add(OFF.actFlags5b).readU8() >> 3) & 1) === 0) return false; // bReplicates
  return a.add(OFF.actRemoteRole).readU8() !== 0;                       // RemoteRole != None
}

function replicar(conn, a, rotulo) {
  if (!replicavel(a)) return;
  try {
    fPre(a, drv);
    fWeak(weak, a);
    let ch = fFind(conn, weak);
    if (ch.isNull()) {
      const okNivel = new NativeFunction(drv.readPointer().add(OFF.vtIsLevelInit).readPointer(), 'uint8', ['pointer', 'pointer', 'pointer'])(drv, a, conn);
      if (!okNivel) { stats.semNivel++; return; }
      ch = fCreate(conn, nomeActor, 2, -1);
      if (ch.isNull()) { log('CreateChannelByName nulo para ' + classe(a)); return; }
      fSetActor(ch, a, 0);
      stats.canais++;
      log('canal aberto: ' + rotulo + ' ' + classe(a) + ' ch=' + ch + ' (' + classe(ch) + ')');
    }
    if ((ch.add(OFF.chFlags).readU8() & 2) !== 0) return;               // canal fechando
    if (!fReady(ch)) fInitComps(a);
    const bits = fRepl(ch);
    stats.repl++; stats.bits += Number(bits);
    const k = a.toString();
    if (!visto[k] && Number(bits) > 0) { visto[k] = true; log('replicado ' + rotulo + ' ' + classe(a) + ': ' + bits + ' bits'); }
  } catch (e) {
    erros++;
    log('erro replicando ' + rotulo + ' ' + classe(a) + ': ' + e);
    if (erros >= MAX_ERROS) { desligado = true; log('DESLIGADO: erros demais'); }
  }
}

function listarExtras() {
  const lista = [];
  const lv = world.add(OFF.worldLevels).readPointer(), nl = world.add(OFF.worldLevels + 8).readS32();
  for (let i = 0; i < nl && i < 4096 && lista.length < MAX_EXTRAS; i++) {
    const L = lv.add(i * 8).readPointer();
    if (L.isNull()) continue;
    const arr = L.add(offActors).readPointer(), n = L.add(offActors + 8).readS32();
    for (let j = 0; j < n && j < 100000 && lista.length < MAX_EXTRAS; j++) {
      const a = arr.add(j * 8).readPointer();
      try { if (!a.isNull() && ((a.add(OFF.actFlags58).readU8() >> 3) & 1) && replicavel(a)) lista.push(a); } catch (e) {}
    }
  }
  return lista;
}
// ULevel::Actors nao e UPROPERTY: acha o TArray cujo elemento 0 e o WorldSettings (regra do UE)
let offActors = -1;
function acharOffActors() {
  const L = world.add(0x30).readPointer();   // PersistentLevel
  for (let o = 0x80; o <= 0x120; o += 8) {
    try { const d = L.add(o).readPointer(), n = L.add(o + 8).readS32();
      if (n > 0 && n < 200000 && !d.isNull()) { const a0 = d.readPointer(); if (!a0.isNull() && classe(a0).indexOf('WorldSettings') >= 0) { offActors = o; log('ULevel::Actors em +0x' + o.toString(16) + ' (' + n + ' atores no nivel persistente)'); return; } } } catch (e) {}
  }
  log('ULevel::Actors nao achado: so os atores essenciais serao replicados');
}

Interceptor.attach(B.add(RVA.tickFlush), {
  onEnter(args) {
    if (desligado) return;
    try {
      if (idxActor < 0 || idxWorld < 0) { idxActor = findFName('Actor'); idxWorld = findFName('World'); nomeActor.writeU32(idxActor); nomeActor.add(4).writeU32(0); if (idxActor < 0) { desligado = true; log('FName Actor nao achado'); } return; }
      if (drv.isNull()) { if (!acharDriver()) return; acharOffActors(); }
      if (!args[0].equals(drv)) return;
      quadros++;
      drv.add(OFF.drvReplicationFrame).writeS32(drv.add(OFF.drvReplicationFrame).readS32() + 1);   // ServerReplicateActors faz ReplicationFrame++
      const conns = drv.add(OFF.drvClientConns).readPointer(), nc = drv.add(OFF.drvClientConns + 8).readS32();
      if (offActors >= 0 && (quadros === 1 || quadros % REFAZ_LISTA === 0)) { extras = listarExtras(); log('atores sempre relevantes listados: ' + extras.length); }
      const gs = world.add(OFF.worldGameState).readPointer();
      for (let i = 0; i < nc && i < 16; i++) {
        const conn = conns.add(i * 8).readPointer();
        if (conn.isNull()) continue;
        const pc = conn.add(OFF.connPC).readPointer();
        if (pc.isNull()) continue;                                  // ainda sem Join
        const pawn = pc.add(OFF.pcPawn).readPointer();
        if (conn.add(OFF.connViewTarget).readPointer().isNull()) conn.add(OFF.connViewTarget).writePointer(pawn.isNull() ? pc : pawn);
        replicar(conn, pc, 'PC');
        if (!pawn.isNull()) replicar(conn, pawn, 'Pawn');
        replicar(conn, pc.add(OFF.pcPlayerState).readPointer(), 'PlayerState');
        if (!gs.isNull()) replicar(conn, gs, 'GameState');
        if (quadros % CAD_EXTRAS === 0) for (const a of extras) replicar(conn, a, 'extra');
      }
      if (quadros === 1 || quadros % 600 === 0) {
        log('quadro ' + quadros + ': conexoes=' + nc + ' ReplicateActor=' + stats.repl + ' bits=' + stats.bits + ' canais novos=' + stats.canais + ' sem nivel=' + stats.semNivel + ' erros=' + erros);
      }
    } catch (e) {
      erros++; log('erro no laco: ' + e);
      if (erros >= MAX_ERROS) { desligado = true; log('DESLIGADO: erros demais'); }
    }
  }
});
log('pronto: laco no TickFlush (0x' + RVA.tickFlush.toString(16) + ')');
})();
