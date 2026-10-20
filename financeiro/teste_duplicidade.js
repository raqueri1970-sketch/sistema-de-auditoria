// Testes do Agente de Duplicidade (R23): node financeiro/teste_duplicidade.js
const A = require(__dirname + '/auditoria.js');
const L = (codigo, fornecedor, valor, pag, venc, comp, conta, cc, extra = {}) => ({codigo, status: pag ? 'Pago' : 'A vencer', fornecedor, valorParcela: valor, valorPago: pag ? valor : 0, saldo: pag ? 0 : valor,
  vencimento: venc, competencia: comp, dataPagamento: pag, contaContabil: conta, centroCusto: cc, ...extra});
const G = 'D. GUARDIAN SEGURANCA ELETRONICA LTDA';
const d = [
  // 1) caso real: mesmo código 24623 pago 13/09 e 14/09, mesmo valor, mesma competência, mesma loja
  L(24623, G, 1109.81, '2026-09-13', '2026-09-13', '2026-08-06', '(-) Serviço de Alarme e Monitoramento', '038 - BEBERIBE'),
  L(24623, G, 1109.81, '2026-09-14', '2026-09-14', '2026-08-06', '(-) Serviço de Alarme e Monitoramento', '038 - BEBERIBE'),
  L(24624, G, 435.83, '2026-09-14', '2026-09-14', '2026-08-06', '(-) Serviço de Alarme e Monitoramento', '007 - CASA'),
  // 2) mesmo fornecedor, mesmo valor, mesmo dia, códigos e lojas diferentes (pedido do usuário)
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
assert(r23.some(o => o.detalhe.includes('24623') && o.sev === 'alta'), 'D. Guardian 24623 pago 2× = alta');
assert(tem('ACME'), 'mesmo valor mesmo dia lojas diferentes');
assert(tem('MARIA DA SILVA'), 'pensão 2× no mesmo mês');
assert(tem('PEREIRA'), 'Uber 2× com cadastro diferente');
assert(r23.some(o => o.fornecedor.includes('XYZ') && o.dup.abertos === 1), 'pago + em aberto (evitável)');
assert(!tem('CONTABIL'), 'rateio não é duplicidade');
assert(!tem('IMOBILIARIA') && !tem('MOVEIS'), 'mensal/parcelas não são duplicidade');
assert(!r23.some(o => o.detalhe.includes('95001')), 'alarme por loja não é duplicidade');
assert(!tem('FORNEC R01') && r.ocorrencias.some(o => o.regra === 'R01' && o.dup), 'R01 não se repete na R23 e tem comparativo');
