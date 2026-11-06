/**
 * 1) Lista Steam falsa (1 servidor local)
 * 2) No Join/ClientTravel para 127.0.0.1 → TravelURL NewCity?listen (host offline)
 *
 * Assim o clique no browser dispara carregamento de mapa, nao connect a porta vazia.
 */
'use strict';

function log(msg) {
  console.log('[tdb-fake] ' + msg);
  try {
    send({ tdb: msg });
  } catch (e) {}
}

function getExport(mod, name) {
  try {
    return Process.getModuleByName(mod).getExportByName(name);
  } catch (e) {
    return null;
  }
}

function hook(mod, name, cbs) {
  const addr = getExport(mod, name);
  if (!addr) return false;
  try {
    Interceptor.attach(addr, cbs);
    log('hook ' + name);
    return true;
  } catch (e) {
    log('hook fail ' + name + ': ' + e);
    return false;
  }
}

const STEAM = 'steam_api64.dll';
const LOCAL_IP = (127 << 24) | (0 << 16) | (0 << 8) | 1;
const GAME_PORT = 7777;
const QUERY_PORT = 27015;
const TRAVEL_URL =
  '/Game/A_TestMap/LandscapeParts/NewCity_WC/NewCity_persistent_WP?listen';

const fakeRequests = {};
let fakeItemPtr = null;

let main = null;
Process.enumerateModules().forEach(function (m) {
  if (m.name.toLowerCase() === 'thedaybefore.exe') main = m;
});

const gEngineSlot = main ? main.base.add(0x7e20ea8) : null;
const tickAddress = main ? main.base.add(0x40d5230) : null;
const fstringAssign = main
  ? new NativeFunction(main.base.add(0x2134630), 'pointer', ['pointer', 'pointer'])
  : null;

let pendingListen = false;

function queueHostListen(reason) {
  pendingListen = true;
  log('queue host listen (' + reason + ') -> ' + TRAVEL_URL);
}

function allocGameServerItem() {
  const p = Memory.alloc(512);
  p.writeByteArray(new Array(512).fill(0));
  p.writeU16(GAME_PORT);
  p.add(2).writeU16(QUERY_PORT);
  p.add(4).writeU32(LOCAL_IP);
  p.add(8).writeS32(12);
  p.add(12).writeU8(1);
  p.add(13).writeU8(0);
  Memory.writeUtf8String(p.add(16), 'Survival');
  Memory.writeUtf8String(p.add(48), 'NewCity_persistent_WP');
  Memory.writeUtf8String(p.add(80), 'TDB Offline Local');
  const after = p.add(144);
  after.writeU32(0);
  after.add(4).writeS32(1);
  after.add(8).writeS32(64);
  after.add(12).writeS32(0);
  Memory.writeUtf8String(p.add(168), 'TDB Offline Local');
  Memory.writeUtf8String(p.add(176), 'TDB Offline Local');
  Memory.writeUtf8String(p.add(184), 'TDB Offline Local');
  return p;
}

function tryFireRefreshComplete(respPtr, hRequest) {
  if (!respPtr || respPtr.isNull()) return;
  try {
    const vtable = respPtr.readPointer();
    const ServerResponded = new NativeFunction(
      vtable.readPointer(),
      'void',
      ['pointer', 'pointer', 'int']
    );
    const RefreshComplete = new NativeFunction(
      vtable.add(Process.pointerSize * 2).readPointer(),
      'void',
      ['pointer', 'pointer', 'int']
    );
    ServerResponded(respPtr, hRequest, 0);
    RefreshComplete(respPtr, hRequest, 0);
    log('ServerResponded+RefreshComplete');
  } catch (e) {
    log('callback skip: ' + e);
  }
}

function setupServerListHooks() {
  hook(STEAM, 'SteamAPI_ISteamMatchmakingServers_RequestInternetServerList', {
    onEnter(args) {
      this.resp = args[4];
    },
    onLeave(retval) {
      const h = retval.toString();
      fakeRequests[h] = true;
      fakeItemPtr = fakeItemPtr || allocGameServerItem();
      log('InternetServerList => fake 1');
      tryFireRefreshComplete(this.resp, retval);
    },
  });

  hook(STEAM, 'SteamAPI_ISteamMatchmakingServers_RequestLANServerList', {
    onEnter(args) {
      this.resp = args[2];
    },
    onLeave(retval) {
      const h = retval.toString();
      fakeRequests[h] = true;
      fakeItemPtr = fakeItemPtr || allocGameServerItem();
      log('LANServerList => fake 1');
      tryFireRefreshComplete(this.resp, retval);
    },
  });

  hook(STEAM, 'SteamAPI_ISteamMatchmakingServers_GetServerCount', {
    onEnter(args) {
      this.h = args[1];
    },
    onLeave(retval) {
      if (Object.keys(fakeRequests).length) {
        retval.replace(ptr(1));
      }
    },
  });

  hook(STEAM, 'SteamAPI_ISteamMatchmakingServers_GetServerDetails', {
    onLeave(retval) {
      if (Object.keys(fakeRequests).length) {
        fakeItemPtr = fakeItemPtr || allocGameServerItem();
        retval.replace(fakeItemPtr);
      }
    },
  });

  // Join / lobby → nao conectar; virar host listen
  hook(STEAM, 'SteamAPI_ISteamMatchmaking_JoinLobby', {
    onEnter() {
      queueHostListen('JoinLobby');
    },
  });

  hook(STEAM, 'SteamAPI_ISteamMatchmaking_GetLobbyGameServer', {
    onEnter(args) {
      this.ipPtr = args[2];
      this.portPtr = args[3];
    },
    onLeave(retval) {
      try {
        if (this.ipPtr && !this.ipPtr.isNull()) this.ipPtr.writeU32(LOCAL_IP);
        if (this.portPtr && !this.portPtr.isNull()) this.portPtr.writeU16(GAME_PORT);
        retval.replace(ptr(1));
        queueHostListen('GetLobbyGameServer');
      } catch (e) {}
    },
  });
}

function setupBrowseJoinDivert() {
  if (!main || !tickAddress || !fstringAssign) {
    log('exe helpers missing');
    return;
  }

  // ClientTravel / open IP: se for 127.0.0.1 ou vazio de sessao, virar listen
  const browseAddress = main.base.add(0x467e880);
  Interceptor.attach(browseAddress, {
    onEnter(args) {
      try {
        const fUrl = args[2];
        if (!fUrl || fUrl.isNull()) return;
        const hostPtr = fUrl.add(0x8).readPointer(); // FURL.Host often near start — best effort
        let host = '';
        let map = '';
        try {
          const mapPtr = fUrl.add(0x28).readPointer();
          if (!mapPtr.isNull()) map = mapPtr.readUtf16String() || '';
        } catch (e) {}
        try {
          if (hostPtr && !hostPtr.isNull()) host = hostPtr.readUtf16String() || '';
        } catch (e) {}

        const blob = (host + ' ' + map).toLowerCase();
        if (
          blob.indexOf('127.0.0.1') >= 0 ||
          blob.indexOf('localhost') >= 0 ||
          blob.indexOf(':7777') >= 0
        ) {
          log('Browse join-like "' + map + '" / host="' + host + '" -> host listen');
          queueHostListen('Browse');
          // Reescreve FURL para listen host (mapa), nao client connect
          const ctor = new NativeFunction(
            main.base.add(0x46bc440),
            'pointer',
            ['pointer', 'pointer', 'pointer', 'int32']
          );
          const dtor = new NativeFunction(main.base.add(0xc1f0c0), 'void', ['pointer']);
          const urlBuf = Memory.allocUtf16String(TRAVEL_URL);
          dtor(fUrl);
          ctor(fUrl, ptr(0), urlBuf, 0);
        }
      } catch (e) {
        log('Browse divert err: ' + e);
      }
    },
  });

  Interceptor.attach(tickAddress, {
    onEnter(args) {
      if (!pendingListen) return;
      try {
        const ge = gEngineSlot.readPointer();
        const eng = !ge.isNull() ? ge : args[0];
        if (eng.isNull()) return;
        const listData = eng.add(0xec0).readPointer();
        const listNum = eng.add(0xec8).readS32();
        if (listNum < 1 || listData.isNull()) return;
        const ctx = listData.readPointer();
        if (ctx.isNull()) return;
        pendingListen = false;
        const urlBuf = Memory.allocUtf16String(TRAVEL_URL);
        fstringAssign(ctx.add(0xa8), urlBuf);
        ctx.add(0xb8).writeU8(0);
        log('TravelURL set (host listen)');
      } catch (e) {
        log('Tick force err: ' + e);
      }
    },
  });
}

function setup() {
  setupBrowseJoinDivert();
  try {
    Process.getModuleByName(STEAM);
    setupServerListHooks();
    log('ready');
  } catch (e) {
    log('waiting steam_api64');
    const load =
      getExport('kernel32.dll', 'LoadLibraryExW') ||
      getExport('kernel32.dll', 'LoadLibraryW');
    if (load) {
      Interceptor.attach(load, {
        onEnter(args) {
          try {
            this.n = args[0].readUtf16String();
          } catch (err) {
            this.n = null;
          }
        },
        onLeave() {
          if (this.n && this.n.toLowerCase().indexOf('steam_api64') !== -1) {
            setupServerListHooks();
            log('steam hooks on');
          }
        },
      });
    }
  }
}

setup();
