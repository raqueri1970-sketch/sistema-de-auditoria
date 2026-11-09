import json, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from dados import D
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
C=json.load(open(sys.argv[1])); OUT=sys.argv[2]
P=C['P']; RET={int(k):v for k,v in C['RET'].items()}
wb=Workbook()
H=PatternFill('solid',fgColor='1F3A5F'); HF=Font(bold=True,color='FFFFFF'); B=Font(bold=True)
RISK={'Alto':'F8D7DA','Médio':'FFF3CD','Baixo':'E2F0D9','OK':'E2F0D9'}
thin=Side(style='thin',color='C9D3DF'); BD=Border(left=thin,right=thin,top=thin,bottom=thin)
BRL='"R$" #,##0.00'
def sheet(title,headers,rows,widths,fmt={},first=False,note=None):
    ws=wb.active if first else wb.create_sheet()
    ws.title=title; r0=1
    if note:
        ws.cell(1,1,note).font=Font(italic=True,color='555555'); r0=3
    for j,h in enumerate(headers,1):
        c=ws.cell(r0,j,h); c.fill=H; c.font=HF; c.alignment=Alignment(wrap_text=True,vertical='center'); c.border=BD
    for i,row in enumerate(rows,r0+1):
        for j,v in enumerate(row,1):
            c=ws.cell(i,j,v); c.alignment=Alignment(wrap_text=True,vertical='top'); c.border=BD
            if j in fmt: c.number_format=fmt[j]
    for j,w in enumerate(widths,1): ws.column_dimensions[get_column_letter(j)].width=w
    ws.freeze_panes=ws.cell(r0+1,1); ws.auto_filter.ref=f"A{r0}:{get_column_letter(len(headers))}{r0+len(rows)}"
    return ws,r0
# 1 Resumo
tot=C['total']; ret=sum(d['v'] for d in D if d['id'] in RET)
ws=wb.active; ws.title='Resumo Executivo'
L=[('AUDITORIA DE DESPESAS – Relatório #12048002 "Despesas Facilities – RECEBIMENTO 16/11/2026"',None),
('Solicitante: Luiz Roberto de Souza Martins (Gerente de Facilities) · Centro de custo: Obras e Investimentos · Projeto: Obras | Lojas Novas',None),
('Aprovado por Anderson Nogueira (11:02) e Renato Denis da Silva Cabral (14:13) em 05/11/2026 · Período dos documentos: 29/10 a 05/11/2026',None),
('',None),
('Total do relatório (sistema)',tot),('Nº de despesas',len(D)),('Valor a RETER até comprovação (5 itens)',ret),('Valor liberável após correções',tot-ret+10),
('Correção a favor do colaborador (Expresso Refrigeração: lançado 58,00, cupom 68,00)',10.0),('Duplicidade identificada (mesmo cupom lançado 2x)','#94603313 = #94600458 (NFC-e 183116)'),
('Despesas SEM loja informada pelo colaborador',f"{sum(1 for d in D if not any(k in d['obs'].lower() for k in ('loja','natal')))} de {len(D)} (só 10 têm observação preenchida)"),
('Veículos diferentes no relatório','6 placas: FGQ-9128, GDR-6J38, EZS-1502, LMC-8J36, QYY-9C24, PVO-3386 (+1 sem placa no etanol)'),
('Abastecimentos com hodômetro informado','Nenhum dos 6 (onde o campo existe, aparece "Km anterior: 0")'),
('Combustível pago × teto pelos deslocamentos comprovados (+20%)',("R$ %s pago × R$ %s teto → R$ %s sem deslocamento comprovado (indicativo)" % tuple(f"{x:,.2f}".replace(',','X').replace('.',',').replace('X','.') for x in (C['coer']['v_pago'],C['coer']['R_teto'],C['coer']['dif_R'])))),
('Hotel / Refeição neste relatório','Nenhum lançamento — médias não calculáveis com este relatório'),
('',None),('Preço médio ponderado – Gasolina (R$/L)',P['Gasolina']),('Preço médio ponderado – Diesel (R$/L)',P['Diesel']),('Preço – Etanol (R$/L)',P['Etanol']),('Preço médio geral (R$/L)',P['Geral']),
('Premissas','7 km/L para todos os veículos, margem de 20%, distâncias rodoviárias reais (OpenStreetMap/OSRM) a partir do CD – Av. da Recuperação 6485, Guabiraba')]
for i,(a,b) in enumerate(L,1):
    ws.cell(i,1,a); 
    if b is not None:
        c=ws.cell(i,2,b)
        if isinstance(b,float): c.number_format=BRL if 'R$/L' not in a else '0.000'
        ws.cell(i,1).font=B
ws.cell(1,1).font=Font(bold=True,size=14,color='1F3A5F'); ws.column_dimensions['A'].width=80; ws.column_dimensions['B'].width=70
# 2 Despesas
rows=[]
for d in D:
    rows.append([d['id'],d['dl'],d['dd'],d['hd'],d['conta'],d['forn'],d['cid'],d['itens'],d['v'],d['vd'],d['pag'],d['placa'],d.get('litros'),d.get('pl'),d['loja'],d['seg'],d['risco'],d['ach'],d['acao'],RET.get(d['id'],'')])
ws,r0=sheet('Despesas Auditadas',['Despesa','Data lançada','Data no documento','Hora no documento','Conta (sistema)','Fornecedor','Cidade do documento','Itens / descrição lida no cupom','Valor sistema','Valor no cupom','Pagamento','Placa','Litros','R$/L','Loja destino','Segmento','Risco','Achado da auditoria','Ação recomendada','Motivo da retenção'],
 rows,[11,11,13,18,16,28,20,40,12,12,20,13,8,8,20,20,8,60,45,30],{9:BRL,10:BRL,13:'0.000',14:'0.00'})
for i,d in enumerate(D,r0+1): ws.cell(i,17).fill=PatternFill('solid',fgColor=RISK[d['risco']])
# 3 Por conta
rows=[]
for k,v in sorted(C['contas'].items(),key=lambda x:-x[1]['sis']):
    r=sum(d['v'] for d in D if d['conta']==k and d['id'] in RET)
    rows.append([k,v['qtd'],v['sis'],v['doc'],v['doc']-v['sis'],v['sis']/tot,r,v['sis']-r])
rows.append(['TOTAL',len(D),tot,sum(v['doc'] for v in C['contas'].values()),sum(v['doc']-v['sis'] for v in C['contas'].values()),1,ret,tot-ret])
ws,r0=sheet('Por Conta',['Conta contábil (sistema)','Qtd','Valor sistema','Valor nos cupons','Diferença','% do total','Retido p/ comprovação','Liberável'],rows,[30,6,14,14,12,10,16,14],{3:BRL,4:BRL,5:BRL,6:'0.0%',7:BRL,8:BRL},
 note='Obs.: a conta "Manutenção Predial" no cupom soma R$ 10 a mais (Expresso Refrigeração). O duplicado (#94603313) está com valor 0,00 no sistema, mas o cupom vale R$ 34,90.')
for c in ws[r0+len(rows)]: c.font=B
# 4 Por segmento
rows=[[k,v['qtd'],v['v'],v['v']/tot] for k,v in sorted(C['seg'].items(),key=lambda x:-x[1]['v'])]
rows.append(['TOTAL',len(D),tot,1])
ws,r0=sheet('Por Segmento',['Segmento operacional (reclassificado pela auditoria)','Qtd','Valor','% do total'],rows,[50,6,14,10],{3:BRL,4:'0.0%'},
 note='Reclassificação pelo conteúdo do cupom (não pela conta escolhida pelo colaborador). Sem a marcenaria (PJ R$ 4.800), o custo operacional da semana foi R$ 2.798,92.')
for c in ws[r0+len(rows)]: c.font=B
# 5 Achados priorizados
A=[('1','Alto','Pagamento de PJ (R$ 4.800) como reembolso pessoal','#94602375','63% do relatório; sem NF-e, contrato ou cotação; recibo autogerado e assinado pelo próprio solicitante; "04/04" indica 3 parcelas anteriores; CNPJ pagador diferente do das lojas.','Retirar do reembolso → Contas a Pagar com NF-e; levantar parcelas 01–03; conferir entrega dos 40 BRTs; 3 cotações.',4800),
('2','Alto',"Caixa d'água 1.000 L com NF em CPF de pessoa física e 'mercadoria entregue'",'#94598788','CPF 105.118.***-01 (João Lopes de Santos, Paulista). Sem loja de destino.','Reter; exigir foto instalada + loja + OS; identificar titular do CPF e endereço da entrega.',476),
('3','Alto','Comprovante duplicado aceito pelo sistema','#94603313 / #94600458','Mesmo NFC-e 183116 lançado 2 vezes (2º com valor 0,00 e data trocada para 05/11).','Excluir; bloquear chave NFC-e repetida; checar se o mesmo cupom não foi usado em outro relatório/colaborador.',0),
('4','Alto','Cafeteira classificada como manutenção, NF em CPF de terceiro','#94598636','Eletrodoméstico de copa, comprado em Abreu e Lima para loja em Jaboatão.','Reclassificar (Copa/Utensílios) com aprovação da Regional; confirmar entrega na loja 915.',169.9),
('5','Alto','Abastecimento pago com cartão PRÉ-PAGO, sem placa e sem loja no trajeto','#94598330','Se ***2315 for cartão corporativo, é reembolso em dobro. Pombos a 64 km do CD.','Identificar titular do cartão e veículo.',100),
('6','Alto','Despesa sem descrição em loja de celular','#94600530','"Manutenção de Móveis" em loja de acessórios de celular.','Reter até descrição.',12),
('7','Alto','Documentos informais (sem CNPJ) e com data divergente','#94600595, #94600474, #94602219','Borracharia sem emitente (29/10), NEM Pneus manuscrito, estacionamento mensal pago por PIX a pessoa física.','Exigir NF/CPF-CNPJ do prestador; despesas fixas via contrato.',270),
('8','Médio','0 de 6 abastecimentos com hodômetro; 6 placas diferentes; R$ 228 de combustível sem deslocamento comprovado','Combustível','Impossível validar consumo real; estimativa por deslocamentos comprovados aponta ~35 L acima do teto (+20%).','Cartão frota com hodômetro obrigatório e relatório por placa.',228.02),
('9','Médio','Compras fracionadas no varejo','Comercial Bezerra (6 cupons), Pintmais (2), Armazém Coral (2)','4 idas à mesma loja em 3h no dia 04/11; porcelanato comprado 2 dias seguidos; cimento/areia em 2 lojas no mesmo dia.','Lista de material por OS; almoxarifado no CD; fornecedor faturado.',None),
('10','Médio','Compra em dinheiro assinada pela gerente da loja','#94602473','Risco de reembolso em dobro (fundo fixo da loja + este relatório).','Confirmar com a loja 977.',185),
('11','Médio','NFC-e em contingência / pagamento com cartão private label','#94602533, #94601726, #94600418','Notas pendentes de autorização; fornecedor lançado como "EMITIDA EM CONTINGÊNCIA".','Consultar as chaves na SEFAZ-PE/RN.',None),
('12','Médio','Datas lançadas diferentes do documento','#94598982, #94600595, #94602554, #94603313','Distorce a checagem de rota/dia e permite reapresentação em outro ciclo.','Data = data do documento (travar no sistema).',None),
('13','Médio','85% das despesas sem loja de destino','28 de 33','Impede apurar custo por loja e checar coerência de rota.','Campo "loja/OS" obrigatório.',None),
('14','Baixo','Valor lançado diferente do cupom','#94598726','Lançado R$ 58,00; cupom R$ 68,00.','Corrigir; conferência valor × cupom na aprovação.',-10),
('15','Médio','Aprovação rápida sem conferência','Fluxo de aprovação','1ª aprovação 11 min após o envio (33 itens, incluindo R$ 4.800 e duplicado).','Checklist de aprovação; alçada própria para valores > R$ 500.',None)]
ws,r0=sheet('Achados',['#','Risco','Achado','Despesa(s)','Evidência','Ação','Valor envolvido'],[list(a) for a in A],[4,8,45,26,60,55,14],{7:BRL})
for i,a in enumerate(A,r0+1): ws.cell(i,2).fill=PatternFill('solid',fgColor=RISK[a[1]])
# 6 Combustível
F=[d for d in D if d.get('litros')]
rows=[[d['dd'],d['hd'],d['forn'],d['cid'],d['comb'],d['placa'],d['litros'],d['pl'],d['v'],d['litros']*7,d['pag']] for d in F]
ws,r0=sheet('Combustível',['Data','Hora','Posto','Local','Combustível','Placa','Litros','R$/L','Valor','Autonomia a 7 km/L (km)','Pagamento'],rows,[10,7,32,32,10,22,8,8,10,12,28],{7:'0.000',8:'0.00',9:BRL,10:'0'})
r=r0+len(rows)+2
co=C['coer']
blk=[('Litros pagos',co['L_pago'],'0.0'),('Autonomia total a 7 km/L (km)',co['km_cap'],'0'),('Km de deslocamentos comprovados pelos documentos',co['km_doc'],'0'),('Km comprovados + 20%',co['km_teto'],'0'),
     ('Litros necessários (+20%)',co['L_teto'],'0.0'),('Teto em R$ (+20%, preço médio geral)',co['R_teto'],BRL),('Valor pago',co['v_pago'],BRL),('Diferença sem deslocamento comprovado (R$)',co['dif_R'],BRL),('Diferença (litros)',co['dif_L'],'0.0')]
ws.cell(r,1,'COERÊNCIA DO COMBUSTÍVEL (período 29/10–05/11)').font=B
for k,(a,b,f) in enumerate(blk,r+1):
    ws.cell(k,1,a); c=ws.cell(k,6,b); c.number_format=f
r=r+len(blk)+2
ws.cell(r,1,'Deslocamentos reconstruídos a partir dos cupons (horário + local)').font=B
for j,h in enumerate(['Data','Veículo','Trajeto','Evidência','Km ida+volta'],1):
    c=ws.cell(r+1,j,h); c.fill=H; c.font=HF
for k,x in enumerate(C['desl'],r+2):
    for j,v in enumerate(x,1): ws.cell(k,j,v)
r=r+len(C['desl'])+3
ws.cell(r,1,'Leitura: o teto considera só deslocamentos com prova documental. Sem hodômetro não dá para afirmar desvio — dá para afirmar que R$ 228 (~35 L, ~245 km) não têm deslocamento comprovado neste relatório. A equipe de Natal (Fiorino PVO-3386) não lançou combustível nesta semana: conferir se abasteceu em outro relatório/cartão.').alignment=Alignment(wrap_text=True)
ws.merge_cells(start_row=r,start_column=1,end_row=r,end_column=11); ws.row_dimensions[r].height=45
# 7 CD x Lojas
rows=[[t['loja'],t['cidade'],t['regiao'],t['tipo'],t['km_ida'],t['km_rt'],t['h_ida'],t['litros'],t['custo_g'],t['teto_g'],t['custo_d'],t['teto_d'],'endereço' if t['geo']!='CENTRO DA CIDADE' else 'centro da cidade'] for t in sorted(C['tab'],key=lambda x:x['km_ida'])]
ws,r0=sheet('CD x Lojas',['Loja','Cidade','Região','Tipo','Km ida (CD→loja)','Km ida+volta','Horas (ida)','Litros (7 km/L)',f"Custo gasolina (R$ {P['Gasolina']:.2f}/L)",'TETO gasolina +20%',f"Custo diesel (R$ {P['Diesel']:.2f}/L)",'TETO diesel +20%','Precisão do ponto'],
 rows,[34,24,26,11,11,11,9,10,14,14,14,14,14],{5:'0.0',6:'0.0',7:'0.00',8:'0.0',9:BRL,10:BRL,11:BRL,12:BRL},
 note=f"Distância rodoviária real (OSRM/OpenStreetMap) a partir do CD (Av. da Recuperação 6485, Guabiraba). Consumo 7 km/L. Preços = média ponderada dos cupons deste relatório. Lojas no mesmo endereço/shopping têm a mesma distância.")
# 8 Rotas
rows=[[r['nome'],r['seq'],r['paradas'],r['km'],r['horas'],r['L'],r['custo'],r['teto'],r['km_ind'],r['custo_ind'],r['custo_ind']-r['custo']] for r in C['rotas']]
ws,r0=sheet('Rotas Regionais',['Circuito','Sequência otimizada','Paradas','Km do circuito','Horas de direção','Litros','Custo gasolina','TETO +20%','Km se fosse 1 viagem por loja','Custo 1 viagem por loja','Economia agrupando'],
 rows,[40,60,8,10,10,8,12,12,14,14,14],{4:'0',5:'0.0',6:'0.0',7:BRL,8:BRL,9:'0',10:BRL,11:BRL},
 note='Sequência mais curta (vizinho mais próximo + 2-opt) saindo e voltando ao CD. Use para validar viagens com várias lojas no mesmo dia/semana — ex.: equipe em Natal visitando várias lojas.')
# 9 Linha do tempo
TL=sorted([d for d in D],key=lambda d:(d['dd'][-4:]+d['dd'][3:5]+d['dd'][:2] if len(d['dd'])==10 else '20261104',d['hd']))
rows=[[d['dd'],d['hd'],d['cid'],d['forn'],d['placa'],d['pag'],d['v']] for d in TL]
ws,r0=sheet('Linha do Tempo',['Data doc.','Hora','Local','Fornecedor','Placa','Pagamento','Valor'],rows,[13,26,34,40,22,30,10],{7:BRL},
 note='Coerência geográfica: em 03/11 há ao menos 5 frentes simultâneas (Paulista, Recife-Ilha do Retiro, Afogados/Jiquiá/Cavaleiro, Natal e CD). Ex.: Expresso Cavaleiro 13:54 e Petromega Paulista 14:15 (30 km em 21 min) não podem ser o mesmo veículo.')
# 10 Médias
Fx=[d for d in D if d.get('litros')]
m=[('Combustível','Preço médio gasolina (R$/L)',P['Gasolina'],'3 abastecimentos; faixa 6,80–6,99'),('Combustível','Preço médio diesel (R$/L)',P['Diesel'],'S10 comum 6,89 × aditivado 6,97'),('Combustível','Preço etanol (R$/L)',P['Etanol'],'1 abastecimento (Pombos)'),
('Combustível','Litros médios por abastecimento',sum(d['litros'] for d in Fx)/len(Fx),'6 abastecimentos'),('Combustível','Valor médio por abastecimento (R$)',sum(d['v'] for d in Fx)/len(Fx),''),
('Estacionamento','Valor médio por ticket avulso (R$)',(26+15+25+12)/4,'Midway, Penta, Concórdia, Lepari'),('Estacionamento','Custo médio por hora (R$/h)',(26+15+25+12)/(5.05+2.15+6.43+5.05),'≈18,7 h estacionadas'),
('Estacionamento','Mensalidade guarda da Fiorino – Natal (R$)',180,'recorrente'),('Material','Ticket médio Comercial Bezerra (R$)',131.49/6,'6 compras em 2 dias'),('Material','Ticket médio de material (todas as lojas) (R$)',None,''),
('Mobilidade','Corrida média app (R$)',29.31/2,'Uber/99'),('Veículos','Vulcanização média (R$)',45,'2 reparos em 6 dias'),
('Hotel','Diária média – Natal / João Pessoa / Maceió / interior','sem dados','Nenhuma hospedagem neste relatório'),('Refeição','Média por funcionário/dia','sem dados','Nenhuma refeição neste relatório')]
mat=[d for d in D if d['conta'] in ('Manutenção Predial','Manutenção de Móveis') and d['v']>0]
m[9]=('Material','Ticket médio de material (todas as lojas) (R$)',sum(d['v'] for d in mat)/len(mat),f'{len(mat)} compras de material')
ws,r0=sheet('Médias',['Grupo','Indicador','Valor','Base'],[list(x) for x in m],[16,52,14,46],{3:'#,##0.00'},
 note='Médias apuradas SOMENTE com os documentos deste relatório. Hotel e refeição não aparecem neste relatório — quando vierem, use a mesma base para fixar tetos por cidade.')
# 11 Plano
PL=[('Imediato','Reter os 5 itens (R$ 5.557,90) e devolver para comprovação','Financeiro/Auditoria','—'),
('Imediato','Excluir o duplicado e corrigir o valor do Expresso (+R$ 10)','Financeiro','—'),
('Imediato','Levantar parcelas 01–03 do recibo PJ e conferir entrega dos 40 BRTs','Auditoria','até R$ 14.400 em risco de não comprovação'),
('30 dias','Proibir pagamento de PJ e despesas fixas (mensalidade estacionamento) via reembolso','Diretoria Financeira','controle'),
('30 dias','Cartão frota por placa com hodômetro obrigatório e bloqueio de combustível premium/aditivado','Facilities/Frota','≈ R$ 228/semana sem deslocamento comprovado + ~1% do aditivado'),
('30 dias','Campo obrigatório "Loja/OS" e "Placa" no sistema de despesas; bloqueio de chave NFC-e repetida e de data ≠ documento','TI/Financeiro','controle'),
('60 dias','Almoxarifado de miúdos no CD + lista de material por OS + fornecedor faturado (NF no CNPJ)','Facilities/Compras','10–15% sobre material comprado no varejo (≈ R$ 150–225 por semana neste volume)'),
('60 dias','Kit de ferramentas patrimoniado por equipe (sem compra de ferramenta em reembolso)','Facilities','evita recompra'),
('60 dias','Roteirização semanal por região (tabela Rotas Regionais) e teto de combustível por viagem','Facilities','agrupar lojas reduz até 85% dos km vs. 1 viagem por loja'),
('60 dias','Política de viagem: teto de hotel e refeição por cidade (preencher com média real dos próximos relatórios)','RH/Financeiro','controle'),
('90 dias','Negociar vaga de serviço nos shoppings e lojas do centro (evitar estacionamento pago)','Facilities/Expansão','≈ R$ 78/semana neste relatório')]
ws,r0=sheet('Plano de Redução',['Prazo','Ação','Responsável sugerido','Ganho esperado'],[list(x) for x in PL],[10,80,24,50])
wb.save(OUT); print('ok',OUT)
