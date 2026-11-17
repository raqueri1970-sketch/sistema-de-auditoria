# Central de Auditoria RH — folhas multi-competência

O módulo "Central de Auditoria RH" fica embutido no `index.html` do portal (`MENC["rh"]`, HTML em base64).
Esta pasta guarda o código que foi injetado nele para carregar várias folhas mensais.

- **No portal:** Central de Auditoria RH → menu **Dados → 📥 Importar Folhas**. Arraste ou selecione
  vários `FOLHA MM-AAAA.xlsx` de uma vez. A leitura é feita no navegador; a folha importada fica salva
  naquele navegador (IndexedDB) e substitui a embutida da mesma competência.
- **Para todos os usuários (embutir no portal):**

  ```bash
  python3 rh-auditoria/ferramentas/gerar_base_folhas.py /tmp/base_folhas.b64 FOLHA_*.xlsx
  python3 rh-auditoria/ferramentas/embutir_no_portal.py index.html rh-auditoria/folhas.js /tmp/base_folhas.b64
  ```

  O segundo script é idempotente (troca os blocos marcados `<!--RHF:...-->`).

Regra de cálculo (igual à auditoria completa 06/2026): 2001 = bruto, 2002 = descontos,
2004 = salário contratual, líquido = 2001 − 2002. Base embutida atual: folhas 01/2026 a 10/2026.
