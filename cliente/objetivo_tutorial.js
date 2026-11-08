// objetivo_tutorial.js (2026-11-07) - CLIENTE: o texto do objetivo da quest do hub ("New Beginning") nao mudava durante o jogo.
// Causa (bytecode do SurvPC + medicao no host e no cliente, 07/11):
//  - o personagem esta marcado como "tutorial concluido" (Firestore char.TutorialBegginer = true -> SurvPC.TutorialCompleted = 1;
//    o caminho de "pular tutorial" do jogo tambem poe TutorCheatCompleted = 1), mas a TrainingQuest (avisar o Chris, terreno, tenda,
//    moveis, voltar a Woodberry) continua salva e ativa, e o servidor avanca os estagios (SetTutorialStage -> SetTutorName_Owning +
//    ShowCurrentTutorialState_Client(NodeText) para o dono);
//  - no cliente, o handler de ShowCurrentTutorialState_Client comeca com "se TutorialCompleted -> nao faz nada", entao o texto
//    novo chega e e descartado; so o caminho do login (que nao confere a flag) mostrava o estagio certo.
// Correcao (cosmetica): quando ShowCurrentTutorialState_Client chega e TutorialCompleted == 1, chama o proprio
// WBP_TutorialObjective.ShowTutorialObjective(true, <nome da quest atual do widget>, NodeText) - o mesmo que o jogo faria.
// A flag nao e alterada (ela tambem libera GPS/bussola/binoculos do tutorial). Filtro em C no ProcessEvent (barato).
(function () {
'use strict';
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send('[objetivo] ' + m); }
const pool = B.add(0x7c27980);
function fn(i) { try { const b = pool.add(0x10).add((i >>> 16) * 8).readPointer(); const e = b.add((i & 0xffff) * 2); const h = e.readU16(); const l = h >>> 6; return (h & 1) ? e.add(2).readUtf16String(l) : e.add(2).readUtf8String(l); } catch (x) { return '?'; } }
function nome(o) { try { return fn(o.add(0x18).readU32()); } catch (e) { return '?'; } }
function classe(o) { try { return nome(o.add(0x10).readPointer()); } catch (e) { return '?'; } }
const processEvent = new NativeFunction(B.add(0x24077b0), 'void', ['pointer', 'pointer', 'pointer']);
function params(f) { const r = {}; try { let p = f.add(0x50).readPointer(); for (let k = 0; k < 16 && !p.isNull(); k++) { r[fn(p.add(0x28).readU32())] = p.add(0x4c).readS32(); p = p.add(0x20).readPointer(); } } catch (e) {} return r; }
const TUTORIAL_COMPLETED = 0xc88, MY_HUD = 0x340, GUI = 0x398, WIDGET = 0x468, W_QUESTNAME = 0x2f8;   // SurvPC_C / AHUD / BP_Game_HUD / UIW_PlayerMain / WBP_TutorialObjective
const parms = Memory.alloc(0x80);
function pick(o, nomes, padrao) { for (const n of nomes) if (o[n] !== undefined) return o[n]; return padrao; }
let fRpc = null, fShow = null, offShow = null, vezes = 0;

function aoChegar(pc, rpcParms) {
  try {
    if (!pc.add(TUTORIAL_COMPLETED).readU8()) return;   // tutorial nao concluido: o proprio jogo atualiza o texto
    const hud = pc.add(MY_HUD).readPointer(); if (hud.isNull()) return;
    const gui = hud.add(GUI).readPointer(); if (gui.isNull()) return;
    const w = gui.add(WIDGET).readPointer(); if (w.isNull() || classe(w) !== 'WBP_TutorialObjective_C') return;
    if (fShow === null) {
      let cls = w.add(0x10).readPointer(), f = ptr(0);
      for (let n = 0; n < 6 && !cls.isNull() && f.isNull(); n++) { let x = cls.add(0x48).readPointer(); for (let k = 0; k < 4000 && !x.isNull(); k++) { if (nome(x) === 'ShowTutorialObjective') { f = x; break; } x = x.add(0x28).readPointer(); } cls = cls.add(0x40).readPointer(); }
      fShow = f; offShow = f.isNull() ? null : params(f);
      log(f.isNull() ? 'ERRO: ShowTutorialObjective nao achada' : 'ShowTutorialObjective ' + JSON.stringify(offShow));
    }
    if (!offShow) return;
    for (let i = 0; i < 0x80; i += 8) parms.add(i).writeU64(0);
    parms.add(offShow.Show !== undefined ? offShow.Show : 0).writeU8(1);
    // FText (0x18): copia rasa; o widget copia com contagem de referencia, e este buffer nunca e destruido
    Memory.copy(parms.add(pick(offShow, ['QuestName_0', 'QuestName'], 8)), w.add(W_QUESTNAME), 0x18);
    Memory.copy(parms.add(pick(offShow, ['MessageText_0', 'MessageText'], 0x20)), rpcParms, 0x18);   // NodeText do RPC (vivo durante esta chamada)
    processEvent(w, fShow, parms);
    if (++vezes <= 5 || vezes % 20 === 0) log('texto do objetivo atualizado (' + vezes + ')');
  } catch (e) { log('erro: ' + e); }
}

const alvo = Memory.alloc(8); alvo.writePointer(ptr(0));
const notify = new NativeCallback(function (obj, p) { aoChegar(obj, p); }, 'void', ['pointer', 'pointer']);
const cm = new CModule(`
#include <gum/guminterceptor.h>
extern void notify (void * obj, void * parms);
extern void * alvo;
void onEnter (GumInvocationContext * ic)
{
  if (alvo != 0 && gum_invocation_context_get_nth_argument (ic, 1) == alvo)
    notify (gum_invocation_context_get_nth_argument (ic, 0), gum_invocation_context_get_nth_argument (ic, 2));
}
`, { notify, alvo });
globalThis.__tdbObjetivo = { cm, notify, alvo, parms };

function procurar() {
  const arr = B.add(0x7ccda10), objs = arr.readPointer(), num = arr.add(0x14).readS32(), nch = arr.add(0x1c).readS32();
  for (let i = 0; i < num; i++) {
    const ch = (i / 0x10000) | 0; if (ch >= nch) break;
    try {
      const o = objs.add(ch * 8).readPointer().add((i % 0x10000) * 0x18).readPointer(); if (o.isNull()) continue;
      if (nome(o) !== 'ShowCurrentTutorialState_Client' || classe(o) !== 'Function') continue;
      const outer = o.add(0x20).readPointer(); if (outer.isNull() || nome(outer) !== 'SurvPC_C') continue;
      fRpc = o; alvo.writePointer(o); log('vigiando SurvPC_C.ShowCurrentTutorialState_Client'); return true;
    } catch (e) {}
  }
  return false;
}
Interceptor.attach(B.add(0x24077b0), cm);
// a classe SurvPC_C (Blueprint) carrega depois do inicio do processo: tenta ate achar
const t = setInterval(function () { try { if (procurar()) clearInterval(t); } catch (e) {} }, 10000);
setTimeout(function () { try { if (procurar()) clearInterval(t); } catch (e) {} }, 0);
log('pronto: texto do objetivo da quest do hub');
})();
