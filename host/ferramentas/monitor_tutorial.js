// monitor_tutorial.js (2026-11-07) - SOMENTE LEITURA: acompanha a troca de estagio do tutorial/quest inicial (host OU cliente).
// Sintoma: o texto do objetivo no HUD (WBP_TutorialObjective, modo tutorial: Context nulo, Current_Stage) fica no estagio antigo,
// enquanto SurvPC.CurrentTutorialStage (replicado, sem OnRep) ja tem o novo. O widget so e avisado por eventos locais disparados
// por RPC para o cliente dono (SetTutorName_Owning, ShowCurrentTutorialState_Client...). Aqui: quem chama o que, no host e no cliente.
// Filtro em C no ProcessEvent (barato). Prefixo [tut]. Host: bash linux/carregar_ferramenta.sh host/ferramentas/monitor_tutorial.js
(function () {
'use strict';
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send({ tdb: '[tut] ' + m }); }
const pool = B.add(0x7c27980);
function fn(i) { try { const b = pool.add(0x10).add((i >>> 16) * 8).readPointer(); const e = b.add((i & 0xffff) * 2); const h = e.readU16(); const l = h >>> 6; return (h & 1) ? e.add(2).readUtf16String(l) : e.add(2).readUtf8String(l); } catch (x) { return '?'; } }
function nome(o) { try { return fn(o.add(0x18).readU32()); } catch (e) { return '?'; } }
function classe(o) { try { return nome(o.add(0x10).readPointer()); } catch (e) { return '?'; } }
function fstr(p) { try { const d = p.readPointer(), n = p.add(8).readS32(); if (d.isNull() || n <= 0 || n > 400) return '""'; return JSON.stringify(d.readUtf16String(n - 1)); } catch (e) { return '?'; } }
function ftext(p) { try { const d = p.readPointer(); if (d.isNull()) return '(vazio)'; for (let o = 8; o <= 0x60; o += 8) { const s = d.add(o).readPointer(), n = d.add(o + 8).readS32(); if (!s.isNull() && n > 1 && n < 400) { try { const t = s.readUtf16String(n - 1); if (t && /\S/.test(t)) return JSON.stringify(t.slice(0, 100)); } catch (e) {} } } return '(?)'; } catch (e) { return '(erro)'; } }
const ALVOS = {
  'SurvPC_C': ['SetTutorialStage', 'SetTutorName_Owning', 'ShowCurrentTutorialState_Client', 'TutorialStart', 'TutorialBegin', 'StartTutorial',
    'EventEndTutorial', 'EndTutorialOwning', 'LoadTutorialstatus', 'CheckTutorialNeedReset', 'InitAllFirstsNPCQuests', 'ShowTutorialQuestMessageCompleted'],
  'WBP_TutorialObjective_C': ['ShowTutorialObjective', 'ShowGeneralObjective', 'OnQuestContextCreated_Event', 'SetQuestText', 'ShowByCachedInfo'],
};
const porPtr = new Map();
const alvosArr = Memory.alloc(64 * 8), nAlvos = Memory.alloc(8); nAlvos.writeS32(0);
const notify = new NativeCallback(function (obj, f, parms) { try { tratar(obj, porPtr.get(f.toString()), parms); } catch (e) { log('erro: ' + e); } }, 'void', ['pointer', 'pointer', 'pointer']);
const cm = new CModule(`
#include <gum/guminterceptor.h>
extern void notify (void * obj, void * fn, void * parms);
extern void * alvos[64];
extern int nalvos;
void onEnter (GumInvocationContext * ic)
{
  void * f = gum_invocation_context_get_nth_argument (ic, 1);
  int i;
  for (i = 0; i < nalvos; i++)
    if (alvos[i] == f) { notify (gum_invocation_context_get_nth_argument (ic, 0), f, gum_invocation_context_get_nth_argument (ic, 2)); return; }
}
`, { notify, alvos: alvosArr, nalvos: nAlvos });
globalThis.__tdbMonTutorial = { cm, notify, alvosArr, nAlvos };

function procurarAlvos() {
  const arr = B.add(0x7ccda10), objs = arr.readPointer(), num = arr.add(0x14).readS32(), nch = arr.add(0x1c).readS32();
  for (let i = 0; i < num; i++) {
    const ch = (i / 0x10000) | 0; if (ch >= nch) break;
    try {
      const o = objs.add(ch * 8).readPointer().add((i % 0x10000) * 0x18).readPointer(); if (o.isNull()) continue;
      const nf = nome(o); let cls = null;
      for (const c in ALVOS) if (ALVOS[c].indexOf(nf) >= 0) { const outer = o.add(0x20).readPointer(); if (!outer.isNull() && nome(outer) === c) { cls = c; break; } }
      if (!cls || classe(o) !== 'Function') continue;
      const k = o.toString(); if (porPtr.has(k)) continue;
      const n = nAlvos.readS32(); if (n >= 64) break;
      alvosArr.add(n * 8).writePointer(o); nAlvos.writeS32(n + 1); porPtr.set(k, cls + '.' + nf);
    } catch (e) {}
  }
  log('vigiando ' + porPtr.size + ' funcoes: ' + [...porPtr.values()].map(s => s.split('.')[1]).join(', '));
}

function tratar(obj, qual, p) {
  if (!qual) return;
  const f = qual.split('.')[1];
  let extra = '';
  if (f === 'SetTutorialStage' || f === 'SetTutorName_Owning') extra = ' etapa=' + fstr(p);
  else if (f === 'ShowCurrentTutorialState_Client') extra = ' texto=' + ftext(p);
  else if (f === 'ShowTutorialObjective' || f === 'ShowGeneralObjective') extra = ' mostrar=' + p.readU8() + ' quest=' + ftext(p.add(8)) + ' texto=' + ftext(p.add(0x20));
  if (classe(obj) === 'SurvPC_C') extra += ' | estagio atual no PC=' + fstr(obj.add(0xd70));
  log(qual + ' em ' + obj + extra);
}

Interceptor.attach(B.add(0x24077b0), cm);
setTimeout(function () { try { procurarAlvos(); } catch (e) { log('erro procurando alvos: ' + e); } }, 0);
setTimeout(function () { try { procurarAlvos(); } catch (e) {} }, 30000);
log('pronto: tutorial/objetivo (somente leitura)');
})();
