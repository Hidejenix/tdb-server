// carregar_dados.js (2026-11-10) - HOST: jogador nascia na sala do doutor e o tutorial recomecava.
// Causa (bytecode do SurvPC + rastreio ao vivo 10/11 11:16-11:19): no login o servidor so faz a 1a leitura do save
// (SetLoginServer -> Get players/<SteamId> -> OnGot_D1E9: pega so o charlist). A 2a leitura, que carrega o "char"
// (TutorialBegginer -> TutorialCompleted, TutorStage, PlayerPosition -> PlayerLocSave), so acontece no evento SurvPC.LoadUserInfo,
// que no nosso servidor nunca e disparado. Sem esses dados, PlayerPlaceholder.PickSpawnPoint ve "iniciante" (TutorialCompleted=false,
// etapa padrao "DoctorSequence") -> ponto ForBeginner (sala do doutor) e o tutorial recomeca, gravando a sala como posicao.
// Prova: chamar LoadUserInfo a mao (11:19:26) carregou completo=1 e a posicao salva em 1 s (OnGot_F36A).
// Correcao: para cada SurvPC de jogador (Steam_Id preenchido, diferente do host) ainda sem dados (TutorialCompleted=0), chama
// LoadUserInfo uma vez, 2 s depois de o Steam_Id aparecer (bem antes do spawn, que vem ~50 s depois). Na thread do jogo (TickFlush).
// Personagem novo (sem "char" no save) segue o fluxo normal do jogo: a leitura nao acha nada e ele continua iniciante. Prefixo [dados].
(function () {
'use strict';
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send({ tdb: '[dados] ' + m }); }
const pool = B.add(0x7c27980);
function fn(i) { try { const b = pool.add(0x10).add((i >>> 16) * 8).readPointer(); const e = b.add((i & 0xffff) * 2); const h = e.readU16(); const l = h >>> 6; return (h & 1) ? e.add(2).readUtf16String(l) : e.add(2).readUtf8String(l); } catch (x) { return '?'; } }
function nome(o) { try { return fn(o.add(0x18).readU32()); } catch (e) { return '?'; } }
function classe(o) { try { return nome(o.add(0x10).readPointer()); } catch (e) { return '?'; } }
function fstr(p) { try { const d = p.readPointer(), n = p.add(8).readS32(); return (d.isNull() || n <= 0) ? '' : d.readUtf16String(Math.min(n, 400)); } catch (e) { return '?'; } }
const processEvent = new NativeFunction(B.add(0x24077b0), 'void', ['pointer', 'pointer', 'pointer']);
const parms = Memory.alloc(64);
const MORTO = (1 << 28) | (1 << 29) | (1 << 21);
const HOST_ID = '76561197960271872';
// SurvPC_C (Dumper-7): TutorialCompleted 0xC88, CurrentTutorialStage 0xD70, Steam_Id 0xF20, PlayerLocSave 0xFA8
const OFF_COMPLETO = 0xC88, OFF_ETAPA = 0xD70, OFF_STEAMID = 0xF20, OFF_POS = 0xFA8;
let fLoad = null;
const vistoEm = new Map(), feitos = new Set(), fila = [];

function acharFuncao(o, alvo) {
  let cls = o.add(0x10).readPointer();
  for (let n = 0; n < 4 && !cls.isNull(); n++) { let x = cls.add(0x48).readPointer(); for (let k = 0; k < 3000 && !x.isNull(); k++) { if (nome(x) === alvo) return x; x = x.add(0x28).readPointer(); } cls = cls.add(0x40).readPointer(); }
  return ptr(0);
}
function pcs() {
  const g = B.add(0x7ccda10), objs = g.readPointer(), num = g.add(0x14).readS32(), nch = g.add(0x1c).readS32(); const r = [];
  for (let i = 0; i < num; i++) {
    const ch = (i / 0x10000) | 0; if (ch >= nch) break;
    try { const it = objs.add(ch * 8).readPointer().add((i % 0x10000) * 0x18); const o = it.readPointer(); if (o.isNull()) continue; if (it.add(8).readS32() & MORTO) continue;
          if (classe(o) === 'SurvPC_C' && nome(o).indexOf('Default__') !== 0) r.push(o); } catch (e) {}
  }
  return r;
}

setInterval(function () {
  try {
    const agora = Date.now();
    for (const pc of pcs()) {
      const k = pc.toString();
      if (feitos.has(k)) {
        const v = vistoEm.get(k);
        if (v && v.conferir && agora - v.chamado > 3000) {
          v.conferir = false;
          log('depois do LoadUserInfo: ' + fstr(pc.add(OFF_STEAMID)) + ' completo=' + pc.add(OFF_COMPLETO).readU8() + ' etapa="' + fstr(pc.add(OFF_ETAPA)) +
              '" posSalva=' + (fstr(pc.add(OFF_POS)).replace(/Rotation:.*/, '').trim() || '(vazia: personagem novo?)'));
        }
        continue;
      }
      const sid = fstr(pc.add(OFF_STEAMID));
      if (!sid || sid === HOST_ID) continue;
      if (pc.add(OFF_COMPLETO).readU8() !== 0) { feitos.add(k); continue; }   // o jogo ja carregou sozinho
      if (!vistoEm.has(k)) { vistoEm.set(k, { t: agora }); continue; }
      if (agora - vistoEm.get(k).t < 2000) continue;
      if (fLoad === null) { fLoad = acharFuncao(pc, 'LoadUserInfo'); log(fLoad.isNull() ? 'ERRO: SurvPC.LoadUserInfo nao achada' : 'LoadUserInfo ' + fLoad); }
      if (fLoad.isNull()) continue;
      feitos.add(k); fila.push([pc, sid]);
    }
  } catch (e) { log('erro: ' + e); }
}, 1000);

Interceptor.attach(B.add(0x42f3650), {
  onEnter() {
    if (!fila.length) return;
    const [pc, sid] = fila.shift();
    try {
      if (classe(pc) !== 'SurvPC_C') return;    // saiu antes
      parms.writeByteArray(new Array(64).fill(0));
      processEvent(pc, fLoad, parms);
      const v = vistoEm.get(pc.toString()) || {}; v.chamado = Date.now(); v.conferir = true; vistoEm.set(pc.toString(), v);
      log('LoadUserInfo chamado para ' + sid + ' (carrega tutorial e posicao salva antes do spawn)');
    } catch (e) { log('erro chamando LoadUserInfo: ' + e); }
  }
});
log('pronto: carrega os dados do personagem (LoadUserInfo) de quem entra');
})();
