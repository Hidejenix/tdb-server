// sonda_aparencia.js (2026-11-07) - SOMENTE LEITURA no host: a aparencia de cada jogador como o SERVIDOR a tem.
// Investiga "personagem sem cabeca para os outros" (o dono ve a cabeca; os outros clientes nao).
// O dono le a aparencia no Firestore, aplica em si e manda UpdateSaveCharactersServer(FS_SaveStructure); o servidor guarda em
// GI_Character_Save_Ref (pawn+0x2798, replicado, sem OnRep) e repassa UpdateSaveCharactersMulticast aos outros.
// Se Face/Hair/... estiverem NULOS aqui, a referencia ao asset nao foi resolvida no servidor -> os outros recebem nulo.
// Mostra tambem as malhas que os componentes do pawn tem de fato no servidor (Mesh e filhos anexados).
// Uma linha por jogador a cada 15 s e na hora em que algo muda.
(function () {
'use strict';
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send({ tdb: '[aparencia] ' + m }); }
const pool = B.add(0x7c27980);
function fn(i) { try { const b = pool.add(0x10).add((i >>> 16) * 8).readPointer(); const e = b.add((i & 0xffff) * 2); const h = e.readU16(); const l = h >>> 6; return (h & 1) ? e.add(2).readUtf16String(l) : e.add(2).readUtf8String(l); } catch (x) { return '?'; } }
function nome(o) { try { return o.isNull() ? 'NULO' : fn(o.add(0x18).readU32()); } catch (e) { return '?'; } }
function classe(o) { try { return nome(o.add(0x10).readPointer()); } catch (e) { return '?'; } }
function fstr(p) { try { const d = p.readPointer(), n = p.add(8).readS32(); if (d.isNull() || n <= 0 || n > 200) return '?'; return d.readUtf16String(n - 1); } catch (e) { return '?'; } }
// FS_SaveStructure (S_SaveStructure_structs.hpp): Face 0x0, Beard 0x8, Body 0x10, Hair 0x18, Legs 0x20, Head(mat) 0x48, BodyLegs(mat) 0x50, Woman 0x68
const SAVE = 0x2798, IS_FEMALE = 0x2968, MESH = 0x318, SKINNED = 0x5b0, FILHOS = 0xc0;
function salvo(p) {
  const s = p.add(SAVE);
  const r = ['Face', 0, 'Beard', 8, 'Body', 0x10, 'Hair', 0x18, 'Legs', 0x20, 'HeadMat', 0x48, 'BodyLegsMat', 0x50];
  const out = [];
  for (let i = 0; i < r.length; i += 2) out.push(r[i] + '=' + nome(s.add(r[i + 1]).readPointer()));
  out.push('Woman=' + s.add(0x68).readU8());
  return out.join(' ');
}
function malhas(p) {
  const out = [];
  const m = p.add(MESH).readPointer(); if (m.isNull()) return 'Mesh NULO';
  out.push('Mesh=' + nome(m.add(SKINNED).readPointer()));
  const arr = m.add(FILHOS).readPointer(), n = m.add(FILHOS + 8).readS32();
  for (let i = 0; i < n && i < 40; i++) {
    const c = arr.add(i * 8).readPointer(); if (c.isNull()) continue;
    const cl = classe(c); if (cl.indexOf('SkeletalMeshComponent') < 0) continue;
    out.push(nome(c) + '=' + nome(c.add(SKINNED).readPointer()));
  }
  return out.join(' ');
}
const ant = new Map();
let n = 0, erroVisto = false;
setInterval(function () {
  try {
    n++;
    const w = B.add(0x7e20ea8).readPointer().add(0xec0).readPointer().readPointer().add(0x2c0).readPointer();
    const drv = w.add(0x38).readPointer(); if (drv.isNull()) return;
    const conns = drv.add(0xa0).readPointer(), nc = drv.add(0xa8).readS32();
    for (let i = 0; i < nc && i < 32; i++) {
      const c = conns.add(i * 8).readPointer(); if (c.isNull()) continue;
      const pc = c.add(0x30).readPointer(); if (pc.isNull()) continue;
      const ps = pc.add(0x298).readPointer();
      const quem = ps.isNull() ? 'conn' + i : fstr(ps.add(0x388));
      const pawn = pc.add(0x2d0).readPointer(); if (pawn.isNull()) continue;
      const lin = 'SteamID=' + (ps.isNull() ? '?' : fstr(ps.add(0x580))) + ' ' + classe(pawn) + ' IsFemale=' + pawn.add(IS_FEMALE).readU8() + ' | SALVO: ' + salvo(pawn) + ' | COMPONENTES: ' + malhas(pawn);
      const k = pc.toString();
      if (ant.get(k) !== lin || n % 15 === 0) { log(quem + ': ' + lin); ant.set(k, lin); }
    }
  } catch (e) { if (!erroVisto) { erroVisto = true; log('erro: ' + e); } }
}, 1000);
log('pronto: aparencia dos jogadores no servidor (somente leitura)');
})();
