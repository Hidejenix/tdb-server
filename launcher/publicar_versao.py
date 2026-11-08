"""Gera uma versao nova para o atualizador do launcher (08/11/2026).

Uso:  python -I launcher\\publicar_versao.py [versao] [--notas "texto"] [--publicar]
  versao     padrao: data/hora (ex.: 2026.11.08-1530)
  --publicar se o GitHub CLI (gh) estiver instalado e logado, cria a release no repositorio (yan1451/tdb-server) com os 2 arquivos.
             Sem isso, so gera a pasta dist\\<versao>\\ e mostra como subir pela pagina do GitHub.

Vai na atualizacao: cliente\\ (.py/.js), launcher\\ (.py/.bat), host\\servidor_host.py, host\\carregar_script_no_host.py,
host\\scripts\\*.js e host\\ferramentas\\*.js (o "Abrir TDB Launcher.bat" da raiz so chama o launcher e nao muda). NUNCA vai: cliente\\host.txt (IP do servidor),
cliente\\steamid.txt, launcher\\config.json, logs, saves (servicos\\) e certificados.
A release precisa ser a "Latest" (nao pre-release): o launcher baixa de /releases/latest/download/.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
REPO = "yan1451/tdb-server"
sys.path.insert(0, str(RAIZ / "launcher"))
from atualizador import PROTEGIDOS, caminho_ok  # noqa: E402

PADROES = ["cliente/*.py", "cliente/*.js", "launcher/*.py", "launcher/*.bat", "host/servidor_host.py",
           "host/carregar_script_no_host.py", "host/scripts/*.js", "host/ferramentas/*.js"]
FORA = {"launcher/publicar_versao.py"}   # ferramenta do dono, nao precisa ir para os jogadores


def coletar() -> list:
    rels = set()
    for p in PADROES:
        for f in RAIZ.glob(p):
            rel = f.relative_to(RAIZ).as_posix()
            if f.is_file() and caminho_ok(rel) and rel not in PROTEGIDOS and rel not in FORA:
                rels.add(rel)
    return sorted(rels)


def main() -> int:
    args = [a for a in sys.argv[1:]]
    notas = ""
    if "--notas" in args:
        i = args.index("--notas"); notas = args[i + 1] if i + 1 < len(args) else ""; del args[i:i + 2]
    publicar = "--publicar" in args
    args = [a for a in args if a != "--publicar"]
    versao = args[0] if args else time.strftime("%Y.%m.%d-%H%M")
    rels = coletar()
    dist = RAIZ / "dist" / versao
    shutil.rmtree(dist, ignore_errors=True); dist.mkdir(parents=True)
    zpath = dist / "atualizacao.zip"
    arquivos = {}
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in rels:
            b = (RAIZ / rel).read_bytes()
            arquivos[rel] = hashlib.sha256(b).hexdigest()
            z.writestr(rel, b)
    man = {"versao": versao, "zip": "atualizacao.zip", "zip_sha256": hashlib.sha256(zpath.read_bytes()).hexdigest(),
           "arquivos": arquivos, "notas": notas, "gerado_em": time.strftime("%Y-%m-%d %H:%M:%S")}
    (dist / "manifesto.json").write_text(json.dumps(man, indent=1, ensure_ascii=False), encoding="utf-8")
    print("versao %s: %d arquivos -> %s" % (versao, len(rels), dist))
    for rel in rels:
        print("  " + rel)
    if publicar:
        gh = shutil.which("gh")
        if not gh:
            print("\nGitHub CLI (gh) nao encontrado. Instale com:  winget install GitHub.cli   e depois:  gh auth login")
        else:
            cmd = [gh, "release", "create", versao, str(dist / "manifesto.json"), str(zpath), "--repo", REPO,
                   "--title", "Cliente " + versao, "--notes", notas or ("Atualizacao do cliente " + versao), "--latest"]
            print("\n" + " ".join(cmd))
            return subprocess.call(cmd)
    print("\nPara publicar pela pagina: https://github.com/%s/releases/new" % REPO)
    print("  - tag: %s ; titulo: Cliente %s" % (versao, versao))
    print("  - anexe os 2 arquivos de %s (manifesto.json e atualizacao.zip)" % dist)
    print("  - deixe marcado 'Set as the latest release' e publique")
    return 0


if __name__ == "__main__":
    sys.exit(main())
