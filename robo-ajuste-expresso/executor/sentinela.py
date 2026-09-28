# SENTINELA DE SEGURANCA - AJUSTE EXPRESS
# Fail-closed: autoriza somente o corredor Menu -> Retaguarda -> Estoque -> Acerto.
import re, time, json, unicodedata
import win32gui, win32process

MAX_QUANTIDADE=50
ALLOWED_OPERATION="ENTRADA"
ALLOWED_PURPOSE="VENDA"
FORBIDDEN=("financeiro","contas","pagar","receber","vendas","fiscal","nota fiscal","cadastro","remanejo","transferencia","saida")
class SecurityBlock(RuntimeError): pass

def _norm(s):
    return re.sub(r"\s+"," ",str(s or "").strip().lower())

def validate_request(req):
    if _norm(req.get("operacao")).upper()!=ALLOWED_OPERATION: raise SecurityBlock("OPERACAO_NAO_ENTRADA")
    if _norm(req.get("finalidade")).upper()!=ALLOWED_PURPOSE: raise SecurityBlock("FINALIDADE_NAO_VENDA")
    try: q=int(req.get("quantidade"))
    except: raise SecurityBlock("QUANTIDADE_INVALIDA")
    if q<=0: raise SecurityBlock("QUANTIDADE_NAO_POSITIVA")
    if q>MAX_QUANTIDADE: raise SecurityBlock("QUANTIDADE_ACIMA_DO_LIMITE")
    if not _norm(req.get("codigo_produto")): raise SecurityBlock("PRODUTO_VAZIO")
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,20}", str(req.get("codigo_produto")).strip()): raise SecurityBlock("PRODUTO_FORMATO_INVALIDO")
    if not str(req.get("protocolo") or "").strip(): raise SecurityBlock("PROTOCOLO_VAZIO")
    if not _norm(req.get("codigo_seta_solicitado")): raise SecurityBlock("LOJA_SETA_VAZIA")
    return True

def seta_windows(pid=None):
    out=[]
    def cb(h,_):
        try:
            if not win32gui.IsWindowVisible(h): return
            if pid is not None and win32process.GetWindowThreadProcessId(h)[1]!=pid: return
            title=_norm(win32gui.GetWindowText(h))
            if title: out.append((h,title))
        except Exception: pass
    win32gui.EnumWindows(cb,None)
    return out

def authorize_navigation(pid, expected_store=None):
    wins=seta_windows(pid)
    if not wins: raise SecurityBlock("SETA_NAO_LOCALIZADO")
    titles=" | ".join(t for _,t in wins)
    if any(x in titles for x in FORBIDDEN): raise SecurityBlock("TELA_PROIBIDA:"+titles)
    if expected_store and ("empresa: "+str(expected_store).zfill(3)) not in titles and "retaguarda" not in titles:
        raise SecurityBlock("LOJA_NAO_CONFIRMADA:"+titles)
    if "menu inicial" in titles: return {"stage":"MENU","titles":titles}
    if "retaguarda" in titles: return {"stage":"RETAGUARDA","titles":titles}
    if "estoque" in titles: return {"stage":"ESTOQUE","titles":titles}
    raise SecurityBlock("FORA_DO_CORREDOR:"+titles)

# so titulos de JANELA/tela (a barra de menu sempre mostra Cadastros/Financeiro/... e nao pode disparar falso positivo)
SCREEN_FORBIDDEN=("cadastro de ","contas a pagar","contas a receber","emissao de nota","remanejo","devolucao ao fornecedor","inventario fisico","controle dos defeitos")

def authorize_commit(pid, req, current_stock=None, new_stock=None, screen_text=None):
    """screen_text: texto OCR da tela. O titulo da janela do Seta continua 'Menu Inicial' dentro do Acerto,
    entao a prova de que estamos no Acerto vem da tela (rotulos 'Acerto do estoque' + 'Novo Estoque')."""
    validate_request(req)
    wins=seta_windows(pid)
    titles=" | ".join(t for _,t in wins)
    if any(x in titles for x in FORBIDDEN): raise SecurityBlock("TELA_PROIBIDA:"+titles)
    if screen_text is not None:
        st=_norm(unicodedata.normalize("NFD",screen_text).encode("ascii","ignore").decode())
        if any(x in st for x in SCREEN_FORBIDDEN): raise SecurityBlock("TELA_PROIBIDA_NA_TELA")
        if not ("acerto do estoque" in st and "novo estoque" in st):
            raise SecurityBlock("FORA_DO_ACERTO_ESTOQUE")
    elif not ("estoque" in titles and ("acerto" in titles or "ajuste" in titles)):
        raise SecurityBlock("FORA_DO_ACERTO_ESTOQUE:"+titles)
    expected=str(req.get("codigo_seta_solicitado")).zfill(3)
    if ("empresa: "+expected) not in titles and expected not in titles:
        raise SecurityBlock("LOJA_NAO_CONFIRMADA:"+titles)
    if current_stock is not None and new_stock is not None:
        if int(new_stock)!=int(current_stock)+int(req["quantidade"]):
            raise SecurityBlock("NOVO_ESTOQUE_DIVERGENTE")
    return {"authorized":True,"stage":"COMMIT","titles":titles,"ts":time.time()}

if __name__=="__main__":
    print(json.dumps({"sentinela":"ATIVO","modo":"FAIL_CLOSED","corredor":"MENU>RETAGUARDA>ESTOQUE>ACERTO","operacao":"SOMENTE_ENTRADA"},ensure_ascii=False))
