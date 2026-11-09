"""TDB Launcher (08/11/2026): abre The Day Before no servidor da comunidade (Online) ou no servidor do proprio PC (Offline),
e atualiza o cliente pelo GitHub Releases. Abrir com "Abrir TDB Launcher.bat" na raiz do projeto.

Online : python cliente\\cliente_conecta.py           (IP em cliente\\host.txt; SteamId unico da pessoa)
Offline: python host\\servidor_host.py --appdata-separado  -> espera "[lnat] LISTEN OK" -> python cliente\\cliente_conecta.py --local
         (ID antigo, onde estao os saves locais). Ao fechar o jogo: fecha o host (export final do Firestore) e desliga os servicos
         locais (emulador e terminador TLS na 443), para o modo Online poder abrir a ponte na 443 depois.
Pasta do jogo: escolhida na janela ("Escolher..."), guardada em launcher\\config.json (local; a atualizacao nunca mexe nele).
"""
from __future__ import annotations

import json
import os
import queue
import re
import socket
import subprocess
import sys
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, scrolledtext

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent
sys.path.insert(0, str(AQUI))
import atualizador  # noqa: E402

CFG_ARQ = AQUI / "config.json"
CLIENTE = RAIZ / "cliente" / "cliente_conecta.py"
HOST = RAIZ / "host" / "servidor_host.py"
HOST_TXT = RAIZ / "cliente" / "host.txt"
LOG_HOST = Path(os.environ.get("TEMP", ".")) / "servidor_host_headless.out"
SEM_JANELA = getattr(subprocess, "CREATE_NO_WINDOW", 0)
IMAGENS_SERVICO = {"java.exe", "node.exe", "python.exe", "pythonw.exe"}


def ler_cfg() -> dict:
    try:
        return json.loads(CFG_ARQ.read_text(encoding="utf-8"))
    except Exception:
        return {}


def salvar_cfg(c: dict) -> None:
    try:
        CFG_ARQ.write_text(json.dumps(c, indent=2, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def python_console() -> str:
    """python.exe ao lado do interpretador atual (o launcher roda em pythonw.exe, sem console)."""
    exe = Path(sys.executable)
    if exe.name.lower() == "pythonw.exe" and (exe.parent / "python.exe").exists():
        return str(exe.parent / "python.exe")
    return str(exe)


def ip_servidor() -> str:
    try:
        return HOST_TXT.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


PASTA_PADRAO = r"C:\Games\THE DAY BEFORE"
EXE_REL = Path("Survival") / "Binaries" / "Win64" / "TheDayBefore.exe"


def raiz_do_jogo(pasta: str):
    """Aceita a pasta do jogo ou qualquer subpasta dela (ou o proprio .exe) e devolve a raiz (a que tem Survival\Binaries\Win64\
    TheDayBefore.exe), ou None se nao achar."""
    if not pasta:
        return None
    try:
        p = Path(pasta).resolve()
    except OSError:
        return None
    if p.is_file():
        p = p.parent
    for cand in [p, *p.parents]:
        if (cand / EXE_REL).is_file():
            return str(cand)
    return None


def porta_aberta(host: str, porta: int, timeout: float = 3) -> bool:
    try:
        with socket.create_connection((host, porta), timeout):
            return True
    except OSError:
        return False


def pids_escutando(portas: set) -> set:
    """PIDs com socket TCP em LISTENING nas portas dadas (netstat do Windows)."""
    r = subprocess.run(["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True, creationflags=SEM_JANELA).stdout
    r += subprocess.run(["netstat", "-ano", "-p", "TCPv6"], capture_output=True, text=True, creationflags=SEM_JANELA).stdout
    pids = set()
    for linha in r.splitlines():
        p = linha.split()
        if len(p) >= 5 and p[3].upper() == "LISTENING":
            try:
                porta = int(p[1].rsplit(":", 1)[1])
            except (ValueError, IndexError):
                continue
            if porta in portas:
                pids.add(int(p[4]))
    return pids


def imagem_do_pid(pid: int) -> str:
    r = subprocess.run(["tasklist", "/FI", "PID eq %d" % pid, "/FO", "CSV", "/NH"], capture_output=True, text=True,
                       creationflags=SEM_JANELA).stdout.strip()
    return r.split('","')[0].strip('"').lower() if r.startswith('"') else ""


def matar(pid: int) -> None:
    subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, creationflags=SEM_JANELA)


class Launcher:
    def __init__(self, raiz: tk.Tk):
        self.r = raiz
        self.cfg = ler_cfg()
        self.repo = self.cfg.get("repo", atualizador.REPO_PADRAO)
        self.fila = queue.Queue()
        self.proc_cliente = None
        self.proc_host = None
        self.modo = None             # "online" / "offline" / None
        self.pid_jogo = None
        self.info_atualizacao = None
        self.parando = False
        self._montar()
        self.r.after(100, self._drenar)
        threading.Thread(target=self._checar_servidor_laco, daemon=True).start()
        threading.Thread(target=self._checar_atualizacao, daemon=True).start()

    # ------------------------------------------------------------------ interface
    def _montar(self):
        r = self.r
        r.title("TDB Launcher")
        r.geometry("760x520")
        r.minsize(620, 420)
        fundo, texto, sec = "#15181d", "#e6e6e6", "#9aa3ad"
        r.configure(bg=fundo)
        tk.Label(r, text="The Day Before — servidor da comunidade", bg=fundo, fg=texto, font=("Segoe UI", 15, "bold")).pack(anchor="w", padx=16, pady=(14, 2))
        info = tk.Frame(r, bg=fundo); info.pack(fill="x", padx=16)
        self.lbl_servidor = tk.Label(info, text="Servidor online: verificando...", bg=fundo, fg=sec, font=("Segoe UI", 10))
        self.lbl_servidor.grid(row=0, column=0, sticky="w")
        self.lbl_versao = tk.Label(info, text="Versão: " + atualizador.versao_local(), bg=fundo, fg=sec, font=("Segoe UI", 10))
        self.lbl_versao.grid(row=1, column=0, sticky="w")
        self.lbl_estado = tk.Label(info, text="Pronto.", bg=fundo, fg=texto, font=("Segoe UI", 10, "bold"))
        self.lbl_estado.grid(row=2, column=0, sticky="w", pady=(4, 0))

        bot = tk.Frame(r, bg=fundo); bot.pack(fill="x", padx=16, pady=10)
        estilo = dict(font=("Segoe UI", 11, "bold"), relief="flat", padx=14, pady=8, cursor="hand2", bd=0)
        self.b_online = tk.Button(bot, text="Jogar Online", bg="#2f7d4f", fg="white", activebackground="#3a9a61", command=self.jogar_online, **estilo)
        self.b_online.pack(side="left")
        self.b_offline = tk.Button(bot, text="Jogar Offline", bg="#3b5b8a", fg="white", activebackground="#4a70a8", command=self.jogar_offline, **estilo)
        self.b_offline.pack(side="left", padx=8)
        estilo2 = dict(font=("Segoe UI", 10), relief="flat", padx=10, pady=8, cursor="hand2", bd=0, bg="#2a2f37", fg=texto, activebackground="#363c46")
        self.b_parar = tk.Button(bot, text="Parar", command=self.parar, state="disabled", **estilo2)
        self.b_parar.pack(side="left")
        self.b_atualizar = tk.Button(bot, text="Procurar atualização", command=self.atualizar_manual, **estilo2)
        self.b_atualizar.pack(side="left", padx=8)
        tk.Button(bot, text="Pasta de logs", command=self.abrir_logs, **estilo2).pack(side="left")

        jog = tk.Frame(r, bg=fundo); jog.pack(fill="x", padx=16, pady=(0, 6))
        tk.Label(jog, text="Pasta do jogo:", bg=fundo, fg=sec, font=("Segoe UI", 10)).pack(side="left")
        self.lbl_pasta = tk.Label(jog, text="", bg=fundo, fg=texto, font=("Segoe UI", 10), anchor="w")
        self.lbl_pasta.pack(side="left", padx=(6, 8), fill="x", expand=True)
        tk.Button(jog, text="Escolher...", command=self.escolher_pasta, **estilo2).pack(side="right")
        self._mostrar_pasta()

        opc = tk.Frame(r, bg=fundo); opc.pack(fill="x", padx=16)
        self.v_barras = tk.BooleanVar(value=self.cfg.get("barras_fixas", True))
        tk.Checkbutton(opc, text="Vida, fome e sede sempre visíveis", variable=self.v_barras, bg=fundo, fg=sec, selectcolor="#2a2f37",
                       activebackground=fundo, activeforeground=texto, command=self._salvar_opcoes).pack(side="left")

        self.txt = scrolledtext.ScrolledText(r, bg="#0e1013", fg="#cfd6dd", insertbackground="white", font=("Consolas", 9), relief="flat", height=14)
        self.txt.pack(fill="both", expand=True, padx=16, pady=(8, 14))
        self.txt.configure(state="disabled")
        r.protocol("WM_DELETE_WINDOW", self.fechar)

    def _salvar_opcoes(self):
        self.cfg["barras_fixas"] = bool(self.v_barras.get()); salvar_cfg(self.cfg)

    def log(self, msg: str):
        self.fila.put(("log", time.strftime("%H:%M:%S ") + msg))

    def estado(self, msg: str):
        self.fila.put(("estado", msg))

    def _drenar(self):
        try:
            while True:
                tipo, val = self.fila.get_nowait()
                if tipo == "log":
                    self.txt.configure(state="normal"); self.txt.insert("end", val + "\n")
                    if int(self.txt.index("end-1c").split(".")[0]) > 3000:
                        self.txt.delete("1.0", "500.0")
                    self.txt.see("end"); self.txt.configure(state="disabled")
                elif tipo == "estado":
                    self.lbl_estado.configure(text=val)
                elif tipo == "servidor":
                    self.lbl_servidor.configure(text=val)
                elif tipo == "versao":
                    self.lbl_versao.configure(text=val)
                elif tipo == "botoes":
                    self._botoes(val)
                elif tipo == "reiniciar":
                    self._reiniciar_launcher()
        except queue.Empty:
            pass
        self.r.after(100, self._drenar)

    def _botoes(self, jogando: bool):
        self.b_online.configure(state="disabled" if jogando else "normal")
        self.b_offline.configure(state="disabled" if jogando else "normal")
        self.b_atualizar.configure(state="disabled" if jogando else "normal")
        self.b_parar.configure(state="normal" if jogando else "disabled")

    # ------------------------------------------------------------------ servidor / atualizacao
    def _checar_servidor_laco(self):
        while True:
            ip = ip_servidor()
            if not ip:
                self.fila.put(("servidor", "Servidor online: sem cliente\\host.txt (modo Online indisponível)"))
            else:
                ok = porta_aberta(ip, 443)
                self.fila.put(("servidor", "Servidor online (%s): %s" % (ip, "no ar" if ok else "fora do ar (servidor desligado?)")))
            time.sleep(30)

    def _checar_atualizacao(self, aplicar_se_houver=False):
        info = atualizador.verificar(self.repo)
        if not info["ok"]:
            self.fila.put(("versao", "Versão: %s (não consegui verificar atualizações)" % atualizador.versao_local()))
            self.log("atualização: " + info["erro"])
            return None
        self.info_atualizacao = info
        if info.get("aviso"):
            self.log("atualização: " + info["aviso"])
        if info["pendentes"]:
            self.fila.put(("versao", "Versão: %s  →  atualização disponível: %s (%d arquivo(s))" % (atualizador.versao_local(), info["versao"], len(info["pendentes"]))))
            self.log("atualização %s disponível: %s" % (info["versao"], ", ".join(info["pendentes"][:8]) + (" ..." if len(info["pendentes"]) > 8 else "")))
            if info.get("notas"):
                self.log("notas: " + info["notas"])
        else:
            if atualizador.versao_local() != info["versao"]:
                try: atualizador.ARQ_VERSAO.write_text(info["versao"] + "\n", encoding="utf-8")
                except OSError: pass
            self.fila.put(("versao", "Versão: %s (atualizada)" % info["versao"]))
        return info

    def _aplicar_atualizacao(self) -> bool:
        """Aplica a atualizacao pendente (se houver). Devolve False se o launcher precisa reabrir (nao seguir para o jogo)."""
        info = self.info_atualizacao or self._checar_atualizacao()
        if not info or not info.get("pendentes"):
            return True
        self.estado("Atualizando para %s..." % info["versao"])
        try:
            gravados = atualizador.aplicar(info, self.repo, log=self.log)
        except Exception as e:
            self.log("ERRO na atualização (nada foi trocado): %s" % e)
            return True
        self.info_atualizacao = None
        self.fila.put(("versao", "Versão: %s (atualizada)" % info["versao"]))
        if any(g.startswith("launcher/") for g in gravados):
            self.log("o launcher foi atualizado: reabrindo...")
            self.fila.put(("reiniciar", None))
            return False
        return True

    def atualizar_manual(self):
        def t():
            self.estado("Procurando atualização...")
            info = self._checar_atualizacao()
            if info and info["pendentes"]:
                if self._aplicar_atualizacao():
                    self.estado("Atualizado.")
            elif info:
                self.estado("Já está na versão mais recente.")
            else:
                self.estado("Não consegui verificar atualizações.")
        threading.Thread(target=t, daemon=True).start()

    def _reiniciar_launcher(self):
        subprocess.Popen([sys.executable, "-I", str(AQUI / "tdb_launcher.py")], cwd=str(RAIZ))
        self.r.destroy()

    # ------------------------------------------------------------------ processos
    def _ler_saida(self, proc, prefixo, ao_ler=None):
        for b in iter(proc.stdout.readline, b""):
            linha = b.decode("utf-8", "replace").rstrip()
            if not linha:
                continue
            m = re.search(r"cliente pid=(\d+)", linha)
            if m:
                self.pid_jogo = int(m.group(1))
            if ao_ler:
                ao_ler(linha)
            self.log(prefixo + linha)

    def _args_cliente(self, local: bool) -> list:
        a = [python_console(), "-I", "-X", "utf8", str(CLIENTE)]
        if local:
            a.append("--local")
        if not self.v_barras.get():
            a.append("--sem-barras-fixas")
        return a

    def _env(self) -> dict:
        env = dict(os.environ)
        pasta = self.pasta_jogo()
        if pasta:
            env["TDB_JOGO"] = pasta   # lida pelo cliente_conecta.py e pelo servidor_host.py
        return env

    # ------------------------------------------------------------------ pasta do jogo
    def pasta_jogo(self):
        """Pasta escolhida (config.json) se for valida; senao a padrao, se existir; senao None."""
        return raiz_do_jogo(self.cfg.get("pasta_jogo", "")) or raiz_do_jogo(os.environ.get("TDB_JOGO", "")) or raiz_do_jogo(PASTA_PADRAO)

    def _mostrar_pasta(self):
        p = self.pasta_jogo()
        if p:
            self.lbl_pasta.configure(text=p, fg="#e6e6e6")
        else:
            self.lbl_pasta.configure(text="não encontrada — clique em Escolher... e aponte a pasta do The Day Before", fg="#e0a050")

    def escolher_pasta(self) -> bool:
        inicial = self.pasta_jogo() or (str(Path(self.cfg["pasta_jogo"]).parent) if self.cfg.get("pasta_jogo") else "C:\\")
        escolhida = filedialog.askdirectory(title="Escolha a pasta do The Day Before (a que tem a pasta Survival)", initialdir=inicial,
                                            mustexist=True, parent=self.r)
        if not escolhida:
            return False
        raiz = raiz_do_jogo(escolhida)
        if not raiz:
            messagebox.showerror("TDB Launcher", "Não achei o jogo nessa pasta.\n\nEscolha a pasta do The Day Before: dentro dela deve existir "
                                 "Survival\\Binaries\\Win64\\TheDayBefore.exe.", parent=self.r)
            return False
        self.cfg["pasta_jogo"] = raiz; salvar_cfg(self.cfg)
        self._mostrar_pasta()
        self.log("pasta do jogo: " + raiz)
        return True

    def _conferir_pasta(self) -> bool:
        """Antes de jogar: exige uma pasta valida (abre o seletor se faltar)."""
        if self.pasta_jogo():
            return True
        messagebox.showinfo("TDB Launcher", "Primeiro escolha onde está instalado o The Day Before.", parent=self.r)
        return self.escolher_pasta()

    def _iniciar_cliente(self, local: bool):
        self.proc_cliente = subprocess.Popen(self._args_cliente(local), cwd=str(CLIENTE.parent), stdout=subprocess.PIPE,
                                             stderr=subprocess.STDOUT, creationflags=SEM_JANELA, env=self._env())
        threading.Thread(target=self._ler_saida, args=(self.proc_cliente, ""), daemon=True).start()

    def jogar_online(self):
        if not ip_servidor():
            messagebox.showwarning("TDB Launcher", "Falta o arquivo cliente\\host.txt com o IP do servidor."); return
        if not self._conferir_pasta():
            return
        self.modo = "online"; self.fila.put(("botoes", True))

        def t():
            if not self._aplicar_atualizacao():
                return
            if pids_escutando({443}):
                self.log("AVISO: algo já usa a porta 443 neste PC (servidor local aberto?). Feche-o, senão a ponte do Firestore falha.")
            self.estado("Abrindo o jogo (Online, %s)..." % ip_servidor())
            self._iniciar_cliente(local=False)
            self.proc_cliente.wait()
            self.log("jogo fechado.")
            self._fim()
        threading.Thread(target=t, daemon=True).start()

    def jogar_offline(self):
        if not HOST.exists():
            messagebox.showwarning("TDB Launcher", "Não achei host\\servidor_host.py: o modo Offline precisa da pasta do projeto completa."); return
        if not self._conferir_pasta():
            return
        self.modo = "offline"; self.fila.put(("botoes", True))

        def t():
            if not self._aplicar_atualizacao():
                return
            self.estado("Subindo o servidor local (1-3 min)...")
            try:
                if LOG_HOST.exists():
                    os.replace(LOG_HOST, LOG_HOST.with_name(LOG_HOST.name + ".anterior"))
            except OSError:
                pass
            self.proc_host = subprocess.Popen([python_console(), "-I", "-X", "utf8", str(HOST), "--appdata-separado"], cwd=str(HOST.parent),
                                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, creationflags=SEM_JANELA, env=self._env())
            threading.Thread(target=self._ler_saida, args=(self.proc_host, "[host] "), daemon=True).start()
            fim = time.time() + 420
            pronto = False
            while time.time() < fim and not self.parando:
                if self.proc_host.poll() is not None:
                    break
                try:
                    if "[lnat] LISTEN OK" in LOG_HOST.read_text(encoding="utf-8", errors="replace"):
                        pronto = True; break
                except OSError:
                    pass
                time.sleep(2)
            if not pronto:
                if not self.parando:
                    self.log("ERRO: o servidor local não ficou pronto (veja %s)" % LOG_HOST)
                self._parar_offline(); self._fim(); return
            self.log("servidor local pronto.")
            self.estado("Abrindo o jogo (Offline)...")
            self._iniciar_cliente(local=True)
            self.proc_cliente.wait()
            self.log("jogo fechado.")
            self._parar_offline()
            self._fim()
        threading.Thread(target=t, daemon=True).start()

    def _pid_host(self):
        try:
            m = re.findall(r"HOST PID (\d+)", LOG_HOST.read_text(encoding="utf-8", errors="replace"))
            return int(m[-1]) if m else None
        except OSError:
            return None

    def _parar_offline(self):
        self.estado("Fechando o servidor local e salvando...")
        pid = self._pid_host()
        if pid and imagem_do_pid(pid) == "thedaybefore.exe":
            matar(pid); self.log("host local fechado (PID %d); esperando o export final do Firestore..." % pid)
        if self.proc_host and self.proc_host.poll() is None:
            try:
                self.proc_host.wait(timeout=180)
            except subprocess.TimeoutExpired:
                self.log("o runner do host não terminou em 3 min; encerrando à força")
                matar(self.proc_host.pid)
        # servicos locais (emulador do Firestore, ponte IPv6, terminador TLS) ficam soltos depois do runner: desliga
        for p in pids_escutando({443, 8081, 4400, 4500, 9150}):
            img = imagem_do_pid(p)
            if img in IMAGENS_SERVICO:
                matar(p); self.log("serviço local desligado: %s (PID %d)" % (img, p))
        self.proc_host = None

    def _fim(self):
        self.modo = None; self.pid_jogo = None; self.proc_cliente = None; self.parando = False
        self.fila.put(("botoes", False))
        self.estado("Pronto.")

    def parar(self):
        if not self.modo:
            return
        self.parando = True
        self.estado("Parando...")

        def t():
            if self.pid_jogo and imagem_do_pid(self.pid_jogo) == "thedaybefore.exe":
                matar(self.pid_jogo)
            if self.proc_cliente and self.proc_cliente.poll() is None:
                try: self.proc_cliente.wait(timeout=15)
                except subprocess.TimeoutExpired: matar(self.proc_cliente.pid)
            # o fluxo de cada modo (thread de jogar_*) termina sozinho: quando o cliente sai (e fecha o host no Offline), ou, se o
            # servidor local ainda estava subindo, o laco de espera ve self.parando e desliga tudo
        threading.Thread(target=t, daemon=True).start()

    def abrir_logs(self):
        os.startfile(str(CLIENTE.parent))

    def fechar(self):
        if self.modo:
            if not messagebox.askyesno("TDB Launcher", "O jogo está aberto. Fechar o launcher vai fechar o jogo%s. Continuar?" %
                                       (" e o servidor local" if self.modo == "offline" else "")):
                return
            self.parar()
            def esperar():
                while self.modo:
                    time.sleep(0.5)
                self.r.after(0, self.r.destroy)
            threading.Thread(target=esperar, daemon=True).start()
            return
        self.r.destroy()


def main():
    raiz = tk.Tk()
    Launcher(raiz)
    if "--teste-janela" in sys.argv:          # abre e fecha sozinho (usado para conferir que a janela monta)
        raiz.after(int(sys.argv[sys.argv.index("--teste-janela") + 1]) if len(sys.argv) > sys.argv.index("--teste-janela") + 1 else 3000, raiz.destroy)
    raiz.mainloop()


if __name__ == "__main__":
    main()
