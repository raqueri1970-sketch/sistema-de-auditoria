// Testes do Agente de Duplicidade (R23): node financeiro/teste_duplicidade.js
const A = require(__dirname + '/auditoria.js');
const L = (codigo, fornecedor, valor, pag, venc, comp, conta, cc, extra = {}) => ({codigo, status: pag ? 'Pago' : 'A vencer', fornecedor, valorParcela: valor, valorPago: pag ? valor : 0, saldo: pag ? 0 : valor,
  vencimento: venc, competencia: comp, dataPagamento: pag, contaContabil: conta, centroCusto: cc, ...extra});
const G = 'D. GUARDIAN SEGURANCA ELETRONICA LTDA';
const d = [
  // 1) mesmo código 24623 com 2 parcelas iguais coladas (venc. 13/09 e 14/09): pode ser parcela duplicada OU entrada + saldo — conferir
  L(24623, G, 1109.81, '2026-09-13', '2026-09-13', '2026-08-06', '(-) Serviço de Alarme e Monitoramento', '038 - BEBERIBE'),
  L(24623, G, 1109.81, '2026-09-14', '2026-09-14', '2026-08-06', '(-) Serviço de Alarme e Monitoramento', '038 - BEBERIBE'),
  L(24624, G, 435.83, '2026-09-14', '2026-09-14', '2026-08-06', '(-) Serviço de Alarme e Monitoramento', '007 - CASA'),
  // 2) mesmo fornecedor, mesmo valor, mesmo dia, códigos e lojas diferentes: cobrança por loja — NÃO é duplicidade (só na mesma loja)
  L(30001, 'ACME SERVICOS LTDA', 2500, '2026-09-20', '2026-09-20', '2026-09-01', '(-) Consertos e Reparos', '010 - LOJA A'),
  L(30002, 'ACME SERVICOS LTDA', 2500, '2026-09-20', '2026-09-22', '2026-09-03', '(-) Consertos e Reparos', '011 - LOJA B'),
  // 3) pensão paga 2× no mesmo mês (dias distantes)
  L(40001, 'MARIA DA SILVA', 850, '2026-09-05', '2026-09-05', '2026-09-01', '(-) Pensão Alimentícia', 'ADMINISTRATIVO'),
  L(40002, 'MARIA DA SILVA', 850, '2026-09-25', '2026-09-25', '2026-09-01', '(-) Pensão Alimentícia', 'ADMINISTRATIVO'),
  // 4) reembolso Uber 2× colado, cadastro com grafia diferente
  L(50001, 'JOAO PEREIRA', 187.40, '2026-09-10', '2026-09-10', '2026-09-08', '(-) Taxi / Uber', '020 - LOJA C'),
  L(50002, 'JOÃO  PEREIRA', 187.40, '2026-09-11', '2026-09-11', '2026-09-08', '(-) Reembolso de Despesas', '020 - LOJA C'),
  // 5) já pago e outro igual em aberto (evitável)
  L(60001, 'XYZ MANUTENCAO LTDA', 3200, '2026-10-01', '2026-10-01', '2026-09-15', '(-) Manutenção', '030 - LOJA D'),
  L(60002, 'XYZ MANUTENCAO LTDA', 3200, null, '2026-10-05', '2026-09-15', '(-) Manutenção', '030 - LOJA D'),
  // LEGÍTIMOS: rateio do mesmo título entre lojas no mesmo dia
  L(70001, 'CONTABIL XPTO LTDA', 900, '2026-09-10', '2026-09-10', '2026-09-01', '(-) Assessoria Contábil', 'LOJA 1'),
  L(70001, 'CONTABIL XPTO LTDA', 900, '2026-09-10', '2026-09-10', '2026-09-01', '(-) Assessoria Contábil', 'LOJA 2'),
  L(70001, 'CONTABIL XPTO LTDA', 900, '2026-09-10', '2026-09-10', '2026-09-01', '(-) Assessoria Contábil', 'LOJA 3'),
  // LEGÍTIMOS: aluguel mensal (30 dias) e parcelas mensais do mesmo código
  L(80001, 'IMOBILIARIA BOA LTDA', 5000, '2026-08-05', '2026-08-05', '2026-08-01', '(-) Aluguel', 'LOJA 1'),
  L(80002, 'IMOBILIARIA BOA LTDA', 5000, '2026-09-05', '2026-09-05', '2026-09-01', '(-) Aluguel', 'LOJA 1'),
  L(90001, 'MOVEIS SA', 1000, '2026-08-10', '2026-08-10', '2026-07-01', '(-) Aquisição de Móveis', 'LOJA 1'),
  L(90001, 'MOVEIS SA', 1000, '2026-09-10', '2026-09-10', '2026-07-01', '(-) Aquisição de Móveis', 'LOJA 1'),
  // LEGÍTIMO: alarme por loja (3 lojas, mesmo preço, mesmo dia)
  L(95001, G, 435.83, '2026-09-30', '2026-09-30', '2026-09-01', '(-) Monitoramento CTFV', '001'),
  L(95002, G, 435.83, '2026-09-30', '2026-09-30', '2026-09-01', '(-) Monitoramento CTFV', '002'),
  L(95003, G, 435.83, '2026-09-30', '2026-09-30', '2026-09-01', '(-) Monitoramento CTFV', '003'),
  // R01 clássico (códigos diferentes, mesmo vencimento e centro)
  L(99001, 'FORNEC R01 LTDA', 777, '2026-09-02', '2026-09-01', '2026-08-01', '(-) Serviços PJ', 'LOJA 9'),
  L(99002, 'FORNEC R01 LTDA', 777, '2026-09-03', '2026-09-01', '2026-08-01', '(-) Serviços PJ', 'LOJA 9'),
];
const r = A.analisar(d, {hoje: '2026-10-20'});
for (const o of r.ocorrencias.filter(o => A.REGRAS_DUP.includes(o.regra)))
  console.log(o.regra, o.sev, o.dup.nota, '|', o.fornecedor, '|', o.detalhe, '| imp', o.impacto, '\n   +', o.dup.sinais.join(' ; '), o.dup.alivios.length ? '\n   -' + o.dup.alivios.join(' ; ') : '');
console.log('\nTotal ocorrências', r.ocorrencias.length, '·', [...new Set(r.ocorrencias.map(o => o.regra))].join(' '));
// garantias
const r23 = r.ocorrencias.filter(o => o.regra === 'R23');
const tem = s => r23.some(o => o.fornecedor.includes(s));
const assert = (c, m) => { if (!c) { console.error('FALHOU:', m); process.exitCode = 1; } else console.log('ok:', m); };
assert(r23.some(o => o.detalhe.includes('24623') && o.sev === 'media'), 'D. Guardian 24623: 2 parcelas iguais coladas = média (conferir na nota), não alta');
assert(!tem('ACME'), 'mesmo valor mesmo dia em lojas diferentes = cobrança por loja, não é duplicidade');
assert(tem('MARIA DA SILVA'), 'pensão 2× no mesmo mês');
assert(tem('PEREIRA'), 'Uber 2× com cadastro diferente');
assert(!r23.some(o => o.fornecedor.includes('XYZ')), 'pago + em aberto NÃO é duplicidade (só quando os dois foram pagos)');
assert(r.ocorrencias.some(o => o.regra === 'R24' && o.fornecedor.includes('XYZ') && o.sev === 'alta' && o.prev.evitavel === 3200), 'pago + em aberto vai para a prevenção (R24), alta: não pagar de novo');
assert(!tem('CONTABIL'), 'rateio não é duplicidade');
assert(!tem('IMOBILIARIA') && !tem('MOVEIS'), 'mensal/parcelas não são duplicidade');
assert(!r23.some(o => o.detalhe.includes('95001')), 'alarme por loja não é duplicidade');
assert(!tem('FORNEC R01') && r.ocorrencias.some(o => o.regra === 'R01' && o.dup), 'R01 não se repete na R23 e tem comparativo');

// ---- verificação direta (padrões reais do Sallamo: uma linha por item/parcela, sem nº do item, da parcela nem da NF)
const P = (codigo, f, v, pag, venc, conta, cc, parcela) => Object.assign(L(codigo, f, v, pag, venc, '2026-09-01', conta, cc), parcela ? {valorParcela: parcela, saldo: parcela - v} : {});
const E = A.duplicidadeExata(A.normalizar([
  // Beira Rio: adiantamento com parcelas DIÁRIAS de R$ 202 mil (vencimentos diferentes); duas pagas no mesmo dia 10/08 → NÃO é duplicidade
  P(23550, 'CALCADOS BEIRA RIO S/A', 202000, '2026-08-10', '2026-08-05', '(-) Adiantamentos à Fornecedores de Mercadorias', 'CEO'),
  P(23550, 'CALCADOS BEIRA RIO S/A', 202000, '2026-08-10', '2026-08-10', '(-) Adiantamentos à Fornecedores de Mercadorias', 'CEO'),
  P(23550, 'CALCADOS BEIRA RIO S/A', 202000, '2026-08-11', '2026-08-11', '(-) Adiantamentos à Fornecedores de Mercadorias', 'CEO'),
  // GETNET: uma linha por maquininha no mesmo título, mesmo dia → itens da mesma nota (conferir), não "pago a mais"
  ...Array.from({length: 5}, () => P(23563, 'GETNET TEC EM CAPTURA E PROC TR SA', 137.9, '2026-07-21', '2026-07-21', '(-) Taxas Administrativas', 'PLANEJAMENTO FINANCEIRO')),
  // mesma parcela (mesmo título e vencimento) baixada 2× em dias diferentes, soma passa da parcela → suspeita forte
  P(3, 'FORN C LTDA', 700, '2026-09-13', '2026-09-13', '(-) Alarme', 'LOJA 3'), P(3, 'FORN C LTDA', 700, '2026-09-20', '2026-09-13', '(-) Alarme', 'LOJA 3'),
  // pagamento parcial: parcela de 1.000 paga em 2× de 500 → não é duplicidade
  P(5, 'FORN E LTDA', 500, '2026-09-10', '2026-09-10', '(-) Manutenção', 'LOJA 5', 1000), P(5, 'FORN E LTDA', 500, '2026-09-15', '2026-09-10', '(-) Manutenção', 'LOJA 5', 1000),
  // títulos diferentes, mesmo fornecedor/valor/vencimento/centro, ambos pagos → suspeita (nota lançada 2×)
  P(17191, 'MOURA DUBEUX ENGENHARIA S/A', 125797.04, '2026-06-15', '2026-06-15', '(-) Retirada Bancária', 'CEO'), P(17193, 'MOURA DUBEUX ENGENHARIA S/A', 125797.04, '2026-06-15', '2026-06-15', '(-) Retirada Bancária', 'CEO'),
  // duas notas de mercadoria iguais (mesma grade) → à parte, conferir NF
  P(1002, 'SKECHERS DO BRASIL CAL LTDA', 41997.9, '2026-08-21', '2026-08-21', '(-) Compras a Prazo', '097 - MACAÍBA'), P(1003, 'SKECHERS DO BRASIL CAL LTDA', 41997.9, '2026-08-21', '2026-08-21', '(-) Compras a Prazo', '097 - MACAÍBA'),
  // rateio: mesmo título dividido entre lojas no mesmo dia
  P(2, 'FORN B LTDA', 300, '2026-09-10', '2026-09-10', '(-) Assessoria', 'LOJA 1'), P(2, 'FORN B LTDA', 300, '2026-09-10', '2026-09-10', '(-) Assessoria', 'LOJA 2'),
  // parcela mensal do mesmo título
  P(4, 'FORN D LTDA', 900, '2026-08-10', '2026-08-10', '(-) Aluguel', 'LOJA 4'), P(4, 'FORN D LTDA', 900, '2026-09-10', '2026-09-10', '(-) Aluguel', 'LOJA 4'),
]));
const temCod = (a, c) => a.some(x => x.codigos.includes(c));
assert(!temCod(E.mesmaParcela, 23550) && !temCod(E.titulosDiferentes, 23550) && !temCod(E.itensIguais, 23550), 'Beira Rio: parcelas diferentes pagas no mesmo dia NÃO são duplicidade');
assert(E.parcelasMesmoDia === 2, 'parcelas diferentes no mesmo dia só são contadas (informativo)');
assert(E.itensIguais.length === 1 && E.itensIguais[0].codigo === '23563' && E.itensIguais[0].excesso === 0 && E.itensIguais[0].linhas === 5, 'GETNET: itens iguais da mesma nota = conferir, sem "pago a mais"');
assert(E.mesmaParcela.length === 1 && E.mesmaParcela[0].codigo === '3' && E.mesmaParcela[0].excesso === 700, 'mesma parcela baixada 2× em dias diferentes = suspeita forte');
assert(!temCod(E.mesmaParcela, 5), 'pagamento parcial (500 + 500 de uma parcela de 1.000) não é duplicidade');
assert(E.titulosDiferentes.length === 1 && E.titulosDiferentes[0].excesso === 125797.04 && E.titulosDiferentes[0].mesmaComp, 'Moura Dubeux: 2 títulos iguais pagos no mesmo dia');
assert(E.mercadoria.length === 1 && temCod(E.mercadoria, 1002), 'Skechers: 2 notas de mercadoria iguais ficam à parte (conferir NF)');
assert(E.rateios.length === 1 && E.rateios[0].codigo === '2', 'mesmo dia em lojas diferentes = rateio (à parte)');
assert(!temCod(E.mesmaParcela, 4) && !temCod(E.itensIguais, 4), 'parcela mensal não é duplicidade');
// o Agente (R23) também não pode chamar parcelas diárias de duplicidade
const RB = A.analisar([
  ...['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-10', '2026-08-11'].map(v => P(23550, 'CALCADOS BEIRA RIO S/A', 202000, v === '2026-08-05' ? '2026-08-10' : v, v, '(-) Adiantamentos à Fornecedores de Mercadorias', 'CEO')),
  ...Array.from({length: 5}, () => P(23563, 'GETNET TEC EM CAPTURA E PROC TR SA', 137.9, '2026-07-21', '2026-07-21', '(-) Taxas Administrativas', 'PLANEJAMENTO FINANCEIRO')),
], {hoje: '2026-10-20'});
assert(!RB.ocorrencias.some(o => A.REGRAS_DUP.includes(o.regra)), 'Agente: parcelas diárias e itens da mesma nota não viram duplicidade');
assert(RB.ocorrencias.some(o => o.regra === 'R02' && o.sev === 'baixa'), 'itens iguais (5 maquininhas) = R02 baixa');

// ---- caso da tela: o mesmo título Renegociado (com saldo) + Pago NÃO é duplicidade nem prevenção nem em aberto
const reneg = (codigo, fornecedor, v, status, pag, venc, comp, cc) => ({codigo, status, fornecedor, valorParcela: v, valorPago: status === 'Pago' ? v : 0, saldo: status === 'Pago' ? 0 : v,
  vencimento: venc, competencia: comp, dataPagamento: status === 'Pago' ? pag : null, contaContabil: '(-) Condomínio', centroCusto: cc});
const RR = A.analisar([reneg(27972, 'COND DO SHOPPING CENTER GUARARAPES', 66013.39, 'Renegociado', null, '2026-09-21', '2026-08-27', '015 - SHOPPING GUARARAPES'),
  reneg(27972, 'COND DO SHOPPING CENTER GUARARAPES', 66013.39, 'Pago', '2026-09-23', '2026-09-23', '2026-08-27', '015 - SHOPPING GUARARAPES'),
  reneg(30726, 'SOUZA E SOUZA LTDA', 42326.25, 'Renegociado', null, '2026-09-21', '2026-08-08', '092 - AFOGADOS'),
  reneg(30726, 'SOUZA E SOUZA LTDA', 42326.25, 'Pago', '2026-09-22', '2026-09-22', '2026-08-08', '092 - AFOGADOS')], {hoje: '2026-10-20'});
assert(!RR.ocorrencias.some(o => ['R01', 'R02', 'R23', 'R24', 'R18'].includes(o.regra)), 'Renegociado + Pago: nenhuma duplicidade, prevenção, linha repetida ou vencido');
assert(RR.indicadores.emAberto === 0, 'Renegociado não conta como em aberto no painel');
const EX = A.duplicidadeExata(RR.titulos);
assert(!EX.mesmaParcela.length && !EX.titulosDiferentes.length && !EX.itensIguais.length, 'verificação exata ignora o renegociado');
// dois pagos de verdade no mesmo título continuam sendo duplicidade
const R2 = A.analisar([reneg(1, 'FORN X LTDA', 5000, 'Pago', '2026-09-21', '2026-09-21', '2026-08-01', 'LOJA'), reneg(1, 'FORN X LTDA', 5000, 'Pago', '2026-09-22', '2026-09-22', '2026-08-01', 'LOJA')], {hoje: '2026-10-20'});
assert(R2.ocorrencias.some(o => o.regra === 'R23' && o.dup.pagos === 2), 'mesmo título pago nos dois = duplicidade');
// prevenção (R24): parcela diária em aberto do mesmo título NÃO "repete o já pago"; a mesma parcela já paga e de novo em aberto, sim
const RP = A.analisar([
  P(23550, 'CALCADOS BEIRA RIO S/A', 202000, '2026-10-19', '2026-10-19', '(-) Adiantamentos à Fornecedores de Mercadorias', 'CEO'),
  P(23550, 'CALCADOS BEIRA RIO S/A', 202000, null, '2026-10-20', '(-) Adiantamentos à Fornecedores de Mercadorias', 'CEO'),
  P(23550, 'CALCADOS BEIRA RIO S/A', 202000, null, '2026-10-21', '(-) Adiantamentos à Fornecedores de Mercadorias', 'CEO'),
  P(777, 'FORN Z LTDA', 1500, '2026-10-01', '2026-10-01', '(-) Manutenção', 'LOJA 7'), P(777, 'FORN Z LTDA', 1500, null, '2026-10-01', '(-) Manutenção', 'LOJA 7'),
], {hoje: '2026-10-18'});
assert(!RP.ocorrencias.some(o => o.regra === 'R24' && o.fornecedor.includes('BEIRA')), 'prevenção: parcelas diárias em aberto não repetem a já paga');
assert(RP.ocorrencias.some(o => o.regra === 'R24' && o.fornecedor.includes('FORN Z') && o.sev === 'alta'), 'prevenção: a mesma parcela já paga e de novo em aberto = alta');
// pagamento semanal igual (vencimentos diferentes, 7 dias) não é duplicidade; mesmo documento na mesma loja em dias próximos, sim
const RW = A.analisar([
  Object.assign(P(61001, 'RL NORDESTE LTDA', 10000, '2026-09-01', '2026-09-01', '(-) Fretes', 'LOGÍSTICA'), {competencia: '2026-08-29'}),
  Object.assign(P(61002, 'RL NORDESTE LTDA', 10000, '2026-09-08', '2026-09-08', '(-) Fretes', 'LOGÍSTICA'), {competencia: '2026-09-05'}),
  P(62001, 'KARLA LTDA', 45000, '2026-08-26', '2026-08-26', '(-) Serviços PJ', 'CEO'), P(62002, 'KARLA LTDA', 45000, '2026-08-28', '2026-08-26', '(-) Serviços PJ', 'CEO'),
], {hoje: '2026-10-20'});
assert(!RW.ocorrencias.some(o => A.REGRAS_DUP.includes(o.regra) && o.fornecedor.includes('RL NORDESTE')), 'frete semanal igual não é duplicidade');
assert(RW.ocorrencias.some(o => A.REGRAS_DUP.includes(o.regra) && o.sev !== 'baixa' && o.fornecedor.includes('KARLA')), 'mesmo vencimento, mesma loja, pagos 26/08 e 28/08 = suspeita');
// R25: maquininhas da rede lançadas numa loja só = centro de custo, não duplicidade; R08 compara o título inteiro com a alçada
const lojas = ['001', '002', '003', '004'].map(c => P(70000 + Number(c), 'GETNET TEC EM CAPTURA E PROC TR SA', 137.9, '2026-06-20', '2026-06-20', '(-) Taxas Administrativas', c));
const RC = A.analisar([...lojas, ...Array.from({length: 20}, () => P(38504, 'GETNET TEC EM CAPTURA E PROC TR SA', 141.17, '2026-10-13', '2026-10-13', '(-) Taxas Administrativas', '057 - SÃO LOURENÇO DA MATA')),
  ...Array.from({length: 10}, () => P(38505, 'GETNET TEC EM CAPTURA E PROC TR SA', 137.9, '2026-10-13', '2026-10-13', '(-) Taxas Administrativas', '036 - NATAL SHOPPING')),
  ...Array.from({length: 10}, () => P(38507, 'GETNET TEC EM CAPTURA E PROC TR SA', 140, '2026-10-13', '2026-10-13', '(-) Taxas Administrativas', '026 - MACAIBA'))], {hoje: '2026-10-20'});
assert(RC.ocorrencias.some(o => o.regra === 'R25' && o.detalhe.includes('38504') && o.impacto === 2823.4), 'R25: 20 maquininhas numa loja só = centro de custo');
assert(!RC.ocorrencias.some(o => A.REGRAS_DUP.includes(o.regra)), 'maquininhas: nenhuma duplicidade');
assert(RC.ocorrencias.some(o => o.regra === 'R08' && o.impacto === 5602.4 && o.detalhe.startsWith('3 títulos')), 'R08 soma por TÍTULO (3 títulos de até R$ 2.823 somando R$ 5.602), não por item');
assert(!A.analisar(Array.from({length: 40}, () => P(1, 'FORN ITENS LTDA', 141.17, '2026-10-13', '2026-10-13', '(-) Manutenção', 'LOJA')), {hoje: '2026-10-20'}).ocorrencias.some(o => o.regra === 'R08'), 'R08: 40 itens de um título só não é fracionamento');
