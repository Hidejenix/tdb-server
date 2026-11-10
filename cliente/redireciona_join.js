/**
 * redireciona_join.js (2026-11-10) - CLIENTE, modo Online: o join SEMPRE vai para o IP do host.txt (TDB_HOST), qualquer que seja o
 * endereco que o jogo tirou da lista de servidores.
 * Por que: o join usa o NOME do documento da lista (ip:porta). Depois da troca de VPS (Brasil 20.206.201.228 -> East US 2), o cliente
 * continuou mostrando o servidor antigo e mandando o join para o IP velho (medido com diagnostico/tdb_join_udp.js:
 * sendto 20.206.201.228:7777), mesmo com o servidor novo so tendo o documento novo.
 * Como: em sendto/WSASendTo para a porta 7777 com IP diferente de TDB_HOST, troca o destino por TDB_HOST numa COPIA do sockaddr
 * (a memoria do jogo nao muda); em recvfrom/WSARecvFrom, pacote vindo de TDB_HOST:7777 tem a origem trocada de volta para o IP que o
 * jogo acha que e o servidor (senao o jogo descarta como pacote de endereco desconhecido). Prefixo [redir].
 */
(function () {
'use strict';
function rlog(m) { send({ tdb: '[redir] ' + m }); }
if (typeof TDB_HOST === 'undefined' || !TDB_HOST || TDB_HOST === '127.0.0.1') { rlog('sem host remoto: nada a fazer'); return; }
const PORTA = 7777;
const alvo = TDB_HOST.split(':')[0].split('.').map(function (x) { return parseInt(x, 10); });
if (alvo.length !== 4 || alvo.some(function (x) { return isNaN(x) || x < 0 || x > 255; })) { rlog('host invalido: ' + TDB_HOST); return; }
const ws2 = Process.getModuleByName('ws2_32.dll');
let original = null;          // [a,b,c,d] do IP que o jogo usa como servidor
let nEnv = 0, nRec = 0;

function ler(sa) {
  try {
    if (sa.isNull() || sa.readU16() !== 2) return null;    // so IPv4
    const porta = (sa.add(2).readU8() << 8) | sa.add(3).readU8();
    return { porta: porta, ip: [sa.add(4).readU8(), sa.add(5).readU8(), sa.add(6).readU8(), sa.add(7).readU8()] };
  } catch (e) { return null; }
}
function igual(a, b) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]; }
function copiaPara(sa) {   // sockaddr_in de 16 bytes com o IP trocado por TDB_HOST
  const c = Memory.alloc(16);
  c.writeByteArray(sa.readByteArray(16));
  for (let i = 0; i < 4; i++) c.add(4 + i).writeU8(alvo[i]);
  return c;
}
function trocarDestino(args, iSa) {
  const d = ler(args[iSa]);
  if (!d || d.porta !== PORTA || igual(d.ip, alvo) || (d.ip[0] === 127)) return;
  if (!original || !igual(original, d.ip)) { original = d.ip; rlog('join para ' + d.ip.join('.') + ':' + PORTA + ' redirecionado para ' + alvo.join('.') + ':' + PORTA); }
  const c = copiaPara(args[iSa]);
  args[iSa] = c;
  this.copia = c;                 // mantem viva ate o fim da chamada
  if (++nEnv === 1 || nEnv % 500 === 0) rlog('pacotes redirecionados: ' + nEnv);
}
function trocarOrigem(sa) {
  if (!original) return;
  const d = ler(sa);
  if (!d || d.porta !== PORTA || !igual(d.ip, alvo)) return;
  for (let i = 0; i < 4; i++) sa.add(4 + i).writeU8(original[i]);
  if (++nRec === 1 || nRec % 500 === 0) rlog('respostas do servidor entregues: ' + nRec);
}

// sendto(s, buf, len, flags, to, tolen)
Interceptor.attach(ws2.getExportByName('sendto'), { onEnter(args) { trocarDestino.call(this, args, 4); } });
// WSASendTo(s, bufs, count, sent, flags, to, tolen, overlapped, routine)
const wsaSendTo = ws2.findExportByName('WSASendTo');
if (wsaSendTo) Interceptor.attach(wsaSendTo, { onEnter(args) { trocarDestino.call(this, args, 5); } });
// recvfrom(s, buf, len, flags, from, fromlen)
Interceptor.attach(ws2.getExportByName('recvfrom'), {
  onEnter(args) { this.from = args[4]; },
  onLeave(ret) { if (ret.toInt32() > 0 && !this.from.isNull()) trocarOrigem(this.from); }
});
// WSARecvFrom(s, bufs, count, recvd, flags, from, fromlen, overlapped, routine): so o caso sincrono (retorno 0)
const wsaRecvFrom = ws2.findExportByName('WSARecvFrom');
if (wsaRecvFrom) Interceptor.attach(wsaRecvFrom, {
  onEnter(args) { this.from = args[5]; },
  onLeave(ret) { if (ret.toInt32() === 0 && !this.from.isNull()) trocarOrigem(this.from); }
});
rlog('pronto: join na porta ' + PORTA + ' sempre vai para ' + alvo.join('.'));
})();
