# Minerador Meta Ads — produtos escalando

Acha produtos que estão **escalando agora**: o **mesmo anunciante** com **40+ anúncios ativos do mesmo produto**,
criados nos **últimos 45 dias** (Biblioteca de Anúncios pública da Meta).

| Peça | Onde |
|---|---|
| Minerador (roda no PC, Python + Playwright) | `minerador_meta_ads.py` + `MINERADOR_META_RODAR.bat` |
| Painel no PC (abre no navegador, mostra a mineração ao vivo) | gerado em `painel_minerador.html` a partir de `painel_template.html` |
| Relatório PDF com foto, link do anúncio, do anunciante e da loja | gerado em `relatorio_minerador.pdf` |
| App de celular (PWA) | `index.html` (gerado por `python gerar_pwa.py`), publicado pelo Vercel em `/minerador/` |
| API do app | edge function `minerador-api` no Supabase **Mapa da mima** (`tazyeczbbgspqbyluynf`) |
| Banco | schema `minerador` (migração em `supabase/migrations`) + bucket público `minerador-fotos` |

## Como funciona
1. **Descoberta**: busca cada palavra-chave (ou cada **dor**: `--dores`, ou **sem palavra-chave**: `--geral`) e separa os
   anunciantes que estão subindo anúncios novos.
2. **Contagem real**: abre a página de cada anunciante na Biblioteca e lê os anúncios ativos (dados estruturados da Meta:
   data de início, cópias do criativo, link do produto).
3. Agrupa por **produto** (link da loja) e conta os anúncios novos (≤ 45 dias). Aba **ESCALANDO** = 40+.
4. Gera planilha, painel, relatório PDF e envia o resultado + andamento ao vivo para o app do celular.

## Chave de acesso
O PC lê a chave em `minerador_chave.txt` (fora do git). No celular, a chave é digitada uma vez (ou aberta pelo link
`.../minerador/#chave=...`) e fica salva no aparelho. O banco guarda só o hash.

## Opções
`--teste`, `--keyword "x" --pais US`, `--dores`, `--geral`, `--min-anuncios 40`, `--max-dias 45`,
`--max-anunciantes 40`, `--headless`, `--json arquivo.json`, `--refazer arquivo.json [--tipo-nuvem palavra-chave]`.
