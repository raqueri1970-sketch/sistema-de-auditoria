# TESTES AUTOMATICOS DO EXECUTOR
#   python testes.py            -> so logica (nao mexe no Seta nem no banco de producao)
#   python testes.py --banco    -> + conexao real com o Supabase (token invalido, heartbeat, fila)
#   python testes.py --seta     -> + testes reais no Seta (NAO lancam estoque: so abrem/fecham telas)
# Resultado tambem gravado em testes_resultado.txt
import sys, json, time, tempfile, threading, urllib.error, traceback
from pathlib import Path
import executor as E
from sentinela import validate_request, authorize_commit, SecurityBlock
import seta_vision as V

OUT = []; FAIL = 0
def say(s): print(s); OUT.append(s)
def check(nome, cond, det=""):
    global FAIL
    if not cond: FAIL += 1
    say(("  OK    " if cond else "  FALHOU ") + nome + ((" -> " + str(det)[:160]) if (det and not cond) else ""))
def raises(exc, fn, code=None):
    try: fn()
    except exc as e: return code is None or code in str(e)
    except Exception: return False
    return False

REAL_CONFIG = E.CONFIG
TMP = Path(tempfile.mkdtemp(prefix="ajuste_testes_"))
E.JOURNAL = TMP / "journal.json"; E.LOG = TMP / "executor.log"; E.STOPFILE = TMP / "STOP"; E.STATE = TMP / "state.json"
REAL_SLEEP = time.sleep
BASE_REQ = {"protocolo": "T-1", "operacao": "ENTRADA", "finalidade": "VENDA", "quantidade": 1, "codigo_produto": "742139", "codigo_seta_solicitado": "050", "motivo": "TESTE DE IA", "id": 1}
class Stub:
    """Supabase de mentira que registra o que o Executor faz."""
    def __init__(self): self.updates = []; self.hb = []; self.nexts = 0; self.fail_update = 0; self.rows = []; self.emexec = []
    def update(self, id_, **kw):
        if self.fail_update > 0: self.fail_update -= 1; raise urllib.error.URLError("sem internet")
        self.updates.append((id_, kw))
    def heartbeat(self, st, det=""): self.hb.append(st)
    def next(self): self.nexts += 1; return self.rows
    def meus_em_execucao(self): return self.emexec

# --------------------------------------------------------------- A. LOGICA
def t_sentinela():
    say("[Sentinela - regras de seguranca]")
    for nome, mod, code in [("SAIDA", {"operacao": "SAIDA"}, "OPERACAO_NAO_ENTRADA"), ("finalidade diferente de VENDA", {"finalidade": "AJUSTE"}, "FINALIDADE_NAO_VENDA"),
                            ("quantidade 0", {"quantidade": 0}, "QUANTIDADE_NAO_POSITIVA"), ("quantidade negativa", {"quantidade": -3}, "QUANTIDADE_NAO_POSITIVA"),
                            ("quantidade texto", {"quantidade": "abc"}, "QUANTIDADE_INVALIDA"), ("produto vazio", {"codigo_produto": " "}, "PRODUTO_VAZIO"), ("loja vazia", {"codigo_seta_solicitado": ""}, "LOJA_SETA_VAZIA")]:
        check("bloqueia " + nome, raises(SecurityBlock, lambda m=mod: validate_request({**BASE_REQ, **m}), code))
    check("aceita pedido valido", validate_request(dict(BASE_REQ)) is True)
    check("bloqueia quantidade acima do limite (51)", raises(SecurityBlock, lambda: validate_request({**BASE_REQ, "quantidade": 51}), "QUANTIDADE_ACIMA_DO_LIMITE"))
    check("aceita quantidade no limite (50)", validate_request({**BASE_REQ, "quantidade": 50}) is True)
    check("bloqueia produto com caracteres estranhos", raises(SecurityBlock, lambda: validate_request({**BASE_REQ, "codigo_produto": "12; rm -rf"}), "PRODUTO_FORMATO_INVALIDO"))
    check("bloqueia pedido sem protocolo", raises(SecurityBlock, lambda: validate_request({**BASE_REQ, "protocolo": ""}), "PROTOCOLO_VAZIO"))
    import sentinela as S
    orig = S.seta_windows
    try:
        S.seta_windows = lambda pid=None: [(0, "s e t a | menu inicial | empresa: 050 - shop manaira")]
        ok_txt = "Acerto do estoque | Codigo | Novo Estoque | 3,00"
        check("commit autorizado com novo = atual + qtd", authorize_commit(1, BASE_REQ, 2, 3, screen_text=ok_txt)["authorized"])
        check("bloqueia novo estoque divergente", raises(SecurityBlock, lambda: authorize_commit(1, BASE_REQ, 2, 5, screen_text=ok_txt), "NOVO_ESTOQUE_DIVERGENTE"))
        check("bloqueia se nao esta no Acerto", raises(SecurityBlock, lambda: authorize_commit(1, BASE_REQ, 2, 3, screen_text="Menu inicial"), "FORA_DO_ACERTO"))
        check("bloqueia tela proibida (Cadastro de Clientes)", raises(SecurityBlock, lambda: authorize_commit(1, BASE_REQ, 2, 3, screen_text=ok_txt + " | Cadastro de Clientes"), "TELA_PROIBIDA"))
        check("bloqueia loja diferente da pedida", raises(SecurityBlock, lambda: authorize_commit(1, {**BASE_REQ, "codigo_seta_solicitado": "020"}, 2, 3, screen_text=ok_txt), "LOJA_NAO_CONFIRMADA"))
    finally: S.seta_windows = orig

def t_numeros():
    say("[Leitura de numeros]")
    for t, ok in [("2,00", True), ("1.234,50", True), ("0,00", True), ("zoo", False), ("200", False), ("2,0", False), ("", False)]:
        check(f"NUM_RE({t!r}) = {ok}", bool(E.NUM_RE.match(t)) == ok)
    check("parse_num pt-BR", V.parse_num("1.234,50") == 1234.5 and V.parse_num("3,00") == 3.0)

def t_idempotencia():
    say("[Idempotencia - nunca repetir commit]")
    orig = E.seta_hwnd
    E.seta_hwnd = lambda: (_ for _ in ()).throw(AssertionError("tocou no Seta!"))   # se tocar no Seta, o teste falha
    try:
        for fase in ("COMMIT_CLICADO", "VERIFICAR_EXECUCAO", "CONCLUIDO"):
            E.journal_set("T-IDEM-" + fase, fase=fase)
            check(f"pedido em fase {fase} nao e refeito (e nem chega ao Seta)", raises(E.Blocked, lambda f=fase: E.execute({**BASE_REQ, "protocolo": "T-IDEM-" + f}, "real"), "PEDIDO_JA_TENTADO"))
    finally: E.seta_hwnd = orig

def t_reenfileirar():
    say("[Novas tentativas seguras + estados de erro]")
    E.time.sleep = lambda s: None
    try:
        def rodar(exc, proto):
            st = Stub(); E.execute = lambda req, mode, rep: (_ for _ in ()).throw(exc); E.cleanup = lambda: None
            E.run_request(st, {"id": 7, "protocolo": proto, "quantidade": 1, "codigo_produto": "742139", "codigo_seta_solicitado": "050", "motivo": "X"}); return st.updates[-1][1] if st.updates else {}
        o_exec, o_clean = E.execute, E.cleanup
        u = rodar(E.Blocked("TIMEOUT", "menu"), "T-R1"); check("TIMEOUT 1a vez volta pra fila (PENDENTE)", u.get("status") == "PENDENTE", u)
        u = rodar(E.Blocked("TIMEOUT", "menu"), "T-R1"); check("TIMEOUT 2a vez volta pra fila", u.get("status") == "PENDENTE", u)
        u = rodar(E.Blocked("TIMEOUT", "menu"), "T-R1"); check("TIMEOUT 3a vez vira ERRO (limite de tentativas)", u.get("status") == "ERRO", u)
        u = rodar(E.Blocked("AVISO_DO_SETA", "codigo invalido"), "T-R2"); check("produto inexistente vira ERRO direto (nao repete)", u.get("status") == "ERRO", u)
        u = rodar(SecurityBlock("OPERACAO_NAO_ENTRADA"), "T-R3"); check("bloqueio de seguranca vira ERRO direto", u.get("status") == "ERRO", u)
        u = rodar(E.Blocked("VERIFICAR_EXECUCAO", "sem retorno apos Sim"), "T-R4"); check("estado ambiguo vira BLOQUEADO_DIVERGENCIA", u.get("status") == "BLOQUEADO_DIVERGENCIA", u)
        E.journal_set("T-R5", fase="COMMIT_CLICADO")
        u = rodar(RuntimeError("queda de energia simulada"), "T-R5"); check("excecao DEPOIS do Sim vira BLOQUEADO_DIVERGENCIA (nao repete)", u.get("status") == "BLOQUEADO_DIVERGENCIA", u)
        E.journal_set("T-R6", fase="COMMIT_CLICADO")
        u = rodar(E.Blocked("TIMEOUT", "x"), "T-R6"); check("TIMEOUT depois do Sim NAO e refeito (ambiguo)", u.get("status") == "BLOQUEADO_DIVERGENCIA", u)
    finally: E.execute, E.cleanup = o_exec, o_clean; E.time.sleep = REAL_SLEEP

def t_internet_no_fim():
    say("[Internet cai justo no fim de um ajuste]")
    E.time.sleep = lambda s: None
    o = E.execute
    try:
        E.execute = lambda req, mode, rep: {"ok": True, "antes": 2.0, "depois": 3.0, "tempos": {}, "produto": {}, "total": 30}
        st = Stub(); st.fail_update = 1
        E.run_request(st, {"id": 9, "protocolo": "T-NET", "quantidade": 1, "codigo_produto": "742139", "codigo_seta_solicitado": "050", "motivo": "X"})
        j = E.journal_load()["T-NET"]
        check("resultado fica guardado localmente (sync pendente)", j.get("sync") is False and j["final"]["status"] == "CONCLUIDO", j)
        E.sync_pendentes(st)
        check("quando a internet volta o resultado e enviado", st.updates and st.updates[-1][1].get("status") == "CONCLUIDO" and E.journal_load()["T-NET"].get("sync") is True, st.updates)
        n = len(st.updates); E.sync_pendentes(st); check("nao reenvia duas vezes", len(st.updates) == n)
    finally: E.execute = o; E.time.sleep = REAL_SLEEP

def t_recuperacao():
    say("[Reinicio do computador/executor no meio de um pedido]")
    st = Stub()
    E.journal_set("T-REC-COMMIT", fase="COMMIT_CLICADO", id=21)
    E.journal_set("T-REC-DONE", fase="CONCLUIDO", id=23, antes=2.0, depois=3.0)
    st.emexec = [{"id": 21, "protocolo": "T-REC-COMMIT", "tentativas": 1}, {"id": 22, "protocolo": "T-REC-NADA", "tentativas": 1},
                 {"id": 23, "protocolo": "T-REC-DONE", "tentativas": 1}, {"id": 24, "protocolo": "T-REC-MUITAS", "tentativas": 9}]
    E.recover_journal(st)
    por_id = {}
    for i, kw in st.updates: por_id[i] = kw
    check("commit clicado + reinicio -> BLOQUEADO_DIVERGENCIA (nunca repete)", por_id.get(21, {}).get("status") == "BLOQUEADO_DIVERGENCIA", por_id.get(21))
    check("pedido preso sem commit -> volta para a fila", por_id.get(22, {}).get("status") == "PENDENTE", por_id.get(22))
    check("ja concluido localmente -> banco atualizado para CONCLUIDO", por_id.get(23, {}).get("status") == "CONCLUIDO" and por_id[23].get("estoque_novo") == 3.0, por_id.get(23))
    check("preso demais vezes -> ERRO para conferencia manual", por_id.get(24, {}).get("status") == "ERRO", por_id.get(24))
    # PC trocado / diario apagado: sem entrada no diario, mas o banco mostra que chegou na confirmacao => NUNCA reenfileirar
    st = Stub(); st.emexec = [{"id": 31, "protocolo": "T-SEM-DIARIO-CONF", "tentativas": 1, "etapa": "CONFIRMAR_ENTRADA", "executado_em": None},
                              {"id": 32, "protocolo": "T-SEM-DIARIO-OK", "tentativas": 1, "etapa": "CONCLUIDO", "executado_em": None},
                              {"id": 33, "protocolo": "T-SEM-DIARIO-CEDO", "tentativas": 1, "etapa": "VALIDAR_PRODUTO", "executado_em": None}]
    E.recover_journal(st); pid = {i: kw for i, kw in st.updates}
    check("sem diario + etapa CONFIRMAR_ENTRADA -> BLOQUEADO_DIVERGENCIA (nao reenfileira)", pid.get(31, {}).get("status") == "BLOQUEADO_DIVERGENCIA", pid.get(31))
    check("sem diario + etapa CONCLUIDO -> BLOQUEADO_DIVERGENCIA", pid.get(32, {}).get("status") == "BLOQUEADO_DIVERGENCIA", pid.get(32))
    check("sem diario + etapa inicial (antes do commit) -> volta para a fila", pid.get(33, {}).get("status") == "PENDENTE", pid.get(33))

def t_diario_falha_fechada():
    say("[Diario ilegivel: o robo NAO pode seguir sem saber o que ja foi confirmado]")
    import shutil
    J = E.JOURNAL; bak = J.with_suffix(".bak")
    for f in (J, bak):
        if f.exists(): f.unlink()
    check("sem arquivo = diario vazio (primeiro uso do PC)", E.journal_load() == {})
    E.journal_set("T-J1", fase="CONCLUIDO"); E.journal_set("T-J2", fase="COMMIT_CLICADO")
    check("grava backup do diario", bak.exists())
    J.write_text("{ isto nao e json", encoding="utf-8")
    check("arquivo corrompido + backup valido -> restaura do backup", "T-J2" in E.journal_load() or "T-J1" in E.journal_load())
    J.write_text("{ corrompido de novo", encoding="utf-8"); bak.write_text("tambem corrompido", encoding="utf-8")
    check("arquivo E backup corrompidos -> ERRO (nao finge diario vazio)", raises(E.JournalError, E.journal_load))
    check("journal_set tambem recusa sobrescrever diario ilegivel", raises(E.JournalError, lambda: E.journal_set("T-J3", fase="X")))
    for f in (J, bak):
        if f.exists(): f.unlink()

def _loop_run(stub, health_fn, segundos=1.5, cfg=True):
    E.CONFIG = TMP / "config.json"; E.CONFIG.write_text(json.dumps({"supabase_url": "http://x", "anon_key": "k", "token": "t", "device": "D"}))
    o = (E.Supa, E.health, E.time.sleep)
    E.Supa = lambda c: stub; E.health = health_fn; E.time.sleep = lambda s: REAL_SLEEP(min(s, 0.02))
    if E.STOPFILE.exists(): E.STOPFILE.unlink()
    th = threading.Thread(target=E.loop, daemon=True); th.start(); REAL_SLEEP(segundos); E.STOPFILE.write_text("x"); th.join(5)
    E.Supa, E.health, E.time.sleep = o; E.STOPFILE.unlink(missing_ok=True)
    return not th.is_alive()

def t_seta_fechado():
    say("[Seta fechado / tela bloqueada / travado]")
    for st_name in ("SETA_FECHADO", "TELA_BLOQUEADA", "SETA_TRAVADO"):
        st = Stub(); st.rows = [{"id": 1, "protocolo": "X"}]
        fim = _loop_run(st, lambda n=st_name: (False, n, "simulado"))
        check(f"{st_name}: nao pega pedido (fica PENDENTE) e avisa o portal", st.nexts == 0 and st_name in st.hb and fim, (st.nexts, st.hb[:2]))

def t_rede_caiu():
    say("[Internet/Supabase indisponivel durante o funcionamento]")
    class Ruim(Stub):
        def next(self):
            self.nexts += 1
            if self.nexts <= 4: raise urllib.error.URLError("sem internet")
            return []
    st = Ruim(); fim = _loop_run(st, lambda: (True, "OCIOSO", "ok"), 2.5)
    check("executor nao cai com a rede fora e continua tentando", fim and st.nexts >= 5, st.nexts)
    check("volta a operar sozinho quando a rede volta", st.nexts > 4)
    class Erro500(Stub):
        def next(self): self.nexts += 1; raise RuntimeError("HTTP 500: erro do servidor")
    st = Erro500(); fim = _loop_run(st, lambda: (True, "OCIOSO", "ok"), 1.2)
    check("erro 500 do servidor nao derruba o executor", fim and st.nexts >= 2, st.nexts)

def t_parar():
    say("[Parada segura]")
    st = Stub(); t0 = time.time(); fim = _loop_run(st, lambda: (True, "OCIOSO", "ok"), 0.8)
    check("arquivo STOP encerra o loop", fim)

# --------------------------------------------------------------- B. BANCO REAL
def t_banco():
    say("[Banco real (Supabase) - executor]")
    E.CONFIG = REAL_CONFIG
    cfg = E.load_config(); ok = E.Supa(cfg)
    try: r = ok.heartbeat("TESTE", "teste automatico"); check("heartbeat com token valido", r.get("ok") is True, r)
    except Exception as e: check("heartbeat com token valido", False, e)
    bad = E.Supa({**cfg, "token": "token-errado"})
    for nome, fn in [("executor_next", bad.next), ("heartbeat", lambda: bad.heartbeat("X")), ("update", lambda: bad.update(1, status="CONCLUIDO"))]:
        check(f"token invalido e recusado em {nome}", raises(RuntimeError, fn, "nao autorizado"))
    other = E.Supa({**cfg, "device": "OUTRO-DEVICE"}); check("token de outro dispositivo e recusado", raises(RuntimeError, other.next, "nao autorizado"))
    try: r = ok.meus_em_execucao(); check("consulta pedidos em execucao", isinstance(r, list), r)
    except Exception as e: check("consulta pedidos em execucao", False, e)
    try: ok.heartbeat("OCIOSO", "voltou ao normal")
    except Exception: pass

# --------------------------------------------------------------- C. SETA REAL (nao lanca estoque)
def limpo():
    ls = E.look(); return not E.modal_present(ls)
def t_seta():
    say("[Seta real - sem lancar estoque]")
    ok, st, det = E.health(); check("saude: Seta aberto e tela liberada", ok, (st, det))
    if not ok: return
    h = E.seta_hwnd(); E.focus(h)
    try: E.execute({**BASE_REQ, "protocolo": "T-SETA-PROD", "codigo_produto": "999999999"}, "dry"); r = False
    except E.Blocked as e: r = e.code == "AVISO_DO_SETA"; E.cleanup()
    check("produto inexistente: bloqueia (AVISO_DO_SETA) e nao lanca nada", r)
    time.sleep(1); check("Seta ficou sem aviso aberto depois do bloqueio", limpo())
    try: E.goto_store(h, "999"); r = False
    except E.Blocked as e: r = e.code in ("TROCA_DE_LOJA_LISTA", "TROCA_DE_LOJA_NAO_CONCLUIDA"); E.cleanup()
    check("loja inexistente (999): bloqueia e cancela a janela de troca", r)
    time.sleep(1.5); ls = E.look(); check("Seta voltou ao launcher/menu (sem janela pendurada)", not E.modal_present(ls) and V.find_label(ls, "Escolha a empresa") is None)
    import win32gui, win32con
    win32gui.ShowWindow(h, win32con.SW_MINIMIZE); time.sleep(1.5)
    try: r = E.execute({**BASE_REQ, "protocolo": "T-SETA-FOCO"}, "dry").get("ok")
    except Exception as e: r = str(e)
    check("Seta minimizado: executor restaura, foca e conclui o teste seco", r is True, r)
    # aviso deixado aberto por outra falha: o proximo pedido precisa limpar sozinho
    try: E.execute({**BASE_REQ, "protocolo": "T-SETA-MODAL", "codigo_produto": "999999998"}, "dry")
    except E.Blocked: pass     # deixa o aviso do Seta aberto de proposito (sem cleanup)
    try: r = E.execute({**BASE_REQ, "protocolo": "T-SETA-MODAL2"}, "dry").get("ok")
    except Exception as e: r = str(e)
    check("aviso aberto por falha anterior: proximo pedido fecha e segue", r is True, r)

if __name__ == "__main__":
    args = set(sys.argv[1:]); t0 = time.time()
    say(f"TESTES DO EXECUTOR v{E.VERSAO} - {time.strftime('%d/%m/%Y %H:%M:%S')}")
    for f in (t_sentinela, t_numeros, t_idempotencia, t_reenfileirar, t_internet_no_fim, t_recuperacao, t_diario_falha_fechada, t_seta_fechado, t_rede_caiu, t_parar):
        try: f()
        except Exception: check(f.__name__ + " (erro no teste)", False, traceback.format_exc()[-300:])
    if "--banco" in args or "--completo" in args:
        try: t_banco()
        except Exception: check("t_banco (erro no teste)", False, traceback.format_exc()[-300:])
    if "--seta" in args or "--completo" in args:
        try: t_seta()
        except Exception: check("t_seta (erro no teste)", False, traceback.format_exc()[-300:])
    say(f"\nRESULTADO: {'TUDO OK' if not FAIL else str(FAIL) + ' FALHA(S)'}  ({time.time() - t0:.0f}s)")
    (Path(__file__).resolve().parent / "testes_resultado.txt").write_text("\n".join(OUT), encoding="utf-8")
    sys.exit(1 if FAIL else 0)
