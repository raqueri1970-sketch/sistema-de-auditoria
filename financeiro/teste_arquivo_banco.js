// Testes da conferência "arquivo do banco / RH × Sallamo" com dados FICTÍCIOS: node financeiro/teste_arquivo_banco.js
const A = require(__dirname + '/auditoria.js');
const pad = (s, n, c = ' ', esq = false) => { s = String(s); return esq ? s.padStart(n, c).slice(-n) : s.padEnd(n, c).slice(0, n); };
// CNAB 240: header, segmento A (nome, código, data, valor) e B (CPF)
const linhaA = (seq, nome, cod, valor, conta) => ('0330001300' + pad(seq, 3, '0', true) + 'A000000' + '033' + '04048' + ' ' + pad(conta, 12, '0', true) + '3 ' + pad(nome, 30) + pad('R' + cod, 20) + '17092026' + 'BRL' + '0'.repeat(15) + pad(Math.round(valor * 100), 15, '0', true)).padEnd(240);
const linhaB = (seq, cpf) => ('0330001300' + pad(seq, 3, '0', true) + 'B   1' + pad(cpf, 14, '0', true)).padEnd(240);
const cnab = ['03300000         2' + ' '.repeat(54) + pad('EMPRESA TESTE', 30), '03300011C3001031'].map(l => l.padEnd(240))  // header de lote: serviço 30 = salários
  .concat(linhaA(1, 'FULANO DE TAL', '700001', 900, '10751703'), linhaB(2, '11111111111'), linhaA(3, 'BELTRANA SOUZA', '700002', 1200, '20000001'), linhaB(4, '22222222222'),
    linhaA(5, 'FULANO DE TAL', '700001', 900, '10751703'), linhaB(6, '11111111111')).join('\n');
const c = A.lerCNAB240(cnab); c.nome = 'Adiantamento 09/26 (CNAB)';
const rel = A.lerTextoBanco(['EMPRESA TESTE', 'Relação para Depósito Bancário', 'Data de Pagamento: 06/10/2026 Banco: SANTANDER', 'Competência: Setembro/26',
  '033.4048-000010751703 1.500,00 700001 FULANO DE TAL 11111111111 3', 'Total do valor transmitido: 1.500,00']); rel.nome = 'Folha 09/26';
const comp = A.lerTextoBanco(['Lista de Comprovantes', 'Número do Pagamento Número do Cliente Funcionário', '900000001 700001 FULANO DE TAL 06/10/2026 CC 1.500,00',
  '900000002 700009 SICRANO FORA 06/10/2026 CC 300,00', 'Total Compromissos: 2 Valor Total: R$ 1.800,00']); comp.nome = 'Comprovantes folha';
const t = (codigo, fornecedor, v, dia, conta) => ({codigo, status: 'Pago', fornecedor, valorParcela: v, valorPago: v, saldo: 0, vencimento: dia, competencia: dia, dataPagamento: dia, contaContabil: conta, centroCusto: 'ADM'});
const T = A.normalizar([t(1, 'ADIANTAMENTO SALARIAL', 3000, '2026-09-17', '(-) Adiantamento Salarial'), t(2, 'ADIANTAMENTO SALARIAL', 3000, '2026-09-18', '(-) Adiantamento Salarial'),
  t(3, 'BELTRANA SOUZA', 1200, '2026-09-20', '(-) Adiantamento Salarial'), t(4, 'FOLHA SETEMBRO', 1500, '2026-10-06', '(-) Salários e Ordenados')]);
const r = A.cruzarArquivoBanco([c, rel, comp], T), tipos = r.achados.map(a => a.tipo);
const ok = (cond, m) => { console.log((cond ? 'ok: ' : 'FALHOU: ') + m); if (!cond) process.exitCode = 1; };
ok(c.itens.length === 3 && c.itens[0].cpf === '11111111111' && c.itens[1].valor === 1200 && c.data === '2026-09-17', 'lê o CNAB 240 (nome, CPF, valor, data)');
ok(rel.itens.length === 1 && rel.totalInformado === 1500 && rel.data === '2026-10-06', 'lê a Relação para Depósito');
ok(comp.tipo === 'comprovante' && comp.itens.length === 2, 'lê a Lista de Comprovantes');
ok(tipos.includes('repetido_arquivo'), 'mesma pessoa 2× no arquivo');
ok(tipos.includes('lote_2x'), 'lote lançado 2× no Sallamo');
ok(r.achados.some(a => a.tipo === 'pessoa_mesmo_valor' && /BELTRANA/.test(a.titulo)), 'pago no arquivo e também no Sallamo (mesmo valor)');
ok(tipos.includes('comprovante_fora'), 'comprovante de quem não está no arquivo');
ok(tipos.includes('adto_sem_folha'), 'adiantamento sem folha');
ok(tipos.includes('lote_ok'), 'lote da folha encontrado 1×');

// ---- remessa a FORNECEDORES (serviço 20): boletos (segmento J + J-52) e TED (A/B), conferidos título a título no Sallamo
const linhaJ = (seq, barras, nome, venc, valor, seu) => ('0330002300' + pad(seq, 3, '0', true) + 'J000' + pad(barras, 44) + pad(nome, 30) + venc + pad(Math.round(valor * 100), 15, '0', true) + '0'.repeat(30) + '20102026'
  + pad(Math.round(valor * 100), 15, '0', true) + '0'.repeat(15) + pad(seu, 20)).padEnd(240);
const linhaJ52 = (seq, cnpj, nome) => ('0330002300' + pad(seq, 3, '0', true) + 'J00052' + ' '.repeat(56) + '2' + pad(cnpj, 15, '0', true) + pad(nome, 40)).padEnd(240);
const remessa = ['03300000         2' + ' '.repeat(54) + pad('EMPRESA TESTE', 30), '03300021C2001031'].map(l => l.padEnd(240)).concat(
  linhaJ(1, '03399111111111111111111111111111111111111111', 'GUARDIAN SEG', '15102026', 1109.81, 'NF100'), linhaJ52(2, '11222333000144', 'D GUARDIAN SEGURANCA ELETRONICA LTDA'),
  linhaJ(3, '03399111111111111111111111111111111111111111', 'GUARDIAN SEG', '15102026', 1109.81, 'NF100B'),
  linhaJ(4, '03399222222222222222222222222222222222222222', 'ACME SERVICOS', '18102026', 2500, 'NF200'),
  linhaJ(5, '03399333333333333333333333333333333333333333', 'XYZ MANUTENCAO', '19102026', 3200, 'NF300')).join('\n');
const f = A.lerCNAB240(remessa); f.nome = 'Remessa fornecedores 20/10';
const TF = A.normalizar([t(10, 'D. GUARDIAN SEGURANCA ELETRONICA LTDA', 1109.81, '2026-10-20', '(-) Serviço de Alarme'),
  t(11, 'ACME SERVICOS LTDA', 2500, '2026-10-20', '(-) Consertos'), t(12, 'ACME SERVICOS LTDA', 2500, '2026-10-21', '(-) Consertos')]);
const rf = A.cruzarArquivoBanco([f], TF), tf = rf.achados.map(a => a.tipo);
ok(f.itens.length === 4 && f.itens[0].forma === 'Boleto' && f.itens[0].modo === 'fornecedor' && f.itens[0].cpf === '11222333000144' && f.itens[0].nome.startsWith('D GUARDIAN'), 'lê boleto (J + J-52) da remessa a fornecedores');
ok(tf.includes('repetido_arquivo') && rf.achados.some(a => /código de barras/.test(a.titulo)), 'mesmo boleto 2× na remessa');
ok(rf.achados.some(a => a.tipo === 'fornecedor_2x_sallamo' && /ACME/.test(a.titulo)), '1 pagamento no banco e 2 títulos pagos no Sallamo');
ok(rf.achados.some(a => a.tipo === 'banco_sem_titulo' && a.itens.some(x => /XYZ/.test(x.nome))), 'pago no banco sem título no Sallamo');
ok(!tf.includes('pessoa_mesmo_valor') && !tf.includes('lote_nao_achado'), 'fornecedor não é tratado como folha');
const outro = A.lerCNAB240(remessa.split('\n').filter(l => l.includes('NF100 ') || l[7] !== '3').join('\n')); outro.nome = 'Remessa 21/10';
ok(A.cruzarArquivoBanco([f, outro], TF).achados.some(a => a.tipo === 'boleto_2_arquivos'), 'mesmo boleto em duas remessas');
// prevenção: a remessa vai pagar algo que já saiu dias antes
const TP = A.normalizar([t(20, 'XYZ MANUTENCAO LTDA', 3200, '2026-10-12', '(-) Manutenção')]);
ok(A.cruzarArquivoBanco([f], TP).achados.some(a => a.tipo === 'ja_pago_antes' && /XYZ/.test(a.titulo)), 'remessa: valor já pago antes ao mesmo fornecedor (evita pagar 2×)');
