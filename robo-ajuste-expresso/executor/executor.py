# EXECUTOR AJUSTE EXPRESSO -> SETA (ENTRADA de estoque, finalidade VENDA)
# Fluxo validado no Seta real (18/09/2026): Estoque > Acerto do Estoque > Codigo > Quantidade > Observacao
#   > Acertar Estoque > "Confirma o Acerto do Estoque?" > Sim.
# Regra de ouro: reconhecer (OCR) -> agir -> reconhecer de novo. Na duvida, BLOQUEIA. Nunca repete commit.
#
# Uso:
#   python executor.py --selftest            preflight sem tocar em nada
#   python executor.py --dry  COD QTD LOJA   navega/preenche/confere e FECHA sem lancar
#   python executor.py --once COD QTD LOJA   lanca de verdade UMA vez (local, sem Supabase)
#   python executor.py --loop                24h: pega pedidos PENDENTE no Supabase (config.json)
import asyncio, ctypes, json, time, os, sys, re, socket, unicodedata, argparse, traceback, urllib.request, urllib.error
import shutil
from pathlib import Path
import pyautogui, win32gui, win32process, win32api, win32con
from PIL import ImageOps, Image
import seta_vision as V
from sentinela import validate_request, authorize_navigation, authorize_commit, SecurityBlock

VERSAO = '1.5.1'
try: ctypes.windll.shcore.SetProcessDpiAwareness(2)   # coordenadas fisicas: captura de tela e cliques no mesmo sistema (PC com escala 125%/150%)
except Exception:
    try: ctypes.windll.user32.SetProcessDPIAware()
    except Exception: pass
BASE = Path(__file__).resolve().parent
STATE, LOG, JOURNAL, CONFIG, STOPFILE = (BASE / n for n in ("state.json", "executor.log", "journal.json", "config.json", "STOP"))
PAUSAFILE = BASE / "PAUSA"   # 1.5.0: freio de emergencia. Existe = fila pausada ate uma pessoa rodar RETOMAR.bat (sobrevive a reinicio)
DIAG = BASE / "diag"
def _escala():
    try: return float(json.loads((Path(__file__).resolve().parent / 'config.json').read_text(encoding='utf-8')).get('escala', 1.0))
    except Exception: return 1.0
ESCALA = _escala()   # 1.0 = layout validado (Seta em 1920x1080, 100%). O diagnostico.py sugere outro valor em outro PC.
def S(v): return int(round(v * ESCALA))
pyautogui.FAILSAFE = True   # mouse no canto superior esquerdo aborta
pyautogui.PAUSE = 0.05
SW, SH = pyautogui.size()
FULL = (0, 0, SW, SH)

class Blocked(RuntimeError):
    def __init__(self, code, detail=""):
        super().__init__(code + (": " + detail if detail else "")); self.code = code; self.detail = detail

# ---------------------------------------------------------------- log / estado / diario
def log(event, **data):
    try:
        if LOG.exists() and LOG.stat().st_size > 5_000_000: os.replace(LOG, LOG.with_suffix(".log.1"))
    except Exception: pass
    with LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"ts": time.strftime("%Y-%m-%d %H:%M:%S"), "event": event, **data}, ensure_ascii=False) + "\n")

def save_state(**data):
    STATE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

class JournalError(RuntimeError):
    """O diario existe mas nao pode ser lido. O robo NAO pode seguir: sem o diario ele nao sabe o que ja foi confirmado no Seta."""

def journal_load():
    if not JOURNAL.exists(): return {}                      # primeira execucao neste PC: diario vazio de verdade
    try: return json.loads(JOURNAL.read_text(encoding="utf-8"))
    except Exception as e:
        bak = JOURNAL.with_suffix(".bak")
        try:
            j = json.loads(bak.read_text(encoding="utf-8")); log("JOURNAL_RESTAURADO_DO_BACKUP", err=str(e)[:120]); return j
        except Exception: pass
        raise JournalError("journal.json ilegivel e sem backup valido (%s). Robo parado por seguranca: confira o estoque no Seta dos pedidos EM_EXECUCAO e restaure o diario." % str(e)[:100])

def journal_set(protocolo, **data):
    j = journal_load(); j.setdefault(protocolo, {}).update(data, ts=time.strftime("%Y-%m-%d %H:%M:%S"))
    tmp = JOURNAL.with_suffix(".tmp"); tmp.write_text(json.dumps(j, ensure_ascii=False, indent=2), encoding="utf-8")
    if JOURNAL.exists():
        try: shutil.copyfile(JOURNAL, JOURNAL.with_suffix(".bak"))   # ultima versao boa, caso o arquivo principal corrompa
        except Exception: pass
    os.replace(tmp, JOURNAL)

# ---------------------------------------------------------------- janela do Seta
def seta_hwnd():
    found = []
    def cb(h, _):
        if win32gui.IsWindowVisible(h) and win32gui.GetClassName(h).startswith("seta") and "S E T A" in win32gui.GetWindowText(h):
            found.append(h)
    win32gui.EnumWindows(cb, None)
    if not found: raise Blocked("SETA_NAO_LOCALIZADO")
    return found[0]

def seta_pid(h): return win32process.GetWindowThreadProcessId(h)[1]

def title_store(h):
    m = re.search(r"Empresa:\s*(\d{3})", win32gui.GetWindowText(h))
    return m.group(1) if m else None

def focus(h):
    if win32gui.IsIconic(h): win32gui.ShowWindow(h, win32con.SW_RESTORE)
    for tentativa in (1, 2, 3):
        fg = win32gui.GetForegroundWindow()
        if fg == h: return
        t_fg = win32process.GetWindowThreadProcessId(fg)[0]; t_me = win32api.GetCurrentThreadId()
        try:
            win32process.AttachThreadInput(t_me, t_fg, True)
            try: win32gui.SetForegroundWindow(h)
            finally: win32process.AttachThreadInput(t_me, t_fg, False)
        except Exception:
            # Windows recusou: um toque de Alt libera a troca de foreground e a janela e restaurada/reativada
            win32api.keybd_event(win32con.VK_MENU, 0, 0, 0); win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
            win32gui.ShowWindow(h, win32con.SW_SHOW)
            try: win32gui.SetForegroundWindow(h)
            except Exception: pass
        time.sleep(0.35)
    if win32gui.GetForegroundWindow() != h: raise Blocked("SETA_SEM_FOCO")

# ---------------------------------------------------------------- visao
def look():
    lines, _ = V.screen_lines(FULL); return lines

def alltext(lines): return " | ".join(l["text"] for l in lines)

def is_acerto(lines):
    return V.find_label(lines, "Acerto do estoque") is not None and V.find_label(lines, "Novo Estoque") is not None

def modal_present(lines):
    return V.find_label(lines, "Atencao") is not None or V.find_label(lines, "Confirma") is not None

def wait_for(pred, timeout=8.0, interval=0.2, what=""):
    """Espera curta e limitada (sem sleep fixo): reavalia a tela ate pred(lines) ou estourar o limite."""
    t0 = time.monotonic(); lines = look()
    while True:
        r = pred(lines)
        if r: return lines
        if time.monotonic() - t0 > timeout:
            salvar_diag(what)
            raise Blocked("TIMEOUT", what)
        time.sleep(interval); lines = look()

DIAG_MAX_HORA, DIAG_MAX_ARQUIVOS = 10, 100
_DIAG_T = []
def salvar_diag(what):
    """1.5.0: captura de diagnostico com limite (no PC31 foram mais de 700 imagens). No maximo DIAG_MAX_HORA por hora e
    DIAG_MAX_ARQUIVOS na pasta (apaga as mais antigas). Nunca derruba o pedido por causa da captura."""
    try:
        agora = time.time(); _DIAG_T[:] = [t for t in _DIAG_T if agora - t < 3600]
        if len(_DIAG_T) >= DIAG_MAX_HORA: log("DIAG_LIMITE", what=what[:60]); return False
        DIAG.mkdir(exist_ok=True)
        V.grab(FULL).save(DIAG / (time.strftime("%Y%m%d_%H%M%S") + "_" + re.sub(r"\W+", "_", what)[:40] + ".png"))
        _DIAG_T.append(agora)
        imgs = sorted(DIAG.glob("20[0-9][0-9][01][0-9][0-3][0-9]_*.png"))   # so as do 1.5.0 (nome com data): as antigas sao evidencia e ficam
        for f in imgs[:max(0, len(imgs) - DIAG_MAX_ARQUIVOS)]: f.unlink(missing_ok=True)
        return True
    except Exception: return False

def guard():
    """Nada de tecla/clique sem o Seta em primeiro plano (o usuario pode ter clicado em outro app)."""
    h = seta_hwnd(); focus(h); return h

def click_xy(x, y): guard(); pyautogui.moveTo(x, y, duration=0.12); pyautogui.click()
def type_text(t, interval=0.12): guard(); pyautogui.typewrite(str(t), interval=interval)
def press_key(*k): guard(); pyautogui.press(k[0]) if len(k) == 1 else pyautogui.hotkey(*k)
def click_line(ln): click_xy((ln["x0"] + ln["x1"]) / 2, (ln["y0"] + ln["y1"]) / 2)

NUM_RE = re.compile(r"^-?\d{1,3}(?:\.\d{3})*,\d{2}$")   # 1.3.3: aceita negativo (-1,00)
LAST_RAW = []   # 1.3.3: o que o OCR leu na ultima celula numerica (vai no erro se ficar ilegivel)
def _num_norm(t):
    """1.3.3: OCR le zero como letra O/o e o sinal de menos como travessao; normaliza antes de validar."""
    t = t.replace("O", "0").replace("o", "0").replace("–", "-").replace("−", "-")
    # 1.3.4: no PC com Seta menor o OCR le a virgula como 't' (ex.: '0t00'); so troca o separador antes dos 2 ultimos digitos
    return re.sub(r"(?<=\d)[tT;:](?=\d{2}$)", ",", t)

def _cell_images(lines, label, dx0=100, dx1=232):
    """Gera variantes do recorte (escala x margem). O Windows OCR e caprichoso com recorte pequeno: a margem em volta e
    essencial e cada escala erra em pontos diferentes; por isso votamos."""
    lab = V.find_label(lines, label)
    if not lab: return
    # 1.3.2: recorte acompanha a escala do Seta (PC com Seta menor, escala 0.79, lia o campo errado). Escala 1.0 = igual antes.
    x0 = int(lab["x0"] + S(dx0)); y0 = int(lab["y0"] - S(5)); base = V.grab((x0, y0, int(lab["x0"] + S(dx1)), y0 + S(28))).convert("L")
    ac = ImageOps.autocontrast(base); fill = int(ac.getpixel((2, 2)))
    for sc, pad in ((4, 40), (4, 30), (4, 50), (3.5, 40), (4.5, 40), (5, 40), (3, 40), (4, 60), (6, 40), (3.5, 30), (4.5, 50)):
        yield ImageOps.expand(ac.resize((int(ac.width * sc), int(ac.height * sc)), Image.LANCZOS), pad, fill=fill)

def cell_text(lines, label, dx0=100, dx1=232):
    """Texto bruto (1a variante que leu algo) - usado p/ codigo; numeros usam cell_number."""
    for im in _cell_images(lines, label, dx0, dx1):
        txt = " ".join(l.text for l in asyncio.run(V._ocr(im)).lines).strip()
        if txt: return txt
    return ""

def cell_number(lines, label):
    """Numero 'ddd,dd' por votacao ate ter 3 leituras iguais e maioria sobre qualquer outra numerica (sai cedo).
    So aceita formato numerico (letras como 'zoo' sao descartadas). Empate/conflito -> None (chamador bloqueia)."""
    from collections import Counter
    votes = Counter(); LAST_RAW.clear()
    for im in _cell_images(lines, label):
        t = _num_norm("".join(l.text for l in asyncio.run(V._ocr(im)).lines).replace(" ", ""))
        if len(LAST_RAW) < 12: LAST_RAW.append(t)
        if NUM_RE.match(t): votes[t] += 1
        if votes:
            (top, n), rest = votes.most_common(1)[0], sum(votes.values()) - votes.most_common(1)[0][1]
            if n >= 3 and n > 2 * rest: return V.parse_num(top)
    if votes:
        (top, n), rest = votes.most_common(1)[0], sum(votes.values()) - votes.most_common(1)[0][1]
        if n >= 2 and rest == 0: return V.parse_num(top)
    return None

def read_stock(lines, label):
    return cell_number(lines, label)

def dismiss_modal(lines):
    """Fecha aviso. Pergunta (Sim/Nao) -> clica NAO. Aviso simples ('Atencao...') -> botao Ok por posicao
    relativa ao cabecalho (o OCR nao le o 'Ok' sublinhado). Nunca aperta Enter (Sim e o padrao do Seta)."""
    words = [w for l in lines for w in l["words"]]
    nao = next((w for w in words if V.norm(w["text"]) == "nao" and w["y0"] > 300), None)
    if nao and V.find_label(lines, "Confirma"):
        click_xy((nao["x0"] + nao["x1"]) / 2, (nao["y0"] + nao["y1"]) / 2); return True
    h = V.find_label(lines, "Atencao")
    if h and not V.find_label(lines, "Confirma"):
        click_xy(h["x0"] + S(313), h["y0"] + S(176)); return True
    return False

# ---------------------------------------------------------------- etapas do Seta
def menubar_present(lines):
    ws = [V.norm(w["text"]) for l in lines for w in l["words"] if w["y0"] < 60]
    return "cadastros" in ws and "sair" in ws

def launcher_present(lines):
    return V.find_label(lines, "F5 - Trocar") is not None and any(V.norm(l["text"]).startswith("5 : retaguarda") for l in lines)

def send_f5():
    """F5 com scan code (como o teclado fisico). pyautogui.press('f5') vira o caractere 'Y' no campo do launcher."""
    guard(); win32api.keybd_event(win32con.VK_F5, 0x3F, 0, 0); time.sleep(0.08); win32api.keybd_event(win32con.VK_F5, 0x3F, win32con.KEYEVENTF_KEYUP, 0)

def handle_popups(lines):
    """Avisos que o Seta mostra ao logar na loja. 'Importante' (fiscal) -> Fechar (nunca 'Saiba mais'); 'Atencao' -> Ok."""
    imp = V.find_label(lines, "Importante")
    if imp:
        # 1.4.0: clica no CENTRO do botao Fechar lido pelo OCR (abaixo do cabecalho); sem leitura, usa a posicao do botao na tela
        f = next((w for l in lines for w in l["words"] if V.norm(w["text"]) == "fechar" and w["y0"] > imp["y0"] + S(150) and w["x0"] > imp["x0"]), None)
        if f: click_xy((f["x0"] + f["x1"]) / 2, (f["y0"] + f["y1"]) / 2)
        else: click_xy(imp["x0"] + S(316), imp["y0"] + S(332))
        log("AVISO_IMPORTANTE_FECHADO", ocr=bool(f)); return True
    if modal_present(lines): return dismiss_modal(lines)
    return False

def limpar_avisos(lines=None):
    """1.4.0: fecha os avisos que ficam NA FRENTE do launcher (ex.: 'Importante' - documentos fiscais pendentes).
    Antes o robo via o launcher por tras do aviso, apertava F5 e nada acontecia (TIMEOUT janela Escolha a empresa)."""
    lines = lines or look()
    for _ in range(3):
        if pedindo_senha(lines): raise Blocked("SETA_PEDINDO_SENHA", "o Seta esta pedindo a senha do usuario - alguem precisa entrar no Seta")
        if not handle_popups(lines): return lines
        time.sleep(1.0); lines = look()
    return lines

def pedindo_senha(lines):
    return any("digitar a sua senha" in V.norm(l["text"]) for l in lines)       # "Quase la! Agora e so digitar a sua senha."

def ensure_launcher(h):
    """Volta ao launcher de modulos (unico lugar onde F5 - Trocar Loja funciona) via menu Sair. Nunca fecha o Seta."""
    lines = limpar_avisos()                                  # 1.4.0: aviso na frente do launcher primeiro
    if launcher_present(lines): return lines
    if is_acerto(lines):
        commit_click("Fechar", lines); time.sleep(1.2); lines = look()
    for tentativa in range(1, 5):
        w = next((w for l in lines for w in l["words"] if V.norm(w["text"]) == "sair" and w["y0"] < 60), None)
        if not w: raise Blocked("SAIR_NAO_ENCONTRADO", alltext(lines)[:160])
        click_xy((w["x0"] + w["x1"]) / 2, (w["y0"] + w["y1"]) / 2)         # so clica se a barra de menu ainda esta na tela
        try: return wait_for(launcher_present, 7, what="launcher de modulos apos Sair")
        except Blocked:
            lines = look()
            if launcher_present(lines): return lines
            if not menubar_present(lines) and tentativa < 4: continue         # pode estar so carregando
            if tentativa == 4: raise
    raise Blocked("LAUNCHER_NAO_ABRIU")

def fechar_dialogo_empresa():
    """Fecha a janela 'Escolha a empresa' com verificacao. Esc funciona sempre; o clique em Cancelar falha quando a lista esta vazia."""
    aberto = lambda: V.find_label(look(), "Escolha a empresa") is not None
    for _ in range(3):
        if not aberto(): return True
        press_key("escape"); time.sleep(1.2)
        if not aberto(): return True
        c = V.find_label(look(), "Cancelar")
        if c: click_xy(c["x0"] + S(15), c["y0"] + S(4)); time.sleep(1.2)
    return not aberto()

def digitado_no_campo(lines, n):
    """O numero da loja digitado aparece no campo de busca (parte de baixo da janela 'Escolha a empresa').
    1.5.1: a altura acompanha a escala do Seta. No PC31 (escala 0.79) o campo fica acima de 600 px e o numero lido
    certo era recusado (loja nunca trocava). Escala 1.0 (D90) = igual antes."""
    return any(l["y0"] > S(600) and len(l["text"].strip()) <= len(n) + 2 and re.sub(r"\D", "", l["text"]) == n for l in lines)

def change_store(h, exp):
    n = str(int(exp))
    for tentativa in (1, 2):
        lines = limpar_avisos(); log("TROCA_F5", exp=exp, tentativa=tentativa, launcher=launcher_present(lines), menubar=menubar_present(lines), modal=modal_present(lines))
        if V.find_label(lines, "Escolha a empresa") is None:
            send_f5()
        try: wait_for(lambda ls: V.find_label(ls, "Escolha a empresa") is not None, 8, what="janela Escolha a empresa"); break
        except Blocked:
            if tentativa == 2: raise
    def one(ls):
        # a lista filtrada deve ter UMA unica linha de empresa ("NNN - NOME") e ela deve ser a pedida
        # 1.3.5: o OCR pode juntar a coluna Codigo com o Nome ("42 042 - CABO ..."): aceita um codigo na frente e compara pelo NUMERO
        rows = []
        for l in ls:
            t = l["text"].upper().replace("O", "0")
            m = re.match(r"^\s*(?:\d{1,3}\s+)?(\d{2,3})\s*-\s*\S", t)
            if m and 300 < l["x0"] < 1300 and 100 < l["y0"] < 780: rows.append((int(m.group(1)), t, l))
        vistos_lista[:] = [t for _, t, _l in rows[:6]]                # 1.3.5: o que apareceu na lista vai no erro
        # 1.3.8: a busca do Seta filtra por "contem" (digitar 5 traz 005, 015, 025...). Vale se a loja pedida aparece UMA vez;
        # o robo clica nela. Depois do Ok o titulo do Seta confirma a loja (senao TROCA_DE_LOJA_NAO_CONCLUIDA) e o sentinela confere antes de lancar.
        certas = [r for r in rows if r[0] == int(exp)]
        alvo[:] = [certas[0][2]] if len(certas) == 1 else []
        return len(certas) == 1
    lines = None; vistos_lista = []; alvo = []
    for tentativa in (1, 2, 3):
        time.sleep(0.8)                                              # o campo de busca demora a aceitar teclas
        ls = look(); fr = V.find_label(ls, "Foram encontrados")
        if fr: click_xy(fr["x0"] + S(220), fr["y0"] - S(22))                          # foca o campo de busca (fica logo acima do rodape)
        for _ in range(4): press_key("backspace")
        type_text(n, 0.2); time.sleep(0.5)
        ls_d = look()
        # 1.4.2: aceita a leitura so com os digitos (a loja 42 falhava sempre: o OCR le o "42" do campo com algum caractere a mais).
        # Seguro: depois do Enter a lista ainda precisa trazer UMA linha com a loja pedida, senao nada e confirmado.
        if not digitado_no_campo(ls_d, n):
            log("TROCA_DIGITACAO_NAO_APARECEU", n=n, tentativa=tentativa, visto=" / ".join(l["text"].strip() for l in ls_d if l["y0"] > S(560))[:200]); continue   # confere ANTES do Enter
        press_key("enter"); log("TROCA_DIGITADO", n=n, tentativa=tentativa)
        try: lines = wait_for(one, 5, what="empresa " + exp + " unica na lista"); break
        except Blocked: log("TROCA_LISTA_FALHOU", exp=exp, tentativa=tentativa, tela=alltext(look())[:300])
    if lines is None:
        fechar_dialogo_empresa()
        raise Blocked("TROCA_DE_LOJA_LISTA", "empresa " + exp + " nao apareceu unica | lista=" + " / ".join(vistos_lista)[:180])
    if alvo:                                             # 1.3.8: seleciona a linha da loja pedida (necessario quando a lista traz outras lojas)
        click_line(alvo[0]); time.sleep(0.6); log("TROCA_LINHA_CLICADA", exp=exp, linhas=len(vistos_lista))
    for tentativa in (1, 2, 3):                          # SEMPRE dar OK: o Seta so troca a loja com o botao Ok
        c = V.find_label(look(), "Cancelar")
        if not c: break                                  # dialogo fechou
        click_xy(c["x0"] + S(15), c["y0"] - S(26))             # botao Ok fica logo acima de Cancelar (OCR nao le o Ok sublinhado)
        log("TROCA_OK_CLICADO", exp=exp, tentativa=tentativa); time.sleep(0.8)
    t0 = time.monotonic()
    while time.monotonic() - t0 < 60:
        time.sleep(0.5); ls = look()                     # 1.4.1: confere a cada 0,5 s (antes 1 s)
        if handle_popups(ls): log("TROCA_POPUP_FECHADO"); time.sleep(1.0); continue
        if title_store(h) == exp and launcher_present(ls) and not modal_present(ls): return
    raise Blocked("TROCA_DE_LOJA_NAO_CONCLUIDA", f"titulo={title_store(h)} esperado={exp}")

def open_retaguarda(h):
    lines = limpar_avisos()
    if menubar_present(lines): return lines
    lb = next((l for l in lines if V.norm(l["text"]).startswith("5 : retaguarda")), None)
    if not lb: raise Blocked("BOTAO_RETAGUARDA_NAO_ENCONTRADO")
    click_xy((lb["x0"] + lb["x1"]) / 2, lb["y0"] - S(70))  # icone do modulo fica acima do rotulo
    def aberto(ls):                                         # 1.4.0: aviso que surge enquanto abre -> fecha e continua esperando
        if handle_popups(ls): time.sleep(1.0); return False
        return menubar_present(ls)
    return wait_for(aberto, 25, what="Retaguarda abrir")

TROCAS_MAX, TROCAS_JANELA = 12, 600
_TROCAS = []
def limite_trocas(espera=time.sleep):
    """1.5.0: no maximo TROCAS_MAX trocas de loja a cada TROCAS_JANELA s. Operacao normal (~55 s por pedido com troca)
    fica abaixo do limite; so segura rajadas anormais como a do PC31 (07 > 94 > 92 > 60 > 14 > 80 > 18 > 45 em minutos)."""
    while True:
        agora = time.monotonic(); _TROCAS[:] = [t for t in _TROCAS if agora - t < TROCAS_JANELA]
        if len(_TROCAS) < TROCAS_MAX: _TROCAS.append(agora); return
        falta = TROCAS_JANELA - (agora - _TROCAS[0]) + 0.5
        log("LIMITE_TROCAS_LOJA", trocas=len(_TROCAS), espera_s=round(falta, 1)); espera(min(falta, 30))

def goto_store(h, expected):
    exp = str(expected).zfill(3)
    if title_store(h) == exp and menubar_present(look()): return exp
    ensure_launcher(h)
    if title_store(h) != exp: limite_trocas(); change_store(h, exp)
    open_retaguarda(h)
    if title_store(h) != exp: raise Blocked("LOJA_DIFERENTE", f"seta={title_store(h)} pedido={exp}")
    return exp

def open_acerto(h):
    lines = look()
    if modal_present(lines):
        dismiss_modal(lines); time.sleep(0.4); lines = look()
        if modal_present(lines): raise Blocked("MODAL_INESPERADO", alltext(lines)[:160])
    if is_acerto(lines):
        if not ((V.value_right_of(lines, "Descricao") or "").strip() or (V.value_right_of(lines, "Codigo") or "").strip()): return lines
        commit_click("Fechar", lines)                      # formulario sujo -> descarta e reabre zerado (nada e lancado ao Fechar)
        wait_for(lambda ls: not is_acerto(ls), 5, what="fechar Acerto"); time.sleep(1.0)   # Seta ignora cliques logo apos fechar
        lines = look()
    est = [w for l in lines for w in l["words"] if V.norm(w["text"]) == "estoque" and w["y0"] < 60]
    if not est: raise Blocked("MENU_ESTOQUE_NAO_ENCONTRADO", alltext(lines)[:160])
    def item(ls):
        for l in ls:
            if V.norm(l["text"]).startswith("acerto do estoque") and l["y0"] > 60 and l["x0"] < 500: return l
    for tentativa in range(1, 6):
        click_xy((est[0]["x0"] + est[0]["x1"]) / 2, (est[0]["y0"] + est[0]["y1"]) / 2)
        try: lines = wait_for(item, 2.5, what="item Acerto do Estoque"); break
        except Blocked:
            if tentativa == 5: raise
            press_key("escape"); time.sleep(1.0)   # fecha menu eventualmente aberto (evita alternar abre/fecha) e da folga ao Seta
            focus(h)
    click_line(item(lines))
    return wait_for(is_acerto, 10, what="tela Acerto do estoque")

def load_product(lines, code, desc_esperada=None):
    """desc_esperada (1.4.1): so na conferencia DEPOIS do lancamento. Se a tela inteira ja leu o codigo exato e a descricao
    e a mesma do produto lancado, dispensa as 3 releituras + lupa (economiza ~3 s; o estoque ainda e conferido depois)."""
    lab = V.find_label(lines, "Codigo")
    if not lab: raise Blocked("CAMPO_CODIGO_AUSENTE")
    want = str(code).lstrip("0")
    if (V.value_right_of(lines, "Codigo") or "").strip():
        raise Blocked("FORMULARIO_NAO_ZERADO", "Codigo ja preenchido; reabrir o Acerto antes")   # nunca sobrescrever (Home/Shift+End confunde o Seta)
    click_xy(lab["x0"] + S(156), (lab["y0"] + lab["y1"]) / 2); time.sleep(0.25)
    type_text(str(code), 0.12); time.sleep(0.4)   # rapido demais corrompe o codigo; NUNCA Ctrl+A (abre Cadastro de Clientes)
    # Antes do Enter o cursor piscando encosta no ultimo digito e o OCR le 9 como 4, entao a conferencia dura e DEPOIS do Enter
    # (campo sem cursor). Enter so carrega ficha (nao lanca nada); codigo errado e barrado abaixo antes de qualquer quantidade.
    press_key("enter")
    visto = {}
    def lupa_conta(ls, minimo):
        """1.3.9: quantas ampliacoes do campo Codigo leem EXATAMENTE o codigo pedido (para ao atingir 'minimo')."""
        n, lidos = 0, []
        for im in _cell_images(ls, "Codigo", 100, 232):
            dig = re.sub(r"\D", "", " ".join(l.text for l in asyncio.run(V._ocr(im)).lines)).lstrip("0")
            if dig: lidos.append(dig)
            if dig == want:
                n += 1
                if n >= minimo: break
        visto["lupa"] = "|".join(lidos[:6]); return n
    def loaded(ls):
        if modal_present(ls): raise Blocked("AVISO_DO_SETA", alltext(ls)[:200])
        raw = V.value_right_of(ls, "Codigo") or ""
        c = re.sub(r"\D", "", raw).lstrip("0")        # 1.3.5: so os digitos (OCR juntava icone/letra ao codigo no Seta menor)
        d = V.value_right_of(ls, "Descricao") or ""
        visto.update(codigo=raw[:30], descricao=d[:40])
        if len(d) <= 2: return False
        if c == want: return True
        # 1.3.9: produto carregou (tem descricao) mas a leitura da tela inteira errou digitos (Seta menor): a lupa decide (2 ampliacoes exatas)
        if lupa_conta(ls, 2) >= 2: visto["por_lupa"] = True; return True
        return False
    try: lines = wait_for(loaded, 8, what="produto carregar")
    except Blocked as e:
        if e.code == "TIMEOUT": raise Blocked("TIMEOUT", "produto carregar | lido codigo=%r descricao=%r lupa=%s" % (visto.get("codigo"), visto.get("descricao"), visto.get("lupa", "")))
        raise
    if desc_esperada and not visto.get("por_lupa") and V.norm(V.value_right_of(lines, "Descricao") or "") == V.norm(desc_esperada):
        return lines, {"descricao": desc_esperada, "cor": V.value_right_of(lines, "Cor")}
    # confirmacao estavel (sem cursor): 3 leituras da tela + 1 do recorte ampliado, todas = codigo pedido
    ls = lines
    for _ in range(3):
        time.sleep(0.2); ls = look()
        if visto.get("por_lupa"): break                # 1.3.9: tela inteira nao le este codigo; a lupa ja confirmou 2x e confirma de novo abaixo
        if re.sub(r"\D", "", V.value_right_of(ls, "Codigo") or "").lstrip("0") != want: raise Blocked("CODIGO_CARREGADO_DIVERGENTE", f"pedido={want}")
    # 1.3.7: a "lupa" tenta varias ampliacoes; basta UMA ler exatamente o codigo (as 3 leituras da tela ja bateram acima)
    lidos = []
    for im in _cell_images(ls, "Codigo", 100, 232):
        dig = re.sub(r"\D", "", " ".join(l.text for l in asyncio.run(V._ocr(im)).lines)).lstrip("0")
        if dig: lidos.append(dig)
        if dig == want: break
    else:
        raise Blocked("CODIGO_CARREGADO_DIVERGENTE_RECORTE", f"pedido={want} lupa=" + "|".join(lidos[:8]))
    lines = ls
    return lines, {"descricao": V.value_right_of(lines, "Descricao"), "cor": V.value_right_of(lines, "Cor")}

def commit_click(name, lines):
    for l in lines:
        if V.norm(l["text"]).startswith(V.norm(name)) and l["x0"] < 780: click_line(l); return
    raise Blocked("BOTAO_NAO_ENCONTRADO", name)

def safe_ascii(s):
    return re.sub(r"[^A-Z0-9 \-\./:]", "", unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().upper())[:80]

# ---------------------------------------------------------------- execucao de um pedido
def execute(req, mode="real", report=lambda **k: None):
    """mode: 'dry' (fecha sem lancar) | 'real'. Retorna dict com resultado e tempos."""
    t_all = time.monotonic(); marks = {}
    def stage(name, etapa=None, **kw):
        marks[name] = round(time.monotonic() - t_all, 2); log("ETAPA", protocolo=req.get("protocolo"), etapa=name, t=marks[name])
        report(etapa=etapa or name, **kw)
    proto = str(req.get("protocolo") or "LOCAL")
    validate_request(req)
    jr = journal_load().get(proto)
    if jr and jr.get("fase") in ("COMMIT_CLICADO", "CONCLUIDO", "VERIFICAR_EXECUCAO") and mode == "real":
        raise Blocked("PEDIDO_JA_TENTADO", f"fase={jr.get('fase')} - NAO repetir; verificar estoque manualmente")
    h = seta_hwnd(); pid = seta_pid(h); focus(h)
    loja = goto_store(h, req["codigo_seta_solicitado"]); authorize_navigation(pid, loja); stage("loja_ok", "VALIDAR_LOJA_ATIVA", loja_seta_lida=loja, loja_validada=True)
    qty = int(req["quantidade"]); code = str(req["codigo_produto"]).strip()
    lines = open_acerto(h); stage("acerto_aberto", "ABRIR_ACERTO_ESTOQUE")
    lines, prod = load_product(lines, code); stage("produto_carregado", "VALIDAR_PRODUTO")
    before = read_stock(lines, "Estoque Atual")
    if before is None: raise Blocked("ESTOQUE_ATUAL_ILEGIVEL", "leituras=" + "|".join(LAST_RAW)[:160])
    stage("estoque_lido", "LER_ESTOQUE_ATUAL", estoque_anterior=before)
    mov = (V.value_right_of(lines, "Movimento") or "")
    if "entrada" not in V.norm(mov): raise Blocked("MOVIMENTO_NAO_ENTRADA", mov)
    lq = V.find_label(lines, "Quantidade")
    click_xy(lq["x0"] + S(170), (lq["y0"] + lq["y1"]) / 2); time.sleep(0.15)
    press_key("home"); press_key("shift", "end"); type_text(str(qty), 0.04); press_key("tab")
    def novo_ok(ls):
        n = read_stock(ls, "Novo Estoque"); q = read_stock(ls, "Quantidade")
        return n is not None and q is not None and abs(q - qty) < 1e-9 and abs(n - (before + qty)) < 1e-9
    lines = wait_for(novo_ok, 5, what="Novo Estoque = atual + quantidade")
    lo = V.find_label(lines, "Observacao")
    click_xy(lo["x0"] + S(150), lo["y1"] + S(40)); time.sleep(0.15)
    obs = safe_ascii(req.get("motivo") or "SOLICITADO PELO GERENTE")   # igual ao que o usuario digita no Seta (teste: TESTE DE IA)
    type_text(obs, 0.02); time.sleep(0.3)
    lines = look()
    if not novo_ok(lines): raise Blocked("DADOS_MUDARAM_ANTES_DO_COMMIT")
    stage("dados_preenchidos", "PREENCHER_ENTRADA", estoque_novo=before + qty)
    pre_text = alltext(lines)
    authorize_commit(pid, req, before, before + qty, screen_text=pre_text)   # 1a barreira
    stage("pre_commit_ok", "VALIDAR_DADOS")
    if mode == "dry":
        commit_click("Fechar", lines); time.sleep(1.5); stage("dry_fechado"); return {"ok": True, "dry": True, "antes": before, "tempos": marks, "produto": prod}
    commit_click("Acertar Estoque", lines)
    def conf(ls):
        return V.find_label(ls, "Confirma o Acerto") is not None
    lines = wait_for(conf, 6, what="janela Confirma o Acerto")
    stage("confirmacao_aberta", "CONFIRMAR_ENTRADA")
    # 2a barreira, antes do ponto sem volta: o modal escurece o formulario (OCR nao le mais 'Novo Estoque'), entao vale o texto do
    # formulario lido imediatamente antes (ja validado com novo = atual + qtd) + a pergunta do modal na tela agora.
    if not any(V.norm(l["text"]).startswith("confirma o acerto do estoque") for l in lines): raise Blocked("CONFIRMACAO_NAO_RECONHECIDA")
    authorize_commit(pid, req, before, before + qty, screen_text=pre_text + " | " + alltext(lines))
    sim = next((w for l in lines for w in l["words"] if V.norm(w["text"]) == "sim"), None)
    if not sim: raise Blocked("BOTAO_SIM_NAO_ENCONTRADO")
    journal_set(proto, fase="COMMIT_CLICADO", id=req.get("id"), produto=code, qtd=qty, antes=before, loja=loja)   # ANTES do clique irreversivel
    click_xy((sim["x0"] + sim["x1"]) / 2, (sim["y0"] + sim["y1"]) / 2)
    stage("sim_clicado", "CONFIRMAR_ENTRADA")
    try:
        lines = wait_for(lambda ls: is_acerto(ls) and not modal_present(ls) and not (V.value_right_of(ls, "Descricao") or "").strip(), 10, what="formulario limpar apos Sim")
    except Blocked:
        journal_set(proto, fase="VERIFICAR_EXECUCAO"); raise Blocked("VERIFICAR_EXECUCAO", "nao confirmei o retorno do Seta apos o Sim; NAO repetir")
    try:
        lines, _ = load_product(lines, code, desc_esperada=prod.get("descricao")); after = read_stock(lines, "Estoque Atual")
    except Blocked:
        journal_set(proto, fase="VERIFICAR_EXECUCAO"); raise Blocked("VERIFICAR_EXECUCAO", "nao consegui reler o estoque")
    stage("verificado", "CONCLUIDO", estoque_novo=after)
    if after is None or abs(after - (before + qty)) > 1e-9:
        journal_set(proto, fase="VERIFICAR_EXECUCAO", depois=after)
        raise Blocked("ESTOQUE_POS_DIVERGENTE", f"antes={before} qtd={qty} depois={after}")
    journal_set(proto, fase="CONCLUIDO", depois=after)
    # 1.3.1: fecha a janela do Acerto e deixa o Seta no menu (o ajuste ja esta lancado e conferido; se falhar aqui, so registra)
    try: commit_click("Fechar", lines); time.sleep(1.2); log("ACERTO_FECHADO", protocolo=proto)
    except Exception as e: log("FECHAR_APOS_CONCLUIDO_FALHOU", err=repr(e)[:150])
    return {"ok": True, "antes": before, "depois": after, "tempos": marks, "produto": prod, "total": round(time.monotonic() - t_all, 2)}

# ---------------------------------------------------------------- Supabase
class Supa:
    def __init__(self, cfg):
        self.url = cfg["supabase_url"].rstrip("/"); self.key = cfg["anon_key"]; self.token = cfg["token"]; self.device = cfg["device"]
    def rpc(self, fn, payload):
        req = urllib.request.Request(f"{self.url}/rest/v1/rpc/{fn}", data=json.dumps(payload).encode(),
                                     headers={"apikey": self.key, "Authorization": "Bearer " + self.key, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r: return json.loads(r.read() or "null")
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"HTTP {e.code}: {e.read().decode('utf-8', 'ignore')[:300]}") from None
    def next(self): return self.rpc("executor_next", {"p_token": self.token, "p_device": self.device})
    def heartbeat(self, status, detalhe=""):
        return self.rpc("executor_heartbeat", {"p_token": self.token, "p_device": self.device, "p_status": status, "p_detalhe": detalhe,
                                               "p_versao": VERSAO, "p_host": socket.gethostname()})
    def meus_em_execucao(self): return self.rpc("executor_meus_em_execucao", {"p_token": self.token, "p_device": self.device}) or []
    def update(self, id_, **kw):
        p = {"p_token": self.token, "p_device": self.device, "p_id": id_}
        m = {"etapa": "p_etapa", "status": "p_status", "loja_seta_lida": "p_loja_seta_lida", "loja_validada": "p_loja_validada",
             "estoque_anterior": "p_estoque_anterior", "estoque_novo": "p_estoque_novo", "seta_retorno": "p_seta_retorno",
             "erro": "p_erro", "executado": "p_executado"}
        for k, v in kw.items():
            if k in m and v is not None: p[m[k]] = v
        return self.rpc("executor_update", p)

# ---------------------------------------------------------------- saude / limpeza
SETA_REDE = None            # 1.5.0: (host, porta) do servidor do Seta/VPN no config.json ("seta_host", "seta_porta"). Sem isso, nao testa.
_REDE_T, _REDE_V = 0.0, True
def seta_rede_ok():
    """Teste leve (1 conexao TCP a cada 20 s, sem enviar dados). Sem rede ate o Seta nao se pega pedido: evita abrir telas e
    gerar reconexoes pela VPN enquanto ela esta caindo."""
    global _REDE_T, _REDE_V
    if not SETA_REDE: return True
    if time.time() - _REDE_T > 20:
        try: socket.create_connection(SETA_REDE, timeout=3).close(); _REDE_V = True
        except OSError: _REDE_V = False
        _REDE_T = time.time()
    return _REDE_V

_SENHA_T, _SENHA_V = 0.0, False
def health():
    """(ok, status, detalhe). O Executor so pega pedido novo se o Seta e a tela estiverem em condicoes de operar."""
    try:
        d = ctypes.windll.user32.OpenInputDesktop(0, False, 0x0100)
        if not d: return False, "TELA_BLOQUEADA", "sessao do Windows bloqueada/desconectada (precisa de sessao interativa desbloqueada)"
        ctypes.windll.user32.CloseDesktop(d)
    except Exception: pass
    if not seta_rede_ok(): return False, "SETA_SEM_REDE", "servidor do Seta/VPN nao responde (%s:%s)" % tuple(SETA_REDE)
    try: h = seta_hwnd()
    except Blocked: return False, "SETA_FECHADO", "Seta nao esta aberto/logado"
    try:
        if ctypes.windll.user32.IsHungAppWindow(h): return False, "SETA_TRAVADO", "Seta nao responde"
    except Exception: pass
    global _SENHA_T, _SENHA_V
    try:                                                     # 1.4.0: Seta pedindo senha -> nao pega pedido (so uma pessoa resolve)
        if time.time() - _SENHA_T > 20:                      # 1.4.1: le a tela no maximo a cada 20 s (a leitura custa ~1 s por pedido)
            _SENHA_V, _SENHA_T = pedindo_senha(look()), time.time()
        if _SENHA_V: return False, "SETA_PEDINDO_SENHA", "o Seta esta pedindo a senha - alguem precisa entrar no Seta"
    except Exception: pass
    return True, "OCIOSO", "Seta " + (title_store(h) or "?")

def cleanup():
    """Apos bloqueio: fecha aviso (Ok) ou confirmacao (NAO) que tenha ficado aberto. Nunca clica Sim."""
    try:
        ls = look()
        if V.find_label(ls, "Escolha a empresa") is not None: fechar_dialogo_empresa(); ls = look()
        if V.find_label(ls, "Importante") is not None: handle_popups(ls); time.sleep(0.8); ls = look()
        if modal_present(ls): dismiss_modal(ls); time.sleep(0.8)
    except Exception as e: log("CLEANUP_FALHOU", err=repr(e))

# erros anteriores ao clique irreversivel e sem efeito no estoque: podem ser refeitos
RETENTAVEL = {"TIMEOUT", "SETA_SEM_FOCO", "MENU_ESTOQUE_NAO_ENCONTRADO", "MODAL_INESPERADO", "SAIR_NAO_ENCONTRADO", "LAUNCHER_NAO_ABRIU",
              "TROCA_DE_LOJA_LISTA", "TROCA_DE_LOJA_NAO_CONCLUIDA", "BOTAO_RETAGUARDA_NAO_ENCONTRADO", "ESTOQUE_ATUAL_ILEGIVEL",
              "DADOS_MUDARAM_ANTES_DO_COMMIT", "FORMULARIO_NAO_ZERADO", "CAMPO_CODIGO_AUSENTE", "BOTAO_NAO_ENCONTRADO",
              "CONFIRMACAO_NAO_RECONHECIDA", "BOTAO_SIM_NAO_ENCONTRADO",
              "CODIGO_CARREGADO_DIVERGENTE_RECORTE", "CODIGO_CARREGADO_DIVERGENTE", "SETA_PEDINDO_SENHA"}   # 1.4.0: volta pra fila e espera alguem entrar no Seta   # 1.3.7: leitura do codigo antes de lancar -> pode tentar de novo
MAX_TENTATIVAS = 3
COMMITADO = ("COMMIT_CLICADO", "VERIFICAR_EXECUCAO", "CONCLUIDO")

def _final_update(supa, id_, proto, **kw):
    """Grava o resultado final; se a internet cair, fica no diario (sync=False) e e reenviado depois (nunca se perde nem se repete)."""
    journal_set(proto, sync=False, final=kw)
    try: supa.update(id_, **kw); journal_set(proto, sync=True)
    except Exception as e: log("FINAL_PENDENTE_SYNC", protocolo=proto, err=str(e)[:200])

def sync_pendentes(supa):
    for proto, j in journal_load().items():
        if j.get("sync") is False and j.get("final") and j.get("id"):
            try: supa.update(j["id"], **j["final"]); journal_set(proto, sync=True); log("SYNC_OK", protocolo=proto)
            except Exception as e: log("SYNC_FALHOU", protocolo=proto, err=str(e)[:200]); return

ULTIMO = {"code": None}   # 1.5.0: resultado do ultimo pedido para o freio (None = concluido)
def run_request(supa, row):
    req = {"id": row["id"], "protocolo": row["protocolo"], "operacao": "ENTRADA", "finalidade": "VENDA", "quantidade": row["quantidade"],
           "codigo_produto": row["codigo_produto"], "codigo_seta_solicitado": row["codigo_seta_solicitado"], "motivo": row.get("motivo")}
    proto = req["protocolo"]
    def rep(**kw):
        try: supa.update(row["id"], **kw)
        except Exception as e: log("UPDATE_FALHOU", err=str(e)[:200])
    try:
        n = journal_load().get(proto, {}).get("tentativas", 0) + 1
        journal_set(proto, id=row["id"], tentativas=n)
        ULTIMO["code"] = "EXCECAO"
        res = execute(req, "real", rep)
        ULTIMO["code"] = None
        _final_update(supa, row["id"], proto, etapa="CONCLUIDO", status="CONCLUIDO", estoque_anterior=res["antes"], estoque_novo=res["depois"],
                      seta_retorno=json.dumps({"tempos": res["tempos"], "total": res["total"], "produto": res["produto"], "tentativas": n}, ensure_ascii=False), executado=True)
        log("CONCLUIDO", protocolo=proto, **{k: res[k] for k in ("antes", "depois", "total")}); return res
    except (Blocked, SecurityBlock) as e:
        cleanup()
        fase = journal_load().get(proto, {}).get("fase")
        ambiguo = fase in ("COMMIT_CLICADO", "VERIFICAR_EXECUCAO") or (isinstance(e, Blocked) and e.code in ("VERIFICAR_EXECUCAO", "ESTOQUE_POS_DIVERGENTE"))
        code = e.code if isinstance(e, Blocked) else "SEGURANCA"
        ULTIMO["code"] = "AMBIGUO" if ambiguo else code
        if not ambiguo and code in RETENTAVEL and journal_load().get(proto, {}).get("tentativas", 1) < MAX_TENTATIVAS:
            log("REENFILEIRADO", protocolo=proto, err=str(e)[:200])
            try: supa.update(row["id"], etapa="AGUARDANDO_TROCA_LOJA", status="PENDENTE", erro="tentativa falhou (" + str(e)[:150] + ")")
            except Exception as e2: log("REENFILEIRAR_FALHOU", err=str(e2)[:200])
            return None                                     # 1.5.0: sem espera fixa aqui; o loop decide (freio/proximo pedido)
        st = "BLOQUEADO_DIVERGENCIA" if ambiguo else "ERRO"
        _final_update(supa, row["id"], proto, etapa=st, status=st, erro=str(e)[:400])
        log("BLOQUEADO", protocolo=proto, err=str(e)); return None
    except Exception as e:
        fase = journal_load().get(proto, {}).get("fase"); amb = fase in ("COMMIT_CLICADO", "VERIFICAR_EXECUCAO")
        ULTIMO["code"] = "AMBIGUO" if amb else "EXCECAO"
        if amb: journal_set(proto, fase="VERIFICAR_EXECUCAO")
        else: cleanup()
        st = "BLOQUEADO_DIVERGENCIA" if amb else "ERRO"
        _final_update(supa, row["id"], proto, etapa=st, status=st, erro=("VERIFICAR_EXECUCAO: " if amb else "") + repr(e)[:380])
        log("EXCECAO", protocolo=proto, err=traceback.format_exc()[-800:]); return None

def recover_journal(supa):
    """Ao (re)iniciar: (1) commit clicado e sem conclusao NUNCA e repetido -> verificacao humana; (2) pedido preso em EM_EXECUCAO
    antes do commit volta pra fila; (3) resultado que nao chegou ao banco e reenviado."""
    jr = journal_load()
    for proto, j in jr.items():
        if j.get("fase") == "COMMIT_CLICADO" and j.get("id"):
            journal_set(proto, fase="VERIFICAR_EXECUCAO")
            try: supa.update(j["id"], etapa="BLOQUEADO_DIVERGENCIA", status="BLOQUEADO_DIVERGENCIA", erro="VERIFICAR_EXECUCAO: executor reiniciou apos clicar Sim; conferir estoque no Seta antes de qualquer nova tentativa")
            except Exception as e: log("RECOVER_FALHOU", err=str(e)[:200])
            log("RECOVER_AMBIGUO", protocolo=proto)
    sync_pendentes(supa)
    jr = journal_load()
    for r in supa.meus_em_execucao():
        j = jr.get(r["protocolo"], {}); fase = j.get("fase")
        etapa_db = (r.get("etapa") or "").upper()
        if not j and (etapa_db in ("CONFIRMAR_ENTRADA", "CONCLUIDO") or r.get("executado_em")):
            # sem diario local (PC trocado/diario apagado) mas o banco mostra que o pedido chegou a janela de confirmacao: pode ja ter sido lancado
            supa.update(r["id"], etapa="BLOQUEADO_DIVERGENCIA", status="BLOQUEADO_DIVERGENCIA", erro="VERIFICAR_EXECUCAO: sem diario local e o pedido ja estava em " + (etapa_db or "execucao") + "; conferir estoque no Seta antes de qualquer nova tentativa")
            log("RECOVER_SEM_DIARIO_BLOQUEADO", protocolo=r["protocolo"], etapa=etapa_db)
        elif fase in ("COMMIT_CLICADO", "VERIFICAR_EXECUCAO"):
            supa.update(r["id"], etapa="BLOQUEADO_DIVERGENCIA", status="BLOQUEADO_DIVERGENCIA", erro="VERIFICAR_EXECUCAO: reinicio durante a execucao; conferir estoque no Seta")
        elif fase == "CONCLUIDO":
            supa.update(r["id"], etapa="CONCLUIDO", status="CONCLUIDO", estoque_anterior=j.get("antes"), estoque_novo=j.get("depois"), executado=True)
        elif (r.get("tentativas") or 1) >= MAX_TENTATIVAS + 1:
            supa.update(r["id"], etapa="ERRO", status="ERRO", erro="pedido preso em execucao apos varias tentativas; verificar manualmente")
        else:
            supa.update(r["id"], etapa="AGUARDANDO_TROCA_LOJA", status="PENDENTE", erro="reenfileirado apos reinicio do executor (nada tinha sido confirmado no Seta)")
            log("RECOVER_REENFILEIRADO", protocolo=r["protocolo"])

# ---------------------------------------------------------------- freio de emergencia (1.5.0)
FREIO_IGUAIS, FREIO_SEGUIDAS = 2, 3
NAO_CONTA = {"SEGURANCA", "PEDIDO_JA_TENTADO"}   # problema do PEDIDO (dado invalido/repetido), nao do Seta: nao pausa a fila
_FALHAS = []
def freio_avaliar(code):
    """Recebe o resultado do pedido (None = concluido). Retorna o motivo da pausa, ou None para seguir.
    Regra: o robo protege por PEDIDO (tentativas, diario) e agora tambem pelo ESTADO GERAL do Seta: quando o Seta repete o
    mesmo erro ele nao consome o resto da fila (sabado 26/09, loja 035: 5 pedidos seguidos com o mesmo aviso)."""
    if code is None: _FALHAS.clear(); return None
    if code in NAO_CONTA: return None
    _FALHAS.append(code)
    if code == "AMBIGUO": return "Seta nao confirmou o resultado de um lancamento (conferir estoque no Seta)"
    if len(_FALHAS) >= FREIO_IGUAIS and len(set(_FALHAS[-FREIO_IGUAIS:])) == 1:
        return "%d erros iguais seguidos do Seta (%s)" % (FREIO_IGUAIS, code)
    if len(_FALHAS) >= FREIO_SEGUIDAS: return "%d falhas seguidas do Seta (%s)" % (len(_FALHAS), ", ".join(_FALHAS[-FREIO_SEGUIDAS:]))
    return None

def pausar(motivo, origem="executor"):
    """Cria PAUSA: nenhum pedido novo e consumido (os pendentes ficam na fila, nada se perde) ate alguem rodar RETOMAR.bat."""
    if PAUSAFILE.exists(): return
    PAUSAFILE.write_text(json.dumps({"motivo": motivo, "origem": origem, "desde": time.strftime("%Y-%m-%d %H:%M:%S"),
                                     "falhas": list(_FALHAS[-5:])}, ensure_ascii=False, indent=1), encoding="utf-8")
    log("FILA_PAUSADA", motivo=motivo, origem=origem)

def pausa_motivo():
    try: return json.loads(PAUSAFILE.read_text(encoding="utf-8")).get("motivo") or "pausa manual"
    except Exception: return "pausa manual"

def keep_awake():
    """Pede ao Windows para nao dormir/apagar a tela enquanto este processo roda (valido so para o processo; nao altera configuracao)."""
    try: ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001 | 0x00000002)
    except Exception: pass

def load_config():
    if not CONFIG.exists(): raise SystemExit("Falta o config.json. Rode CONFIGURAR.bat (ou python configurar.py).")
    return json.loads(CONFIG.read_text(encoding="utf-8"))

def loop():
    global SETA_REDE, FREIO_IGUAIS, FREIO_SEGUIDAS, TROCAS_MAX
    cfg = load_config(); supa = Supa(cfg); keep_awake()
    if cfg.get("seta_host") and cfg.get("seta_porta"): SETA_REDE = (str(cfg["seta_host"]), int(cfg["seta_porta"]))
    FREIO_IGUAIS = int(cfg.get("freio_erros_iguais", FREIO_IGUAIS)); FREIO_SEGUIDAS = int(cfg.get("freio_falhas_seguidas", FREIO_SEGUIDAS))
    TROCAS_MAX = int(cfg.get("max_trocas_loja_10min", TROCAS_MAX))
    ocioso_rapido, ocioso_lento = float(cfg.get("intervalo_fila_s", 1.5)), float(cfg.get("intervalo_fila_ocioso_s", 5.0))
    log("LOOP_INICIO", device=cfg["device"], versao=VERSAO)
    while True:
        try: recover_journal(supa); break
        except Exception as e: log("RECOVER_ERRO", err=str(e)[:200]); time.sleep(10)
    last_hb, last_st, backoff, ultima_atividade = 0, None, 3, time.monotonic()
    while not STOPFILE.exists():
        try:
            if PAUSAFILE.exists():                           # 1.5.0: fila pausada -> nao toca no Seta nem pega pedido; so avisa o Portal
                mot = pausa_motivo()
                if last_st != "PAUSADO_SEGURANCA" or time.time() - last_hb > 60:
                    try: supa.heartbeat("PAUSADO_SEGURANCA", mot[:380]); last_hb, last_st = time.time(), "PAUSADO_SEGURANCA"
                    except Exception as e: log("HEARTBEAT_FALHOU", err=str(e)[:200])
                save_state(status="PAUSADO_SEGURANCA", detalhe=mot, ts=time.strftime("%H:%M:%S")); time.sleep(5); continue
            if last_st == "PAUSADO_SEGURANCA": _FALHAS.clear(); log("FILA_RETOMADA")   # RETOMAR.bat: recomeca a contagem do freio do zero
            ok, st, det = health()
            if st != last_st or time.time() - last_hb > 30:
                try: supa.heartbeat(st, det); last_hb, last_st = time.time(), st
                except Exception as e: log("HEARTBEAT_FALHOU", err=str(e)[:200]); raise
            save_state(status=st, detalhe=det, ts=time.strftime("%H:%M:%S"))
            if not ok: time.sleep(10); continue            # pedidos ficam PENDENTES ate o Seta voltar; nada e consumido
            sync_pendentes(supa)
            journal_load()                                   # diario ilegivel -> excecao AQUI, antes de pegar qualquer pedido (falha fechada)
            rows = supa.next() or []
            if rows:
                supa.heartbeat("EXECUTANDO", "protocolo " + str(rows[0]["protocolo"] if isinstance(rows, list) else rows["protocolo"])); last_hb, last_st = time.time(), "EXECUTANDO"
                run_request(supa, rows[0] if isinstance(rows, list) else rows); backoff = 3; ultima_atividade = time.monotonic()
                motivo = freio_avaliar(ULTIMO["code"])
                if motivo: pausar(motivo); last_st = None; continue
                if ULTIMO["code"]: time.sleep(5)             # falhou mas nao pausou: folga para o Seta antes do proximo
                continue
            # 1.5.0: fila vazia -> 1,5 s nos 2 min seguintes a um pedido (rajada de pedidos); depois 5 s. ~70% menos consultas/dia
            time.sleep(ocioso_rapido if time.monotonic() - ultima_atividade < 120 else ocioso_lento); backoff = 3
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, RuntimeError) as e:
            log("REDE_OU_API", err=str(e)[:200]); time.sleep(min(backoff, 60)); backoff = min(backoff * 2, 60)
        except Exception as e:
            log("LOOP_ERRO", err=repr(e)); time.sleep(5)
    log("LOOP_PARADO_STOP")

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--selftest", action="store_true"); ap.add_argument("--dry", nargs=3, metavar=("COD", "QTD", "LOJA"))
    ap.add_argument("--once", nargs=3, metavar=("COD", "QTD", "LOJA")); ap.add_argument("--loop", action="store_true"); ap.add_argument("--status", action="store_true"); a = ap.parse_args()
    if a.loop: loop(); sys.exit(0)
    def mk(c, q, l): return {"protocolo": "LOCAL-" + time.strftime("%Y%m%d-%H%M%S"), "operacao": "ENTRADA", "finalidade": "VENDA", "quantidade": q, "codigo_produto": c, "codigo_seta_solicitado": l, "motivo": "TESTE DE IA"}
    try:
        if a.status: print(json.dumps(dict(zip(("ok", "status", "detalhe"), health())), ensure_ascii=False)); sys.exit(0)
        if a.selftest:
            h = seta_hwnd(); validate_request(mk("742139", 1, "050")); print(json.dumps({"seta": True, "loja": title_store(h), "acerto_aberto": is_acerto(look()), "versao": VERSAO}))
        elif a.dry: print(json.dumps(execute(mk(*a.dry), "dry"), ensure_ascii=False, indent=1))
        elif a.once: print(json.dumps(execute(mk(*a.once), "real"), ensure_ascii=False, indent=1))
        else: ap.print_help()
    except (Blocked, SecurityBlock) as e:
        cleanup(); save_state(status="BLOQUEADO", error=str(e)); log("BLOQUEADO", err=str(e)); print("BLOQUEADO:", e); sys.exit(2)
