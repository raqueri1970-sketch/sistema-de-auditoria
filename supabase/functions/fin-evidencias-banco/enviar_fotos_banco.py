# Roda no D90 (acesso ao S:\). Renderiza a pagina do PDF do banco de cada pagamento das duplicidades e envia para
# fin-evidencias-banco. So envia a pagina se o ID do pagamento (ou o valor) aparecer no texto dela.
# Uso: python enviar_fotos_banco.py <codigo>  (codigo temporario: insira o sha256 dele em fin_envio_token com validade)
import sys, base64, re, fitz, requests
URL = 'https://rdztzurfesnobfkazgpm.supabase.co/functions/v1/fin-evidencias-banco'
tok = sys.argv[1]
r = requests.post(URL, json={'token': tok, 'acao': 'pendentes'}, timeout=120); r.raise_for_status()
jobs = r.json()['lista']
print('pendentes', len(jobs), flush=True)
limpa = lambda t: re.sub(r'[\s.\-/]', '', t or '').upper()
def valor_br(v):
    return f'{float(v):,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
ok = falha = 0; docs = {}; log = open('log_fotos_banco.txt', 'w', encoding='utf-8')
for n, (dup, lado, arq, pag, idp, valor) in enumerate(jobs, 1):
    try:
        if arq not in docs: docs[arq] = fitz.open(arq)
        d = docs[arq]; achou = None
        for idx in (pag - 1, pag, pag - 2):  # pagina gravada 1-based; tolera +-1
            if not 0 <= idx < d.page_count: continue
            t = d[idx].get_text()
            if (idp and limpa(idp) in limpa(t)) or (not idp and valor != '' and valor_br(valor) in t):
                achou = idx; break
        if achou is None:
            falha += 1; log.write(f'NAO_ACHOU\t{dup}\t{lado}\t{arq}\t{pag}\t{idp}\n'); continue
        img = d[achou].get_pixmap(dpi=130).tobytes('jpeg', jpg_quality=80)
        r = requests.post(URL, json={'token': tok, 'dup': dup, 'lado': lado, 'pagina': achou + 1,
                                     'imagem': base64.b64encode(img).decode()}, timeout=90)
        if r.ok: ok += 1; log.write(f'OK\t{dup}\t{lado}\t{achou + 1}\n')
        else: falha += 1; log.write(f'ERRO\t{dup}\t{lado}\t{arq}\t{pag}\t{r.status_code} {r.text[:200]}\n')
    except Exception as e:
        falha += 1; log.write(f'EXC\t{dup}\t{lado}\t{arq}\t{pag}\t{e}\n')
    log.flush()
    if n % 25 == 0: print(n, 'ok', ok, 'falha', falha, flush=True)
print(f'FIM ok={ok} falha={falha}', flush=True)
