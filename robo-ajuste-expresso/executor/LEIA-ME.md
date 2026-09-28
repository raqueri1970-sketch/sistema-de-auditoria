# Executor Ajuste Expresso (Seta)

Robô que lança **ENTRADA de estoque** no Seta quando um gerente pede pelo link do celular.
**Só faz ENTRADA (finalidade VENDA), quantidade maior que zero.** Saída, transferência, inventário etc. são bloqueados em 3 camadas (Portal/banco, Sentinela e o próprio Executor).

```
Gerente (celular) → Supabase (fila) → Executor (este PC) → Seta → confere o estoque depois → Portal (auditoria)
```

## Requisitos do computador

- Windows 10/11 **ligado 24 h**, com o usuário logado, **tela desbloqueada** (não pode dormir, nem bloquear).
- **Seta aberto e logado** (o robô nunca digita senha), na **tela principal** (monitor 1).
- Python 3.11+ de 64 bits (python.org, marcar “Add python.exe to PATH”).
- Idioma **Português (Brasil) com “Reconhecimento óptico”** instalado (o robô lê a tela com o OCR do Windows).
- Internet.

## Instalar em um computador novo (10 minutos)

1. **Copie a pasta inteira** (ou descompacte o `AJUSTE_EXPRESS_PACOTE.zip`) para, por exemplo, `C:\AJUSTE_EXPRESS_EXECUTOR`.
2. **`INSTALAR.bat`** — instala as bibliotecas e já roda o diagnóstico.
3. No **Portal Esposende → Acerto de Estoque Lojas → 🔐 Segurança → Executores**: digite o nome do computador e clique **Gerar token**. Copie o token (aparece **uma vez**).
4. **`CONFIGURAR.bat`** — cole o token. Ele valida no Portal antes de gravar o `config.json`.
5. **`DIAGNOSTICO.bat`** — tudo precisa estar **OK**. Se o Seta aparecer maior/menor, ele sugere o valor de `"escala"` para o `config.json`.
6. **`TESTAR_COM_SETA.bat`** — bateria real no Seta (**não lança estoque**). Precisa terminar `TUDO OK`.
7. **`INICIAR.bat`** — o robô roda em segundo plano. Confira no Portal (Executores → bolinha verde **ONLINE**).
8. (Opcional) **`INICIO_AUTOMATICO_ATIVAR.bat`** — inicia sozinho depois de ligar/logar no Windows.

> Cada computador usa **seu próprio token**. Para desativar um computador antigo: Portal → Segurança → Executores → Desativar.

## Dia a dia

| Quero… | Faça |
|---|---|
| Ver se está funcionando | Portal → Segurança → Executores (ONLINE) ou `STATUS.bat` |
| Parar o robô | `PARAR.bat` (termina o pedido atual e encerra) |
| Ver o que aconteceu | `executor.log` (uma linha por etapa) e Portal → Ajustes → detalhes |
| Testar depois de atualizar o Seta | `TESTAR_COM_SETA.bat` |

## O que o robô faz em cada pedido (≈ 30 a 60 s)

1. Confere que o Seta está aberto, com a tela liberada. Se não estiver, **não pega o pedido** (ele fica na fila) e o Portal mostra o motivo.
2. Vai à loja pedida: Sair → F5 → número da loja → **Ok** → fecha avisos fiscais → Retaguarda.
3. Estoque → Acerto do Estoque → código do produto (**confere depois do Enter**) → lê o estoque atual.
4. Digita a quantidade e **confere que Novo Estoque = atual + quantidade**. Escreve a observação.
5. Acertar Estoque → “Confirma?” → **segunda conferência** → **Sim** (grava no diário *antes* de clicar).
6. Recarrega o produto e **prova** que o estoque subiu exatamente a quantidade. Só então marca CONCLUÍDO.

## Segurança contra ajuste duplicado

- Antes de clicar em **Sim** o robô grava `COMMIT_CLICADO` no `journal.json`. Se o computador cair depois disso, ao voltar ele **nunca repete**: o pedido vai para **DIVERGÊNCIA** e a auditoria confere no Seta (Portal → Detalhes → “Conferi no Seta: foi executado”).
- Falhas *antes* do Sim (tela não abriu, tempo esgotado…) são refeitas automaticamente até 3 vezes, sem efeito no estoque.
- Se a internet cair no fim, o resultado fica guardado e é enviado quando voltar.

## Problemas comuns

| Portal mostra | Significa | O que fazer |
|---|---|---|
| `SETA_FECHADO` | Seta não está aberto/logado | Abrir o Seta e logar |
| `TELA_BLOQUEADA` | Windows bloqueado/RDP desconectado | Desbloquear; desativar bloqueio automático |
| `SETA_TRAVADO` | Seta não responde | Reiniciar o Seta |
| Executor OFFLINE | Sem internet ou robô parado | `INICIAR.bat` / ver internet |
| Pedido `ERRO` “produto não encontrado” | Código digitado não existe no Seta | Gerente refaz o pedido com o código certo |
| Pedido `DIVERGÊNCIA` | Robô não teve certeza do resultado | Conferir o estoque no Seta e resolver pelo Portal |

## Arquivos

`executor.py` (robô) · `sentinela.py` (regras de segurança) · `seta_vision.py` (leitura da tela) · `supervisor.py` (reinicia o robô se cair) · `diagnostico.py` · `configurar.py` · `testes.py` · `config.json` (token — **não copie para outro PC**) · `journal.json` (diário de ajustes — **não copie**).

**Nunca compartilhe o `config.json`** (contém o token deste computador). O pacote `.zip` gerado por `gerar_pacote.py` já sai sem ele.
