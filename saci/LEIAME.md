# Casamento de Saci — Saci na Rede (conta oficial)

    Pé Direito + Pé Esquerdo + Enviados 2026 = Saci na Rede
    Casados = pares já resolvidos (histórico) — não sai da conta

D1.xlsx de 17/11/2026: 5.753 + 5.276 + 8.487 = **19.516** pés a casar. Casados (histórico, fora da conta): 10.217 pares = 20.434 pés.

| Arquivo | O que é |
|---|---|
| `resumo-saci.js` | Cálculo (abas pelo nome, ignora a linha "Total" do rodapé, regras de custo/venda de cada aba). Roda no navegador e no Node. |
| `saci-rede-patch.fonte.js` | Molde do patch do módulo (bloco da conta, cartões do Resumo Geral, Excel, sincroniza em `portal_sync` / `saci_rede`). |
| `gerar_patch.js` | `node saci/gerar_patch.js D1.xlsx VERSAO [DATA_ISO]` → gera `../saci-rede-patch.js` com a base embutida. |
| `embutir_no_index.js` | `node saci/embutir_no_index.js` → coloca o patch dentro do módulo Saci do `index.html` deste repositório. |

## Publicar no Portal (portal-esposende-login)
1. Copiar `saci-rede-patch.js` para a raiz do repositório do Portal.
2. No `index.html` do Portal, junto dos outros patches:
   `html=inserirAntesDoFimDoBody(html,'<scr'+'ipt src="'+new URL('saci-rede-patch.js?v=20261119-1',location.href).href+'"></scr'+'ipt>');`

Depois disso, um D1.xlsx novo carregado no módulo (botão "Atualizar com novo D1.xlsx" ou o upload normal) refaz a conta para todos os usuários.

## 19/11/2026 — Conferência (leitor de código de barras) dizia "Carregue o D1" com o D1 na nuvem
O módulo grava `saci_d1_synced_at = agora` antes de saber se a nuvem aceitou o envio. Com perfil que só lê
(colaborador → 403) e o D1 grande demais para o localStorage, no próximo F5 o módulo achava a cópia local
"mais nova" que a nuvem, não baixava o D1 e a conferência ficava vazia. O patch 20261119-1 (`corrigirSyncD1`)
só grava a marca quando a nuvem aceita, ignora a marca quando o D1 da tela está vazio e refaz a busca.
Testado com o código real do módulo (cópia do Portal de 13/10): sem a correção → aviso; com a correção → D1 carregado.
