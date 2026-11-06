// replicacao_donos.js (2026-11-06) - COMPLEMENTO do replicacao.js (nao o substitui; carregar junto, no mesmo host).
// Problema: replicacao.js so replica PC, Pawn, PlayerState, GameState e atores bAlwaysRelevant. Atores criados pelo pawn
// (arma BP_Weapon_C, equipamentos) nunca chegam ao cliente: BPC_Equipment.WeaponReference replicada resolve para nulo (cliente "semArma").
// Aqui: por conexao, replica os atores cujo AActor::Owner (+0x140) e o PC ou o pawn do cliente, ou cujo dono e dono-de-dono (ate 4 niveis).
// Regra do motor imitada: IsNetRelevantFor -> o dono do ator e o PC/pawn do viewer (bOnlyRelevantToOwner / owner relevancy).
// Mesmo caminho do replicacao.js por ator: PreReplication -> FindActorChannelRef -> CreateChannelByName -> SetChannelActor -> ReplicateActor.
// Lista de donos refeita por varredura incremental (a cada 300 quadros, 1000 atores por quadro); replica a cada 2 quadros. Enderecos: os do replicacao.js (verificados no Ghidra em 05/11).
(function () {
'use strict';
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send({ tdb: '[donos] ' + m }); }
const RVA = { fnamePool: 0x7c27980, gEngine: 0x7e20ea8, tickFlush: 0x42f3650, callPreReplication: 0x3d3beb0, makeWeak: 0x24382c0,
  findActorChannelRef: 0x4052f30, createChannelByName: 0x42d10a0, setChannelActor: 0x4033210, isActorReady: 0x40227a0,
  initReplicatedComponents: 0x3d70170, replicateActor: 0x402ec70 };
const OFF = { objClass: 0x10, objName: 0x18, engWorldList: 0xec0, engWorldListNum: 0xec8, ctxWorld: 0x2c0, worldNetDriver: 0x38, worldLevels: 0x170,
  drvServerConn: 0x98, drvClientConns: 0xa0, vtIsLevelInit: 0x438, connPC: 0x30, pcPawn: 0x2d0,
  actFlags5b: 0x5b, actFlags5d: 0x5d, actRemoteRole: 0x68, actOwner: 0x140, actChildren: 0x188, chFlags: 0x30 };
const CAD_FILHOS = 10;
// 06/11 (leve): com o caminho rapido pelos filhos, a varredura completa vira so rede de seguranca: a cada 3000 quadros (antes 300).
const CAD_LISTA = 3000, CAD_REPL = 2, MAX_DONOS = 64, MAX_ERROS = 50;

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
let idxActor = -1, idxWorld = -1, drv = ptr(0), world = ptr(0), quadros = 0, erros = 0, desligado = false;
const donos = new Map();           // conn(str) -> [atores]
const visto = {}; const stats = { repl: 0, canais: 0, semNivel: 0 };
let offActors = -1;

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
// Varredura INCREMENTAL (a completa leu ~144 mil atores em ~900 ms = travada na thread do jogo): LOTE atores por quadro.
const LOTE = 1000;
let varr = null;   // { raizes, res, nivel, idx, total, t0 }
function passoVarredura() {
  const v = varr;
  const lv = world.add(OFF.worldLevels).readPointer(), nl = world.add(OFF.worldLevels + 8).readS32();
  let feitos = 0;
  while (v.nivel < nl && v.nivel < 4096 && feitos < LOTE) {
    const L = lv.add(v.nivel * 8).readPointer();
    if (L.isNull()) { v.nivel++; v.idx = 0; continue; }
    const arr = L.add(offActors).readPointer(), n = L.add(offActors + 8).readS32();
    if (v.idx >= n || v.idx >= 200000) { v.nivel++; v.idx = 0; continue; }
    const j = v.idx++; feitos++; v.total++;
    try {
      const a = arr.add(j * 8).readPointer(); if (a.isNull()) continue;
      let o = a.add(OFF.actOwner).readPointer(); if (o.isNull()) continue;
      let alvo = null;
      for (let d = 0; d < 4 && !o.isNull() && alvo === null; d++) {
        const s = o.toString();
        for (const [k, raizes] of v.raizes) { if (raizes.has(s)) { alvo = k; break; } }
        if (alvo === null) o = o.add(OFF.actOwner).readPointer();
      }
      if (alvo !== null && replicavel(a)) { const l = v.res.get(alvo); if (l.length < MAX_DONOS) l.push(a); }
    } catch (e) {}
  }
  if (v.nivel >= nl || v.nivel >= 4096) {
    const dt = Date.now() - v.t0;
    for (const [k, l] of v.res) { const antes = donos.has(k) ? donos.get(k).length : -1; donos.set(k, l); if (antes !== l.length) log('donos da conexao ' + k + ': ' + l.length + ' atores (' + l.slice(0, 8).map(classe).join(',') + ') varridos=' + v.total + ' em ' + dt + ' ms (incremental)'); }
    varr = null;
  }
}
// (versao antiga, completa, nao usada) atores dos niveis cujo dono (cadeia de ate 4 niveis) e um dos "raizes" de uma conexao
function listarDonos(raizesPorConn) {
  const res = new Map(); for (const k of raizesPorConn.keys()) res.set(k, []);
  const lv = world.add(OFF.worldLevels).readPointer(), nl = world.add(OFF.worldLevels + 8).readS32();
  let total = 0;
  for (let i = 0; i < nl && i < 4096; i++) {
    const L = lv.add(i * 8).readPointer(); if (L.isNull()) continue;
    const arr = L.add(offActors).readPointer(), n = L.add(offActors + 8).readS32();
    for (let j = 0; j < n && j < 200000; j++) {
      total++;
      let a;
      try { a = arr.add(j * 8).readPointer(); if (a.isNull()) continue;
        let o = a.add(OFF.actOwner).readPointer(); if (o.isNull()) continue;
        let alvo = null;
        for (let d = 0; d < 4 && !o.isNull() && alvo === null; d++) {
          const s = o.toString();
          for (const [k, raizes] of raizesPorConn) { if (raizes.has(s)) { alvo = k; break; } }
          if (alvo === null) o = o.add(OFF.actOwner).readPointer();
        }
        if (alvo !== null && replicavel(a)) { const l = res.get(alvo); if (l.length < MAX_DONOS) l.push(a); }
      } catch (e) {}
    }
  }
  return { res, total };
}
function replicar(conn, a) {
  if (!replicavel(a)) return;
  try {
    fPre(a, drv); fWeak(weak, a);
    let ch = fFind(conn, weak);
    if (ch.isNull()) {
      const ok = new NativeFunction(drv.readPointer().add(OFF.vtIsLevelInit).readPointer(), 'uint8', ['pointer', 'pointer', 'pointer'])(drv, a, conn);
      if (!ok) { stats.semNivel++; return; }
      ch = fCreate(conn, nomeActor, 2, -1);
      if (ch.isNull()) { log('CreateChannelByName nulo para ' + classe(a)); return; }
      fSetActor(ch, a, 0); stats.canais++;
      log('canal aberto (dono): ' + classe(a) + ' @' + a + ' dono=' + classe(a.add(OFF.actOwner).readPointer()));
    }
    if ((ch.add(OFF.chFlags).readU8() & 2) !== 0) return;
    if (!fReady(ch)) fInitComps(a);
    const bits = fRepl(ch); stats.repl++;
    const k = a.toString();
    if (!visto[k] && Number(bits) > 0) { visto[k] = true; log('replicado (dono) ' + classe(a) + ': ' + bits + ' bits'); }
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
      if (varr === null && quadros % CAD_LISTA === 1 && conexoes.length > 0) {
        const raizes = new Map(), res = new Map();
        for (const x of conexoes) { const s = new Set([x.pc.toString()]); if (!x.pawn.isNull()) s.add(x.pawn.toString()); raizes.set(x.c.toString(), s); res.set(x.c.toString(), []); }
        varr = { raizes, res, nivel: 0, idx: 0, total: 0, t0: Date.now() };
      }
      if (varr !== null) passoVarredura();
      // v2 (06/11 11:25): caminho RAPIDO pelos filhos (AActor::Children +0x188, mantido pelo SetOwner) do PC e do pawn, a cada
      // CAD_FILHOS quadros. Motivo: a varredura incremental leva ~12 s; o cliente abriu o GPS antes da arma chegar e o bug voltou.
      if (quadros % CAD_FILHOS === 0) for (const x of conexoes) {
        const k = x.c.toString(), lista = donos.get(k) || [], ja = new Set(lista.map(String));
        const fila = [x.pc]; if (!x.pawn.isNull()) fila.push(x.pawn);
        let novos = 0;
        for (let d = 0; d < 4 && fila.length; d++) {
          const prox = [];
          for (const o of fila) {
            try {
              const arr = o.add(OFF.actChildren).readPointer(), n = o.add(OFF.actChildren + 8).readS32();
              for (let j = 0; j < n && j < 64; j++) {
                const a = arr.add(j * 8).readPointer();
                if (a.isNull() || ja.has(a.toString())) continue;
                ja.add(a.toString()); prox.push(a);
                if (replicavel(a) && lista.length < MAX_DONOS) { lista.push(a); novos++; }
              }
            } catch (e) {}
          }
          fila.length = 0; for (const a of prox) fila.push(a);
        }
        if (novos) { donos.set(k, lista); log('filhos: +' + novos + ' ator(es) da conexao ' + k + ' (' + lista.slice(-novos).map(classe).join(',') + ')'); }
      }
      if (quadros % CAD_REPL === 0) for (const x of conexoes) { const l = donos.get(x.c.toString()); if (l) for (const a of l) replicar(x.c, a); }
      if (quadros % 1200 === 1) log('quadro ' + quadros + ': ReplicateActor=' + stats.repl + ' canais novos=' + stats.canais + ' sem nivel=' + stats.semNivel + ' erros=' + erros);
    } catch (e) { erros++; log('erro no laco: ' + e); if (erros >= MAX_ERROS) { desligado = true; log('DESLIGADO: erros demais'); } }
  }
});
log('pronto: replicacao por dono (TickFlush 0x' + RVA.tickFlush.toString(16) + ')');
})();

