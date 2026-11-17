# Central de Auditoria RH — folhas multi-competência

Código das telas **📥 Importar Folhas** e **🗓️ Folhas por Competência** (mais Histórico, Comparativo,
Anomalias e Previsões com a série de folhas) do módulo "Central de Auditoria RH".

- **Uso:** Central de Auditoria RH → **Dados → 📥 Importar Folhas**. Arraste ou selecione vários
  `FOLHA MM-AAAA.xlsx` de uma vez. A planilha é lida no navegador e o resumo por funcionário vai para
  a nuvem — todos os usuários com acesso de RH passam a ver.
- **Armazenamento:** Supabase, tabela `rh_folhas_competencias` (uma linha por competência; RLS
  `portal_pode('rh')`; CPF mascarado `•••.•••.XXX-YY#código`, mesmo formato do módulo Faltas e Atrasos).
  Migration: `supabase/migrations/20261117b_rh_folhas_competencias.sql`. Sem conexão/acesso, a folha fica
  pendente no navegador (IndexedDB) e é enviada na próxima abertura.
- **Regra:** 2001 = bruto, 2002 = descontos, 2004 = salário contratual, líquido = 2001 − 2002
  (igual à auditoria completa 06/2026).
- **Nenhum dado pessoal em arquivo público** (os repositórios e o GitHub Pages são públicos).

## Publicar
- Portal (`portal-esposende-login`, módulos no Storage → patch):
  `python3 rh-auditoria/ferramentas/gerar_patch_portal.py ../portal-esposende-login rh-auditoria/folhas.js AAAAMMDD-N`
  e atualizar o `?v=` do `rh-folhas-patch.js` no `index.html` do portal.
- Cópia do portal neste repositório (`index.html`, `MENC["rh"]`):
  `python3 rh-auditoria/ferramentas/embutir_no_portal.py index.html rh-auditoria/folhas.js` (idempotente).
