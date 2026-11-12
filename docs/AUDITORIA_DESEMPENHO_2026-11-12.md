# Auditoria de desempenho do Portal Esposende — 12/11/2026

Pedido: "o carregamento está muito mais lento em quase todos os módulos; auditar, melhorar e ver se tem lixo sobrecarregando".

O Portal que abre no navegador vem do repositório **portal-esposende-login**: a página de login baixa
o arquivo `PORTAL_ESPOSENDE_V4_AUTH.html` do Supabase Storage (≈13 MB, com todos os módulos em base64)
e injeta ~20 patches `*-patch.js`. As correções estão em
[`desempenho-portal-esposende-login.patch`](desempenho-portal-esposende-login.patch) (um commit pronto
para aplicar naquele repositório com `git am`).

## Resultado medido

Chromium (Playwright), arquivo do Portal de 12,8 MB (o `index.html` deste repositório), "Storage" a 20 Mbit/s,
Supabase simulado. CPU = tempo de CPU da página com o Portal parado, sem ninguém mexer.

| Cenário | Antes | Depois |
|---|---|---|
| Reabrir / recarregar o Portal (F5, novo login no mesmo PC) | 7,5 s | **0,8 s** |
| Primeiro login (arquivo ainda não guardado) | 7,6 s | **6,0 s** |
| Downloads do arquivo de 13 MB em 2 aberturas | 2 | **1** |
| CPU parado na Visão Geral (Almoxarifado aberto em segundo plano) | 7,3 % | **1,8 %** |
| CPU parado com o Almoxarifado na tela | 7,5 % | **4,7 %** |
| CPU parado com 8 módulos já abertos | 13,6 % | **4,4 %** |

Num PC de loja/escritório os percentuais de CPU são de 2 a 4 vezes maiores; o ganho proporcional é o mesmo.

## O que pesava (e por quê)

### 1. O arquivo de 13 MB era baixado do zero a cada abertura
`openPortal()` cria um link assinado novo a cada login/recarga. Como o endereço muda toda vez, o
navegador nunca reaproveitava o download.
**Correção:** cópia local (IndexedDB) guardada junto com a versão do objeto no Storage
(eTag + data + tamanho). Na abertura só se consulta a versão (poucos bytes). Arquivo mudou → baixa de
novo. Consulta falhou → baixa como antes. Sair do Portal ou acesso negado apagam a cópia.

### 2. A montagem do HTML copiava os 13 MB umas 20 vezes (≈2 s de CPU)
Cada patch era inserido com `html.toLowerCase().lastIndexOf('</body>')` + `slice` — o arquivo inteiro
convertido e copiado a cada inserção.
**Correção:** todas as inserções são juntadas e aplicadas de uma vez.

### 3. Lixo: pré-carga da Central quebrada em produção
`ORC_UNIFIED_PATCH` e `ALMOX_MINIMO_PATCH` eram inseridos no **primeiro** `</body>` do arquivo. Depois
que a cópia da Central (`__ORC_UNIFIED_HTML`, 110 KB) é posta no `<head>`, o primeiro `</body>` passa a
ser um que está **dentro do texto da Central**. Efeito, confirmado no navegador:
- o script `window.__ORC_UNIFIED_HTML=...` dá erro de sintaxe a cada login;
- o `ORC_UNIFIED_PATCH` nunca roda (`abrirCentralCompras` fica indefinida);
- sobra um texto solto `\n";` no topo da página.

A Central de Compras sempre abriu pela ponte da página de login (`abrirCentralUnicaExterna` +
`__ORC_PAGE_HTML`), que continua igual. **Correção:** os 110 KB e o patch morto deixam de ser
injetados — o comportamento visível fica idêntico, sem o erro e sem o texto solto. O `ALMOX_MINIMO_PATCH`
continua rodando como hoje.

### 4. Vigias que varriam todos os módulos abertos para sempre
O Portal tem ~30 rotinas `setInterval` (0,5 s a 1,8 s) e 7 observadores de DOM. As piores:

| Patch | Problema | Correção |
|---|---|---|
| `crediario-patch.js`, `auditoria-despesas-patch.js` | Procuravam o card "Descontos de Funcionários" (que só existe na Visão Geral) **dentro de cada módulo aberto**, lendo o texto de todos os elementos, a cada 1,2 s. Nunca acham, então repetem para sempre. Quanto mais módulos abertos, pior. | Só no documento do Portal. |
| `protocolo-graficos.js` | Busca XPath em todos os elementos de todos os módulos a cada 1,5 s. | Só em documentos visíveis. |
| Patch do Almoxarifado no login (`ALMOX_MINIMO_PATCH`) | A cada 1 s **e** a cada mudança no Portal: percorria todas as requisições e o DOM inteiro do módulo (`querySelectorAll('*')` + texto), mesmo com outro módulo na tela. Recalculava cards que o painel novo já esconde. | Só com o Almoxarifado na tela; não mexe nos cards ocultos; mudanças agrupadas (300 ms). |
| `almox-painel-patch.js` | Somava todas as bases e, sem achar os cards, varria o texto do módulo a cada 1,5 s, aberto ou não. | Só com o módulo na tela. |
| `almox-consumo-item-patch.js` | Percorria consumo/estoque a cada 1,5 s; observador sem intervalo. | Só com o módulo na tela; observador agrupado. |
| `faltas-atrasos-patch.js` (novo em 10/11) | A cada mudança no Portal, varredura recursiva de todos os iframes. | Agrupado (no máx. 1 a cada 400 ms). |
| Demais (`obras`, `rl`, `compras`, `gastos`, `relatório`, `estado`, `atualizações`, `consumo loja`) | Rodavam com a aba do navegador em segundo plano. | Pausam com a aba em segundo plano. |

Todos os patches alterados ganharam `?v=20261112-desempenho` para o navegador não usar a versão antiga.

## Testes feitos
- Login simulado ponta a ponta (página real de login, Supabase falso): mesmos 16 patches carregados,
  sessão injetada, patch do Almoxarifado presente, Central externa pré-carregada — antes e depois.
- Cache: arquivo alterado no Storage → baixa de novo; consulta de versão negada → baixa como antes.
- Sintaxe de todos os scripts e dos patches inline.
- Perfil de CPU (Chrome DevTools Protocol): as funções dos patches somem do topo do perfil.

## Pontos estruturais (não alterados — exigem decisão)
1. **Dados embutidos nos módulos** (vão junto nos 13 MB, em todo login):
   - RH (`rh`): `RH_DATA` de 5,1 MB, gerado em 30/07/2026 (competência 06/26). É a fonte principal do
     módulo — não pode só ser apagado; o ideal é mover para o Supabase e carregar sob demanda.
   - SGDF (`sgdf`): ~1,8 MB (`DB_CONTAS`, `DB_EST`, `DB_NFD`, `DB_EC_NFS`).
   - Compras (`desc`) 220 KB, NF-e (`nf`) 205 KB de registros; logos em base64 repetidas em 5 módulos.
   Juntos, ~70 % do arquivo do Portal.
2. **Base64**: os módulos ficam ~33 % maiores em base64. Trocar o formato exige ajustar
   `meias-modulo-patch.js`, `compras-diretoria-patch.js` e `upload-correcoes.js`, que leem `MENC` em base64.
3. **Muitos patches por varredura**: o caminho certo a médio prazo é aplicar os patches ao arquivo do
   Storage (uma versão nova do Portal) em vez de corrigir a tela a cada segundo.
4. Lixo no repositório que **não** pesa no carregamento (não é baixado ao abrir): `backup/` (296 KB),
   `curso/` (5,9 MB) no portal-esposende-login; `.github/workflows` de uso único já executados.
