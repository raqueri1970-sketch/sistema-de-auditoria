# DIAGNOSTICO - roda em qualquer computador novo. NAO lanca estoque e nao altera nada no Windows.
# Confere: Python, bibliotecas, OCR em portugues, tela/monitor/escala, Seta, config e conexao com o Portal.
import sys, os, json, ctypes, time, platform
from pathlib import Path
BASE = Path(__file__).resolve().parent
R = []
def item(nome, ok, det="", aviso=False):
    R.append(ok or aviso)
    tag = "  OK   " if ok else ("  AVISO" if aviso else "  ERRO ")
    print(f"{tag} {nome}" + (f"  ->  {det}" if det else ""))
    return ok

print("=" * 72); print(" DIAGNOSTICO DO EXECUTOR AJUSTE EXPRESSO"); print("=" * 72)
v = sys.version_info
item("Windows", platform.system() == "Windows", platform.platform())
item("Python 3.11+ de 64 bits", v >= (3, 11) and sys.maxsize > 2**32, f"{platform.python_version()} {'64' if sys.maxsize > 2**32 else '32'} bits")

mods = {}
for m in ("pyautogui", "win32gui", "win32api", "PIL", "winrt.windows.media.ocr", "winrt.windows.graphics.imaging"):
    try: __import__(m); mods[m] = True
    except Exception as e: mods[m] = False; item("biblioteca " + m, False, "nao instalada - rode INSTALAR.bat")
if all(mods.values()): item("bibliotecas Python", True)

ocr_ok = False
if mods.get("winrt.windows.media.ocr"):
    try:
        from winrt.windows.media.ocr import OcrEngine
        from winrt.windows.globalization import Language
        langs = [l.language_tag for l in OcrEngine.available_recognizer_languages]
        ocr_ok = OcrEngine.try_create_from_language(Language("pt-BR")) is not None
        item("OCR do Windows em portugues (pt-BR)", ocr_ok, "idiomas: " + ", ".join(langs) if langs else "nenhum idioma de OCR instalado")
        if not ocr_ok: print("         Como corrigir: Configuracoes > Hora e idioma > Idioma > Portugues (Brasil) > Opcoes > 'Reconhecimento optico' (instalar).")
    except Exception as e: item("OCR do Windows", False, str(e)[:120])

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception: pass
sw = sh = None
if mods.get("pyautogui"):
    import pyautogui
    sw, sh = pyautogui.size()
    dpi = 96
    try: dpi = ctypes.windll.user32.GetDpiForSystem()
    except Exception: pass
    item("resolucao do monitor principal", True, f"{sw}x{sh}  escala do Windows {round(dpi/96*100)}%")
    if (sw, sh) != (1920, 1080):
        item("resolucao igual a validada (1920x1080)", False, "diferente do validado: confira a escala sugerida abaixo e rode TESTAR_COM_SETA.bat", aviso=True)
    try:
        d = ctypes.windll.user32.OpenInputDesktop(0, False, 0x100)
        item("sessao do Windows desbloqueada", bool(d), "a tela precisa estar desbloqueada" if not d else "")
        if d: ctypes.windll.user32.CloseDesktop(d)
    except Exception: pass

seta = None
if mods.get("win32gui"):
    import win32gui, win32process
    found = []
    def cb(h, _):
        if win32gui.IsWindowVisible(h) and win32gui.GetClassName(h).startswith("seta") and "S E T A" in win32gui.GetWindowText(h): found.append(h)
    win32gui.EnumWindows(cb, None)
    if found:
        seta = found[0]; t = win32gui.GetWindowText(seta)
        item("Seta aberto e logado", True, t[:80])
        l, tp, r, b = win32gui.GetWindowRect(seta); cx, cy = (l + r) // 2, (tp + b) // 2
        if sw: item("Seta esta no monitor PRINCIPAL", 0 <= cx < sw and 0 <= cy < sh, "arraste o Seta para o monitor principal" if not (0 <= cx < sw and 0 <= cy < sh) else "")
    else:
        item("Seta aberto e logado", False, "abra o Seta e entre com o usuario (o Executor nunca digita senha)")

if seta and ocr_ok and sw:
    try:
        import seta_vision as V
        lines, img = V.screen_lines((0, 0, sw, sh))
        ext = img.getextrema(); black = all(e[1] < 8 for e in ext[:3]) if isinstance(ext[0], tuple) else False
        item("captura de tela funcionando (nao esta preta)", not black)
        words = [w for l in lines for w in l["words"] if w["y0"] < 70]
        cfg = next((w for w in words if V.norm(w["text"]).startswith("configuracoes")), None)
        if cfg:
            larg = cfg["x1"] - cfg["x0"]; sugestao = round(larg / 97.0, 2)
            item("menu da Retaguarda reconhecido pelo OCR", True, f"largura de 'Configuracoes' = {larg:.0f}px (referencia 97px)")
            if abs(sugestao - 1) > 0.08:
                print(f"         SUGESTAO: coloque  \"escala\": {sugestao}  no config.json (o Seta aparece {'maior' if sugestao > 1 else 'menor'} que o layout de referencia).")
                # aplica sozinho no config.json (so a escala; o resto do arquivo nao muda)
                cp = BASE / "config.json"
                if cp.exists():
                    try:
                        c = json.loads(cp.read_text(encoding="utf-8"))
                        if abs(float(c.get("escala", 1.0)) - sugestao) > 0.03:
                            c["escala"] = sugestao; cp.write_text(json.dumps(c, indent=2), encoding="utf-8")
                            print(f"         APLICADO: escala {sugestao} gravada no config.json.")
                        else: print(f"         (config.json ja esta com escala {c.get('escala')})")
                    except Exception as e: print("         nao consegui gravar a escala: " + str(e)[:80])
            else: item("escala do layout", True, "1.0 (igual a referencia)")
        elif any(V.norm(l["text"]).startswith("5 : retaguarda") for l in lines):
            item("Seta no launcher de modulos", True, "abra a Retaguarda (5) uma vez para a calibracao de escala", aviso=True)
        else:
            item("tela do Seta reconhecida", False, "deixe o Seta no Menu Inicial/Retaguarda, sem janelas abertas", aviso=True)
    except Exception as e: item("leitura da tela do Seta", False, str(e)[:120])

cfgp = BASE / "config.json"
if not cfgp.exists():
    item("config.json (token do executor)", False, "rode CONFIGURAR.bat")
else:
    try:
        cfg = json.loads(cfgp.read_text(encoding="utf-8")); item("config.json encontrado", True, "executor: " + cfg.get("device", "?"))
        import urllib.request, urllib.error
        req = urllib.request.Request(cfg["supabase_url"].rstrip("/") + "/rest/v1/rpc/executor_heartbeat",
              data=json.dumps({"p_token": cfg["token"], "p_device": cfg["device"], "p_status": "DIAGNOSTICO", "p_detalhe": "diagnostico.py", "p_versao": "diag", "p_host": platform.node()}).encode(),
              headers={"apikey": cfg["anon_key"], "Authorization": "Bearer " + cfg["anon_key"], "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r: item("conexao com o Portal e token valido", True, "pedidos na fila: " + str(json.loads(r.read()).get("pendentes")))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "ignore")
            item("conexao com o Portal e token valido", False, "token/executor recusado (gere outro no Portal > Seguranca > Executores)" if "autorizado" in body else body[:120])
        except Exception as e: item("conexao com o Portal (internet)", False, str(e)[:120])
    except Exception as e: item("config.json valido", False, str(e)[:120])

print("=" * 72)
falhas = sum(1 for x in R if not x)
print(" RESULTADO: " + ("TUDO CERTO - pode iniciar o Executor (INICIAR.bat)." if not falhas else f"{falhas} item(ns) com ERRO - corrija e rode de novo."))
print("=" * 72)
sys.exit(1 if falhas else 0)
