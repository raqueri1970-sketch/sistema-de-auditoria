# RL TRANSPORTES - Leitor local de comprovantes em PDF (reserva quando a IA Gemini falha
# ou a cota gratuita acaba). Le o TEXTO do PDF (sem IA, sem custo) e reconhece os
# comprovantes do banco Cora (PIX e pagamento de boleto/guia).
# Uso: python leitor_pdf.py arquivo.pdf  -> imprime JSON no mesmo formato da IA.
# Sai com codigo 1 (sem saida) se nao reconhecer o documento.
import sys, re, json
from pypdf import PdfReader

PLACA = re.compile(r'\b([A-Z]{3})[-\s]?(\d[A-Z]\d{2}|\d{4})\b')

def brl(s): return float(s.replace('.', '').replace(',', '.'))
def iso(d, m, a): return f'{a}-{m}-{d}'
def placa_de(t):
    m = PLACA.search((t or '').upper())
    return f'{m.group(1)}-{m.group(2)}' if m else None

def ler(caminho):
    t = re.sub(r'\s+', ' ', ' '.join((p.extract_text() or '') for p in PdfReader(caminho).pages))
    m = re.search(r'Comprovante de Pix.*?Valor R\$ ([\d.]+,\d{2}) Transfer[eê]ncia realizada (\d{2})/(\d{2})/(\d{4}) (\d{2}:\d{2}:\d{2}) '
                  r'De (.+?) CNPJ.*? Para (.+?) (?:Chave: \S+ )?Banco (.+?) (?:Descri[cç][aã]o (.+?) )?ID da transa[cç][aã]o (\S+) '
                  r'Autentica[cç][aã]o Cora (\S+)', t)
    if m:
        valor, d, mo, a, hora, de, para, banco, descr, idtx, aut = m.groups()
        descr = (descr or '').strip() or None
        return {'valor': brl(valor), 'data': iso(d, mo, a), 'hora': hora, 'fornecedor': para.strip(), 'servico': descr,
                'placa': placa_de(descr), 'nf': None, 'cnpj': None, 'banco': banco.strip(), 'pix': None,
                'tipo_doc': 'comprovante_pix', 'descricao': descr or para.strip(), 'confianca': 0.95, 'is_orcamento': False,
                'autenticacao': aut, 'pagador': de.strip(), 'fonte': 'leitor_pdf local (sem IA)'}
    m = re.search(r'Comprovante de pagamento Valor R\$ ([\d.]+,\d{2}) Pagamento realizado (\d{2})/(\d{2})/(\d{4}) (\d{2}:\d{2}:\d{2}) '
                  r'De (.+?) CNPJ.*? Favorecido (.+?) C[oó]digo d[oe] (?:boleto|barras) .*?Autentica[cç][aã]o Cora (\S+)', t)
    if m:
        valor, d, mo, a, hora, de, fav, aut = m.groups()
        return {'valor': brl(valor), 'data': iso(d, mo, a), 'hora': hora, 'fornecedor': fav.strip(), 'servico': None,
                'placa': None, 'nf': None, 'cnpj': None, 'banco': 'Cora', 'pix': None, 'tipo_doc': 'comprovante_boleto',
                'descricao': fav.strip(), 'confianca': 0.95, 'is_orcamento': False, 'autenticacao': aut,
                'pagador': de.strip(), 'fonte': 'leitor_pdf local (sem IA)'}
    return None

if __name__ == '__main__':
    try: r = ler(sys.argv[1])
    except Exception: r = None
    if not r: sys.exit(1)
    print(json.dumps(r, ensure_ascii=False))
