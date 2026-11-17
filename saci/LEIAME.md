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
   `html=inserirAntesDoFimDoBody(html,'<scr'+'ipt src="'+new URL('saci-rede-patch.js?v=20261117-1',location.href).href+'"></scr'+'ipt>');`

Depois disso, um D1.xlsx novo carregado no módulo (botão "Atualizar com novo D1.xlsx" ou o upload normal) refaz a conta para todos os usuários.
