// monitor_gps_cliente.js (2026-11-06) - SOMENTE LEITURA, roda no CLIENTE (carregado pelo cliente_conecta.py se este arquivo existir).
// Objetivo: ver o que o CLIENTE acredita quando o GPS (tecla M) bugar: tela embacada, lentidao e sem interagir.
// - ProcessEvent (0x24077b0): InpActEvt_EquipGPS (a tecla M), EquipGPS(bool), EquipGpsServer(bool) (a chamada enviada ao servidor),
//   PerexodGPS, GPSEvent, GPSEquipFP, OnRep_GPSEquip, HidePlayerWithDelay.
// - A cada chamada e a cada 0,5 s (se mudar): ESTADO do pawn LOCAL no cliente:
//   GPSEquip(+0x2B78) GPSState(+0x2B79) GPSRef(+0x2B80) GPSRef_FP(+0x3158) CanInteract(+0x1008) BlockInputAnim(+0x3050)
//   CustomInputBlockers(+0x16E0) MaxWalkSpeed (ACharacter+0x320 -> CharacterMovement; UCharacterMovementComponent+0x1E8, float).
// Compare com o log do host (monitor_gps.js), que mostra o ESTADO do mesmo personagem no servidor.
(function () {
'use strict';
const B = Process.getModuleByName('TheDayBefore.exe').base;
function glog(m) { send({ tdb: '[gpsc] ' + m }); }
const pool = B.add(0x7c27980);
function fnameStr(i) { try { const b = pool.add(0x10).add((i >>> 16) * 8).readPointer(); const e = b.add((i & 0xffff) * 2); const h = e.readU16(); const l = h >>> 6; return (h & 1) ? e.add(2).readUtf16String(l) : e.add(2).readUtf8String(l); } catch (x) { return '?'; } }
function nome(o) { try { return fnameStr(o.add(0x18).readU32()); } catch (x) { return '?'; } }
function cls(o) { try { return nome(o.add(0x10).readPointer()); } catch (x) { return '?'; } }
function fstr(p) { try { const d = p.readPointer(), n = p.add(8).readS32(); if (d.isNull() || n <= 0) return ''; return d.readUtf16String(n - 1); } catch (x) { return '?'; } }

let pawn = ptr(0);
function estado(p) {
  try {
    const gr = p.add(0x2b80).readPointer(), gf = p.add(0x3158).readPointer();
    const bl = p.add(0x16e0), nb = bl.add(8).readS32(), db = bl.readPointer();
    const bs = []; for (let k = 0; k < nb && k < 20; k++) bs.push(fstr(db.add(k * 16)));
    let vel = '?';
    try { const cmc = p.add(0x320).readPointer(); if (!cmc.isNull()) vel = cmc.add(0x1e8).readFloat().toFixed(0); } catch (x) {}
    // rotacao do movimento ("andar de lado"): APawn.bUseControllerRotationYaw (+0x298 bit1); CMC.bUseControllerDesiredRotation (+0x258 bit2), bOrientRotationToMovement (+0x258 bit3)
    let rot = '';
    try {
      rot = ' UseCtrlYaw=' + ((p.add(0x298).readU8() >> 1) & 1);
      const cmc2 = p.add(0x320).readPointer();
      if (!cmc2.isNull()) { const f = cmc2.add(0x258).readU8(); rot += ' OrientToMove=' + ((f >> 3) & 1) + ' UseCtrlDesiredRot=' + ((f >> 2) & 1); }
    } catch (x) {}
    // v2 (06/11): condicoes do ramo que restaura o DoF e os campos de DoF da camera (Camera +0x830; PostProcessSettings +0x350 na UCameraComponent)
    let dof = '';
    try {
      const eq = p.add(0xa10).readPointer(); let fpm = '?';
      if (!eq.isNull()) { const w = eq.add(0xa8).readPointer(); fpm = w.isNull() ? 'semArma' : w.add(0xcb8).readU8(); }
      dof = ' FPM=' + fpm + ' compas=' + p.add(0x2990).readU8() + ' binoc=' + p.add(0x2e24).readU8();
      const cam = p.add(0x830).readPointer();
      if (!cam.isNull()) { const pp = cam.add(0x350); dof += ' DoF[fstop=' + pp.add(0x470).readFloat().toFixed(1) + ' foco=' + pp.add(0x620).readFloat().toFixed(0) + ' blurAmt=' + pp.add(0x624).readFloat().toFixed(2) + ' blurRad=' + pp.add(0x628).readFloat().toFixed(1) + ' vig=' + pp.add(0x588).readFloat().toFixed(2) + ']'; }
    } catch (x) {}
    return 'GPSEquip=' + p.add(0x2b78).readU8() + ' GPSState=' + p.add(0x2b79).readU8() + ' GPSRef=' + (gr.isNull() ? 'nulo' : cls(gr)) +
      ' GPSRef_FP=' + (gf.isNull() ? 'nulo' : cls(gf)) + ' CanInteract=' + p.add(0x1008).readU8() + ' BlockInputAnim=' + p.add(0x3050).readU8() +
      ' MaxWalkSpeed=' + vel + rot + dof + ' bloqueios=[' + bs.join(',') + ']';
  } catch (x) { return '(pawn ilegivel)'; }
}

const ALVOS = new Set(['EquipGPS', 'EquipGpsServer', 'PerexodGPS', 'GPSEvent', 'GPSEquipFP', 'OnRep_GPSEquip', 'HidePlayerWithDelay']);
const FUNC = new Map();
Interceptor.attach(B.add(0x24077b0), {
  onEnter(a) {
    try {
      const k = a[1].toString();
      let n = FUNC.get(k);
      if (n === undefined) { n = fnameStr(a[1].add(0x18).readU32()); FUNC.set(k, n); }
      if (n === 'ServerMovePacked') {            // o cliente chama isto no proprio pawn (AutonomousProxy: Role == 2)
        if ((pawn.isNull() || !pawn.equals(a[0])) && cls(a[0]).indexOf('SurvivalPlayer') === 0) {
          try { if (a[0].add(0x150).readU8() === 2) { pawn = a[0]; glog('pawn local: ' + pawn); } } catch (x) {}
        }
        return;
      }
      const tecla = n.indexOf('InpActEvt_EquipGPS') === 0;
      const mira = n.indexOf('ChangeAimState') === 0;
      if (!tecla && !mira && !ALVOS.has(n)) return;
      let extra = '';
      if (mira) { try { extra = ' (IsAim=' + a[2].readU8() + ' IsFPS=' + a[2].add(1).readU8() + ')'; } catch (x) {} }
      if (n === 'EquipGpsServer' || n === 'EquipGPS' || n === 'HidePlayerWithDelay') extra = ' (bool=' + a[2].readU8() + ')';
      glog((tecla ? 'TECLA M: ' : '') + cls(a[0]) + '.' + n + extra + (pawn.isNull() ? '' : ' | ' + estado(pawn)));
    } catch (e) {}
  }
});
let ult = '';
setInterval(function () {
  if (pawn.isNull()) return;
  const s = estado(pawn);
  if (s !== ult) { ult = s; glog('ESTADO ' + s); }
}, 250);
glog('pronto v2: GPS + DoF + ChangeAimState do pawn local no cliente');
})();
