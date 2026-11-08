// modo_dedicado.js (2026-11-05) - faz o host se declarar SERVIDOR DEDICADO e registra o fluxo de login.
// Patch: UWorld::InternalGetNetMode, ramo "tem NetDriver" (0x14470b933: mov eax, imm): 03 (orig) / 02 (listen) -> 01 (NM_DedicatedServer).
// Efeito: UKismetSystemLibrary::IsDedicatedServer = World->GetNetMode()==NM_DedicatedServer (KismetSystemLibrary.cpp:266) passa a ser true,
// e os ramos de servidor dos Blueprints (PlayerPlaceholder BeginPlay 3413, SurvPC 25462/25880) rodam como em producao.
// So vale para objetos criados DEPOIS do patch (o BeginPlay decide): o cliente precisa reconectar.
// Monitor: ProcessEvent (0x24077b0) nas classes do login, sem ticks/animacao, em %TEMP%\modo_dedicado_host.out.
(function () {
'use strict';
const B = Process.getModuleByName('TheDayBefore.exe').base;
function log(m) { send({ tdb: '[ded] ' + m }); }

// ---- patch ----
const p = B.add(0x470b933);
const u = new Uint8Array(p.readByteArray(5));
if (u[0] !== 0xb8 || u[2] !== 0 || u[3] !== 0 || u[4] !== 0 || [1, 2, 3].indexOf(u[1]) < 0) {
  log('ABORTADO: bytes inesperados em 0x14470b933: ' + Array.from(u).map(x => x.toString(16)).join(' '));
  return;
}
Memory.protect(p, 8, 'rwx'); p.add(1).writeU8(0x01); Memory.protect(p, 8, 'r-x');
log('NetMode com NetDriver: ' + u[1] + ' -> 1 (NM_DedicatedServer). IsDedicatedServer agora e true no host.');

// ---- monitor ----
// 06/11 (modo leve): com `var HOST_LEVE = true;` (servidor_host.py --sem-interface) o monitor NAO e instalado: era um hook JS em
// TODA chamada de ProcessEvent do servidor. O patch acima continua.
if (typeof HOST_LEVE !== 'undefined' && HOST_LEVE) { log('modo leve: monitor de ProcessEvent desligado'); return; }
const pool = B.add(0x7c27980);
function fn(i) { try { const b = pool.add(0x10).add((i >>> 16) * 8).readPointer(); const e = b.add((i & 0xffff) * 2); const h = e.readU16(); const l = h >>> 6; return (h & 1) ? e.add(2).readUtf16String(l) : e.add(2).readUtf8String(l); } catch (x) { return '?'; } }
const CLASSES = /^(PlayerPlaceholder_C|SurvPC_C|TDB_GameMode_C|LevelStreamer_C|SurvivalPlayer_V2_C|PS_TDB_C|GI_Survival_C)$/;
const IGNORA = /Tick|Anim|BlueprintUpdate|GetLifetime|ReceiveDraw|Footstep|Camera|Look|Turn|Move(Forward|Right)|Inp(Axis)/;
const clsCache = new Map();   // ptr da classe -> nome ou null
function nomeClasse(o) {
  const c = o.add(0x10).readPointer();
  const k = c.toString();
  if (clsCache.has(k)) return clsCache.get(k);
  const n = fn(c.add(0x18).readU32());
  const v = CLASSES.test(n) ? n : null;
  clsCache.set(k, v);
  return v;
}
const vistos = {}; let total = 0;
Interceptor.attach(B.add(0x24077b0), {
  onEnter(a) {
    try {
      const c = nomeClasse(a[0]);
      if (c === null) return;
      const f = fn(a[1].add(0x18).readU32());
      if (IGNORA.test(f)) return;
      if (f === 'SetSteamId' || f === 'SetLoginServer') {   // 1o parametro FString: o id do documento players/<id>
        let v = '?';
        try { const d = a[2].readPointer(), n = a[2].add(8).readS32(); v = (d.isNull() || n <= 0) ? '(vazio)' : d.readUtf16String(n - 1); } catch (e) {}
        log(c + ' ' + a[0] + ' .' + f + ' SteamId="' + v + '"');
      }
      const k = a[0] + '.' + f;
      vistos[k] = (vistos[k] || 0) + 1;
      total++;
      if (vistos[k] <= 3) log(c + ' ' + a[0] + ' .' + f + (vistos[k] > 1 ? ' (#' + vistos[k] + ')' : ''));
    } catch (e) {}
  }
});
log('monitor pronto');
})();
