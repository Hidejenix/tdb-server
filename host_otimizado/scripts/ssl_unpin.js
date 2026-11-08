/**
 * The Day Before — TLS bypass for mitmproxy.
 * WinHTTP/Schannel + libssl/libcurl (if loaded) + embedded curl PINNEDPUBLICKEY.
 */
'use strict';

function log(msg) {
  console.log('[tdb-unpin] ' + msg);
  try {
    send({ tdb: msg });
  } catch (e) {}
}

function getExport(moduleName, exportName) {
  try {
    const mod = Process.getModuleByName(moduleName);
    return mod.getExportByName(exportName);
  } catch (e) {
    try {
      return Module.getGlobalExportByName(exportName);
    } catch (e2) {
      return null;
    }
  }
}

function tryHook(moduleName, exportName, callbacks) {
  const addr = getExport(moduleName, exportName);
  if (!addr) return false;
  try {
    Interceptor.attach(addr, callbacks);
    log('hooked ' + moduleName + '!' + exportName);
    return true;
  } catch (e) {
    log('hook fail ' + exportName + ': ' + e);
    return false;
  }
}

const hooked = {};
const WINHTTP_OPTION_SECURITY_FLAGS = 31;
const IGNORE_FLAGS = 0x00000100 | 0x00002000 | 0x00001000 | 0x00000200;
// CURLOPT_PINNEDPUBLICKEY = CURLOPTTYPE_STRINGPOINT + 230 = 10230
const CURLOPT_PINNEDPUBLICKEY = 10230;
const CURLOPT_SSL_VERIFYPEER = 64;
const CURLOPT_SSL_VERIFYHOST = 81;

function forceIgnore(hRequest) {
  if (hRequest.isNull()) return;
  const setOpt = getExport('Winhttp.dll', 'WinHttpSetOption');
  if (!setOpt) return;
  const buf = Memory.alloc(4);
  buf.writeU32(IGNORE_FLAGS);
  const fn = new NativeFunction(setOpt, 'int', ['pointer', 'uint', 'pointer', 'uint']);
  fn(hRequest, WINHTTP_OPTION_SECURITY_FLAGS, buf, 4);
}

function hookSchannel() {
  if (hooked.schannel) return;
  hooked.schannel = true;

  tryHook('Crypt32.dll', 'CertVerifyCertificateChainPolicy', {
    onEnter(args) {
      this.status = args[3];
    },
    onLeave(retval) {
      retval.replace(ptr(1));
      try {
        if (this.status && !this.status.isNull()) this.status.add(4).writeU32(0);
      } catch (e) {}
    }
  });
  tryHook('Crypt32.dll', 'CertGetCertificateChain', {
    onLeave(retval) {
      retval.replace(ptr(1));
    }
  });
  tryHook('Winhttp.dll', 'WinHttpSetOption', {
    onEnter(args) {
      if (args[1].toInt32() === WINHTTP_OPTION_SECURITY_FLAGS) {
        try {
          args[2].writeU32(IGNORE_FLAGS);
        } catch (e) {}
      }
    }
  });
  ['WinHttpOpenRequest', 'WinHttpSendRequest', 'WinHttpReceiveResponse'].forEach(function (n) {
    tryHook('Winhttp.dll', n, {
      onEnter(args) {
        forceIgnore(args[0]);
      }
    });
  });
}

function hookOpenSsl(moduleName) {
  if (hooked['ssl:' + moduleName]) return;
  hooked['ssl:' + moduleName] = true;
  tryHook(moduleName, 'SSL_CTX_set_verify', {
    onEnter(args) {
      args[1] = ptr(0);
    }
  });
  tryHook(moduleName, 'SSL_set_verify', {
    onEnter(args) {
      args[1] = ptr(0);
    }
  });
  tryHook(moduleName, 'SSL_get_verify_result', {
    onLeave(retval) {
      retval.replace(ptr(0));
    }
  });
  tryHook(moduleName, 'X509_verify_cert', {
    onLeave(retval) {
      retval.replace(ptr(1));
    }
  });
}

function hookCurlSetopt(addr, label) {
  if (hooked['setopt:' + label]) return;
  hooked['setopt:' + label] = true;
  Interceptor.attach(addr, {
    onEnter(args) {
      const opt = args[1].toInt32();
      if (
        opt === CURLOPT_SSL_VERIFYPEER ||
        opt === CURLOPT_SSL_VERIFYHOST ||
        opt === CURLOPT_PINNEDPUBLICKEY ||
        opt === 248 ||
        opt === 249
      ) {
        args[2] = ptr(0);
        log('setopt cleared opt=' + opt + ' via ' + label);
      }
    }
  });
  log('hooked curl_easy_setopt @ ' + addr + ' (' + label + ')');
}

function hookCurlModule(moduleName) {
  const addr = getExport(moduleName, 'curl_easy_setopt');
  if (addr) hookCurlSetopt(addr, moduleName);
}

function patchEmbeddedPins() {
  let main = null;
  Process.enumerateModules().forEach(function (m) {
    if (m.name.toLowerCase() === 'thedaybefore.exe') main = m;
  });
  if (!main) {
    log('TheDayBefore.exe module not found');
    return;
  }
  log('main module ' + main.base + ' size=' + main.size);

  // Neutralize pinned-key option strings in image (curl reads these)
  const patterns = [
    '70 75 62 6c 69 63 20 6b 65 79 20 68 61 73 68 3a 20 73 68 61 32 35 36', // public key hash: sha256
    '73 68 61 32 35 36 2f 2f' // sha256//
  ];
  patterns.forEach(function (pat) {
    try {
      const hits = Memory.scanSync(main.base, main.size, pat);
      log('scan ' + pat.slice(0, 12) + '... hits=' + hits.length);
      hits.forEach(function (h) {
        try {
          // Make string empty / inert: write leading NUL
          h.address.writeU8(0);
        } catch (e) {
          // .rdata may be read-only — protect+write
          try {
            Memory.protect(h.address, 8, 'rwx');
            h.address.writeU8(0);
          } catch (e2) {
            log('patch fail ' + e2);
          }
        }
      });
    } catch (e) {
      log('scan fail: ' + e);
    }
  });

  // If side-by-side libcurl exists on disk, load+hook it (some paths use it)
  try {
    const LoadLibraryW = new NativeFunction(getExport('kernel32.dll', 'LoadLibraryW'), 'pointer', [
      'pointer'
    ]);
    const dir = main.path.substring(0, main.path.lastIndexOf('\\') + 1);
    ['libcrypto-1_1-x64.dll', 'libssl-1_1-x64.dll', 'libcurl.dll'].forEach(function (n) {
      const h = LoadLibraryW(Memory.allocUtf16String(dir + n));
      log('LoadLibrary ' + n + ' => ' + h);
    });
    hookOpenSsl('libssl-1_1-x64.dll');
    hookCurlModule('libcurl.dll');
  } catch (e) {
    log('LoadLibrary path: ' + e);
  }
}

function hookAll() {
  hookSchannel();
  ['libssl-1_1-x64.dll', 'libssl-1_1.dll'].forEach(function (n) {
    try {
      Process.getModuleByName(n);
      hookOpenSsl(n);
    } catch (e) {}
  });
  try {
    Process.getModuleByName('libcurl.dll');
    hookCurlModule('libcurl.dll');
  } catch (e) {}
  patchEmbeddedPins();
}

const loadLib = getExport('kernel32.dll', 'LoadLibraryExW') || getExport('kernel32.dll', 'LoadLibraryW');
if (loadLib) {
  Interceptor.attach(loadLib, {
    onEnter(args) {
      try {
        this.name = args[0].readUtf16String();
      } catch (e) {
        this.name = null;
      }
    },
    onLeave() {
      if (!this.name) return;
      const lower = this.name.toLowerCase();
      if (lower.indexOf('libssl') !== -1) hookOpenSsl(this.name.split('\\').pop());
      if (lower.indexOf('libcurl') !== -1) hookCurlModule(this.name.split('\\').pop());
    }
  });
}

hookAll();
log('ready pid=' + Process.id);

function bypassInternalBoringSSL() {
  log('A iniciar monitorização de chamadas de sistema corrigida...');

  let main = null;
  Process.enumerateModules().forEach(function (m) {
    if (m.name.toLowerCase() === 'thedaybefore.exe') main = m;
  });

  if (!main) {
    log('Módulo principal não encontrado.');
    return;
  }
  log('Módulo principal mapeado com sucesso em: ' + main.base);

  // Correção do CreateFileW usando getExport e args[0].readUtf16String() (Frida 17+)
  const createFileAddr = getExport('kernel32.dll', 'CreateFileW');
  if (createFileAddr) {
    Interceptor.attach(createFileAddr, {
      onEnter(args) {
        if (args[0] && !args[0].isNull()) {
          try {
            const path = args[0].readUtf16String();
            if (path && (path.toLowerCase().indexOf('firebase') !== -1 || path.toLowerCase().indexOf('grpc') !== -1)) {
              log('Detetado acesso a recurso gRPC/Firebase no disco: ' + path);
            }
          } catch (e) {
            // Silencia falhas se não for uma string válida
          }
        }
      }
    });
  }

  // Garante que ws2_32.dll esteja carregada antes de instalar o hook no modo spawn
  try {
    const LoadLibraryW = new NativeFunction(getExport('kernel32.dll', 'LoadLibraryW'), 'pointer', ['pointer']);
    LoadLibraryW(Memory.allocUtf16String('ws2_32.dll'));
  } catch (e) {}

  // So desviar AUTH (Identity Toolkit / Secure Token / CheckOwnership).
  // NAO desviar Firestore gRPC (443 generico) — mitm REST nao fala gRPC → lista vazia + Permission denied.
  const redirectHosts = {};
  const AUTH_HOST_RE = /identitytoolkit|securetoken|checkownership/i;

  (function hookDnsAndConnect() {
    function markAuthAddrs(node, resPtr) {
      if (!node || !AUTH_HOST_RE.test(node) || !resPtr || resPtr.isNull()) return;
      try {
        // MSVC x64 ADDRINFOA/W: ai_addr@32, ai_next@40
        let ai = resPtr.readPointer();
        while (!ai.isNull()) {
          const ai_addr = ai.add(32).readPointer();
          if (!ai_addr.isNull() && ai_addr.readU16() === 2) {
            const ip =
              ai_addr.add(4).readU8() +
              '.' +
              ai_addr.add(5).readU8() +
              '.' +
              ai_addr.add(6).readU8() +
              '.' +
              ai_addr.add(7).readU8();
            redirectHosts[ip] = node;
            log('[DNS] auth host ' + node + ' -> ' + ip + ' (redirect OK)');
          }
          ai = ai.add(40).readPointer();
        }
      } catch (e) {
        log('[DNS] parse fail: ' + e);
      }
    }

    function attachGetAddrInfo(name, readNode) {
      const gai = getExport('ws2_32.dll', name);
      if (!gai) return;
      Interceptor.attach(gai, {
        onEnter(args) {
          try {
            this.node = args[0].isNull() ? null : readNode(args[0]);
            this.resPtr = args[3];
          } catch (e) {
            this.node = null;
            this.resPtr = null;
          }
        },
        onLeave(retval) {
          if (retval.toInt32() !== 0) return;
          markAuthAddrs(this.node, this.resPtr);
        },
      });
      log('hook ' + name + ' (auth whitelist)');
    }

    attachGetAddrInfo('getaddrinfo', function (p) {
      return p.readUtf8String();
    });
    attachGetAddrInfo('GetAddrInfoW', function (p) {
      return p.readUtf16String();
    });

    const connectAddr = getExport('ws2_32.dll', 'connect');
    if (!connectAddr) return;
    Interceptor.attach(connectAddr, {
      onEnter(args) {
        if (!args[1] || args[1].isNull()) return;
        try {
          const sockaddr = args[1];
          if (sockaddr.readU16() !== 2) return;
          const port = (sockaddr.add(2).readU8() << 8) | sockaddr.add(3).readU8();
          const ipStr =
            sockaddr.add(4).readU8() +
            '.' +
            sockaddr.add(5).readU8() +
            '.' +
            sockaddr.add(6).readU8() +
            '.' +
            sockaddr.add(7).readU8();
          if (port !== 443) return;
          if (!redirectHosts[ipStr]) return;
          log('[PATCH REDE] auth ' + redirectHosts[ipStr] + ' ' + ipStr + ':443 -> 127.0.0.1:8080');
          sockaddr.add(4).writeU8(127);
          sockaddr.add(5).writeU8(0);
          sockaddr.add(6).writeU8(0);
          sockaddr.add(7).writeU8(1);
          sockaddr.add(2).writeU8((8080 >> 8) & 0xff);
          sockaddr.add(3).writeU8(8080 & 0xff);
        } catch (e) {
          log('Erro connect patch: ' + e);
        }
      },
    });
  })();
}

// Executar a rotina corrigida
bypassInternalBoringSSL();


/**
 * Travel offline / LAN via UEngine::Browse (vtable +0x4B0).
 *
 * IMPORTANTE: nao substituir Browse por LoadMap — isso salta listen/WP e da void vermelho.
 * Em vez disso: reescreve a FURL e deixa o Browse ORIGINAL correr.
 *
 * Modos (TDB_TRAVEL / rpc): listen | join=IP:PORT | off | once
 * forceListen(): escreve TravelURL no WorldContext; TickWorldTravel chama Browse.
 */
function aplicarDesvioParaLoadMap() {
  log('A inicializar travel Browse (rewrite FURL, Browse original)...');

  let main = null;
  Process.enumerateModules().forEach(function (m) {
    if (m.name.toLowerCase() === 'thedaybefore.exe') main = m;
  });
  if (!main) {
    log('Erro: TheDayBefore.exe nao encontrado.');
    return;
  }

  const browseAddress = main.base.add(0x467e880);
  const fUrlCtorAddress = main.base.add(0x46bc440);
  const fUrlDtorAddress = main.base.add(0xc1f0c0);
  const fUrlHasOptionAddress = main.base.add(0x46d7a60);
  const loadMapAddress = main.base.add(0x4717f80);
  const tickAddress = main.base.add(0x40d5230);
  const gEngineSlot = main.base.add(0x7e20ea8);
  const fstringAssign = new NativeFunction(
    main.base.add(0x2134630),
    'pointer',
    ['pointer', 'pointer']
  );

  const nativeFUrlCtor = new NativeFunction(
    fUrlCtorAddress,
    'pointer',
    ['pointer', 'pointer', 'pointer', 'int32']
  );
  const nativeFUrlDtor = new NativeFunction(fUrlDtorAddress, 'void', ['pointer']);
  const nativeFUrlHasOption = new NativeFunction(
    fUrlHasOptionAddress,
    'uint8',
    ['pointer', 'pointer']
  );
  // ServerDefaultMap (pak) — short name costuma resolver melhor no Browse
  const MAP_PATH = 'NewCity_persistent_WP';
  const MAP_PATH_FULL =
    '/Game/A_TestMap/LandscapeParts/NewCity_WC/NewCity_persistent_WP';
  const GAME_OPT =
    '?game=/Game/ThirdPersonBP/Blueprints/TDB_GameMode.TDB_GameMode_C';

  const state = {
    mode: 'listen',
    joinTarget: '',
    once: false,
    armed: true,
    diverted: 0,
    skippedBoot: 0,
    forcePending: false,
    forceDone: false,
    forceSolo: false,
    forceVariant: 'short', // short | full | game
  };

  const listenOptBuf = Memory.allocUtf16String('listen');

  // Captura mensagens UE relevantes (se -log / OutputDebugString)
  const ods = getExport('kernel32.dll', 'OutputDebugStringW');
  if (ods) {
    Interceptor.attach(ods, {
      onEnter(args) {
        try {
          const s = args[0].readUtf16String();
          if (
            s &&
            /travel|listen|NetDriver|LoadMap|Browse|Unable to|World Partition|InitListen|Error:/i.test(
              s
            )
          ) {
            log('ODS: ' + s.slice(0, 240));
          }
        } catch (e) {}
      },
    });
  }

  const BOOT_MAP_MARKERS = [
    'mainmenu',
    'gate_intro',
    'transition',
    'entry',
    'frontend',
    'login',
  ];

  function isBootMap(mapPath) {
    if (!mapPath) return true;
    const low = String(mapPath).toLowerCase();
    for (let i = 0; i < BOOT_MAP_MARKERS.length; i++) {
      if (low.indexOf(BOOT_MAP_MARKERS[i]) >= 0) return true;
    }
    return false;
  }

  function parseMode(raw) {
    if (!raw) return;
    const s = String(raw).trim();
    const low = s.toLowerCase();
    if (low === 'off' || low === 'passthrough' || low === '0') {
      state.mode = 'off';
      state.armed = false;
      return;
    }
    if (low === 'once') {
      state.mode = 'listen';
      state.once = true;
      state.armed = true;
      return;
    }
    if (low === 'listen' || low === 'host') {
      state.mode = 'listen';
      state.armed = true;
      return;
    }
    if (low.indexOf('join=') === 0 || low.indexOf('join:') === 0) {
      state.mode = 'join';
      state.joinTarget = s.slice(5).trim();
      if (state.joinTarget.indexOf(':') < 0) state.joinTarget += ':7777';
      state.armed = true;
      return;
    }
    if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(s)) {
      state.mode = 'join';
      state.joinTarget = s.indexOf(':') >= 0 ? s : s + ':7777';
      state.armed = true;
    }
  }

  try {
    if (typeof TDB_TRAVEL !== 'undefined' && TDB_TRAVEL) parseMode(TDB_TRAVEL);
  } catch (e) {}

  function mapBaseForVariant() {
    if (state.forceVariant === 'full') return MAP_PATH_FULL;
    return MAP_PATH;
  }

  function buildTravelUrl() {
    if (state.mode === 'join' && state.joinTarget) return state.joinTarget;
    const base = mapBaseForVariant();
    if (state.forceSolo) return base;
    // UE FURL options: first '?' then '&' for extras (not second '?')
    if (state.forceVariant === 'game') return base + '?listen' + GAME_OPT.replace(/^\?/, '&');
    return base + '?listen';
  }

  function readFurlMap(fUrlPtr) {
    try {
      if (!fUrlPtr || fUrlPtr.isNull()) return '';
      const mapDataPtr = fUrlPtr.add(0x28).readPointer();
      if (mapDataPtr.isNull()) return '';
      return mapDataPtr.readUtf16String() || '';
    } catch (e) {
      return '';
    }
  }

  function furlHasListen(fUrlPtr) {
    try {
      return nativeFUrlHasOption(fUrlPtr, listenOptBuf) !== 0;
    } catch (e) {
      return false;
    }
  }

  function rewriteFurlInPlace(fUrlPtr, urlTxt) {
    const urlBuf = Memory.allocUtf16String(urlTxt);
    nativeFUrlDtor(fUrlPtr);
    nativeFUrlCtor(fUrlPtr, ptr(0), urlBuf, 0);
  }

  Interceptor.attach(loadMapAddress, {
    onEnter(args) {
      try {
        const mapName = readFurlMap(args[2]);
        const hasL = furlHasListen(args[2]);
        log('[LoadMap] map="' + mapName + '" listen=' + hasL);
      } catch (e) {
        log('[LoadMap] enter');
      }
    },
    onLeave(retval) {
      try {
        log('[LoadMap] return=' + retval);
      } catch (e) {}
    },
  });

  Interceptor.attach(browseAddress, {
    onEnter: function (args) {
      const fUrlPtr = args[2];
      const mapOriginal = readFurlMap(fUrlPtr);
      const hasL = furlHasListen(fUrlPtr);
      log(
        '[Browse] map="' +
          mapOriginal +
          '" listen=' +
          hasL +
          ' armed=' +
          state.armed +
          ' mode=' +
          state.mode
      );

      if (!state.armed || state.mode === 'off') return;
      if (isBootMap(mapOriginal)) {
        state.skippedBoot++;
        log('[PASSTHROUGH] boot skip#' + state.skippedBoot);
        return;
      }

      const low = (mapOriginal || '').toLowerCase();
      const isTarget =
        low.indexOf('newcity') >= 0 || low.indexOf('persistent_wp') >= 0;

      // Se ja e NewCity COM listen, nao reescrever (rewrite a meio partia WP).
      // Desarmar apos sucesso — evita loop Browse se TravelURL/F7 voltar a disparar.
      if (isTarget && hasL && !state.forceSolo) {
        log('[PASSTHROUGH] NewCity+listen intacta — disarm');
        state.diverted++;
        state.armed = false;
        state.forcePending = false;
        state.forceDone = true;
        return;
      }
      if (isTarget && state.forceSolo) {
        log('[PASSTHROUGH] NewCity solo intacta — disarm');
        state.diverted++;
        state.armed = false;
        state.forcePending = false;
        state.forceDone = true;
        return;
      }

      const urlTxt = buildTravelUrl();
      try {
        rewriteFurlInPlace(fUrlPtr, urlTxt);
        state.diverted++;
        log(
          '[REWRITE] "' +
            mapOriginal +
            '" -> ' +
            urlTxt +
            ' listenNow=' +
            furlHasListen(fUrlPtr)
        );
        if (state.once) {
          state.armed = false;
          log('[REWRITE] once: desarmado');
        }
      } catch (e) {
        log('[REWRITE] falha: ' + e);
      }
    },
    onLeave: function (retval) {
      try {
        log('[Browse] return=' + retval.toInt32());
      } catch (e) {}
    },
  });

  function queueListenNow(solo, variant) {
    state.forceDone = false;
    state.forcePending = true;
    state.forceSolo = !!solo;
    if (variant) state.forceVariant = variant;
    if (state.mode === 'off') state.mode = 'listen';
    state.armed = true;
    log(
      'forceListen: TravelURL no proximo Tick' +
        (solo ? ' (solo)' : '') +
        ' variant=' +
        state.forceVariant
    );
    return { ok: true, solo: !!solo, variant: state.forceVariant };
  }

  // Teclas F6-F9 OFF por defeito — host_flow.js usa F7=HideLoading / F8=listen.
  // Sem isto, F7 do host_flow dispara solo travel aqui e entra em loop de Browse.
  // Reactivar: var TDB_TRAVEL_KEYS = true; antes do script.
  const travelKeysOn =
    typeof TDB_TRAVEL_KEYS !== 'undefined' ? !!TDB_TRAVEL_KEYS : false;
  const gaksAddr = travelKeysOn ? getExport('user32.dll', 'GetAsyncKeyState') : null;
  const GetAsyncKeyState = gaksAddr
    ? new NativeFunction(gaksAddr, 'int16', ['int'])
    : null;
  let f6WasDown = false;
  let f7WasDown = false;
  let f8WasDown = false;
  let f9WasDown = false;
  if (!travelKeysOn) {
    log('travel keys F6-F9 DESLIGADAS (host_flow manda; rpc.forceListen ok)');
  }

  Interceptor.attach(tickAddress, {
    onEnter: function (args) {
      if (GetAsyncKeyState) {
        try {
          const f6 = (GetAsyncKeyState(0x75) & 0x8000) !== 0;
          const f7 = (GetAsyncKeyState(0x76) & 0x8000) !== 0;
          const f8 = (GetAsyncKeyState(0x77) & 0x8000) !== 0;
          const f9 = (GetAsyncKeyState(0x78) & 0x8000) !== 0;
          if (f6 && !f6WasDown) {
            log('[KEY] F6 short?listen');
            queueListenNow(false, 'short');
          }
          if (f7 && !f7WasDown) {
            log('[KEY] F7 solo');
            queueListenNow(true, 'short');
          }
          if (f8 && !f8WasDown) {
            log('[KEY] F8 full?listen');
            queueListenNow(false, 'full');
          }
          if (f9 && !f9WasDown) {
            log('[KEY] F9 short?listen&game=');
            queueListenNow(false, 'game');
          }
          f6WasDown = f6;
          f7WasDown = f7;
          f8WasDown = f8;
          f9WasDown = f9;
        } catch (e) {}
      }

      if (!state.forcePending) return;
      try {
        const ge = gEngineSlot.readPointer();
        const eng = !ge.isNull() ? ge : args[0];
        if (eng.isNull()) return;
        const listData = eng.add(0xec0).readPointer();
        const listNum = eng.add(0xec8).readS32();
        if (listNum < 1 || listData.isNull()) return;
        const ctx = listData.readPointer();
        if (ctx.isNull()) return;

        const urlTxt = buildTravelUrl();
        const urlBuf = Memory.allocUtf16String(urlTxt);
        fstringAssign(ctx.add(0xa8), urlBuf);
        ctx.add(0xb8).writeU8(0); // TRAVEL_Absolute
        state.forcePending = false;
        state.forceDone = true;
        log('[FORCE] TravelURL="' + urlTxt + '" (TickWorldTravel -> Browse)');
      } catch (e) {
        log('[FORCE] erro: ' + e);
      }
    },
  });

  rpc.exports = {
    setTravel: function (mode) {
      parseMode(mode);
      return { mode: state.mode, join: state.joinTarget, armed: state.armed };
    },
    armOnce: function () {
      state.mode = 'listen';
      state.once = true;
      state.armed = true;
      return true;
    },
    forceListen: function () {
      return queueListenNow(false);
    },
    forceSolo: function () {
      return queueListenNow(true);
    },
    status: function () {
      return {
        mode: state.mode,
        join: state.joinTarget,
        armed: state.armed,
        once: state.once,
        diverted: state.diverted,
        skippedBoot: state.skippedBoot,
        forcePending: state.forcePending,
        forceDone: state.forceDone,
        url: buildTravelUrl(),
      };
    },
  };

  log(
    'Browse rewrite OK @ ' +
      browseAddress +
      ' | mode=' +
      state.mode +
      ' | keys=' +
      (typeof TDB_TRAVEL_KEYS !== 'undefined' && TDB_TRAVEL_KEYS
        ? 'F6-F9 ON'
        : 'OFF(host_flow)') +
      ' | rpc.forceListen'
  );
}

aplicarDesvioParaLoadMap();
