# Skills e agentes do Portal Executivo Esposende

Carregados automaticamente em toda sessão do Claude Code aberta neste repositório.
Plugins (superpowers, mattpocock-skills) são baixados do GitHub oficial via `.claude/settings.json`.

## Agentes (`.claude/agents/`)
| Agente | Uso |
|---|---|
| `programador` | Analisa código, corrige bugs, roda testes |
| `auditor-master` | Inconsistências e cruzamentos entre módulos |
| `dados` | Integridade e qualidade das tabelas do Supabase |
| `sentinela` | Falhas, robôs parados, anomalias, site fora do ar |
| `automacao` | Fluxos para tarefas repetitivas |
| `criativos` | Roteiros, ganchos e CTAs para afiliados Shopee |

Todos são **somente leitura** em produção: nada é alterado, publicado ou executado no banco real sem aprovação.

## Skills por especialidade
| Especialidade | Skills |
|---|---|
| Desenvolvimento de software | `superpowers:*` (TDD, systematic-debugging, writing-plans, code review, verification-before-completion), `mattpocock-skills:*` (tdd, diagnosing-bugs, code-review, domain-modeling, prototype), `speckit-*` (especificação → plano → tarefas → implementação), `webapp-testing`, `frontend-design` |
| Auditoria financeira | agente `auditor-master` + `anthropic-skills:auditoria-nf-canceladas`, `anthropic-skills:comissao-meias` |
| Auditoria de estoque | agente `auditor-master` + `anthropic-skills:inconsistencia-remanejo` |
| Análise e cruzamento de dados | agente `dados` + `data:*` (sql-queries, validate-data, explore-data, statistical-analysis) |
| Automação de computadores | `agent-desktop`, `agent-desktop-windows`, `agent-desktop-linux`, `agent-desktop-macos` |
| Integrações com APIs | `mcp-builder`, `scrapling-official` |
| Memória e contexto | `productivity:memory-management`, `mattpocock-skills:handoff`, `claude-mem:*` (memória entre sessões, local) |
| Vídeos e criativos | agente `criativos` + MoneyPrinterTurbo, `canva:*`, `marketing:content-creation` |
| Pesquisa de produtos/concorrentes | `anthropic-skills:minerador-produtos`, `scrapling-official`, `marketing:competitive-brief` |

## Duplicidades resolvidas
- `pdf`, `docx`, `xlsx`, `pptx`, `canvas-design`, `skill-creator`, `claude-api` do repositório anthropics/skills **não** foram copiados: já vêm na conta (anthropic-skills).
- `code-review` e `tdd` existem em mais de um pacote; cada um tem prefixo próprio (`superpowers:`, `mattpocock-skills:`), sem conflito.

## Origem e licenças
| Pasta | Origem | Licença |
|---|---|---|
| webapp-testing, mcp-builder, frontend-design | github.com/anthropics/skills | Apache-2.0 (LICENSE.txt na pasta) |
| scrapling-official | github.com/D4Vinci/Scrapling | BSD-3-Clause |
| agent-desktop* | github.com/vercel-labs/agent-desktop | Apache-2.0 |
| speckit-* e `.specify/` | github.com/github/spec-kit (`specify init`) | MIT |

## Ferramentas de linha de comando (precisam ser instaladas na máquina)
```bash
uv tool install specify-cli --from git+https://github.com/github/spec-kit.git
uv tool install "scrapling[fetchers]"
npm install -g agent-desktop
```

## Instaladas fora do repositório (autorizadas em 08/11/2026)
| Ferramenta | Onde | Configuração |
|---|---|---|
| claude-mem 15.12.1 | plugin de usuário + worker local (porta 37700), dados em `~/.claude-mem` | Provedor = seu plano Anthropic (sem chave extra), sincronização na nuvem OFF, telemetria OFF |
| MoneyPrinterTurbo | `~/apps/MoneyPrinterTurbo` | Sem chaves: roteiro próprio + vídeo local + Edge TTS. Neste container de nuvem foi preciso confiar no certificado do proxy dentro do `certifi` do app |
| NVIDIA auto-ontology | `~/apps/auto-ontology` | Dependências instaladas e testes unitários ok. A stack (Docker + Postgres + web) só funciona com a chave `nvapi-` (build.nvidia.com) no `.env` |

```bash
npx claude-mem install --ide claude-code --provider claude --runtime worker
npx claude-mem telemetry disable
git clone https://github.com/harry0703/MoneyPrinterTurbo && cd MoneyPrinterTurbo && uv sync --frozen && cp config.example.toml config.toml
git clone https://github.com/NVIDIA/auto-ontology && cd auto-ontology && uv sync --frozen
```
