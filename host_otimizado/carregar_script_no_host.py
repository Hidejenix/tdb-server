"""Carrega um script Frida num host JA aberto (sem reiniciar).
Uso: python -I carregar_script_no_host.py <PID> <script.js> [horas]
Log: %TEMP%\\<nome do script>_host.out"""
import os, sys, time, json
import frida
pid = int(sys.argv[1]); js = os.path.abspath(sys.argv[2]); horas = float(sys.argv[3]) if len(sys.argv) > 3 else 4
OUT = os.path.join(os.environ["TEMP"], os.path.splitext(os.path.basename(js))[0] + "_host.out")
fh = open(OUT, "w", encoding="utf-8")
def log(s):
    fh.write(time.strftime("%H:%M:%S ") + s + "\n"); fh.flush()
sess = frida.attach(pid)
vivo = {"v": True}
def det(reason, crash=None):
    vivo["v"] = False; log("DETACHED reason=%s crash=%s" % (reason, crash))
sess.on("detached", det)
def msg(m, d):
    if m.get("type") == "send":
        t = (m.get("payload") or {}).get("tdb", "")
        if t: log("MSG " + t)
    else:
        log("ERRO-SCRIPT " + json.dumps(m)[:400])
sc = sess.create_script(open(js, encoding="utf-8").read(), name=os.path.basename(js))
sc.on("message", msg); sc.load()
log("carregado %s no PID %d" % (os.path.basename(js), pid))
fim = time.time() + horas * 3600
while time.time() < fim and vivo["v"]:
    time.sleep(2)
log("fim")
