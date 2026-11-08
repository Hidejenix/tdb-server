// barras_sempre_visiveis.js (2026-11-07) - CLIENTE: deixa vida, fome e sede sempre na tela.
// O HUD do jogo (W_PlayerStats) esconde as barras sozinho: so mostra quando um valor SOBE (OnStatChanged_Handler compara com o
// valor anterior), com vida < 30%, ou por 4,5 s depois de uma cena; some de novo em 2 s (AutoHideDelay). No hub os valores so
// caem, entao as barras nunca aparecem.
// Aqui, na thread do jogo (UNetDriver::TickFlush), a cada 2 s: para cada W_PlayerStats ligado a um jogador (Player != nulo) com
// ForcedShowStat == 0, chama o proprio ShowAllStats(Enabled=true) (grava ForcedShowStat; ShowStats, apesar do nome, so cuida da
// municao). Isso nao basta: as barras WBP_Stat_HP/Hunger/Thirst ficam Collapsed e com opacidade <= 0 (animacoes de esconder), entao
// o script tambem reafirma SetVisibility(SelfHitTestInvisible) e SetRenderOpacity(1) nelas quando mudam.
// Desligar: python cliente\cliente_conecta.py --sem-barras-fixas
(function () {
'use strict';
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send('[barras] ' + m); }
const pool = B.add(0x7c27980);
function fn(i) { try { const b = pool.add(0x10).add((i >>> 16) * 8).readPointer(); const e = b.add((i & 0xffff) * 2); const h = e.readU16(); const l = h >>> 6; return (h & 1) ? e.add(2).readUtf16String(l) : e.add(2).readUtf8String(l); } catch (x) { return '?'; } }
function nome(o) { return fn(o.add(0x18).readU32()); }
function classe(o) { return nome(o.add(0x10).readPointer()); }
const processEvent = new NativeFunction(B.add(0x24077b0), 'void', ['pointer', 'pointer', 'pointer']);
function acharFuncao(obj, nomeF) {
  let cls = obj.add(0x10).readPointer();
  for (let n = 0; n < 12 && !cls.isNull(); n++) { let f = cls.add(0x48).readPointer(); for (let k = 0; k < 4000 && !f.isNull(); k++) { if (nome(f) === nomeF) return f; f = f.add(0x28).readPointer(); } cls = cls.add(0x40).readPointer(); }
  return ptr(0);
}
// offsets dos parametros pela reflexao (UStruct::ChildProperties +0x50; FField Next +0x20, Name +0x28; FProperty Offset_Internal +0x4c)
function params(f) { const r = {}; try { let p = f.add(0x50).readPointer(); for (let k = 0; k < 16 && !p.isNull(); k++) { r[fn(p.add(0x28).readU32())] = p.add(0x4c).readS32(); p = p.add(0x20).readPointer(); } } catch (e) {} return r; }
const PLAYER = 0x3c0, FORCADO = 0x3e8;   // W_PlayerStats_C.Player, ForcedShowStat
const parms = Memory.alloc(0x40);
globalThis.__tdbBarras = { parms };
// WBP_Stat_HP +0x3a8, WBP_Stat_Hunger +0x3b0, WBP_Stat_Thirst +0x3b8; UWidget.Visibility +0xe4, RenderOpacity +0xe8
const BARRAS = [0x3a8, 0x3b0, 0x3b8], VIS_OK = 4;   // ESlateVisibility::SelfHitTestInvisible
let fVis = null, fOpa = null, offVis = null, offOpa = null;
let fShow = null, offs = null, ultimo = 0, vezes = 0;
// Caminho direto (o mesmo do jogo: GetHUD -> GUI -> W_PlayerStats), sem varrer a GObjects (que engasgaria o jogo):
// GEngine -> UGameEngine.GameInstance +0xFC0 -> LocalPlayers +0x38 [0] -> PlayerController +0x30 -> MyHUD +0x340
// -> BP_Game_HUD.GUI +0x398 -> UIW_PlayerMain.W_PlayerStats +0x3E8
function acharWidget() {
  try {
    const gi = B.add(0x7e20ea8).readPointer().add(0xfc0).readPointer(); if (gi.isNull()) return null;
    const lps = gi.add(0x38).readPointer(); if (lps.isNull() || gi.add(0x40).readS32() < 1) return null;
    const pc = lps.readPointer().add(0x30).readPointer(); if (pc.isNull()) return null;
    const hud = pc.add(0x340).readPointer(); if (hud.isNull()) return null;
    const gui = hud.add(0x398).readPointer(); if (gui.isNull()) return null;
    const w = gui.add(0x3e8).readPointer(); if (w.isNull() || classe(w) !== 'W_PlayerStats_C') return null;
    return w;
  } catch (e) { return null; }
}
Interceptor.attach(B.add(0x42f3650), {   // TickFlush: thread do jogo, todo quadro
  onEnter() {
    const agora = Date.now(); if (agora - ultimo < 2000) return; ultimo = agora;
    try {
      const w1 = acharWidget(); const widgets = w1 ? [w1] : [];
      if (w1 && !globalThis.__tdbBarras.w) log('HUD achado: W_PlayerStats ' + w1);
      globalThis.__tdbBarras.w = w1;
      for (const w of widgets) {
        if (w.add(PLAYER).readPointer().isNull()) continue;
        // 1) modo "mostrar tudo" do proprio widget (as rotinas de esconder respeitam ForcedShowStat)
        if (!w.add(FORCADO).readU8()) {
          if (fShow === null) { fShow = acharFuncao(w, 'ShowAllStats'); offs = fShow.isNull() ? null : params(fShow); log(fShow.isNull() ? 'ERRO: ShowAllStats nao achada' : 'ShowAllStats ' + JSON.stringify(offs)); }
          if (offs) { for (let i = 0; i < 0x40; i += 8) parms.add(i).writeU64(0); parms.add(offs.Enabled !== undefined ? offs.Enabled : 0).writeU8(1); processEvent(w, fShow, parms); }
        }
        // 2) as barras em si (WBP_Stat_HP/Hunger/Thirst) ficam Collapsed e com opacidade <= 0 pelas animacoes de esconder:
        //    reafirma visivel (SelfHitTestInvisible) e opacidade 1 pelas funcoes do proprio UWidget
        let mexeu = 0;
        for (const off of BARRAS) {
          const b = w.add(off).readPointer(); if (b.isNull()) continue;
          if (fVis === null) { fVis = acharFuncao(b, 'SetVisibility'); fOpa = acharFuncao(b, 'SetRenderOpacity'); offVis = params(fVis); offOpa = params(fOpa); log('SetVisibility ' + JSON.stringify(offVis) + ' SetRenderOpacity ' + JSON.stringify(offOpa)); }
          if (fVis.isNull() || fOpa.isNull()) break;
          if (b.add(0xe4).readU8() !== VIS_OK) { for (let i = 0; i < 0x40; i += 8) parms.add(i).writeU64(0); parms.add(offVis.InVisibility || 0).writeU8(VIS_OK); processEvent(b, fVis, parms); mexeu++; }
          if (b.add(0xe8).readFloat() < 0.99) { for (let i = 0; i < 0x40; i += 8) parms.add(i).writeU64(0); parms.add(offOpa.InOpacity || 0).writeFloat(1); processEvent(b, fOpa, parms); mexeu++; }
        }
        if (mexeu && (++vezes <= 3 || vezes % 100 === 0)) log('barras mostradas (' + vezes + ')');
      }
    } catch (e) { log('erro: ' + e); }
  }
});
log('pronto: vida, fome e sede sempre visiveis');
})();
