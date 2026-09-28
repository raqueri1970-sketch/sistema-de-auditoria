# SUPERVISOR - mantem o Executor rodando: se ele fechar, sobe de novo com espera crescente (10 s, 30 s, 1 min, 2 min, 5 min).
# 1.5.0: nao reinicia as cegas. Se o Executor cair 4 vezes em 30 min, o supervisor cria o arquivo PAUSA: o Executor volta,
# mas fica PAUSADO_SEGURANCA (aparece no Portal) e nao pega pedido ate alguem rodar RETOMAR.bat.
# Para parar de verdade: crie o arquivo STOP nesta pasta (PARAR.bat). Rode com pythonw.exe para nao abrir janela.
import subprocess, sys, time, json
from pathlib import Path
BASE = Path(__file__).resolve().parent; STOP = BASE / "STOP"; PAUSA = BASE / "PAUSA"; LOG = BASE / "supervisor.log"
ESPERAS = (10, 30, 60, 120, 300)
QUEDAS_PAUSA, JANELA = 4, 1800

def log(m):
    with LOG.open("a", encoding="utf-8") as f: f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + m + "\n")

def proxima_espera(quedas, agora):
    """quedas: horarios (time.time) das saidas do Executor. Retorna (segundos de espera, pausar?)."""
    recentes = [t for t in quedas if agora - t < JANELA]
    return ESPERAS[min(len(recentes), len(ESPERAS)) - 1] if recentes else ESPERAS[0], len(recentes) >= QUEDAS_PAUSA

def main():
    if STOP.exists(): STOP.unlink()
    log("supervisor iniciado")
    py = sys.executable.replace("pythonw.exe", "python.exe")
    quedas = []
    while not STOP.exists():
        p = subprocess.Popen([py, str(BASE / "executor.py"), "--loop"], cwd=str(BASE), creationflags=0x08000000)   # sem janela
        while p.poll() is None and not STOP.exists(): time.sleep(2)
        if STOP.exists():
            try: p.wait(timeout=90)
            except Exception: p.kill()
            break
        if p.returncode == 75:                        # 1.5.2: reinicio pedido pelo celular - nao e queda
            log("reinicio pedido pelo administrador (celular); subindo de novo em 3 s"); time.sleep(3); continue
        agora = time.time(); quedas.append(agora); quedas = [t for t in quedas if agora - t < JANELA]
        espera, pausar = proxima_espera(quedas, agora)
        if pausar and not PAUSA.exists():
            PAUSA.write_text(json.dumps({"motivo": "Executor caiu %d vezes em 30 min" % len(quedas), "origem": "supervisor",
                                         "desde": time.strftime("%Y-%m-%d %H:%M:%S")}, ensure_ascii=False, indent=1), encoding="utf-8")
            log("PAUSA criada: executor caiu %d vezes em 30 min" % len(quedas))
        log("executor saiu (codigo %s); reiniciando em %d s" % (p.returncode, espera))
        t0 = time.time()
        while time.time() - t0 < espera and not STOP.exists(): time.sleep(2)
    log("supervisor encerrado")

if __name__ == "__main__":
    main()
