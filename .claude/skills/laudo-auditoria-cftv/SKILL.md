---
name: laudo-auditoria-cftv
description: Gera laudo técnico de auditoria a partir de vídeos de CFTV (furto, desvio, apropriação de mercadoria/brinde, conduta de colaborador) — analisa os vídeos quadro a quadro, extrai fotos com marcação e ampliação, monta cronologia pelo relógio do DVR, calcula SHA-256 dos arquivos e entrega PDF profissional com logomarca Esposende e assinatura do Auditor Ricardo. Use quando o usuário enviar vídeos de câmera e pedir laudo, dossiê, parecer ou relatório de auditoria sobre uma ocorrência.
---

# Laudo de Auditoria — Análise de Imagens de CFTV

Produz um **Laudo Técnico de Análise de Imagens de CFTV** em PDF A4 (Esposende Calçados), no padrão já aprovado pelo usuário:
cabeçalho com logomarca em todas as páginas, quadro-resumo, objeto, contexto, material examinado (com SHA-256),
síntese cronológica, registro fotográfico (quadro original marcado + ampliação + descrição), análise, conclusão
e assinatura única da Auditoria. **Sem seção de providências/recomendações.**

## Arquivos

| Arquivo | Função |
|---|---|
| `scripts/contato.sh` | Folha de contato do vídeo (1 quadro/s com tempo carimbado) para a primeira leitura |
| `scripts/zoom_seq.sh` | Sequência ampliada de uma área em vários instantes (mãos, bolsos, balcão) |
| `scripts/quadro.sh` | Evidência final: quadro com retângulo vermelho + ampliação da área |
| `scripts/gerar_laudo.js` | JSON → PDF (Playwright/Chromium já instalados) |
| `exemplo-laudo.json` | Estrutura completa do JSON (nomes fictícios) |
| `assets/logo.jpg` | Logomarca Esposende (cabeçalho de todas as páginas) |
| `assets/assinatura-auditoria.png` | Assinatura da Auditoria (mesma do certificado do módulo de cursos). **Não é versionada** (`.gitignore`): o `gerar_laudo.js` baixa automaticamente de `portal-esposende-login/curso/cert/` na primeira execução |

## Fluxo

### 1. Coletar os fatos com o usuário
Antes de analisar, tenha claro (pergunte só o que faltar):
- O que ocorreu e como foi percebido (ex.: brinde faltou na venda → vitrine vazia → buscaram as imagens).
- Nome e função do colaborador; item envolvido; onde o item fica guardado e qual era a instrução recebida.
- Data do laudo (a data dos fatos sai do relógio do DVR nas imagens) e quem assina (padrão: **Auditor – Ricardo**).
- O que **não** deve aparecer no texto (ex.: o usuário pode informar que o laudo será usado em processo — use isso só como
  contexto para o rigor; **não mencione processo, audiência ou ação judicial no laudo**).

### 2. Ler os vídeos
Trabalhe numa pasta de rascunho (scratchpad), nunca dentro do repositório.
```bash
ffprobe -v error -show_entries format=duration:stream=width,height,r_frame_rate -of compact VIDEO.mp4
bash scripts/contato.sh VIDEO.mp4 contato.jpg 1 8
sha256sum VIDEO1.mp4 VIDEO2.mp4 ...
```
- Leia a folha de contato com a ferramenta Read. Identifique câmera (ex.: "CAM 7") e a pessoa em cada trecho.
- **Relógio do DVR**: extraia um quadro inteiro (`ffmpeg -ss T -i V -frames:v 1 f.jpg`) e leia data/hora no canto.
  Calcule o deslocamento `hora_DVR = início + t` e use **sempre o horário do DVR** no laudo, nunca o tempo do arquivo.
- Para movimentos finos, use `zoom_seq.sh` com passos de 0,3–0,5 s na área de interesse.
- Confirme a identidade do colaborador cruzando os vídeos (roupa, calvície, óculos, crachá) antes de atribuir ações.

### 3. Escolher as evidências (6 a 10 fotos)
Uma foto por fato relevante, na ordem: recebimento/pegada → deslocamento → ponto onde deveria ter feito algo →
retorno → manipulação/ocultação → mãos vazias → momentos posteriores. Para cada uma:
```bash
bash scripts/quadro.sh VIDEO.mp4 25.5 700 150 500 380 ev/f1
```
Coordenadas na resolução original. Verifique cada `_zoom.jpg` com Read: a pessoa deve estar inteira e centrada.

### 4. Montar o JSON e gerar
Copie `exemplo-laudo.json`, preencha e rode:
```bash
node scripts/gerar_laudo.js /caminho/laudo.json /caminho/LAUDO_CFTV_<CASO>.pdf
pdftoppm -r 45 -png LAUDO.pdf pg   # conferir todas as páginas com Read
```
Campos de texto aceitam `**negrito**`. Imagens são relativas à pasta do JSON.
Confira: cabeçalho não sobrepõe o texto, nenhum título órfão no fim da página, conclusão + assinatura juntas.

### 5. Entregar
- Envie o PDF com `SendUserFile` (display `attach`) e informe o caminho completo.
- **Não** faça commit do laudo, das fotos nem dos vídeos: o repositório `sistema-de-auditoria` é **público** e o laudo
  contém nome de colaborador e imputação. Se o usuário pedir para versionar, avise e só faça em repositório privado.

## Regras de redação (laudo técnico)

- Tom impessoal, técnico, frases curtas; verbos no presente para descrever imagens ("o colaborador afasta-se…").
- Cada afirmação deve corresponder ao que **é visível** no quadro citado. O que a resolução não permite ver
  (ex.: a carteira entrando no bolso) escreva como **"movimento compatível com…"**; a conclusão se apoia na
  **sequência** dos fatos (recebeu → não expôs → retornou com o item → item some das mãos → não devolvido → não localizado).
- Nomeie o item pelo nome (ex.: "carteira") quando o usuário pedir; avise se nas fotos posteriores o item não é
  identificável, oferecendo "a carteira recebida no caixa" como alternativa mais defensável.
- Conclusão em caixa destacada, termo técnico neutro: "retirada indevida" / "apropriação indevida de bem da empresa".
  Evite "furto/crime" (tipificação penal não cabe à auditoria) salvo pedido expresso.
- Sem providências, recomendações, campo de testemunhas ou segunda assinatura — apenas a da Auditoria.
- Fechamento padrão: "Laudo finalizado e assinado em **DD/MM/AAAA**, referente aos fatos ocorridos em **DD/MM/AAAA**,
  conforme data registrada nas imagens do CFTV."
- Não inclua e-mail, CPF ou outros dados pessoais além de nome e função do colaborador.
