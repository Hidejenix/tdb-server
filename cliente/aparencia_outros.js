// aparencia_outros.js (2026-11-07) - CLIENTE: monta rosto/cabelo/barba dos OUTROS jogadores quando o multicast do servidor se perde.
// A aparencia de cada pawn chega como propriedade replicada (SurvivalPlayer_C.GI_Character_Save_Ref, +0x2798, sem OnRep), mas quem
// monta as malhas e o UpdateCharacter, chamado so pelo multicast UpdateSaveCharactersMulticast. Se o multicast nao chega (jogador
// longe/fora de relevancia na hora, ou descartado), o pawn fica sem rosto e cabelo (Hair2/Hair1 vazios) - medido 07/11 com uma
// personagem feminina (Face=FW3_lod0 recebido, Hair1/Hair2 nulos) mesmo depois do reenvio pelo servidor (reaplicar_aparencia.js).
// Aqui: na thread do jogo (TickFlush), a cada 2 s, para cada pawn de outro jogador com Face preenchido e Hair2 diferente de Face,
// chama localmente o proprio UpdateCharacter(GI_Character_Save_Ref). So visual; nao manda nada pela rede (o pawn local e ignorado).
(function () {
'use strict';
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send('[aparencia] ' + m); }
const pool = B.add(0x7c27980);
function fn(i) { try { const b = pool.add(0x10).add((i >>> 16) * 8).readPointer(); const e = b.add((i & 0xffff) * 2); const h = e.readU16(); const l = h >>> 6; return (h & 1) ? e.add(2).readUtf16String(l) : e.add(2).readUtf8String(l); } catch (x) { return '?'; } }
function nome(o) { try { return o.isNull() ? 'NULO' : fn(o.add(0x18).readU32()); } catch (e) { return '?'; } }
function classe(o) { try { return nome(o.add(0x10).readPointer()); } catch (e) { return '?'; } }
function fstr(p) { try { const d = p.readPointer(), n = p.add(8).readS32(); if (d.isNull() || n <= 0 || n > 200) return '?'; return d.readUtf16String(n - 1); } catch (e) { return '?'; } }
const processEvent = new NativeFunction(B.add(0x24077b0), 'void', ['pointer', 'pointer', 'pointer']);
const SAVE = 0x2798, SAVE_TAM = 0x1b0, HAIR2 = 0x9e0, SKINNED = 0x5b0;       // SurvivalPlayer_C / USkinnedMeshComponent
const GAMESTATE = 0x158, PLAYERARRAY = 0x2a8, PS_PAWN = 0x308, PS_NOME = 0x388; // UWorld / AGameStateBase / APlayerState
const parms = Memory.alloc(0x300);
globalThis.__tdbAparenciaOutros = { parms };
let fUpdate = null, ultimo = 0, vezes = 0;
const ultimaVez = new Map();   // pawn -> ms

function meuPawn() {
  try {
    const gi = B.add(0x7e20ea8).readPointer().add(0xfc0).readPointer();
    const pc = gi.add(0x38).readPointer().readPointer().add(0x30).readPointer();
    return pc.add(0x2d0).readPointer();   // APlayerController.AcknowledgedPawn/Pawn
  } catch (e) { return ptr(0); }
}
function mundo() { try { return B.add(0x7e20ea8).readPointer().add(0xec0).readPointer().readPointer().add(0x2c0).readPointer(); } catch (e) { return ptr(0); } }

Interceptor.attach(B.add(0x42f3650), {   // TickFlush: thread do jogo
  onEnter() {
    const agora = Date.now(); if (agora - ultimo < 2000) return; ultimo = agora;
    try {
      const w = mundo(); if (w.isNull()) return;
      const gs = w.add(GAMESTATE).readPointer(); if (gs.isNull()) return;
      const arr = gs.add(PLAYERARRAY).readPointer(), n = gs.add(PLAYERARRAY + 8).readS32(); if (arr.isNull() || n <= 0 || n > 64) return;
      const eu = meuPawn();
      for (let i = 0; i < n; i++) {
        const ps = arr.add(i * 8).readPointer(); if (ps.isNull()) continue;
        const pawn = ps.add(PS_PAWN).readPointer(); if (pawn.isNull() || pawn.equals(eu)) continue;
        if (classe(pawn).indexOf('SurvivalPlayer') !== 0) continue;
        const face = pawn.add(SAVE).readPointer(); if (face.isNull()) continue;   // aparencia ainda nao chegou
        const h2 = pawn.add(HAIR2).readPointer(); if (h2.isNull()) continue;
        if (h2.add(SKINNED).readPointer().equals(face)) continue;                    // ja montado
        const k = pawn.toString(); if ((ultimaVez.get(k) || 0) > agora - 5000) continue; ultimaVez.set(k, agora);
        if (fUpdate === null) {
          let cls = pawn.add(0x10).readPointer(), f = ptr(0);
          for (let c = 0; c < 8 && !cls.isNull() && f.isNull(); c++) { let x = cls.add(0x48).readPointer(); for (let j = 0; j < 4000 && !x.isNull(); j++) { if (nome(x) === 'UpdateCharacter') { f = x; break; } x = x.add(0x28).readPointer(); } cls = cls.add(0x40).readPointer(); }
          fUpdate = f; log(f.isNull() ? 'ERRO: UpdateCharacter nao achada' : 'funcao UpdateCharacter ' + f);
        }
        if (fUpdate.isNull()) return;
        for (let j = 0; j < 0x300; j += 8) parms.add(j).writeU64(0);
        Memory.copy(parms, pawn.add(SAVE), SAVE_TAM);   // Target (copia rasa; os parametros nao sao destruidos pelo ProcessEvent)
        processEvent(pawn, fUpdate, parms);
        vezes++;
        log('montada a aparencia de ' + fstr(ps.add(PS_NOME)) + ' (rosto ' + nome(face) + ', antes ' + nome(h2.add(SKINNED).readPointer()) + ') | total ' + vezes);
      }
    } catch (e) { log('erro: ' + e); }
  }
});
log('pronto: aparencia dos outros jogadores');
})();
