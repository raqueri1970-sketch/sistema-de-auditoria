# CONFIGURAR - gera o config.json neste computador.
#   python configurar.py            -> pede o TOKEN (Portal > Seguranca > Executores > Gerar token)
#   python configurar.py --parear   -> SEM digitar token: pede liberacao ao Portal, o administrador aprova
#                                      e o token chega sozinho (so este PC consegue buscar; vale 1 hora).
#   (opcional) 1o argumento sem "--" = nome do executor
import json, sys, time, secrets, socket, urllib.request, urllib.error
from pathlib import Path
BASE = Path(__file__).resolve().parent; CFG = BASE / "config.json"
URL = "https://rdztzurfesnobfkazgpm.supabase.co"; KEY = "sb_publishable_4LHSO4TrP7F4m4tpJyH44g_BGmfC92h"
ARGS = [a for a in sys.argv[1:] if a.strip()]; PAREAR = "--parear" in ARGS; ARGS = [a for a in ARGS if not a.startswith("--")]

def rpc(nome_fn, corpo, timeout=20):
    req = urllib.request.Request(f"{URL}/rest/v1/rpc/{nome_fn}", data=json.dumps(corpo).encode(),
                                 headers={"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r: return json.loads(r.read())

def erro_http(e):
    try: return json.loads(e.read().decode("utf-8", "ignore")).get("message", "")[:200]
    except Exception: return str(e)[:200]

print("=" * 70); print(" CONFIGURAR EXECUTOR AJUSTE EXPRESSO"); print("=" * 70)
old = json.loads(CFG.read_text(encoding="utf-8")) if CFG.exists() else {}
if old: print("   (ja existe um config.json - vou substituir depois de validar o novo)\n")
# Nome: automatico (EXEC-SETA-<computador>), ou o 1o argumento. Sem pergunta: colar no campo errado era o erro mais comum.
nome = (ARGS[0].strip() if ARGS else "") or old.get("device") or "EXEC-SETA-" + socket.gethostname()
print(f"\n   Nome deste executor: {nome}\n")

token = ""; ESCALA_APROVADA = None
if PAREAR:
    chave = secrets.token_urlsafe(32)            # segredo que so este PC conhece; o banco guarda so o hash
    try: p = rpc("executor_pareamento_pedir", {"p_device": nome, "p_host": socket.gethostname(), "p_nonce": chave})
    except urllib.error.HTTPError as e: sys.exit("\nO Portal recusou o pedido de liberacao: " + erro_http(e))
    except Exception as e: sys.exit("\nSem conexao com o Portal (" + str(e)[:100] + "). Confira a internet.")
    print("   " + "*" * 60)
    print(f"   PEDIDO DE LIBERACAO ENVIADO.   CODIGO:  {p['codigo']}")
    print("   Avise o administrador (Ricardo) com este codigo.")
    print("   Esta janela continua sozinha quando ele aprovar (vale 1 hora).")
    print("   " + "*" * 60 + "\n")
    fim = time.time() + 3600; ultimo = 0
    while time.time() < fim:
        try: r = rpc("executor_pareamento_buscar", {"p_id": p["id"], "p_nonce": chave})
        except Exception as e: r = {"status": "REDE", "erro": str(e)[:80]}
        st = r.get("status")
        if st == "APROVADO":
            token = r["token"]; print("   APROVADO! Token recebido.")
            if r.get("escala"): ESCALA_APROVADA = float(r["escala"]); print(f"   Escala do Seta definida pelo administrador: {ESCALA_APROVADA}")
            print(); break
        if st in ("RECUSADO", "EXPIRADO", "JA_ENTREGUE"): sys.exit(f"\nPedido {st}. Rode de novo para pedir outra liberacao.")
        if time.time() - ultimo > 60: print(time.strftime("   %H:%M") + f"  aguardando aprovacao do codigo {p['codigo']}..."); ultimo = time.time()
        time.sleep(5)
    if not token: sys.exit("\nNinguem aprovou em 1 hora. Rode de novo para pedir outra liberacao.")
else:
    print("   No Portal: Acerto de Estoque Lojas > Seguranca > Executores > digite o nome acima > Gerar token.\n")
    # Campo VISIVEL: no Windows, colar com o botao direito num campo escondido (getpass) nao funciona.
    token = "".join(input("Cole o TOKEN aqui (botao direito do mouse) e aperte ENTER: ").split()).strip("'\"")
if not token: sys.exit("Token vazio. Nada foi alterado.")

cfg = {"supabase_url": URL, "anon_key": KEY, "token": token, "device": nome, "escala": ESCALA_APROVADA or old.get("escala", 1.0)}
try:
    r = rpc("executor_heartbeat", {"p_token": token, "p_device": nome, "p_status": "CONFIGURADO", "p_detalhe": "configurar.py", "p_versao": "cfg", "p_host": socket.gethostname()})
    print("Token VALIDADO. Pedidos na fila agora:", r.get("pendentes"))
except urllib.error.HTTPError as e:
    sys.exit("\nToken/nome recusado pelo Portal: " + erro_http(e) + "\nNada foi alterado. Confira se o NOME e o TOKEN sao do mesmo executor.")
except Exception as e:
    sys.exit("\nSem conexao com o Portal (" + str(e)[:100] + "). Nada foi alterado.")
CFG.write_text(json.dumps(cfg, indent=2), encoding="utf-8"); print("config.json gravado. Proximo passo: DIAGNOSTICO.bat")
