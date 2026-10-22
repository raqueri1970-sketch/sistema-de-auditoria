# 2a passada (D90): páginas escaneadas sem texto. Lê os NAO_ACHOU de log_fotos_banco.txt, faz OCR (rapidocr_onnxruntime)
# e só envia se o ID do pagamento aparecer na página. Uso: python enviar_fotos_banco_ocr.py <codigo>
import sys, base64, re, fitz, requests
from rapidocr_onnxruntime import RapidOCR
URL = 'https://rdztzurfesnobfkazgpm.supabase.co/functions/v1/fin-evidencias-banco'
tok = sys.argv[1]; ocr = RapidOCR()
limpa = lambda t: re.sub(r'[^0-9A-Z]', '', (t or '').upper()).replace('O', '0')
jobs = [l.rstrip('\n').split('\t')[1:] for l in open('log_fotos_banco.txt', encoding='utf-8') if l.startswith('NAO_ACHOU')]
print('pendentes', len(jobs), flush=True)
ok = falha = 0; docs = {}; log = open('log_fotos_banco_ocr.txt', 'w', encoding='utf-8')
for dup, lado, arq, pag, idp in jobs:
    dup, pag = int(dup), int(pag)
    try:
        if arq not in docs: docs[arq] = fitz.open(arq)
        d = docs[arq]; achou = None
        for idx in (pag - 1, pag, pag - 2):
            if not 0 <= idx < d.page_count or not idp: continue
            res, _ = ocr(d[idx].get_pixmap(dpi=200).tobytes('png'))
            if limpa(idp) in limpa(' '.join(r[1] for r in (res or []))):
                achou = idx; break
        if achou is None:
            falha += 1; log.write(f'NAO_ACHOU\t{dup}\t{lado}\t{arq}\t{pag}\t{idp}\n'); log.flush(); continue
        img = d[achou].get_pixmap(dpi=130).tobytes('jpeg', jpg_quality=80)
        r = requests.post(URL, json={'token': tok, 'dup': dup, 'lado': lado, 'pagina': achou + 1,
                                     'imagem': base64.b64encode(img).decode()}, timeout=90)
        if r.ok: ok += 1; log.write(f'OK\t{dup}\t{lado}\t{achou + 1}\n')
        else: falha += 1; log.write(f'ERRO\t{dup}\t{lado}\t{arq}\t{pag}\t{r.status_code} {r.text[:200]}\n')
    except Exception as e:
        falha += 1; log.write(f'EXC\t{dup}\t{lado}\t{arq}\t{pag}\t{e}\n')
    log.flush()
print(f'FIM ok={ok} falha={falha}', flush=True)
