"""Teste do replicacao_otimizada.js FORA do jogo: compila o modulo C (TinyCC do Frida) dentro de um processo qualquer (ping.exe)
e roda o teste_harness.js (mundo falso + funcoes falsas do motor + quadros simulados a 40 q/s).
Uso: python -I host_otimizado/testes/rodar_teste.py      (precisa do Frida instalado: pip install frida)
Depuracao: TDB_PRE_JS / TDB_POS_JS = arquivos .js colados antes / depois (ex.: var TDB_DEBUG = true; + um roteiro proprio)."""
import os, sys, threading
import frida

AQUI = os.path.dirname(os.path.abspath(__file__))
OTIM = os.path.join(os.path.dirname(AQUI), "scripts", "replicacao_otimizada.js")
HARNESS = os.path.join(AQUI, "teste_harness.js")
def ler(p): return open(p, encoding="utf-8").read() if p else ""
src = (ler(os.environ.get("TDB_PRE_JS")) + "\nvar TDB_TESTE = true;\n" + ler(OTIM) + "\n" + ler(HARNESS) + "\n" +
       ler(os.environ.get("TDB_POS_JS")))

fim = threading.Event()
def on_msg(m, data):
    if m["type"] == "send":
        p = m["payload"]
        if p.get("fim"): fim.set()
        elif "t" in p: print(p["t"], flush=True)
    else:
        print("ERRO DO SCRIPT:", m.get("description"), m.get("stack", ""), flush=True); fim.set()

alvo = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "PING.EXE")
pid = frida.spawn([alvo, "-n", "120", "127.0.0.1"])
sess = frida.attach(pid)
try:
    s = sess.create_script(src)
    s.on("message", on_msg)
    s.load()
    frida.resume(pid)
    fim.wait(120)
finally:
    try: frida.kill(pid)
    except Exception: pass
