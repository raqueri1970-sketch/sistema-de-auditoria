#!/usr/bin/env python3
"""Relatório informativo de auditoria dos ajustes de estoque.

Lê o JSON produzido por auditoria_ajustes_estoque.sql (uma linha por ajuste,
já cruzada com Estoque por Loja e Inventário) e gera:
  - relatorio_ajustes_estoque.html  (painel com filtros, um bloco por ajuste)
  - relatorio_ajustes_estoque.xlsx  (mesmos campos em planilha)

Somente leitura: não bloqueia, não aprova e não altera nenhum ajuste.
Não analisa movimentações e não toma decisão.

Uso:
  python3 gerar_relatorio_ajustes.py saida_ajustes.json [--posicao DD/MM/AAAA]
         [--estoque-carregado] [--saida DIR]

--estoque-carregado indica que a base Estoque por Loja
(ajuste_saldo_estoque_loja) tem registros. Sem ela, a situação da linha fica
"NÃO CLASSIFICADA" em vez de "SEM SALDO NA LINHA": ausência de base não é zero.
"""
import argparse
import html
import json
import os
from collections import Counter
from datetime import datetime

MSG_ZERO = "INVENTÁRIO JÁ APONTOU ESTA NUMERAÇÃO COMO ZERO — ajuste atual compatível com a contagem anterior."
MSG_ATENCAO = "ATENÇÃO: inventário registrou saldo nesta numeração; conferir a divergência."
MSG_SEM_INV = "SEM INVENTÁRIO LOCALIZADO PARA ESTE ITEM E NUMERAÇÃO NESTA LOJA."

SIT_ULTIMO = "ÚLTIMO PAR DA LINHA"
SIT_OUTRAS = "HÁ OUTRAS NUMERAÇÕES"
SIT_SEM = "SEM SALDO NA LINHA"
SIT_NC = "NÃO CLASSIFICADA"


def num(v):
    if v is None:
        return None
    f = float(v)
    return int(f) if f.is_integer() else f


def data_br(s):
    """Aceita AAAA-MM-DD ou DD/MM/AAAA e devolve DD/MM/AAAA."""
    if len(s) == 10 and s[4] == "-":
        return f"{s[8:10]}/{s[5:7]}/{s[0:4]}"
    return s


def classificar(r, estoque_carregado):
    nu = r.get("nu")
    loja = r.get("l")
    out = {
        "id": r["id"],
        "loja": f"{loja:03d} - {r.get('ln') or 'nome não localizado'}" if loja is not None else "Loja não informada",
        "loja_num": loja,
        "marca": r.get("m") or "Não informada no Acerto de Estoque",
        "produto": r.get("d") or "Não informada no Acerto de Estoque",
        "codigo": r.get("cc") or r.get("cp") or "",
        "codigo_informado": r.get("cp") or "",
        "modelo": r.get("mo") or "",
        "numeracao": nu or "",
        "quantidade": r.get("q"),
        "solicitante": r.get("so") or "Não informado",
        "cargo": r.get("ca") or "",
        "cpf": r.get("cpf") or "",
        "data": r.get("dt") or "",
        "status": r.get("st") or "",
        "finalidade": r.get("fi") or "",
        "acerto_seta": r.get("ac"),
    }

    # --- Estoque por Loja: saldo por numeração do mesmo modelo ---
    linhas = int(r.get("el") or 0)
    if linhas > 0:
        out["saldo"] = r.get("es") or ""
        total = num(r.get("et")) or 0
        outras = num(r.get("eo")) or 0
        if not nu:
            out["situacao"] = SIT_OUTRAS if total > 0 else SIT_SEM
            out["situacao_det"] = "numeração ajustada não identificada no código; saldo do modelo listado acima"
        elif total <= 0:
            out["situacao"] = SIT_SEM
            out["situacao_det"] = "nenhuma numeração do modelo com saldo na loja"
        elif outras > 0:
            out["situacao"] = SIT_OUTRAS
            out["situacao_det"] = f"outras numerações com saldo: {r.get('ex')}"
        else:
            out["situacao"] = SIT_ULTIMO
            out["situacao_det"] = "nenhuma outra numeração do modelo com saldo na loja"
    elif estoque_carregado:
        out["saldo"] = "modelo não localizado no Estoque por Loja desta loja"
        out["situacao"] = SIT_SEM
        out["situacao_det"] = "não foi localizado saldo de nenhuma numeração do modelo na loja"
    else:
        out["saldo"] = "Estoque por Loja sem registros carregados; saldo não consultável"
        out["situacao"] = SIT_NC
        out["situacao_det"] = "a base Estoque por Loja está vazia; a ausência de base não é tratada como zero"

    # --- Inventário: mesmo produto, mesma numeração, mesma loja ---
    if r.get("ii"):
        iq = num(r.get("iq"))
        ia = num(r.get("ia"))
        partes = [f"{r.get('id_')}", f"quantidade encontrada {iq}"]
        if ia is not None:
            partes.append(f"sistema antes {ia}")
        partes.append(r.get("is") or "")
        if r.get("ip"):
            partes.append("inventário posterior ao ajuste")
        out["inventario"] = " — ".join(p for p in partes if p)
        if iq is not None and iq <= 0:
            out["inv_classe"] = "zero"
            out["inv_msg"] = MSG_ZERO
        else:
            out["inv_classe"] = "atencao"
            out["inv_msg"] = MSG_ATENCAO
    else:
        if not nu:
            txt = "Não localizado — numeração não identificada no código do ajuste"
        else:
            txt = "Não localizado"
        if r.get("il"):
            datas = ", ".join(data_br(d.strip()) for d in r["il"].split(","))
            txt += f" (loja inventariada em {datas}; este item/numeração não consta na contagem)"
        out["inventario"] = txt
        out["inv_classe"] = "sem"
        out["inv_msg"] = MSG_SEM_INV

    # --- Histórico de Acerto de Estoque ---
    out["anterior"] = r.get("an") or "Não localizado"
    out["tem_anterior"] = bool(r.get("an"))

    # --- Apontamento de auditoria (esclarecimento objetivo) ---
    if out["inv_classe"] == "zero":
        # Regra: quando o inventário já apontou zero, mostrar apenas este esclarecimento.
        out["apontamento"] = MSG_ZERO
    else:
        partes = [out["inv_msg"]]
        if not nu:
            partes.append("Código informado sem os dois dígitos da numeração; cruzamento por numeração não aplicável.")
        if out["situacao"] == SIT_NC:
            partes.append("Situação da linha não classificada: Estoque por Loja sem registros.")
        elif out["situacao"] == SIT_OUTRAS and nu:
            partes.append(f"Há outras numerações do modelo na loja ({r.get('ex')}).")
        elif out["situacao"] == SIT_ULTIMO:
            partes.append("Último par da linha na loja.")
        elif out["situacao"] == SIT_SEM:
            partes.append("Sem saldo na linha na loja.")
        if out["tem_anterior"]:
            partes.append("A mesma numeração já teve ajuste anterior nesta loja.")
        if out["status"] and out["status"] != "CONCLUIDO":
            partes.append(f"Ajuste com status {out['status']}.")
        out["apontamento"] = " ".join(partes)
    return out


def ajuste_txt(x):
    q = x["quantidade"]
    quem = x["solicitante"]
    extra = ", ".join(p for p in (x["cargo"], f"CPF {x['cpf']}" if x["cpf"] else "") if p)
    if extra:
        quem += f" ({extra})"
    return f"{q} un. — {quem} — {x['data']}"


def cod_txt(x):
    return f"{x['codigo'] or '—'} / {x['modelo'] or '—'} / {x['numeracao'] or 'não identificada'}"


# ---------------------------------------------------------------- Excel
def gerar_xlsx(itens, caminho, posicao):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = "Ajustes"
    cab = ["ID ajuste", "Loja", "Marca", "Produto", "Código", "Modelo", "Numeração", "Código informado",
           "Quantidade", "Solicitante", "Cargo", "CPF (mascarado)", "Data do ajuste", "Status",
           "Saldo por numeração na loja", "Situação da linha", "Detalhe da situação", "Inventário",
           "Ajuste anterior da mesma numeração", "Apontamento de auditoria"]
    ws.append(cab)
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1F4E5F")
        c.alignment = Alignment(vertical="center", wrap_text=True)
    cores = {"zero": "E3F1E6", "atencao": "FCEBD3", "sem": None}
    for x in itens:
        ws.append([x["id"], x["loja"], x["marca"], x["produto"], x["codigo"], x["modelo"], x["numeracao"] or "não identificada",
                   x["codigo_informado"], x["quantidade"], x["solicitante"], x["cargo"], x["cpf"], x["data"], x["status"],
                   x["saldo"], x["situacao"], x["situacao_det"], x["inventario"], x["anterior"], x["apontamento"]])
        cor = cores[x["inv_classe"]]
        if cor:
            ws.cell(ws.max_row, len(cab)).fill = PatternFill("solid", fgColor=cor)
    larg = [9, 30, 16, 42, 12, 10, 11, 14, 10, 32, 24, 16, 17, 12, 40, 22, 40, 48, 60, 70]
    for i, w in enumerate(larg, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = Alignment(vertical="top", wrap_text=True)
    ws.freeze_panes = "C2"
    ws.auto_filter.ref = ws.dimensions

    rs = wb.create_sheet("Resumo")
    rs.append(["Relatório informativo de auditoria dos ajustes de estoque"])
    rs.append([f"Posição: {posicao}"])
    rs.append(["Somente informativo: não bloqueia, não aprova e não altera ajustes."])
    rs.append([])
    rs.append(["Indicador", "Quantidade"])
    for k, v in resumo(itens):
        rs.append([k, v])
    rs.column_dimensions["A"].width = 70
    rs.column_dimensions["B"].width = 14
    rs["A1"].font = Font(bold=True, size=13)
    wb.save(caminho)


def resumo(itens):
    c = Counter(x["inv_classe"] for x in itens)
    s = Counter(x["situacao"] for x in itens)
    return [
        ("Ajustes analisados", len(itens)),
        ("Lojas com ajuste", len({x["loja_num"] for x in itens})),
        ("Com numeração identificada no código", sum(1 for x in itens if x["numeracao"])),
        ("Numeração não identificada (código só de modelo)", sum(1 for x in itens if not x["numeracao"])),
        ("Inventário já apontou zero (compatível)", c["zero"]),
        ("Inventário registrou saldo (conferir divergência)", c["atencao"]),
        ("Sem inventário localizado", c["sem"]),
        ("Com ajuste anterior da mesma numeração", sum(1 for x in itens if x["tem_anterior"])),
        ("Situação: " + SIT_ULTIMO, s[SIT_ULTIMO]),
        ("Situação: " + SIT_OUTRAS, s[SIT_OUTRAS]),
        ("Situação: " + SIT_SEM, s[SIT_SEM]),
        ("Situação: " + SIT_NC + " (Estoque por Loja sem registros)", s[SIT_NC]),
    ]


# ---------------------------------------------------------------- HTML
def gerar_html(itens, caminho, posicao, estoque_carregado):
    dados = [{
        "id": x["id"], "lj": x["loja"], "ln": x["loja_num"], "m": x["marca"], "p": x["produto"],
        "cod": cod_txt(x), "aj": ajuste_txt(x), "st": x["status"], "sal": x["saldo"], "sit": x["situacao"],
        "sitd": x["situacao_det"], "inv": x["inventario"], "ic": x["inv_classe"], "ant": x["anterior"],
        "ta": x["tem_anterior"], "ap": x["apontamento"], "nn": not x["numeracao"],
    } for x in itens]
    res = resumo(itens)
    res_map = dict(res)
    lojas = sorted({(x["loja_num"] or 0, x["loja"]) for x in itens})
    opts = "".join(f'<option value="{n}">{html.escape(t)}</option>' for n, t in lojas)
    aviso_estoque = "" if estoque_carregado else (
        '<p class="nota"><strong>Estoque por Loja:</strong> a base oficial (<code>ajuste_saldo_estoque_loja</code>) '
        'está sem registros nesta posição. O saldo por numeração e a situação da linha ficam como '
        '<em>não classificada</em>; ausência de base não foi tratada como zero. Ao carregar a base, basta '
        'regerar o relatório e a classificação é preenchida automaticamente.</p>')
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "modelo_relatorio.html"), encoding="utf-8") as f:
        tpl = f.read()
    pagina = (tpl
              .replace("{{POSICAO}}", html.escape(posicao))
              .replace("{{TOTAL}}", str(res_map["Ajustes analisados"]))
              .replace("{{LOJAS}}", str(res_map["Lojas com ajuste"]))
              .replace("{{ZERO}}", str(res_map["Inventário já apontou zero (compatível)"]))
              .replace("{{ATENCAO}}", str(res_map["Inventário registrou saldo (conferir divergência)"]))
              .replace("{{SEMINV}}", str(res_map["Sem inventário localizado"]))
              .replace("{{ANTERIOR}}", str(res_map["Com ajuste anterior da mesma numeração"]))
              .replace("{{SEMNUM}}", str(res_map["Numeração não identificada (código só de modelo)"]))
              .replace("{{AVISO_ESTOQUE}}", aviso_estoque)
              .replace("{{OPCOES_LOJA}}", opts)
              .replace("{{DADOS}}", json.dumps(dados, ensure_ascii=False).replace("</", "<\\/")))
    with open(caminho, "w", encoding="utf-8") as f:
        f.write(pagina)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("entrada")
    ap.add_argument("--posicao", default=datetime.now().strftime("%d/%m/%Y"))
    ap.add_argument("--estoque-carregado", action="store_true")
    ap.add_argument("--saida", default=".")
    a = ap.parse_args()
    with open(a.entrada, encoding="utf-8") as f:
        linhas = json.load(f)
    estoque = a.estoque_carregado or any(int(r.get("el") or 0) > 0 for r in linhas)
    itens = [classificar(r, estoque) for r in linhas]
    itens.sort(key=lambda x: (x["loja_num"] or 0, x["data"][6:10] + x["data"][3:5] + x["data"][0:2] + x["data"][11:], x["id"]))
    os.makedirs(a.saida, exist_ok=True)
    gerar_html(itens, os.path.join(a.saida, "relatorio_ajustes_estoque.html"), a.posicao, estoque)
    gerar_xlsx(itens, os.path.join(a.saida, "relatorio_ajustes_estoque.xlsx"), a.posicao)
    for k, v in resumo(itens):
        print(f"{k}: {v}")


if __name__ == "__main__":
    main()
