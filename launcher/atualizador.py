"""Atualizador do cliente/launcher pelo GitHub Releases (08/11/2026).

A release publicada (launcher\\publicar_versao.py) tem dois arquivos:
  - manifesto.json : {"versao": "...", "zip": "atualizacao.zip", "zip_sha256": "...", "arquivos": {"caminho/rel": "sha256", ...},
                      "notas": "..."}
  - atualizacao.zip: os arquivos listados, com os mesmos caminhos relativos a raiz do projeto.
O launcher baixa o manifesto da release mais recente; se algum arquivo local tiver hash diferente, baixa o zip, confere o hash do
zip e de cada arquivo e so entao grava. So aceita caminhos dentro de PREFIXOS_PERMITIDOS e nunca toca nos arquivos PROTEGIDOS
(IP do servidor, SteamId, configuracao local). Os saves (servicos\\) nunca fazem parte da atualizacao.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent          # pasta do projeto (tem cliente\, host\, launcher\, servicos\)
REPO_PADRAO = "yan1451/tdb-server"
PREFIXOS_PERMITIDOS = ("cliente/", "launcher/", "host/")
PROTEGIDOS = {"cliente/host.txt", "cliente/steamid.txt", "launcher/config.json", "launcher/versao.txt"}
ARQ_VERSAO = RAIZ / "launcher" / "versao.txt"
AGENTE = "tdb-launcher"


def url_release(repo: str, nome: str, versao: str = "") -> str:
    """Sem versao: /releases/latest/download/<arquivo> (a release mais recente; o GitHub pode demorar alguns minutos para apontar
    para uma release recem-publicada). Com versao: /releases/download/<versao>/<arquivo> (exatamente aquela release) - o zip e
    sempre baixado assim, para nunca misturar o manifesto de uma versao com o zip de outra (visto em 08/11)."""
    if repo.startswith("http://") or repo.startswith("https://") or repo.startswith("file:"):
        return repo.rstrip("/") + "/" + nome          # base alternativa (testes, espelho)
    if versao:
        return "https://github.com/%s/releases/download/%s/%s" % (repo, versao, nome)
    return "https://github.com/%s/releases/latest/download/%s" % (repo, nome)


def chave_versao(v: str) -> tuple:
    """'2026.11.08-10' -> (2026, 11, 8, 10): compara numeros, nao texto ('-10' > '-2')."""
    import re
    return tuple(int(x) for x in re.findall(r"\d+", v or ""))


def _contexto_certifi():
    """Pacote de raizes do certifi (o pip traz uma copia em pip._vendor.certifi), para Windows com repositorio de raizes incompleto."""
    import ssl
    for mod in ("certifi", "pip._vendor.certifi"):
        try:
            m = __import__(mod, fromlist=["where"])
            return ssl.create_default_context(cafile=m.where())
        except Exception:
            continue
    return None


def _baixar_powershell(url: str, timeout: float) -> bytes:
    """Ultimo recurso: TLS do proprio Windows (schannel), que completa a cadeia de certificados sozinho. Verificacao continua ligada."""
    import subprocess, tempfile
    fd, tmp = tempfile.mkstemp(prefix="tdb_dl_"); os.close(fd)
    try:
        cmd = ("$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol='Tls12,Tls13'; "
               "Invoke-WebRequest -UseBasicParsing -UserAgent '%s' -TimeoutSec %d -Uri '%s' -OutFile '%s'" % (AGENTE, int(timeout), url, tmp))
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd], capture_output=True, text=True,
                           timeout=timeout + 15, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if r.returncode != 0:
            raise RuntimeError("PowerShell: " + (r.stderr or r.stdout).strip().splitlines()[-1][:200] if (r.stderr or r.stdout).strip() else "PowerShell falhou")
        with open(tmp, "rb") as f:
            return f.read()
    finally:
        try: os.remove(tmp)
        except OSError: pass


def baixar(url: str, timeout: float = 20) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": AGENTE})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError:
        raise                                   # 404 etc.: resposta valida do servidor, nao e problema de certificado
    except Exception as e:
        if "CERTIFICATE_VERIFY_FAILED" not in str(e) or not url.startswith("https://"):
            raise
        erro = e
    ctx = _contexto_certifi()                   # 2a tentativa: raizes do certifi
    if ctx is not None:
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
                return r.read()
        except urllib.error.HTTPError:
            raise
        except Exception as e:
            erro = e
    try:                                        # 3a tentativa: TLS do Windows
        return _baixar_powershell(url, timeout)
    except Exception as e:
        raise RuntimeError("falha de certificado (%s); PowerShell tambem falhou (%s)" % (erro, e))


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_arquivo(p: Path) -> str:
    try:
        return sha256_bytes(p.read_bytes())
    except OSError:
        return ""


def versao_local() -> str:
    try:
        return ARQ_VERSAO.read_text(encoding="utf-8").strip() or "(sem versao)"
    except OSError:
        return "(sem versao)"


def caminho_ok(rel: str) -> bool:
    rel = rel.replace("\\", "/")
    if rel.startswith("/") or ":" in rel or ".." in rel.split("/"):
        return False
    return rel.startswith(PREFIXOS_PERMITIDOS) and rel not in PROTEGIDOS


def verificar(repo: str = REPO_PADRAO) -> dict:
    """Devolve {"ok", "versao", "pendentes": [rel], "manifesto", "erro"}. Nao grava nada."""
    try:
        man = json.loads(baixar(url_release(repo, "manifesto.json"), timeout=10).decode("utf-8"))
    except Exception as e:
        return {"ok": False, "erro": "nao consegui baixar o manifesto (%s)" % e, "pendentes": [], "versao": ""}
    arquivos = man.get("arquivos") or {}
    remota, local = man.get("versao", "?"), versao_local()
    if chave_versao(local) and chave_versao(remota) < chave_versao(local):
        # o "latest" ainda aponta para uma release mais antiga que a instalada (propagacao do GitHub): nunca voltar versao
        return {"ok": True, "versao": local, "pendentes": [], "manifesto": man, "erro": "", "notas": "",
                "aviso": "o GitHub ainda aponta para %s (mais antiga que a instalada, %s); nada a fazer" % (remota, local)}
    pendentes = [rel for rel, h in sorted(arquivos.items()) if caminho_ok(rel) and sha256_arquivo(RAIZ / rel) != h]
    return {"ok": True, "versao": remota, "pendentes": pendentes, "manifesto": man, "erro": "",
            "notas": man.get("notas", "")}


def aplicar(info: dict, repo: str = REPO_PADRAO, log=print) -> list:
    """Baixa o zip DA MESMA versao do manifesto, confere hashes e grava os arquivos pendentes. Devolve a lista gravada."""
    man = info["manifesto"]
    if not info.get("pendentes"):
        return []
    dados = baixar(url_release(repo, man.get("zip", "atualizacao.zip"), versao=man.get("versao", "")), timeout=60)
    if man.get("zip_sha256") and sha256_bytes(dados) != man["zip_sha256"]:
        raise RuntimeError("o zip baixado nao confere com o manifesto (hash diferente); atualizacao cancelada")
    gravados = []
    with zipfile.ZipFile(io.BytesIO(dados)) as z:
        nomes = set(z.namelist())
        conteudo = {}
        for rel in info["pendentes"]:          # confere TUDO antes de gravar qualquer coisa
            if rel not in nomes:
                raise RuntimeError("arquivo %s faltando no zip" % rel)
            b = z.read(rel)
            if sha256_bytes(b) != man["arquivos"][rel]:
                raise RuntimeError("arquivo %s nao confere com o manifesto" % rel)
            conteudo[rel] = b
    for rel, b in conteudo.items():
        dest = RAIZ / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name + ".novo")
        tmp.write_bytes(b)
        os.replace(tmp, dest)                  # troca atomica (o .py do launcher em uso pode ser trocado no Windows)
        gravados.append(rel)
        log("atualizado: " + rel)
    ARQ_VERSAO.parent.mkdir(parents=True, exist_ok=True)
    ARQ_VERSAO.write_text(info["versao"] + "\n", encoding="utf-8")
    return gravados
