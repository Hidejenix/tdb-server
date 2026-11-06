"""Cliente: abre o jogo como um jogador comum que entra no servidor local. Ver README.md na raiz do repositorio.

Rode em OUTRA conta do Windows (nao na conta do host): o banco local do Firestore em %LOCALAPPDATA% so abre em um
processo por usuario. Nessa conta: Python + pacote frida, e acesso de leitura a pasta do jogo.

O que faz:
  - grava o SteamId do cliente (emulador Goldberg) antes de abrir o jogo;
  - abre o jogo com tdb_connectex_test.js (Google:443 -> terminador TLS local; verificacao de certificado desligada em
    memoria) e tdb_fname_join.js (o join do Server Browser vai para 127.0.0.1:7777);
  - fica rodando ate o jogo fechar. Depois: login, Server Browser, Atualizar, SERVIDOR-LOCAL.

Uso:  python cliente_conecta.py [--diag] [segundos]
      --diag  liga os scripts de diagnostico de diagnostico\\ (mais lento)
Pasta do jogo: variavel de ambiente TDB_JOGO (padrao C:\\Games\\THE DAY BEFORE).
"""
from __future__ import annotations

import os
import shutil
import sys
import time
from pathlib import Path

import frida

DIR = Path(__file__).resolve().parent
JS = DIR / "tdb_connectex_test.js"
LOG = DIR / "cliente_frida.log"
JOGO = os.environ.get("TDB_JOGO", r"C:\Games\THE DAY BEFORE")
WD = os.path.join(JOGO, r"Survival\Binaries\Win64")
EXE = os.path.join(WD, "TheDayBefore.exe")
DIAG = DIR / "diagnostico"
UE_LOGS = Path(os.path.expandvars(r"%LOCALAPPDATA%\Survival\Saved\Logs"))


# Identidade Steam do CLIENTE (emulador Goldberg). Host e cliente usam a mesma instalacao, e o emulador le o ID
# de arquivos na pasta do jogo ao abrir o processo. O host usa outro ID (76561197960271872, ver servidor_host.py).
# O steam_api64.dll carregado e o da pasta do Engine (force_steamid.txt); o configs.user.ini e gravado junto por seguranca.
# Cada jogador precisa de um SteamId diferente (o personagem fica em players/<SteamId> no Firestore).
CLIENTE_STEAM_ID = os.environ.get("TDB_STEAMID", "76561197960287930")
CLIENTE_NOME = os.environ.get("TDB_NOME", "Jogador1")
STEAM_ENGINE = Path(JOGO) / r"Engine\Binaries\ThirdParty\Steamworks\Steamv153\Win64\steam_settings"
STEAM_CFG = Path(WD) / r"steam_settings\configs.user.ini"


def definir_identidade(steam_id: str, nome: str) -> None:
    try:
        (STEAM_ENGINE / "force_steamid.txt").write_bytes(steam_id.encode("ascii"))
        (STEAM_ENGINE / "force_account_name.txt").write_bytes(nome.encode("ascii"))
        linhas = STEAM_CFG.read_text(encoding="ascii").splitlines()
        linhas = [("steam_id = " + steam_id) if l.strip().startswith("steam_id") else
                  ("account_name = " + nome) if l.strip().startswith("account_name") else l for l in linhas]
        STEAM_CFG.write_text("\n".join(linhas) + "\n", encoding="ascii")
        print(f"identidade Steam do cliente: {steam_id} ({nome})", flush=True)
    except OSError as e:
        atual = (STEAM_ENGINE / "force_steamid.txt").read_text(encoding="ascii", errors="replace")
        print(f"AVISO: nao consegui gravar a identidade ({e}); force_steamid.txt atual = {atual}", flush=True)


def on_message(message, data):
    line = str(message.get("payload")) if message.get("type") == "send" else str(message)
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(time.strftime("%H:%M:%S ") + line + "\n")


def copy_ue_logs() -> None:
    # Copia o log mais recente do Unreal para a pasta do cliente (para ver o motivo da falha).
    if not UE_LOGS.exists():
        print(f"pasta de logs do jogo nao encontrada: {UE_LOGS}", flush=True)
        return
    files = [p for p in UE_LOGS.rglob("*") if p.is_file()]
    if not files:
        print(f"nenhum log em {UE_LOGS}", flush=True)
        return
    newest = max(files, key=lambda p: p.stat().st_mtime)
    dest = DIR / ("ue_" + newest.name)
    shutil.copy2(newest, dest)
    print(f"log do jogo copiado: {dest}", flush=True)


def main() -> int:
    # 06/11: antes o padrao era 900 s; apos 15 min o script soltava o jogo (session.detach) e fechava a janela,
    # e os monitores paravam no meio do jogo. Agora o padrao (0) e ficar ate o jogo fechar; um numero > 0 ainda limita o tempo.
    # 06/11 (modo leve, padrao): so os scripts que mudam o comportamento (redirecionamento do Firestore e do join).
    # Com --diag volta tudo: diagnosticos de UDP/travel/ProcessEvent, monitor do GPS e gRPC em modo debug.
    diag = "--diag" in sys.argv
    nums = [a for a in sys.argv[1:] if a.isdigit()]
    seconds = int(nums[0]) if nums else 0
    env = dict(os.environ)
    if diag:   # gRPC em modo debug (conexao com o Firestore): muito texto no stdout, custa desempenho
        env["GRPC_VERBOSITY"] = "DEBUG"
        env["GRPC_TRACE"] = "tsi,ssl_transport_security,tcp,client_channel"
    print("modo: " + ("DIAGNOSTICO (--diag)" if diag else "LEVE (sem monitores; use --diag para liga-los)"), flush=True)
    definir_identidade(CLIENTE_STEAM_ID, CLIENTE_NOME)
    device = frida.get_local_device()
    print("abrindo o jogo como cliente...", flush=True)
    pid = device.spawn(
        [EXE, "-windowed", "-ResX=1280", "-ResY=720", "-FullStdOutLogOutput"],
        cwd=WD,
        env=env,
    )
    session = device.attach(pid)
    # Necessarios: tdb_connectex_test.js (Firestore/lista -> terminador TLS local) e tdb_fname_join.js (join -> 127.0.0.1:7777).
    # Diagnosticos (so com --diag): tdb_join_udp.js, tdb_travel_log.js, tdb_pe_travel.js (hook em ProcessEvent).
    partes = [JS, DIR / "tdb_fname_join.js"]
    if diag:
        partes += [DIAG / "tdb_join_udp.js", DIAG / "tdb_travel_log.js", DIAG / "tdb_pe_travel.js"]
    source = "\n".join(p.read_text(encoding="utf-8") for p in partes)
    script = session.create_script(source)
    script.on("message", on_message)
    script.load()
    # Monitor opcional (somente leitura) do GPS no cliente, em script separado para um erro nele nao derrubar os demais.
    extra = DIAG / "monitor_gps_cliente.js"
    if diag and extra.exists():
        script2 = session.create_script(extra.read_text(encoding="utf-8"))
        script2.on("message", on_message)
        script2.load()
    device.resume(pid)
    print(f"cliente pid={pid}. Faca o login, abra o Server Browser e entre no servidor.", flush=True)
    fechou = {"v": False}
    session.on("detached", lambda reason, crash=None: (fechou.__setitem__("v", True), print(f"jogo fechado/desanexado: {reason}", flush=True)))
    fim = time.time() + seconds if seconds > 0 else None
    try:
        while not fechou["v"] and (fim is None or time.time() < fim):
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    if not fechou["v"]:
        session.detach()
    copy_ue_logs()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


