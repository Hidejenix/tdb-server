// appdata_separado.js (2026-11-06) - da a ESTA instancia do jogo uma pasta LocalAppData propria.
// Motivo (medido 06/11 11:51, captura_excecao.js): a 2a instancia na mesma conta lanca firebase::firestore::FirestoreInternalError e cai
// (0xe06d7363 em KERNELBASE+0xc408a): o banco local do Firestore (LevelDB) fica em %LOCALAPPDATA%\firestore\__FIRAPP_DEFAULT\
// the-day-before-8f438\main, com arquivo LOCK, e so um processo por usuario consegue abri-lo.
// Como: hooks em shell32!SHGetKnownFolderPath (FOLDERID_LocalAppData) e shell32!SHGetFolderPathW (CSIDL_LOCAL_APPDATA 0x1c),
// devolvendo APPDATA_DIR (injetado pelo runner). Tudo que o jogo grava em LocalAppData (Firestore, Saved, logs) vai para la.
(function () {
'use strict';
function log(m) { send({ tdb: '[appdata] ' + m }); }
if (typeof APPDATA_DIR === 'undefined') { log('APPDATA_DIR nao definido: nada a fazer'); return; }
const LOCALAPPDATA = [0x85, 0x27, 0xb3, 0xf1, 0xba, 0x6f, 0xcf, 0x4f, 0x9d, 0x55, 0x7b, 0x8e, 0x7f, 0x15, 0x70, 0x91];
const ole = Process.getModuleByName('ole32.dll');
const coAlloc = new NativeFunction(ole.getExportByName('CoTaskMemAlloc'), 'pointer', ['size_t']);
const coFree = new NativeFunction(ole.getExportByName('CoTaskMemFree'), 'void', ['pointer']);
let n1 = 0, n2 = 0;
function ehLocalAppData(g) { try { const b = new Uint8Array(g.readByteArray(16)); for (let i = 0; i < 16; i++) if (b[i] !== LOCALAPPDATA[i]) return false; return true; } catch (e) { return false; } }
// 10/11: os hooks de 06/11 NUNCA dispararam: shell32!SHGetKnownFolderPath e so um encaminhador; quem o jogo chama de fato e a
// implementacao em windows.storage.dll (medido 10/11 08:30: dispara por ela). Agora o hook vai em todas as exportacoes
// (windows.storage, shell32, KERNELBASE), sem repetir endereco.
function alvos(nome) {
  const vistos = {}, lista = [];
  ['windows.storage.dll', 'shell32.dll', 'KERNELBASE.dll'].forEach(function (m) {
    let mod = null;
    try { mod = Process.getModuleByName(m); } catch (e) { try { mod = Module.load(m); } catch (e2) { return; } }
    let p = null;
    try { p = mod.findExportByName(nome); } catch (e) {}
    if (!p || p.isNull() || vistos[p.toString()]) return;
    vistos[p.toString()] = 1; lista.push(p); log('hook ' + nome + ' @ ' + p + ' [' + m + ']');
  });
  return lista;
}
alvos('SHGetKnownFolderPath').forEach(function (alvo) { Interceptor.attach(alvo, {
  onEnter(a) { this.alvo = ehLocalAppData(a[0]); this.out = a[3]; },
  onLeave(r) {
    if (!this.alvo || r.toInt32() !== 0) return;
    try {
      const antigo = this.out.readPointer();
      if (!antigo.isNull() && antigo.readUtf16String() === APPDATA_DIR) return;   // ja trocado por outro hook da cadeia
      const bytes = (APPDATA_DIR.length + 1) * 2, novo = coAlloc(bytes);
      novo.writeUtf16String(APPDATA_DIR);
      this.out.writePointer(novo); if (!antigo.isNull()) coFree(antigo);
      if (++n1 <= 3) log('SHGetKnownFolderPath(LocalAppData) -> ' + APPDATA_DIR);
    } catch (e) { log('erro KnownFolder: ' + e); }
  }
}); });
alvos('SHGetFolderPathW').forEach(function (alvo) { Interceptor.attach(alvo, {
  onEnter(a) { this.alvo = (a[1].toInt32() & 0xff) === 0x1c; this.buf = a[4]; },
  onLeave(r) {
    if (!this.alvo || r.toInt32() !== 0) return;
    try { this.buf.writeUtf16String(APPDATA_DIR); if (++n2 <= 3) log('SHGetFolderPathW(CSIDL_LOCAL_APPDATA) -> ' + APPDATA_DIR); } catch (e) { log('erro FolderPath: ' + e); }
  }
}); });
log('pronto: LocalAppData desta instancia = ' + APPDATA_DIR);
})();
