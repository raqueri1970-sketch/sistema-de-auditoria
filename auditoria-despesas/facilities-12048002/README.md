# Auditoria – Despesas Facilities #12048002 (Recebimento 16/11/2026)

Solicitante: Luiz Roberto de Souza Martins · 33 despesas · R$ 7.598,92 · documentos de 29/10 a 05/11/2026.
Os 33 comprovantes do PDF foram lidos um a um (valor, data/hora, local, placa, litros, forma de pagamento, CPF do consumidor).

## Resultado
| | Valor |
|---|---|
| Total do relatório | R$ 7.598,92 |
| Reter até comprovação (5 itens) | R$ 5.557,90 |
| Liberável após correções (+R$ 10 Expresso) | R$ 2.051,02 |
| Combustível sem deslocamento comprovado (7 km/L, +20%) | R$ 228,02 (≈ 35 L) |
| Cupom duplicado | #94603313 = #94600458 (NFC-e 183116) |

Itens retidos: PJ R$ 4.800 pago como reembolso (#94602375), caixa d'água com NF em CPF de terceiro (#94598788),
cafeteira como "manutenção de móveis" (#94598636), etanol com cartão pré-pago sem placa (#94598330), compra sem descrição na Shapcell (#94600530).

## Arquivos
- `Auditoria_Despesas_Facilities_12048002.xlsx` – 11 abas: resumo, 33 despesas auditadas, por conta, por segmento, achados, combustível,
  CD × lojas (69 lojas, km reais, litros a 7 km/L, custo e teto +20%), rotas regionais, linha do tempo, médias e plano de redução.
- `scripts/` – reprodução: `dados.py` (base lida dos cupons), `geo.py` + `route.py` (geocodificação e distâncias OSRM a partir do CD),
  `calc.py` (agregados, coerência do combustível, circuitos), `xlsx.py` (planilha).

```bash
python3 scripts/geo.py Enderecos_Lojas.xlsx geo.json && python3 scripts/route.py geo.json routes.json
python3 scripts/calc.py routes.json calc.json && python3 scripts/xlsx.py calc.json saida.xlsx
```

Premissas: 7 km/L, margem 20%, preços médios dos próprios cupons (gasolina 6,858 · diesel 6,938 · etanol 4,75 R$/L),
CD na Av. da Recuperação 6485, Guabiraba. Achados são indícios a esclarecer, não conclusões de fraude.
