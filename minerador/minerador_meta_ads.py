# -*- coding: utf-8 -*-
"""
Minerador Meta Ads - ShopPainless v4.0  (produtos ESCALANDO)
-----------------------------------------------------------
Objetivo: achar produtos que estao escalando AGORA = o mesmo anunciante com
40+ anuncios ativos do mesmo produto, criados nos ultimos 45 dias.

Como funciona:
  1) DESCOBERTA: busca cada palavra-chave na Biblioteca de Anuncios da Meta e
     separa os anunciantes que estao subindo anuncios novos.
  2) CONTAGEM REAL: abre a pagina de cada anunciante na Biblioteca e le TODOS
     os anuncios ativos dele (dados estruturados da propria Meta: data de
     inicio, copias do criativo, link do produto).
  3) Agrupa por PRODUTO (link da loja) e conta os anuncios novos (<= 45 dias).
  4) Planilha: aba ESCALANDO (40+ anuncios novos), Em observacao, Anunciantes,
     Anuncios, Como ler.

Uso (o MINERADOR_META_RODAR.bat chama estas opcoes):
  python minerador_meta_ads.py                 -> todas as palavras-chave
  python minerador_meta_ads.py --teste         -> 3 primeiras palavras, menos anunciantes
  python minerador_meta_ads.py --keyword "x" --pais US
  python minerador_meta_ads.py --configurar    -> abre o Chrome do minerador p/ login
Ajustes: --min-anuncios 40  --max-dias 45  --max-anunciantes 40  --headless
"""
import argparse
import json
import os
import random
import re
import sys
import time
from collections import defaultdict, deque
from datetime import date, datetime, timezone
from urllib.parse import quote, unquote, urlparse, parse_qs

PASTA = os.path.dirname(os.path.abspath(__file__))
PERFIL = os.environ.get("MINERADOR_PERFIL") or os.path.join(PASTA, "perfil_chrome_meta")
ARQ_KEYWORDS = os.path.join(PASTA, "keywords_meta.txt")
ARQ_RANKING = os.path.join(PASTA, "meta_ads_ranking.xlsx")
PASTA_HIST = os.path.join(PASTA, "resultados_meta")

KEYWORDS_PADRAO = [
    "posture corrector", "neck massager", "back pain relief", "knee brace",
    "plantar fasciitis", "sciatica relief", "foot massager", "heating pad",
    "tens unit", "cervical pillow", "wrist brace", "lumbar support",
    "shoulder massager", "acupressure mat", "red light therapy",
]

# Mineracao POR DOR: cada dor do cliente vira 1-3 buscas em ingles (mercado US)
DORES_PADRAO = {
    "Queda de cabelo / calvicie": ["hair loss", "thinning hair", "hair growth"],
    "Envelhecimento / rugas": ["wrinkles", "anti aging", "sagging skin"],
    "Flacidez / papada": ["double chin", "neck firming"],
    "Manchas / acne": ["dark spots", "acne", "hyperpigmentation"],
    "Olheiras / bolsas nos olhos": ["dark circles", "under eye bags"],
    "Celulite / estrias": ["cellulite", "stretch marks"],
    "Gordura / barriga": ["belly fat", "weight loss"],
    "Inchaco / retencao": ["bloating", "lymphatic drainage", "swollen legs"],
    "Varizes / circulacao": ["varicose veins", "poor circulation"],
    "Dor nas costas": ["back pain relief", "lower back pain"],
    "Dor no pescoco / postura": ["neck pain", "posture corrector"],
    "Dor no joelho / articulacoes": ["knee pain", "joint pain"],
    "Dor nos pes / fascite": ["plantar fasciitis", "foot pain"],
    "Neuropatia / formigamento": ["neuropathy"],
    "Ciatica": ["sciatica relief"],
    "Joanete / calos": ["bunion corrector"],
    "Dor de cabeca / enxaqueca": ["migraine relief", "headache relief"],
    "Zumbido no ouvido": ["tinnitus relief"],
    "Insonia / sono": ["insomnia", "sleep better"],
    "Ronco / apneia": ["snoring", "sleep apnea"],
    "Ansiedade / estresse": ["anxiety relief", "stress relief"],
    "Menopausa": ["menopause relief", "hot flashes"],
    "Colica menstrual": ["period cramps"],
    "Incontinencia urinaria": ["bladder leakage"],
    "Fungo de unha": ["nail fungus"],
    "Dentes amarelos": ["teeth whitening"],
    "Visao / oculos": ["reading glasses"],
}
ARQ_DORES = os.path.join(PASTA, "dores_meta.txt")

# Marcas grandes / farmacia / marketplaces: nao sao produto para revender
IGNORAR_ANUNCIANTES = ("aleve", "advil", "voltaren", "tylenol", "cosentyx", "vyndamax", "hinge health",
                       "alibaba.com", "temu", "shoptemu", "amazon", "walmart", "cvs", "shop")
# Sites que nao sao loja de produto proprio (marketplaces, farmacias)
IGNORAR_DOMINIOS = ("temu.com", "amazon.com", "link.amazon", "amzlink.to", "amzn.to", "walmart.com", "alibaba.com",
                    "aliexpress.com", "cvs.com", "walgreens.com", "target.com", "shop.com", "ebay.com")

# --------------------------------------------------------------------------
# Filtro de SEGMENTO: so produto FISICO de saude, beleza e bem-estar
# --------------------------------------------------------------------------
_SEG_PERMITE = re.compile(  # termos que salvam palmilhas/ortopedicos mesmo com "shoe" no texto
    r"\b(insoles?|inserts?|orthotics?|arch supports?|heel cups?|toe separators?|bunion)\b", re.I)
_SEG_EXCLUI = [
    ("Calcado/roupa", re.compile(
        r"\b(shoes?|sneakers?|sandals?|boots?|slippers?|loafers?|footwear|clogs?|high heels|"
        r"dress(es)?|jeans|leggings|pants|shirts?|t-shirts?|hoodies?|jackets?|bras?|bralettes?|underwear|"
        r"panties|lingerie|shapewear|swimsuits?|bikinis?|apparel|clothing)\b", re.I)),
    ("Capsula/suplemento", re.compile(
        r"\b(supplements?|capsules?|gummies|gummy|pills?|tablets?|vitamins?|multivitamins?|probiotics?|"
        r"softgels?|powders?|tinctures?|teas?|coffee|shakes?|drink mix|dietary|nutrition)\b|\b\d+\s?mg\b", re.I)),
    ("Infoproduto/servico", re.compile(
        r"\b(courses?|e-?books?|masterclass|webinars?|workshops?|programs?|coaching|coach|memberships?|"
        r"subscriptions?|subscribe|apps?|download|guides?|appointments?|consultations?|"
        r"chiropract\w*|physical therapists?|telehealth|insurance|medicare|podcasts?|newsletters?|"
        r"classes|lessons?|sessions?|book now|sign up)\b", re.I)),
    ("Remedio", re.compile(
        r"\b(prescription|rx|medications?|drugs?|injections?|tafamidis|secukinumab|ozempic|semaglutide|"
        r"tirzepatide|glp-?1)\b", re.I)),
    ("Fora do segmento", re.compile(
        r"\b(dogs?|cats?|pets?|puppy|puppies|canine|feline|mattress(es)?|sofas?|couch(es)?|chairs?|desks?|"
        r"furniture|recliners?|drills?|tool ?kits?|phones?|laptops?|toys?|snacks?|recipes?|meals?|food|"
        r"crochet|jewelry|watches)\b", re.I)),
]
_SEG_DOMINIO_EXCLUI = re.compile(
    r"(footwear|shoes|sneaker|apparel|clothing|fashion|boutique|fabfitfun|hingehealth|"
    r"sleepingduck|mattress|petco|chewy|kurufootwear|oofos)", re.I)


def classificar_segmento(titulo, texto, link):
    """(True, '') se e produto fisico de saude/beleza/bem-estar; senao (False, motivo)."""
    dom = dominio_de(link) if link else ""
    caminho = urlparse(link).path.replace("-", " ").replace("_", " ") if link else ""
    tudo = " ".join(x for x in (titulo, texto, caminho) if x)
    if dom and _SEG_DOMINIO_EXCLUI.search(dom):
        return False, f"Calcado/roupa/servico (site {dom})"
    for motivo, rx in _SEG_EXCLUI:
        m = rx.search(tudo)
        if m and not (motivo == "Calcado/roupa" and _SEG_PERMITE.search(tudo)):
            return False, f"{motivo} ('{m.group(0)}')"
    return True, ""


DESCARTADOS = []   # produtos fora do segmento da ultima analise (vao para a aba "Fora do segmento")

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


# Nuvem (app de celular): edge function minerador-api no Supabase. A chave fica em minerador_chave.txt
API_NUVEM = "https://tazyeczbbgspqbyluynf.supabase.co/functions/v1/minerador-api"
ARQ_CHAVE = os.path.join(PASTA, "minerador_chave.txt")
_NUVEM = {"ultimo": 0.0, "aviso": False}


def _chave_nuvem():
    try:
        return open(ARQ_CHAVE, encoding="utf-8").read().strip()
    except Exception:
        return ""


def nuvem_post(corpo, timeout=25):
    """Envia para o app do celular. Falha de internet nunca para a mineracao."""
    chave = _chave_nuvem()
    if not chave:
        return None
    import urllib.request
    try:
        req = urllib.request.Request(API_NUVEM, data=json.dumps(corpo, ensure_ascii=False, default=str).encode("utf-8"),
                                     headers={"Content-Type": "application/json", "x-minerador-chave": chave},
                                     method="POST")
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:
        if not _NUVEM["aviso"]:
            _NUVEM["aviso"] = True
            print(f"(aviso: nao consegui enviar ao app do celular: {e})", flush=True)
        return None


def _status_nuvem(forcar=False):
    if not _chave_nuvem() or (not forcar and time.time() - _NUVEM["ultimo"] < 8):
        return
    _NUVEM["ultimo"] = time.time()
    dados = dict(STATUS)
    dados["log"] = dados.get("log", [])[-40:]
    import threading
    threading.Thread(target=nuvem_post, args=({"acao": "status", "dados": dados}, 15), daemon=True).start()


# Andamento ao vivo (lido pelo painel a cada 3 s)
ARQ_STATUS = os.path.join(PASTA, "painel_status.js")
STATUS = {}
_LOG = deque(maxlen=80)


def _gravar_status():
    if not STATUS:
        return
    STATUS["atualizado"] = time.time()
    STATUS["log"] = list(_LOG)
    try:
        tmp = ARQ_STATUS + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write("window.atualizarStatus && window.atualizarStatus(" +
                    json.dumps(STATUS, ensure_ascii=False, default=str) + ");")
        os.replace(tmp, ARQ_STATUS)
    except Exception:
        pass
    _status_nuvem(forcar=not STATUS.get("rodando"))


def status(**kw):
    STATUS.update(kw)
    _gravar_status()


def log(msg):
    linha = f"[{datetime.now():%H:%M:%S}] {msg}"
    print(linha, flush=True)
    _LOG.append(linha)
    _gravar_status()


def pausa(a, b):
    time.sleep(random.uniform(a, b))


# --------------------------------------------------------------------------
# Palavras-chave
# --------------------------------------------------------------------------
def carregar_keywords():
    """Le keywords_meta.txt (cria com a lista padrao se nao existir).
    Formato: uma por linha -> 'palavra-chave' ou 'palavra-chave;PAIS'."""
    if not os.path.exists(ARQ_KEYWORDS):
        with open(ARQ_KEYWORDS, "w", encoding="utf-8") as f:
            f.write("# Uma palavra-chave por linha. Pais opcional apos ';' (US, MX, ES, BR...)\n")
            f.write("# Linhas com # sao ignoradas.\n")
            for k in KEYWORDS_PADRAO:
                f.write(f"{k};US\n")
        log(f"Criado {ARQ_KEYWORDS} com {len(KEYWORDS_PADRAO)} palavras-chave.")
    itens = []
    with open(ARQ_KEYWORDS, encoding="utf-8-sig") as f:
        for linha in f:
            linha = linha.strip()
            if not linha or linha.startswith("#"):
                continue
            partes = [x.strip() for x in linha.split(";")]
            kw = partes[0]
            pais = (partes[1] if len(partes) > 1 and partes[1] else "US").upper()
            dor = partes[2] if len(partes) > 2 and partes[2] else kw
            if kw:
                itens.append((kw, pais, dor))
    return itens


def carregar_dores():
    """Le dores_meta.txt (cria com o mapa padrao). Formato: termo;PAIS;Dor."""
    if not os.path.exists(ARQ_DORES):
        with open(ARQ_DORES, "w", encoding="utf-8") as f:
            f.write("# Mineracao POR DOR. Formato: termo de busca;PAIS;Nome da dor\n")
            f.write("# Pense na DOR do cliente e coloque as palavras que ele usaria (em ingles para US).\n")
            for dor, termos in DORES_PADRAO.items():
                for t in termos:
                    f.write(f"{t};US;{dor}\n")
        log(f"Criado {ARQ_DORES} com {len(DORES_PADRAO)} dores.")
    global ARQ_KEYWORDS
    original, ARQ_KEYWORDS = ARQ_KEYWORDS, ARQ_DORES
    try:
        return carregar_keywords()
    finally:
        ARQ_KEYWORDS = original


# --------------------------------------------------------------------------
# Links
# --------------------------------------------------------------------------
NAO_LOJA = ("transparency.meta.com", "meta.com", "facebook.com", "fb.me", "fb.com",
            "instagram.com", "app.adjust.com", "onelink.me", "wa.me", "whatsapp.com", "m.me")
TIRAR_PARAMS = ("utm_", "fbclid", "campaign", "ad_id", "adset", "adgroup", "creative", "h=")


def url_destino(url):
    """Desembrulha o link de saida (Facebook/Criteo), tira rastreadores e descarta o que nao e loja."""
    if not url:
        return ""
    try:
        for _ in range(3):
            p = urlparse(url)
            qs = parse_qs(p.query)
            if "l.facebook.com" in p.netloc and qs.get("u"):
                url = qs["u"][0]
            elif "criteo.com" in p.netloc and qs.get("r"):
                url = qs["r"][0]
            else:
                break
        p = urlparse(url)
        host = p.netloc.lower()
        if not url.startswith("http") or any(host == d or host.endswith("." + d) for d in NAO_LOJA):
            return ""
        q = "&".join(x for x in p.query.split("&")
                     if x and not x.lower().startswith(TIRAR_PARAMS) and "{{" not in unquote(x))
        return p._replace(query=q, fragment="").geturl()
    except Exception:
        return ""


def dominio_de(url):
    try:
        host = urlparse(url).netloc.lower()
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return ""


def chave_produto(url, titulo):
    """Identifica o produto: dominio + caminho do link (sem parametros). Sem link, usa o titulo."""
    if url:
        p = urlparse(url)
        caminho = re.sub(r"/+$", "", p.path.lower()) or "/"
        return dominio_de(url) + caminho
    return "(sem link) " + (titulo or "").strip().lower()[:60]


def parse_numero(s):
    s = s.strip().lower()
    if s.endswith("mil") or s.endswith("k"):
        s = s.replace("mil", "").replace("k", "").strip().replace(",", ".")
        try:
            return int(float(s) * 1000)
        except ValueError:
            return 0
    s = re.sub(r"[.,]", "", s)
    return int(s) if s.isdigit() else 0


# --------------------------------------------------------------------------
# Leitura dos dados estruturados da Biblioteca
# --------------------------------------------------------------------------
_DEC = json.JSONDecoder()


def extrair_anuncios(texto):
    """Acha todos os objetos JSON de anuncio (com ad_archive_id) num texto (html ou resposta graphql)."""
    out = []
    for m in re.finditer(r'\{"ad_archive_id"', texto):
        try:
            o, _ = _DEC.raw_decode(texto, m.start())
            if o.get("page_id"):
                out.append(o)
        except Exception:
            pass
    return out


def normalizar(o):
    s = o.get("snapshot") or {}
    cards = s.get("cards") or []
    link = s.get("link_url") or next((c.get("link_url") for c in cards if c.get("link_url")), "")
    titulo = s.get("title") or ""
    if not titulo or "{{" in titulo:
        titulo = next((c.get("title") for c in cards if c.get("title") and "{{" not in c.get("title")), "") or ""
    loja = url_destino(link)
    corpo = s.get("body") or {}
    texto = corpo.get("text", "") if isinstance(corpo, dict) else str(corpo)
    if not texto or "{{" in texto:
        texto = next((c.get("body") for c in cards if c.get("body") and "{{" not in c.get("body")), "") or ""
    ini = o.get("start_date")
    inicio = datetime.fromtimestamp(ini, tz=timezone.utc).date() if ini else None
    img = ""
    if s.get("images"):
        img = s["images"][0].get("original_image_url") or s["images"][0].get("resized_image_url") or ""
    elif s.get("videos"):
        img = s["videos"][0].get("video_preview_image_url") or ""
    elif cards:
        img = cards[0].get("original_image_url") or cards[0].get("video_preview_image_url") or ""
    return {
        "id": str(o.get("ad_archive_id")),
        "grupo": str(o.get("collation_id") or o.get("ad_archive_id")),
        "copias": int(o.get("collation_count") or 1),
        "page_id": str(o.get("page_id")),
        "anunciante": o.get("page_name") or s.get("page_name") or "",
        "inicio": inicio,
        "dias": (date.today() - inicio).days if inicio else None,
        "ativo": o.get("is_active", True) is not False,
        "link_loja": loja,
        "dominio": dominio_de(loja),
        "titulo": re.sub(r"\s+", " ", titulo).strip(),
        "texto": re.sub(r"\s+", " ", texto).strip()[:400],
        "produto": chave_produto(loja, titulo),
        "imagem": img or "",
    }


class Coletor:
    """Guarda tudo que a pagina recebe (html inicial + respostas graphql da rolagem)."""

    def __init__(self, page):
        self.page = page
        self.buffer = []
        page.on("response", self._resp)

    def _resp(self, r):
        if "graphql" in r.url:
            try:
                self.buffer.append(r.text())
            except Exception:
                pass

    def abrir(self, url, rolagens):
        self.buffer.clear()
        self.page.goto(url, wait_until="domcontentloaded", timeout=60000)
        pausa(5, 8)
        fechar_popups(self.page)
        try:
            self.page.wait_for_function(
                "() => /(resultados|results|Nenhum an|No ads|No hay anuncios)/i.test(document.body.innerText)",
                timeout=25000)
        except Exception:
            pass
        corpo = self.page.inner_text("body")
        m = re.search(r"~?\s*([\d][\d.,]*\s*(?:mil|k)?)\s+(?:results|resultados)", corpo, re.I)
        total = parse_numero(m.group(1)) if m else 0
        ads = {}
        for o in extrair_anuncios(self.page.content()):
            ads[str(o["ad_archive_id"])] = o
        parado = 0
        for _ in range(rolagens):
            antes = len(ads)
            self.page.mouse.wheel(0, random.randint(3500, 5500))
            pausa(2.0, 3.5)
            for t in self.buffer:
                for o in extrair_anuncios(t):
                    ads[str(o["ad_archive_id"])] = o
            self.buffer.clear()
            parado = parado + 1 if len(ads) == antes else 0
            if parado >= 3:
                break
        return total, [normalizar(o) for o in ads.values()]


# --------------------------------------------------------------------------
# Navegador
# --------------------------------------------------------------------------
def perfil_em_uso(perfil):
    """True se ja existe um Chrome aberto usando este perfil (Windows)."""
    if os.name != "nt":
        return False
    try:
        import subprocess
        alvo = os.path.basename(perfil).lower()
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Get-CimInstance Win32_Process -Filter \"name='chrome.exe'\" | ForEach-Object { $_.CommandLine }"],
            capture_output=True, text=True, timeout=20).stdout.lower()
        return any("--user-data-dir" in l and alvo in l for l in out.splitlines())
    except Exception:
        return False


def abrir_navegador(pw, headless=False):
    os.makedirs(PERFIL, exist_ok=True)
    if perfil_em_uso(PERFIL):
        log("ATENCAO: a janela do Chrome do minerador ja esta aberta. Feche-a e rode de novo.")
        sys.exit(1)
    opcoes = dict(
        user_data_dir=PERFIL,
        headless=headless,
        viewport={"width": 1366, "height": 860},
        ignore_default_args=["--enable-automation", "--disable-extensions"],
        args=["--disable-blink-features=AutomationControlled"],
    )
    try:
        return pw.chromium.launch_persistent_context(channel="chrome", **opcoes)
    except Exception as e:
        log(f"Chrome instalado nao abriu ({str(e).splitlines()[0]}); usando Chromium do Playwright.")
        return pw.chromium.launch_persistent_context(**opcoes)


def fechar_popups(page):
    for txt in ["Allow all cookies", "Permitir todos os cookies", "Permitir todas las cookies",
                "Only allow essential cookies", "Decline optional cookies", "Recusar cookies opcionais"]:
        try:
            btn = page.get_by_role("button", name=txt)
            if btn.count():
                btn.first.click(timeout=2000)
                pausa(0.8, 1.5)
                return
        except Exception:
            pass


def url_busca(keyword, pais):
    if keyword == "*":   # sem palavra-chave: todos os anuncios ativos do pais
        return ("https://www.facebook.com/ads/library/?active_status=active&ad_type=all"
                f"&country={pais}&q=&search_type=keyword_unordered&media_type=all")
    return ("https://www.facebook.com/ads/library/?active_status=active&ad_type=all"
            f"&country={pais}&q={quote(keyword)}&search_type=keyword_unordered&media_type=all")


def url_anunciante(page_id, pais):
    return ("https://www.facebook.com/ads/library/?active_status=active&ad_type=all"
            f"&country={pais}&view_all_page_id={page_id}&search_type=page&media_type=all")


def ignorar(nome):
    n = (nome or "").lower().strip()
    return any(n == x or n.startswith(x + " ") or n.startswith(x + "(") for x in IGNORAR_ANUNCIANTES)


# --------------------------------------------------------------------------
# Analise
# --------------------------------------------------------------------------
def contar(ads):
    """Numero de anuncios contando as copias do criativo (grupo) sem contar duas vezes."""
    grupos = defaultdict(set)
    copias = {}
    for a in ads:
        grupos[a["grupo"]].add(a["id"])
        copias[a["grupo"]] = max(copias.get(a["grupo"], 1), a["copias"])
    return sum(max(len(ids), copias[g]) for g, ids in grupos.items())


def novos_de(ads, max_dias):
    return [a for a in ads if a["dias"] is not None and a["dias"] <= max_dias]


def analisar(anunciantes, max_dias, guardar_descartados=True):
    """Gera uma linha por (anunciante, produto). So entra produto fisico de saude/beleza/bem-estar."""
    linhas = []
    if guardar_descartados:
        DESCARTADOS.clear()
    for pid, info in anunciantes.items():
        ads = [a for a in info["ads"] if a["ativo"]]
        por_prod = defaultdict(list)
        for a in ads:
            por_prod[a["produto"]].append(a)
        for prod, lista in por_prod.items():
            dom = next((a["dominio"] for a in lista if a["dominio"]), "")
            if any(dom == d or dom.endswith("." + d) for d in IGNORAR_DOMINIOS):
                continue
            novos = novos_de(lista, max_dias)
            datas = [a["inicio"] for a in lista if a["inicio"]]
            ref = max(novos or lista, key=lambda a: (a["copias"], a["inicio"] or date.min))
            textos = " ".join(dict.fromkeys(a.get("texto", "") for a in lista[:8] if a.get("texto")))[:1200]
            link_loja = next((a["link_loja"] for a in lista if a["link_loja"]), "")
            ok_seg, motivo = classificar_segmento(ref["titulo"] or prod, textos, link_loja)
            if not ok_seg:
                if guardar_descartados:
                    DESCARTADOS.append({"anunciante": info["nome"], "produto": ref["titulo"] or prod,
                                        "dominio": ref["dominio"], "novos": contar(novos), "motivo": motivo,
                                        "link_anuncio": f"https://www.facebook.com/ads/library/?id={ref['id']}",
                                        "link_loja": link_loja, "keyword": info["keyword"]})
                continue
            n_novos, n_tot = contar(novos), contar(lista)
            mais_antigo = min(datas) if datas else None
            linhas.append({
                "anunciante": info["nome"], "page_id": pid, "keyword": info["keyword"], "pais": info["pais"],
                "dor": info.get("dor", info["keyword"]),
                "produto": ref["titulo"] or prod, "chave": prod, "dominio": ref["dominio"],
                "link_loja": next((a["link_loja"] for a in lista if a["link_loja"]), ""),
                "novos": n_novos, "total_produto": n_tot,
                "ult7": contar(novos_de(lista, 7)),
                "pct_novos": round(100 * n_novos / n_tot) if n_tot else 0,
                "idade_produto": (date.today() - mais_antigo).days if mais_antigo else None,
                "primeiro": mais_antigo.isoformat() if mais_antigo else "",
                "mais_recente": max(datas).isoformat() if datas else "",
                "total_anunciante": info["total"] or contar(ads),
                "link_anuncio": f"https://www.facebook.com/ads/library/?id={ref['id']}",
                "link_anunciante": url_anunciante(pid, info["pais"]),
                "imagem": ref["imagem"],
                # anuncios criados por semana: [esta semana, semana passada, ...] (8 semanas)
                "serie": [contar([a for a in lista if a["dias"] is not None
                                  and (a["dias"] <= 7 if w == 0 else 7 * w < a["dias"] <= 7 * (w + 1))])
                          for w in range(8)],
            })
    linhas.sort(key=lambda l: (-l["novos"], -l["ult7"], l["idade_produto"] if l["idade_produto"] is not None else 9999))
    return linhas


# --------------------------------------------------------------------------
# Excel
# --------------------------------------------------------------------------
def como_ler(min_anuncios, max_dias):
    return [
        ("O QUE E", f"Produtos ESCALANDO: o mesmo anunciante com {min_anuncios}+ anuncios ATIVOS do mesmo produto, "
                    f"criados nos ultimos {max_dias} dias (Biblioteca de Anuncios da Meta)."),
        ("", ""),
        ("COLUNA", "SIGNIFICADO"),
        (f"Anuncios novos (<= {max_dias}d)", f"Quantos anuncios ativos DESTE produto, DESTE anunciante, comecaram a rodar nos "
                                             f"ultimos {max_dias} dias. E o numero principal: muitos anuncios novos = o anunciante "
                                             "esta colocando dinheiro para escalar."),
        ("Novos ult. 7 dias", "Quantos desses anuncios foram criados na ultima semana. Alto = esta acelerando agora."),
        ("% novos", "Parte dos anuncios ativos do produto que e nova. 100% = produto lancado agora."),
        ("Idade do produto (dias)", "Ha quantos dias esta no ar o anuncio ativo mais antigo desse produto. "
                                    f"Ate {max_dias} (fundo verde) = produto NOVO; mais que isso = produto antigo que voltou a escalar."),
        ("Total do produto", "Todos os anuncios ativos do produto (novos + antigos)."),
        ("Total do anunciante", "Todos os anuncios ativos do anunciante (todos os produtos)."),
        ("Link da loja", "Pagina do produto: preco, oferta, fotos."),
        ("Ver anuncio", "Um anuncio do produto na Biblioteca da Meta (video/imagem e texto)."),
        ("Todos do anunciante", "Abre a Biblioteca com TODOS os anuncios ativos desse anunciante."),
        ("Criativo", "Imagem/capa do video do anuncio (o link expira em alguns dias)."),
        ("", ""),
        ("ABAS", f"ESCALANDO: {min_anuncios}+ anuncios novos. | Em observacao: 15 a {min_anuncios - 1} anuncios novos "
                 "(podem virar escala). | Anunciantes: resumo de cada anunciante analisado. | Anuncios: lista completa."),
        ("COMO USAR", "1) Aba ESCALANDO, de cima para baixo. 2) Abra 'Ver anuncio' e 'Link da loja'. "
                      "3) Produto novo (idade baixa) + muitos anuncios novos + varios na ultima semana = escala forte."),
    ]


def salvar_excel(linhas, anunciantes, min_anuncios, max_dias, resumo_kw, arquivo=None):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter

    azul = PatternFill("solid", fgColor="1F4E78")
    verde = PatternFill("solid", fgColor="C6EFCE")
    link_font = Font(color="0563C1", underline="single")

    def cabecalho(sh, cols):
        sh.append(cols)
        for cel in sh[1]:
            cel.font = Font(bold=True, color="FFFFFF")
            cel.fill = azul
            cel.alignment = Alignment(vertical="center", wrap_text=True)
        sh.row_dimensions[1].height = 32
        sh.freeze_panes = "A2"

    def link(cel, url, texto):
        if url:
            cel.value = texto
            cel.hyperlink = url
            cel.font = link_font

    def larguras(sh, fixas):
        for i in range(1, sh.max_column + 1):
            letra = get_column_letter(i)
            larg = fixas.get(i) or max(len(str(c.value or "")) for c in sh[letra][:300]) + 2
            sh.column_dimensions[letra].width = min(max(9, larg), 60)
        if sh.max_row > 1:
            sh.auto_filter.ref = sh.dimensions

    cols = [f"Anuncios novos (<= {max_dias}d)", "Novos ult. 7 dias", "% novos", "Idade do produto (dias)",
            "Produto", "Anunciante", "Loja (site)", "Link da loja", "Ver anuncio", "Todos do anunciante",
            "Total do produto", "Total do anunciante", "Anuncio mais antigo", "Anuncio mais recente",
            "Dor", "Palavra-chave", "Pais", "Criativo"]

    def aba_produtos(sh, lista, vazio):
        cabecalho(sh, cols)
        for l in lista:
            sh.append([l["novos"], l["ult7"], l["pct_novos"], l["idade_produto"], l["produto"][:90],
                       l["anunciante"], l["dominio"] or "-", "", "", "", l["total_produto"],
                       l["total_anunciante"], l["primeiro"], l["mais_recente"], l["dor"], l["keyword"], l["pais"], ""])
            r = sh.max_row
            link(sh.cell(r, 8), l["link_loja"], "Abrir loja")
            link(sh.cell(r, 9), l["link_anuncio"], "Ver anuncio")
            link(sh.cell(r, 10), l["link_anunciante"], "Ver todos")
            link(sh.cell(r, 18), l["imagem"], "Ver imagem")
            if l["idade_produto"] is not None and l["idade_produto"] <= max_dias:
                for c in sh[r][:4]:
                    c.fill = verde
        if not lista:
            sh.append([vazio])
        larguras(sh, {1: 12, 2: 10, 3: 8, 4: 11, 5: 45, 8: 12, 9: 12, 10: 12, 18: 11})

    wb = Workbook()
    ws = wb.active
    ws.title = "ESCALANDO"
    aba_produtos(ws, [l for l in linhas if l["novos"] >= min_anuncios],
                 f"Nenhum produto com {min_anuncios}+ anuncios novos nesta rodada. Veja 'Em observacao' "
                 "ou rode com mais palavras-chave.")
    aba_produtos(wb.create_sheet("Em observacao"), [l for l in linhas if 15 <= l["novos"] < min_anuncios],
                 "Nenhum produto entre 15 e %d anuncios novos." % (min_anuncios - 1))

    ws3 = wb.create_sheet("Anunciantes")
    cabecalho(ws3, ["Anunciante", "Total anuncios ativos", f"Novos (<= {max_dias}d)", "Novos ult. 7 dias",
                    "Produtos diferentes", "Maior produto (novos)", "Dor", "Palavra-chave", "Todos do anunciante"])
    for pid, info in sorted(anunciantes.items(), key=lambda x: -contar(novos_de(x[1]["ads"], max_dias))):
        ads = info["ads"]
        prods = [l for l in linhas if l["page_id"] == pid]
        ws3.append([info["nome"], info["total"] or contar(ads), contar(novos_de(ads, max_dias)),
                    contar(novos_de(ads, 7)), len(prods), max([p["novos"] for p in prods] or [0]),
                    info.get("dor", ""), info["keyword"], ""])
        link(ws3.cell(ws3.max_row, 9), url_anunciante(pid, info["pais"]), "Ver todos")
    larguras(ws3, {9: 12})

    ws4 = wb.create_sheet("Anuncios")
    cabecalho(ws4, ["Anunciante", "Produto", "Dias no ar", "Inicio", "Copias do criativo", "Loja (site)",
                    "Link da loja", "Ver anuncio", "Palavra-chave"])
    todos = [(info, a) for info in anunciantes.values() for a in info["ads"]]
    for info, a in sorted(todos, key=lambda x: x[1]["dias"] if x[1]["dias"] is not None else 9999):
        ws4.append([info["nome"], a["titulo"][:90], a["dias"], a["inicio"].isoformat() if a["inicio"] else "",
                    a["copias"], a["dominio"] or "-", "", "", info["keyword"]])
        r = ws4.max_row
        link(ws4.cell(r, 7), a["link_loja"], "Abrir loja")
        link(ws4.cell(r, 8), f"https://www.facebook.com/ads/library/?id={a['id']}", "Ver anuncio")
    larguras(ws4, {2: 50, 7: 12, 8: 12})

    ws5 = wb.create_sheet("Resumo Keywords")
    cabecalho(ws5, ["Dor", "Palavra-chave", "Pais", "Anuncios ativos (total Meta)", "Anunciantes analisados",
                    f"Produtos com {min_anuncios}+ novos", "Produtos 15-%d novos" % (min_anuncios - 1),
                    "Maior escala (anuncios novos)"])
    por_dor = defaultdict(list)
    for (kw, pais, dor), tot in resumo_kw.items():
        ls = [l for l in linhas if l["keyword"] == kw]
        por_dor[dor].extend(ls)
        ws5.append([dor, "(sem palavra-chave)" if kw == "*" else kw, pais, tot, len({l["page_id"] for l in ls}),
                    sum(1 for l in ls if l["novos"] >= min_anuncios),
                    sum(1 for l in ls if 15 <= l["novos"] < min_anuncios),
                    max([l["novos"] for l in ls] or [0])])
    larguras(ws5, {})

    if len(por_dor) > 1:
        ws7 = wb.create_sheet("Ranking por Dor", 1)
        cabecalho(ws7, ["Dor", f"Produtos escalando ({min_anuncios}+)", "Produtos 15-%d" % (min_anuncios - 1),
                        "Maior escala (anuncios novos)", "Melhor produto", "Anunciante", "Link da loja", "Ver anuncio"])
        for dor, ls in sorted(por_dor.items(), key=lambda x: (-sum(1 for l in x[1] if l["novos"] >= min_anuncios),
                                                             -max([l["novos"] for l in x[1]] or [0]))):
            top = max(ls, key=lambda l: l["novos"]) if ls else None
            ws7.append([dor, sum(1 for l in ls if l["novos"] >= min_anuncios),
                        sum(1 for l in ls if 15 <= l["novos"] < min_anuncios),
                        top["novos"] if top else 0, (top["produto"][:70] if top else ""),
                        (top["anunciante"] if top else ""), "", ""])
            if top:
                link(ws7.cell(ws7.max_row, 7), top["link_loja"], "Abrir loja")
                link(ws7.cell(ws7.max_row, 8), top["link_anuncio"], "Ver anuncio")
        larguras(ws7, {5: 45, 7: 12, 8: 12})

    wsd = wb.create_sheet("Fora do segmento")
    cabecalho(wsd, ["Motivo", "Anuncios novos", "Produto", "Anunciante", "Loja (site)", "Ver anuncio", "Link da loja",
                    "Palavra-chave"])
    for d in sorted(DESCARTADOS, key=lambda d: -d["novos"]):
        wsd.append([d["motivo"], d["novos"], d["produto"][:90], d["anunciante"], d["dominio"] or "-", "", "",
                    d["keyword"]])
        link(wsd.cell(wsd.max_row, 6), d["link_anuncio"], "Ver anuncio")
        link(wsd.cell(wsd.max_row, 7), d["link_loja"], "Abrir loja")
    if not DESCARTADOS:
        wsd.append(["Nenhum produto descartado."])
    larguras(wsd, {1: 40, 3: 50, 6: 12, 7: 12})

    ws6 = wb.create_sheet("Como ler")
    for linha in como_ler(min_anuncios, max_dias) + [
            ("Dor", "A dor do cliente que levou a busca (ex.: Queda de cabelo -> hair loss, thinning hair). "
                    "Aba 'Ranking por Dor' mostra quais dores tem mais produtos escalando."),
            ("Sem palavra-chave", "Busca '*' = todos os anuncios ativos do pais, para achar anunciantes com muitos anuncios "
                                  "em qualquer segmento."),
            ("Fora do segmento", "So entra PRODUTO FISICO de saude, beleza e bem-estar. Ficam de fora (aba 'Fora do segmento', "
                                 "com o motivo): calcados e roupas, capsulas/suplementos, infoprodutos/cursos/apps/servicos, "
                                 "remedios, pets, moveis e outros. Palmilhas e ortopedicos continuam.")]:
        ws6.append(list(linha))
    for row in ws6.iter_rows():
        if row[0].value in ("O QUE E", "COLUNA", "ABAS", "COMO USAR"):
            for c in row:
                c.font = Font(bold=True, color="FFFFFF")
                c.fill = azul
        row[1].alignment = Alignment(wrap_text=True, vertical="top")
        row[0].alignment = Alignment(vertical="top", wrap_text=True)
    ws6.column_dimensions["A"].width = 26
    ws6.column_dimensions["B"].width = 110

    if arquivo:
        wb.save(arquivo)
        return arquivo
    os.makedirs(PASTA_HIST, exist_ok=True)
    hist = os.path.join(PASTA_HIST, f"meta_ads_{datetime.now():%Y-%m-%d_%H%M}.xlsx")
    wb.save(hist)
    try:
        wb.save(ARQ_RANKING)
    except PermissionError:
        log(f"meta_ads_ranking.xlsx esta aberto no Excel - feche-o. Copia salva em {hist}")
        return hist
    log(f"Planilha salva: {ARQ_RANKING}  (copia: {hist})")
    return ARQ_RANKING


# --------------------------------------------------------------------------
# Painel (dashboard HTML)
# --------------------------------------------------------------------------
ARQ_PAINEL = os.path.join(PASTA, "painel_minerador.html")
ARQ_TEMPLATE = os.path.join(PASTA, "painel_template.html")


CAMPOS_PAINEL = ("anunciante", "keyword", "dor", "produto", "dominio", "link_loja", "novos", "ult7", "pct_novos",
                 "idade_produto", "total_produto", "total_anunciante", "link_anuncio", "link_anunciante", "imagem",
                 "primeiro", "mais_recente", "serie")


def resumo_anunciantes(anunciantes, max_dias):
    an = []
    for pid, info in anunciantes.items():
        ads = info["ads"]
        an.append({"nome": info["nome"], "total": info["total"] or contar(ads),
                   "novos": contar(novos_de(ads, max_dias)), "ult7": contar(novos_de(ads, 7)),
                   "produtos": len({a["produto"] for a in ads}), "dor": info.get("dor", info["keyword"]),
                   "link": url_anunciante(pid, info["pais"])})
    an.sort(key=lambda a: -a["novos"])
    return an


def enviar_rodada_nuvem(linhas, anunciantes, min_anuncios, max_dias, tipo, versao=None):
    """Sobe fotos + resultado para o app do celular."""
    if not _chave_nuvem():
        return
    import base64
    sel = sorted([l for l in linhas if l["novos"] >= 3], key=lambda l: -l["novos"])[:400]
    enviadas = 0
    for l in sel:
        if l["novos"] >= 15 and l.get("foto_local") and os.path.exists(l["foto_local"]):
            with open(l["foto_local"], "rb") as f:
                r = nuvem_post({"acao": "foto", "nome": os.path.basename(l["foto_local"]),
                                "base64": base64.b64encode(f.read()).decode()})
            if r and r.get("url"):
                l["imagem_nuvem"] = r["url"]
                enviadas += 1
    linhas_app = []
    for l in sel:
        d = {k: l.get(k) for k in CAMPOS_PAINEL}
        d["imagem"] = l.get("imagem_nuvem") or (l.get("imagem") if str(l.get("imagem", "")).startswith("http") else "")
        linhas_app.append(d)
    r = nuvem_post({"acao": "rodada", "versao": versao or STATUS.get("versao") or datetime.now().strftime("%Y%m%d%H%M%S"),
                    "tipo": tipo,
                    "resumo": {"min_anuncios": min_anuncios, "max_dias": max_dias,
                               "gerado_em": datetime.now().strftime("%d/%m/%Y %H:%M"),
                               "n_anunciantes": len(anunciantes),
                               "n_anuncios": sum(len(i["ads"]) for i in anunciantes.values())},
                    "linhas": linhas_app, "anunciantes": resumo_anunciantes(anunciantes, max_dias)}, timeout=60)
    log(f"App do celular atualizado ({len(linhas_app)} produtos, {enviadas} fotos)" if r and r.get("ok")
        else "App do celular NAO foi atualizado (sem internet ou chave ausente)")


def salvar_painel(linhas, anunciantes, min_anuncios, max_dias, arquivo=None, ao_vivo=True):
    """Gera o painel HTML (abre no navegador, funciona sem internet)."""
    if not os.path.exists(ARQ_TEMPLATE):
        log("painel_template.html nao encontrado - painel nao gerado.")
        return None
    an = resumo_anunciantes(anunciantes, max_dias)
    campos = CAMPOS_PAINEL
    linhas = [dict(l) for l in linhas]
    for l in linhas:
        if l.get("foto_local") and os.path.exists(l["foto_local"]):
            l["imagem"] = "fotos_meta/" + os.path.basename(l["foto_local"])
    dados = {
        "gerado_em": datetime.now().strftime("%d/%m/%Y %H:%M"),
        "versao": STATUS.get("versao"),
        "min_anuncios": min_anuncios, "max_dias": max_dias,
        "n_anunciantes": len(anunciantes), "n_anuncios": sum(len(i["ads"]) for i in anunciantes.values()),
        "linhas": [{k: l[k] for k in campos} for l in linhas if l["novos"] > 0],
        "anunciantes": an,
    }
    js = json.dumps(dados, ensure_ascii=False).replace("</", "<\\/")
    modelo = open(ARQ_TEMPLATE, encoding="utf-8").read().replace("__DADOS__", js)
    destino = arquivo or ARQ_PAINEL
    with open(destino, "w", encoding="utf-8") as f:
        f.write(modelo.replace("__AO_VIVO__", "true" if ao_vivo else "false"))
    if not arquivo and linhas:
        os.makedirs(PASTA_HIST, exist_ok=True)
        with open(os.path.join(PASTA_HIST, f"painel_{datetime.now():%Y-%m-%d_%H%M}.html"), "w", encoding="utf-8") as f:
            f.write(modelo.replace("__AO_VIVO__", "false"))
    log(f"Painel salvo: {destino}")
    return destino


PASTA_FOTOS = os.path.join(PASTA, "fotos_meta")
ARQ_RELATORIO = os.path.join(PASTA, "relatorio_minerador")   # .html e .pdf


def baixar_fotos(linhas, req):
    """Baixa a foto do criativo de cada produto (o link da Meta expira em poucos dias)."""
    os.makedirs(PASTA_FOTOS, exist_ok=True)
    ok = 0
    for l in linhas:
        if not l.get("imagem"):
            continue
        nome = re.sub(r"\D", "", l["link_anuncio"].split("id=")[-1]) or str(abs(hash(l["imagem"])))
        arq = os.path.join(PASTA_FOTOS, nome + ".jpg")
        if not os.path.exists(arq):
            try:
                r = req.get(l["imagem"], timeout=20000)
                if r.ok and len(r.body()) > 500:
                    with open(arq, "wb") as f:
                        f.write(r.body())
            except Exception:
                pass
        if os.path.exists(arq):
            reduzir_foto(arq)
            l["foto_local"] = arq
            ok += 1
    return ok


def reduzir_foto(arq, lado=600):
    """Deixa a foto leve (ate 600 px, JPEG) para o PDF, o painel e o app do celular."""
    try:
        from PIL import Image
        if os.path.getsize(arq) < 120_000:
            return
        with Image.open(arq) as orig:
            im = orig.convert("RGB")
        im.thumbnail((lado, lado))
        im.save(arq, "JPEG", quality=82, optimize=True)
    except Exception:
        pass


def _foto_data_uri(l):
    import base64
    arq = l.get("foto_local")
    if arq and os.path.exists(arq):
        with open(arq, "rb") as f:
            return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()
    return ""


def html_relatorio(linhas, anunciantes, min_anuncios, max_dias):
    from html import escape as e
    esc_ = [l for l in linhas if l["novos"] >= min_anuncios]
    obs = [l for l in linhas if 15 <= l["novos"] < min_anuncios][:40]

    def bloco(l, grande=True):
        foto = _foto_data_uri(l)
        img = f'<img src="{foto}">' if foto else '<div class="semfoto">sem foto</div>'
        novo = l["idade_produto"] is not None and l["idade_produto"] <= max_dias
        loja = (f'<a href="{e(l["link_loja"])}">{e(l["dominio"] or "loja")}</a>' if l["link_loja"] else "sem link de loja")
        return f"""<div class="item{' g' if grande else ''}">
  <div class="foto">{img}<span class="selo{' novo' if novo else ''}">{l['novos']} novos</span></div>
  <div class="info">
    <h3>{e(l['produto'][:110])}</h3>
    <div class="anun">Anunciante: <a href="{e(l['link_anunciante'])}">{e(l['anunciante'])}</a> &middot; Dor: {e(l.get('dor', ''))}</div>
    <table class="met"><tr>
      <td><b>{l['novos']}</b>anúncios novos (&le;{max_dias}d)</td>
      <td><b>{l['ult7']}</b>últimos 7 dias</td>
      <td><b>{l['idade_produto'] if l['idade_produto'] is not None else '-'}d</b>idade do produto</td>
      <td><b>{l['total_anunciante']}</b>total do anunciante</td>
    </tr></table>
    <div class="links">
      <a class="b" href="{e(l['link_anuncio'])}">Ver anúncio</a>
      <a class="b" href="{e(l['link_anunciante'])}">Todos os anúncios do anunciante</a>
      {f'<a class="b" href="{e(l["link_loja"])}">Abrir loja</a>' if l['link_loja'] else ''}
    </div>
    <div class="url">Loja: {loja}<br>Anúncio: {e(l['link_anuncio'])}</div>
  </div>
</div>"""

    dores = defaultdict(list)
    for l in linhas:
        dores[l.get("dor", "")].append(l)
    rank = sorted(dores.items(), key=lambda x: (-sum(1 for l in x[1] if l["novos"] >= min_anuncios),
                                               -max([l["novos"] for l in x[1]] or [0])))
    linhas_dor = "".join(
        f"<tr><td>{e(d)}</td><td>{sum(1 for l in ls if l['novos'] >= min_anuncios)}</td>"
        f"<td>{max([l['novos'] for l in ls] or [0])}</td></tr>" for d, ls in rank[:30])
    return f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Relatório Minerador Meta Ads</title>
<style>
@page {{ size: A4; margin: 12mm 11mm; }}
body {{ font: 10.5pt/1.4 "Segoe UI", Arial, sans-serif; color: #1b2430; margin: 0; }}
a {{ color: #1F4E78; }}
.capa {{ background: #1F4E78; color: #fff; padding: 18px 20px; border-radius: 8px; }}
.capa h1 {{ margin: 0 0 4px; font-size: 20pt; }}
.capa p {{ margin: 0; opacity: .9; }}
.kpis {{ display: flex; gap: 8px; margin: 12px 0 6px; }}
.kpis div {{ flex: 1; border: 1px solid #dde3ea; border-radius: 6px; padding: 8px 10px; }}
.kpis b {{ display: block; font-size: 17pt; color: #1F4E78; }}
.kpis span {{ font-size: 8pt; color: #5b6676; text-transform: uppercase; }}
h2 {{ color: #1F4E78; border-bottom: 2px solid #1F4E78; padding-bottom: 3px; margin: 18px 0 10px; font-size: 13pt; }}
.item {{ display: flex; gap: 12px; border: 1px solid #dde3ea; border-radius: 8px; padding: 10px; margin-bottom: 10px;
         page-break-inside: avoid; break-inside: avoid; }}
.foto {{ width: 150px; min-width: 150px; height: 150px; position: relative; border-radius: 6px; overflow: hidden; background: #eef2f7; }}
.item:not(.g) .foto {{ width: 95px; min-width: 95px; height: 95px; }}
.foto img {{ width: 100%; height: 100%; object-fit: cover; }}
.semfoto {{ display: flex; align-items: center; justify-content: center; height: 100%; color: #8792a2; font-size: 9pt; }}
.selo {{ position: absolute; left: 5px; top: 5px; background: #1F4E78; color: #fff; font-weight: 700; font-size: 8.5pt; border-radius: 4px; padding: 2px 6px; }}
.selo.novo {{ background: #1e8e3e; }}
.info {{ flex: 1; min-width: 0; }}
.info h3 {{ margin: 0 0 3px; font-size: 11.5pt; }}
.anun {{ color: #5b6676; font-size: 9.5pt; margin-bottom: 5px; }}
table.met {{ border-collapse: separate; border-spacing: 4px 0; margin: 0 -4px 6px; }}
table.met td {{ background: #eef2f7; border-radius: 5px; padding: 4px 8px; font-size: 7.8pt; color: #5b6676; text-align: center; }}
table.met b {{ display: block; font-size: 12pt; color: #1b2430; }}
.links a.b {{ display: inline-block; border: 1px solid #1F4E78; border-radius: 4px; padding: 3px 8px; margin: 0 4px 4px 0;
             text-decoration: none; font-size: 8.5pt; font-weight: 600; }}
.url {{ font-size: 7.5pt; color: #8792a2; word-break: break-all; }}
table.dor {{ width: 100%; border-collapse: collapse; font-size: 9.5pt; }}
table.dor th, table.dor td {{ border-bottom: 1px solid #dde3ea; padding: 4px 6px; text-align: left; }}
table.dor th {{ color: #5b6676; font-size: 8pt; text-transform: uppercase; }}
.nota {{ font-size: 8.5pt; color: #5b6676; }}
</style></head><body>
<div class="capa"><h1>Relatório — Produtos Escalando (Meta Ads)</h1>
<p>Gerado em {datetime.now():%d/%m/%Y %H:%M} &middot; Critério: {min_anuncios}+ anúncios ativos do MESMO anunciante e produto, criados nos últimos {max_dias} dias</p></div>
<div class="kpis">
  <div><b>{len(esc_)}</b><span>produtos escalando</span></div>
  <div><b>{sum(1 for l in esc_ if (l['idade_produto'] or 999) <= max_dias)}</b><span>escalando e lançados há &le; {max_dias}d</span></div>
  <div><b>{len([l for l in linhas if 15 <= l['novos'] < min_anuncios])}</b><span>em observação (15+)</span></div>
  <div><b>{len(anunciantes)}</b><span>anunciantes analisados</span></div>
</div>
<p class="nota">Selo verde = produto lançado há no máximo {max_dias} dias. Links clicáveis: anúncio (Biblioteca da Meta), todos os anúncios do anunciante e loja.</p>
<h2>Produtos escalando ({min_anuncios}+ anúncios novos)</h2>
{''.join(bloco(l) for l in esc_) or '<p>Nenhum produto atingiu o critério nesta rodada. Veja os produtos em observação abaixo.</p>'}
<h2>Em observação (15 a {min_anuncios - 1} anúncios novos)</h2>
{''.join(bloco(l, False) for l in obs) or '<p>Nenhum.</p>'}
<h2>Ranking por dor</h2>
<table class="dor"><tr><th>Dor</th><th>Produtos escalando</th><th>Maior escala (anúncios novos)</th></tr>{linhas_dor}</table>
</body></html>"""


def gerar_relatorio(linhas, anunciantes, min_anuncios, max_dias, destino=None):
    """Baixa as fotos, gera relatorio HTML + PDF com foto, links do anuncio, anunciante e loja."""
    from playwright.sync_api import sync_playwright
    destino = destino or ARQ_RELATORIO
    sel = [l for l in linhas if l["novos"] >= 15]
    with sync_playwright() as pw:
        try:
            nav = pw.chromium.launch(channel="chrome", headless=True)
        except Exception:
            nav = pw.chromium.launch(headless=True)
        ctx = nav.new_context()
        n = baixar_fotos(sel, ctx.request)
        log(f"Fotos baixadas: {n} de {len(sel)} produtos")
        html = html_relatorio(linhas, anunciantes, min_anuncios, max_dias)
        with open(destino + ".html", "w", encoding="utf-8") as f:
            f.write(html)
        pg = ctx.new_page()
        from pathlib import Path
        pg.goto(Path(destino + ".html").resolve().as_uri(), wait_until="load", timeout=180000)
        pg.pdf(path=destino + ".pdf", format="A4", print_background=True,
               margin={"top": "12mm", "bottom": "12mm", "left": "11mm", "right": "11mm"})
        nav.close()
    log(f"Relatorio salvo: {destino}.pdf")
    return destino + ".pdf"


def carregar_json(caminho):
    """Recarrega uma rodada salva com --json (para refazer planilha/painel sem minerar de novo)."""
    d = json.load(open(caminho, encoding="utf-8"))
    anunciantes = {}
    for pid, info in d["anunciantes"].items():
        ads = []
        for a in info["ads"]:
            ini = date.fromisoformat(a["inicio"]) if a.get("inicio") else None
            ads.append({**a, "inicio": ini, "dias": (date.today() - ini).days if ini else None})
        anunciantes[pid] = {**info, "ads": ads}
    resumo = {}
    for r in d.get("resumo_kw", []):
        if len(r) == 4:
            resumo[(r[0], r[1], r[2])] = r[3]
        else:
            resumo[(r[0], r[1], r[0])] = r[2]
    return anunciantes, resumo


def refazer(caminho_json, min_anuncios=40, max_dias=45, xlsx=None, html=None, tipo=None):
    anunciantes, resumo = carregar_json(caminho_json)
    linhas = analisar(anunciantes, max_dias)
    try:
        gerar_relatorio(linhas, anunciantes, min_anuncios, max_dias)
    except Exception as e:
        log(f"Relatorio nao gerado: {e}")
    x = salvar_excel(linhas, anunciantes, min_anuncios, max_dias, resumo, arquivo=xlsx)
    h = salvar_painel(linhas, anunciantes, min_anuncios, max_dias, arquivo=html)
    if tipo:
        enviar_rodada_nuvem(linhas, anunciantes, min_anuncios, max_dias, tipo,
                            versao="json-" + os.path.basename(caminho_json) + datetime.now().strftime("-%Y%m%d"))
    return x, h, linhas


# --------------------------------------------------------------------------
# Fluxos
# --------------------------------------------------------------------------
def configurar():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        ctx = abrir_navegador(pw)
        p = ctx.pages[0] if ctx.pages else ctx.new_page()
        p.goto("https://www.facebook.com/login")
        p2 = ctx.new_page()
        p2.goto("https://chromewebstore.google.com/search/copycat%20ads")
        print("\n" + "=" * 60)
        print(" Abriu o Chrome do minerador (perfil separado).")
        print(" 1) Faca login no Facebook na 1a aba.")
        print(" 2) Se usa a extensao copycat.ads, instale/entre na 2a aba.")
        print(" Quando terminar, volte aqui e aperte ENTER (nao feche o Chrome antes).")
        print("=" * 60)
        try:
            input()
        except EOFError:
            pass
        ctx.close()
    log("Configuracao salva no perfil: " + PERFIL)


def manter_acordado(ligar=True):
    """Impede o Windows de entrar em repouso enquanto o minerador roda."""
    if os.name != "nt":
        return
    try:
        import ctypes
        ES_CONTINUOUS, ES_SYSTEM_REQUIRED = 0x80000000, 0x00000001
        ctypes.windll.kernel32.SetThreadExecutionState(
            ES_CONTINUOUS | ES_SYSTEM_REQUIRED if ligar else ES_CONTINUOUS)
    except Exception:
        pass


def rodar(itens, args):
    manter_acordado(True)
    try:
        return _rodar(itens, args)
    except BaseException as e:
        if STATUS:
            status(rodando=False, erro=str(e) or type(e).__name__, fase="Interrompido", atual=str(e)[:200])
        raise
    finally:
        manter_acordado(False)


def _rodar(itens, args):
    from playwright.sync_api import sync_playwright
    teste = args.teste
    max_dias, min_anuncios = args.max_dias, args.min_anuncios
    limite = 12 if teste else args.max_anunciantes
    por_kw = 6
    candidatos, resumo_kw, anunciantes = {}, {}, {}

    STATUS.clear()
    _LOG.clear()
    status(versao=datetime.now().strftime("%Y%m%d%H%M%S"), rodando=True, erro=None, inicio=time.time(),
           fase="Fase 1 de 2 - Descoberta (buscando anunciantes)", atual="Abrindo o navegador...",
           etapa=0, total_etapas=len(itens) + limite, buscas_feitas=0, buscas_total=len(itens),
           anunciantes_feitos=0, anunciantes_total=0, top=[], min_anuncios=min_anuncios, max_dias=max_dias)
    if not os.path.exists(ARQ_PAINEL):
        salvar_painel([], {}, min_anuncios, max_dias)
    if not args.headless and not getattr(args, "sem_painel", False):
        try:
            os.startfile(ARQ_PAINEL)
        except Exception:
            pass

    with sync_playwright() as pw:
        ctx = abrir_navegador(pw, headless=args.headless)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        col = Coletor(page)

        # ---- 1) DESCOBERTA ----
        log(f"FASE 1 - descoberta ({len(itens)} buscas)")
        for i, (kw, pais, dor) in enumerate(itens, 1):
            nome_kw = '(sem palavra-chave)' if kw == '*' else kw
            status(etapa=i - 1, atual=f"Buscando '{nome_kw}' na Biblioteca da Meta  [{dor}]")
            log(f"({i}/{len(itens)}) [{dor}] Buscando '{nome_kw}' ({pais})...")
            try:
                total, ads = col.abrir(url_busca(kw, pais), rolagens=args.rolagens)
            except Exception as e:
                log(f"  ERRO: {str(e).splitlines()[0]}")
                continue
            resumo_kw[(kw, pais, dor)] = total
            por_pag = defaultdict(list)
            for a in ads:
                if not ignorar(a["anunciante"]):
                    por_pag[a["page_id"]].append(a)
            ranking = sorted(por_pag.items(), key=lambda x: (-contar(novos_de(x[1], max_dias)), -contar(x[1])))
            escolhidos = [(pid, l) for pid, l in ranking if novos_de(l, max_dias) or contar(l) >= 5][:por_kw]
            for pid, l in escolhidos:
                nota = (contar(novos_de(l, max_dias)), contar(l))
                if pid not in candidatos or nota > candidatos[pid]["nota"]:
                    candidatos[pid] = {"nome": l[0]["anunciante"], "keyword": kw, "pais": pais, "dor": dor, "nota": nota}
            log(f"  {total or '?'} anuncios na Meta | {len(ads)} lidos | {len(por_pag)} anunciantes | "
                f"{len(escolhidos)} candidatos")
            status(etapa=i, buscas_feitas=i, atual=f"Pausa humana antes da proxima busca ({len(candidatos)} candidatos ate agora)")
            if i < len(itens):
                pausa(*((6, 12) if teste else (25, 50)))

        # ---- 2) CONTAGEM REAL POR ANUNCIANTE ----
        # os anunciantes com MAIS anuncios novos na amostra vao primeiro
        lista = sorted(candidatos.items(), key=lambda x: x[1]["nota"], reverse=True)[:limite]
        log(f"FASE 2 - contando todos os anuncios de {len(lista)} anunciantes")
        status(fase="Fase 2 de 2 - Contagem real por anunciante", total_etapas=len(itens) + len(lista),
               anunciantes_total=len(lista), etapa=len(itens))
        for j, (pid, c) in enumerate(lista, 1):
            status(atual=f"Contando todos os anuncios de: {c['nome']}  [{c.get('dor', '')}]")
            log(f"({j}/{len(lista)}) {c['nome']}...")
            try:
                total, ads = col.abrir(url_anunciante(pid, c["pais"]), rolagens=args.rolagens_anunciante)
            except Exception as e:
                log(f"  ERRO: {str(e).splitlines()[0]}")
                continue
            ads = [a for a in ads if a["page_id"] == pid]
            anunciantes[pid] = {**{k: v for k, v in c.items() if k != "nota"}, "total": total, "ads": ads}
            n_novos = contar(novos_de(ads, max_dias))
            log(f"  {total or contar(ads)} anuncios ativos | lidos {len(ads)} | {n_novos} novos (<= {max_dias}d)")
            ls_ok = analisar({pid: anunciantes[pid]}, max_dias, guardar_descartados=False)
            maior = max([l["novos"] for l in ls_ok] or [0])
            top = STATUS.get("top", []) + [{"nome": c["nome"], "novos": maior, "novos_anunciante": n_novos,
                                             "ult7": contar(novos_de(ads, 7)), "total": total or contar(ads),
                                             "dor": c.get("dor", "")}]
            top.sort(key=lambda a: -a["novos"])
            status(etapa=len(itens) + j, anunciantes_feitos=j, top=top,
                   atual="Pausa humana antes do proximo anunciante")
            if j < len(lista):
                pausa(*((4, 8) if teste else (20, 45)))
        ctx.close()

    if not anunciantes:
        log("Nenhum anunciante lido. Rode a opcao [4] CONFIGURAR e faca login no Facebook, depois tente de novo.")
        status(rodando=False, erro="nenhum anunciante lido", fase="Sem resultados")
        return None
    linhas = analisar(anunciantes, max_dias)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({"anunciantes": {k: {**v, "ads": [{**a, "inicio": a["inicio"].isoformat() if a["inicio"] else None}
                                                         for a in v["ads"]]} for k, v in anunciantes.items()},
                       "resumo_kw": [[k[0], k[1], k[2], t] for k, t in resumo_kw.items()]}, f, ensure_ascii=False)
    status(atual="Baixando fotos e gerando o relatorio PDF...")
    try:
        gerar_relatorio(linhas, anunciantes, min_anuncios, max_dias)
    except Exception as e:
        log(f"Relatorio nao gerado: {e}")
    status(atual="Gerando planilha e painel...")
    caminho = salvar_excel(linhas, anunciantes, min_anuncios, max_dias, resumo_kw)
    try:
        salvar_painel(linhas, anunciantes, min_anuncios, max_dias)
    except Exception as e:
        log(f"Painel nao gerado: {e}")
    status(atual="Enviando resultado para o app do celular...")
    try:
        enviar_rodada_nuvem(linhas, anunciantes, min_anuncios, max_dias,
                            "dores" if args.dores else ("geral" if args.geral and len(itens) == 1 else "palavra-chave"))
    except Exception as e:
        log(f"Envio ao app falhou: {e}")
    n_esc = sum(1 for l in linhas if l["novos"] >= min_anuncios)
    log(f"ESCALANDO: {n_esc} produtos com {min_anuncios}+ anuncios novos")
    status(rodando=False, fase=f"Concluido - {n_esc} produtos escalando", etapa=STATUS.get("total_etapas", 0),
           atual="Mineracao concluida. Clique em 'Ver resultados'.")

    esc = [l for l in linhas if l["novos"] >= min_anuncios]
    print(f"\nPRODUTOS ESCALANDO ({min_anuncios}+ anuncios novos em {max_dias} dias): {len(esc)}")
    for l in (esc or linhas)[:15]:
        print(f"  {l['novos']:>4} novos | 7d:{l['ult7']:>3} | idade {str(l['idade_produto']):>4}d | "
              f"{l['anunciante'][:22]:22} | {l['produto'][:40]:40} | {l['dominio']} | {l['dor']}")
    if not esc:
        print("  (nenhum atingiu o minimo - acima, os mais proximos)")
    return caminho


def main():
    ap = argparse.ArgumentParser(description="Minerador Meta Ads - ShopPainless v4.0")
    ap.add_argument("--teste", action="store_true")
    ap.add_argument("--configurar", action="store_true")
    ap.add_argument("--keyword")
    ap.add_argument("--pais", default="US")
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--min-anuncios", type=int, default=40)
    ap.add_argument("--max-dias", type=int, default=45)
    ap.add_argument("--max-anunciantes", type=int, default=40)
    ap.add_argument("--rolagens", type=int, default=12)
    ap.add_argument("--rolagens-anunciante", type=int, default=30)
    ap.add_argument("--json", help="salva tambem os dados brutos neste arquivo")
    ap.add_argument("--dores", action="store_true", help="minera pela lista de DORES (dores_meta.txt)")
    ap.add_argument("--geral", action="store_true", help="inclui busca SEM palavra-chave (todos os anuncios do pais)")
    ap.add_argument("--refazer", help="refaz planilha e painel a partir de um arquivo .json salvo")
    ap.add_argument("--sem-painel", action="store_true", help="nao abre o painel no navegador ao iniciar")
    ap.add_argument("--tipo-nuvem", help="com --refazer: envia ao app do celular com este tipo (palavra-chave/dores)")
    a = ap.parse_args()

    if a.refazer:
        x, h, _ = refazer(a.refazer, a.min_anuncios, a.max_dias, tipo=a.tipo_nuvem)
        return
    if a.configurar:
        return configurar()
    if a.keyword:
        itens = [(a.keyword.strip(), (a.pais or "US").upper(), a.keyword.strip())]
    elif a.dores:
        itens = carregar_dores()
        if a.teste:
            itens = itens[:3]
    elif a.geral:
        itens = []
    else:
        itens = carregar_keywords()
        if a.teste:
            itens = itens[:3]
    if a.geral:
        itens = [("*", (a.pais or "US").upper(), "Geral (sem palavra-chave)")] + itens
    if not itens:
        log("Lista de palavras-chave vazia (keywords_meta.txt).")
        return
    rodar(itens, a)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("Interrompido pelo usuario.")
