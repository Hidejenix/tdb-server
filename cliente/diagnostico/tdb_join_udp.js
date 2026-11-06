/**
 * Diagnostico do join (somente leitura): registra o trafego de rede do cliente para 127.0.0.1
 * e para as portas 11111 / 7777 (porta do host), com o erro do Windows quando falha.
 * Nao altera o trafego: so le os enderecos e loga o retorno.
 */
(function () {
'use strict';

function jlog(msg) {
  console.log('[join] ' + msg);
  send({ tdb: '[join] ' + msg });
}

const ws2 = Process.getModuleByName('ws2_32.dll');
const wsaGetLastError = new NativeFunction(ws2.getExportByName('WSAGetLastError'), 'int', []);
const JOIN_PORTS = [11111, 7777];
let count = 0;

function describe(sa) {
  const family = sa.readU16();
  if (family !== 2) return null;
  const port = (sa.add(2).readU8() << 8) | sa.add(3).readU8();
  const ip = [sa.add(4).readU8(), sa.add(5).readU8(), sa.add(6).readU8(), sa.add(7).readU8()].join('.');
  return { ip: ip, port: port };
}

function interesting(d) {
  return d && (d.ip === '127.0.0.1' || JOIN_PORTS.indexOf(d.port) >= 0);
}

// sendto(s, buf, len, flags, to, tolen)
Interceptor.attach(ws2.getExportByName('sendto'), {
  onEnter(args) {
    const d = describe(args[4]);
    this.d = interesting(d) ? d : null;
    this.len = args[2].toInt32();
  },
  onLeave(retval) {
    if (!this.d) return;
    count++;
    if (count <= 300) {
      jlog('sendto ' + this.d.ip + ':' + this.d.port + ' len=' + this.len + ' ret=' + retval.toInt32() + ' err=' + wsaGetLastError());
    }
  }
});

// WSASendTo(s, bufs, count, sent, flags, to, tolen, overlapped, routine)
const wsaSendTo = ws2.findExportByName('WSASendTo');
if (wsaSendTo) {
  Interceptor.attach(wsaSendTo, {
    onEnter(args) {
      const d = describe(args[5]);
      this.d = interesting(d) ? d : null;
    },
    onLeave(retval) {
      if (!this.d) return;
      count++;
      if (count <= 300) {
        jlog('WSASendTo ' + this.d.ip + ':' + this.d.port + ' ret=' + retval.toInt32() + ' err=' + wsaGetLastError());
      }
    }
  });
}

// bind(s, name, namelen): porta local usada pelo cliente
Interceptor.attach(ws2.getExportByName('bind'), {
  onEnter(args) {
    const d = describe(args[1]);
    this.d = d;
  },
  onLeave(retval) {
    if (this.d) jlog('bind local porta=' + this.d.port + ' ip=' + this.d.ip + ' ret=' + retval.toInt32() + ' err=' + wsaGetLastError());
  }
});

// connect(s, name, namelen): conexoes TCP para 127.0.0.1 ou porta do host
Interceptor.attach(ws2.getExportByName('connect'), {
  onEnter(args) {
    const d = describe(args[1]);
    this.d = interesting(d) ? d : null;
  },
  onLeave(retval) {
    if (!this.d) return;
    jlog('connect ' + this.d.ip + ':' + this.d.port + ' ret=' + retval.toInt32() + ' err=' + wsaGetLastError());
  }
});

jlog('hook de join armado (sendto, WSASendTo, bind, connect)');
})();
