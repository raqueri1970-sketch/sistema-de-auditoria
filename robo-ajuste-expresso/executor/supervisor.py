# SUPERVISOR - mantem o Executor sempre rodando: se ele fechar por qualquer motivo, sobe de novo em 10 s.
# Para parar de verdade: crie o arquivo STOP nesta pasta (PARAR.bat). Rode com pythonw.exe para nao abrir janela.
import subprocess, sys, time, os
from pathlib import Path
BASE = Path(__file__).resolve().parent; STOP = BASE / "STOP"; LOG = BASE / "supervisor.log"
def log(m):
    with LOG.open("a", encoding="utf-8") as f: f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + m + "\n")
if STOP.exists(): STOP.unlink()
log("supervisor iniciado")
py = sys.executable.replace("pythonw.exe", "python.exe")
while not STOP.exists():
    p = subprocess.Popen([py, str(BASE / "executor.py"), "--loop"], cwd=str(BASE), creationflags=0x08000000)   # sem janela
    while p.poll() is None and not STOP.exists(): time.sleep(2)
    if STOP.exists():
        try: p.wait(timeout=90)
        except Exception: p.kill()
        break
    log("executor saiu (codigo %s); reiniciando em 10 s" % p.returncode); time.sleep(10)
log("supervisor encerrado")
