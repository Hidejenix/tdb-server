// monitor_bugs.js (2026-11-06) - SOMENTE LEITURA, carregado sempre pelo servidor_host.py. Vigia os 2 bugs conhecidos:
//  (1) ITENS/DINHEIRO SUMINDO: decodifica as listas que o cliente manda ao servidor (BPC_SharpSync.UpdateData = inventario,
//      UpdateStash = estoque/bau) e soma inventario+bau por item. Queda que nao volta em 20 s -> linha "ITEM SUMIU?" (venda/uso tambem
//      aparecem: conferir com o que o jogador fez). Tambem registra Cash*/Set_Stash_Money/StashLoader se forem chamados.
//  (2) TIRO EM ZUMBI FANTASMA: em cada Zombie_C.ReceivePointDamage mede a distancia do zumbi ate o jogador mais perto; acima de 30 m
//      -> linha "TIRO EM ZUMBI LONGE" (o cliente acertou uma copia velha). Os fechamentos de canal ja saem no log do replicacao_distancia.
// Desempenho: o filtro do hook de ProcessEvent e em C (CModule): compara o UFunction* com ate 32 alvos e so entao chama o JS.
// Os alvos (UFunction por nome+classe) sao achados na GObjects (base+0x7CCDA10) a cada 20 s ate todos aparecerem (classes de Blueprint
// so carregam junto com o mapa). Logs com o prefixo [bugs] no log do runner.
(function () {
'use strict';
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send({ tdb: '[bugs] ' + m }); }
const pool = B.add(0x7c27980);
function fn(i) { try { const b = pool.add(0x10).add((i >>> 16) * 8).readPointer(); const e = b.add((i & 0xffff) * 2); const h = e.readU16(); const l = h >>> 6; return (h & 1) ? e.add(2).readUtf16String(l) : e.add(2).readUtf8String(l); } catch (x) { return '?'; } }
function nome(o) { return fn(o.add(0x18).readU32()); }
function classe(o) { try { return nome(o.add(0x10).readPointer()); } catch (e) { return '?'; } }
function fstr(p) { try { const d = p.readPointer(), n = p.add(8).readS32(); if (d.isNull() || n <= 0 || n > 4000) return ''; return d.readUtf16String(n - 1); } catch (e) { return '?'; } }
function arrStr(p) { const r = []; try { const d = p.readPointer(), n = p.add(8).readS32(); if (n < 0 || n > 600) return r; for (let i = 0; i < n; i++) r.push(fstr(d.add(i * 16))); } catch (e) {} return r; }
function loc(a) { try { const r = a.add(0x198).readPointer(); if (r.isNull()) return null; const p = r.add(0x128); return [p.readDouble(), p.add(8).readDouble(), p.add(16).readDouble()]; } catch (e) { return null; } }

// ---- alvos: classe -> funcoes ----
const ALVOS = {
  'BPC_SharpSync_C': ['UpdateData', 'UpdateStash', 'StashLoader', 'StashLocal', 'UpdateCash', 'UpdateCashServ', 'CashLoader', 'CashLocal', 'Set_Stash_Money'],
  'Zombie_C': ['ReceivePointDamage'],
};
const porPtr = new Map();   // UFunction ptr (str) -> 'Classe.Funcao'

// ---- filtro nativo ----
// lista de alvos em memoria do JS (gravavel); a memoria do proprio CModule nao aceitou escrita (1a versao nao achava nada)
const alvosArr = Memory.alloc(32 * 8), nAlvos = Memory.alloc(8); nAlvos.writeS32(0);
const notify = new NativeCallback(function (obj, f, parms) { try { tratar(obj, f, parms); } catch (e) {} }, 'void', ['pointer', 'pointer', 'pointer']);
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

function procurarAlvos() {
  const faltam = []; for (const c in ALVOS) for (const f of ALVOS[c]) if (![...porPtr.values()].includes(c + '.' + f)) faltam.push(c + '.' + f);
  if (!faltam.length) return true;
  const arr = B.add(0x7ccda10), objs = arr.readPointer(), num = arr.add(0x14).readS32(), nch = arr.add(0x1c).readS32();
  let novos = 0;
  for (let i = 0; i < num; i++) {
    const ch = (i / 0x10000) | 0; if (ch >= nch) break;
    try {
      const chunk = objs.add(ch * 8).readPointer(); if (chunk.isNull()) continue;
      const o = chunk.add((i % 0x10000) * 0x18).readPointer(); if (o.isNull()) continue;
      const nf = nome(o); let lista = null, cls = null;
      for (const c in ALVOS) if (ALVOS[c].indexOf(nf) >= 0) { cls = c; lista = ALVOS[c]; break; }
      if (!lista || classe(o) !== 'Function') continue;
      const outer = o.add(0x20).readPointer(); if (outer.isNull() || nome(outer) !== cls) continue;
      const k = o.toString(); if (porPtr.has(k)) continue;
      const n = nAlvos.readS32(); if (n >= 32) break;
      alvosArr.add(n * 8).writePointer(o); nAlvos.writeS32(n + 1); porPtr.set(k, cls + '.' + nf); novos++;
    } catch (e) {}
  }
  if (novos) log('alvos vigiados: ' + [...porPtr.values()].join(', '));
  return false;
}

// ---- (1) itens ----
const ultimo = new Map();   // sharpsync(str) -> { inv: [..], est: [..] }
const pendentes = new Map(); // 'sync|item' -> { qtd, t }
function nomeQtd(s) { const m = /^([^:;!]+):(\d+)/.exec(s || ''); return m ? [m[1], parseInt(m[2], 10)] : null; }
function totais(inv, est) {
  const t = {};
  for (const s of inv.concat(est)) { const x = nomeQtd(s); if (!x) continue; if (/^(Equip_|Helmet_|Armor_|Equipment_|Weapon_)/.test(x[0])) { t[x[0]] = (t[x[0]] || 0) + 1; continue; } t[x[0]] = (t[x[0]] || 0) + x[1]; }
  return t;
}
function curto(lista) { return lista.map(s => s.replace(/;[^!]*/, '')).join(' | '); }
function tratarItens(obj, qual, lista) {
  const k = obj.toString();
  let u = ultimo.get(k); if (!u) { u = { inv: null, est: null }; ultimo.set(k, u); }
  const antes = (u.inv && u.est) ? totais(u.inv, u.est) : null;
  if (qual === 'UpdateData') u.inv = lista; else u.est = lista;
  log(qual + ' n=' + lista.length + ' [' + curto(lista) + ']');
  if (!antes || !u.inv || !u.est) return;
  const depois = totais(u.inv, u.est), agora = Date.now();
  for (const it of new Set(Object.keys(antes).concat(Object.keys(depois)))) {
    const a = antes[it] || 0, d = depois[it] || 0, pk = k + '|' + it;
    if (d < a) { const p = pendentes.get(pk); pendentes.set(pk, { qtd: (p ? p.qtd : 0) + (a - d), t: p ? p.t : agora, base: p ? p.base : a }); }
    else if (d > a) { const p = pendentes.get(pk); if (p) { p.qtd -= (d - a); if (p.qtd <= 0) pendentes.delete(pk); } }
  }
}
setInterval(function () {
  const agora = Date.now();
  for (const [pk, p] of pendentes) if (agora - p.t > 20000) { log('ITEM SUMIU? ' + pk.split('|')[1] + ' -' + p.qtd + ' (total inventario+bau era ' + p.base + '; nao voltou em 20 s)'); pendentes.delete(pk); }
}, 5000);

// ---- (2) tiros ----
let nTiros = 0, nLonge = 0;
function jogadorMaisPerto(p) {
  try {
    const eng = B.add(0x7e20ea8).readPointer(); const w = eng.add(0xec0).readPointer().readPointer().add(0x2c0).readPointer();
    const d = w.add(0x38).readPointer(); const conns = d.add(0xa0).readPointer(), nc = d.add(0xa8).readS32();
    let melhor = 1e12;
    for (let i = 0; i < nc && i < 16; i++) { const pc = conns.add(i * 8).readPointer().add(0x30).readPointer(); if (pc.isNull()) continue; const pw = pc.add(0x2d0).readPointer(); if (pw.isNull()) continue; const q = loc(pw); if (!q) continue; melhor = Math.min(melhor, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])); }
    return melhor;
  } catch (e) { return -1; }
}
function tratarTiro(z) {
  nTiros++;
  const p = loc(z); if (!p) return;
  const d = jogadorMaisPerto(p);
  if (d > 3000) { nLonge++; log('TIRO EM ZUMBI LONGE: ' + z + ' a ' + (d / 100).toFixed(0) + ' m do jogador mais perto (Dead=' + z.add(0x680).readU8() + ') -> o cliente acertou uma copia velha'); }
}
setInterval(function () { if (nTiros) log('tiros em zumbis no ultimo minuto: ' + nTiros + ' (longe: ' + nLonge + ')'); nTiros = 0; nLonge = 0; }, 60000);

function tratar(obj, f, parms) {
  const qual = porPtr.get(f.toString()); if (!qual) return;
  const nf = qual.split('.')[1];
  if (nf === 'ReceivePointDamage') { tratarTiro(obj); return; }
  if (nf === 'UpdateData' || nf === 'UpdateStash') { tratarItens(obj, nf, arrStr(parms)); return; }
  if (nf === 'Set_Stash_Money') { log(qual + ' int=' + parms.readS32()); return; }
  log(qual + ' n=' + arrStr(parms).length + ' [' + curto(arrStr(parms)) + ']');
}

Interceptor.attach(B.add(0x24077b0), cm);
// repete a busca a cada 20 s; para quando achar tudo ou quando os essenciais ja estiverem e passarem 10 tentativas (cada busca ~5 s na thread do Frida)
let tentativas = 0;
function essenciais() { const v = [...porPtr.values()]; return ['BPC_SharpSync_C.UpdateData', 'BPC_SharpSync_C.UpdateStash', 'Zombie_C.ReceivePointDamage'].every(x => v.includes(x)); }
const t = setInterval(function () { try { tentativas++; if (procurarAlvos() || (essenciais() && tentativas >= 10)) { clearInterval(t); log('busca de alvos encerrada (' + porPtr.size + ' vigiados)'); } } catch (e) { log('erro procurando alvos: ' + e); } }, 20000);
setTimeout(function () { try { if (procurarAlvos()) log('todos os alvos achados'); } catch (e) { log('erro procurando alvos: ' + e); } }, 0);
log('pronto: itens sumindo + tiro em zumbi fantasma (filtro nativo)');
})();
