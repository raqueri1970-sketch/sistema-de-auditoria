// Auditoria Financeira · motor de cruzamentos do Contas a Pagar (Sallamo).
// Recebe as movimentações da API /api/bi/contas-a-pagar e devolve as ocorrências (possíveis irregularidades),
// indicadores e rankings de risco. Não depende de tela: roda no navegador e no Node (testes).
// Cada regra tem um código fixo (R01…) para o auditor registrar a análise no Supabase (fin_analises).
(function (raiz) {
  'use strict';

  const PADRAO = {
    hoje: null,                // 'YYYY-MM-DD' (padrão: hoje em São Paulo)
    dupMin: 100,               // R01: valor mínimo para considerar duplicidade
    dupRecorrente: 4,          // R01: a partir de N títulos iguais no período é cobrança recorrente (não é duplicidade)
    tolerancia: 1,             // R03/R04: diferença de centavos/arredondamento ignorada (R$)
    antecipDias: 15,           // R05: pago N dias ou mais antes do vencimento
    alcada: 5000,              // R08: alçada de aprovação (fracionamento abaixo dela)
    fracMin: 3,                // R08: nº mínimo de títulos no mesmo dia
    atipicoFator: 4,           // R09: valor N vezes acima da mediana do fornecedor/conta
    atipicoMin: 1000,          // R09: valor mínimo para ser atípico
    pfMin: 3000,               // R12: total mínimo pago a possível pessoa física
    redondoMin: 10000,         // R14: valor redondo a partir de
    novoValor: 20000,          // R15: fornecedor novo com total pago a partir de
    novoDias: 60,              // R15: "novo" = primeira aparição N dias depois do início da base
    mesmoValorMin: 2000,       // R16: mesmo valor no mesmo dia para fornecedores diferentes
    vencidoMin: 5000,          // R18: título vencido em aberto a partir de
    vencidoDias: 30,           // R18: dias de atraso
    contasMin: 4,              // R19: fornecedor classificado em N ou mais contas contábeis
    benfordMinLinhas: 60,      // R10: mínimo de pagamentos para testar Benford por fornecedor
    benfordMAD: 0.015,         // R10: MAD acima disso = não conformidade (Nigrini)
  };

  // Contas onde certos padrões são normais
  const RX_MERCADORIA = /compras a prazo|compras a vista|frete de compra|adiantamentos? (a|à) fornecedores de mercadoria/i;
  const RX_ADIANTAMENTO = /adiantamento/i;
  const RX_TRIBUTO = /icms|iss\b|iptu|ipva|tribut|imposto|fgts|inss|pis|cofins|irrf|csll|contribui[cç][aã]o|taxa de|parcelamento|das\b|simples/i;
  const RX_FOLHA = /sal[aá]ri|f[eé]rias|re[cs]+is|pens[aã]o|fgts|13º|d[eé]cimo|pr[oó].?labore|vale transporte|ajuda de custo|pr[eê]mio|bolsa|est[aá]gi|inss|comiss|trabalhist|rpa\b|aut[oô]nomo|di[aá]ria|reembolso/i;
  const RX_RECORRENTE = /aluguel|condom[ií]nio|energia|[aá]gua|internet|link de|tarifa|taxas? administrativa|mensalidade|alarme|seguro|iptu|benef[ií]cio|sindicato|sa[uú]de ocupacional|credsystem|parcelamento|icms|cim\b/i;
  // Contas sensíveis: saída de caixa sem nota de mercadoria/serviço — olhar uma a uma
  const CONTAS_SENSIVEIS = [
    [/retirada banc/i, 'Retirada bancária (saque/dinheiro)'],
    [/partes relacionadas/i, 'Partes relacionadas (sócios/empresas do grupo)'],
    [/adiantamento/i, 'Adiantamento (sem a entrega ainda)'],
    [/acordo/i, 'Acordos'],
    [/ajuda de custo/i, 'Ajuda de custo'],
    [/pr[eê]mio/i, 'Prêmios'],
    [/doa[cç][aã]o|brinde|patroc/i, 'Doações/brindes/patrocínio'],
    [/multa|juros/i, 'Multas e juros'],
  ];
  const RX_EMPRESA = /\b(LTDA|S\/?A|S\.A|ME|EPP|EIRELI|MEI|CIA|COMPANHIA|COMERCIO|COMERCIAL|INDUSTRIA|SERVICOS?|ASSOCIACAO|INSTITUTO|CONDOMINIO|ADMINISTRADORA|BANCO|SECRETARIA|PREFEITURA|MUNICIPIO|ESTADO|FUNDO|SINDICATO|SHOPPING|TECNOLOGIA|TEC|SOLUCOES|LOCACAO|LOCADORA|TRANSPORTES?|DISTRIBUIDORA|GRUPO|HOLDING|PARTICIPACOES|EMPREENDIMENTOS|CONSTRUTORA|CONSULTORIA|ENGENHARIA|ASSESSORIA|AGENCIA|OPERADORA|EDITORA|IMOBILIARIA|COOPERATIVA|CAIXA|RECEITA|FAZENDA|SEFAZ|DETRAN|CORREIOS|TELECOM|TELEFONICA|ENERGIA|SANEAMENTO|COMPESA|NEOENERGIA|COSERN|CELPE|CAGEPA|CAERN|ENERGISA|CLARO|VIVO|TIM|OI|NET|UNIMED|HAPVIDA|SESC|SENAC|SEBRAE|SPE|LOJA|LOJAS|CALCADOS|ESPORTIVOS|ARTIGOS|PRODUTOS|MATERIAIS|EQUIPAMENTOS|SISTEMAS|INFORMATICA|DIGITAL|MARKETING|PUBLICIDADE|GRAFICA|PAPELARIA|SUPERMERCADO|ATACADO|VAREJO|COMBUSTIVEIS|POSTO|AUTO|PECAS|SEGUROS?|SEGURADORA|CARTORIO|TABELIONATO|ODONTO|SAUDE|CLINICA|LABORATORIO|HOSPITAL|FARMACIA|ESCOLA|FACULDADE|UNIVERSIDADE|EDUCACAO|HOTEL|POUSADA|TURISMO|VIAGENS|ALIMENTOS|RESTAURANTE|PADARIA|CONSERVACAO|LIMPEZA|VIGILANCIA|SEGURANCA|MONITORAMENTO|LOGISTICA|EXPRESS|CARGAS|EMBALAGENS|PLASTICOS|METALURGICA|MOVEIS|DECORACOES|ILUMINACAO|ELETRICA|HIDRAULICA|REFRIGERACAO|CLIMATIZACAO|ARQUITETURA|PROJETOS|ADVOGADOS|ADVOCACIA|CONTABIL|CONTABILIDADE|AUDITORIA|PAGAMENTOS|PAGSEGURO|GETNET|CIELO|STONE|REDE|BRADESCO|ITAU|SANTANDER|SICREDI|SICOOB|NUBANK|INTER|BTG|SAFRA|MERCADO|AMAZON|GOOGLE|MICROSOFT|META|FACEBOOK|APPLE|TOTVS|LINX|SALLAMO|ALLAMO)\b/;

  // Feriados nacionais (fixos + móveis 2025–2027)
  const FERIADOS = new Set([
    '2025-01-01', '2025-03-03', '2025-03-04', '2025-04-18', '2025-04-21', '2025-05-01', '2025-06-19', '2025-09-07', '2025-10-12', '2025-11-02', '2025-11-15', '2025-11-20', '2025-12-25',
    '2026-01-01', '2026-02-16', '2026-02-17', '2026-04-03', '2026-04-21', '2026-05-01', '2026-06-04', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25',
    '2027-01-01', '2027-02-08', '2027-02-09', '2027-03-26', '2027-04-21', '2027-05-01', '2027-05-27', '2027-09-07', '2027-10-12', '2027-11-02', '2027-11-15', '2027-11-20', '2027-12-25',
  ]);

  const REGRAS = {
    R01: {nome: 'Pagamento em duplicidade', sev: 'alta', desc: 'Mesmo fornecedor, mesmo valor, mesmo vencimento e mesmo centro de custo em títulos (códigos) diferentes. Clássico de pagamento em dobro ou nota lançada duas vezes. Alta = mesma competência fora de mercadoria.'},
    R02: {nome: 'Lançamento repetido no mesmo título', sev: 'media', desc: 'Linhas idênticas (valor, vencimento, conta e centro de custo) dentro do mesmo código. Pode ser rateio legítimo ou lançamento repetido.'},
    R03: {nome: 'Pago a maior', sev: 'alta', desc: 'Valor pago maior que o valor da parcela. Se pago em atraso, a diferença é juros/multa (custo evitável); se em dia, é pagamento indevido.'},
    R04: {nome: 'Status incoerente', sev: 'media', desc: 'Situação do título não bate com os valores: "Pago" com saldo, cancelado/renegociado com pagamento, "A vencer" já vencido, pago sem data.'},
    R05: {nome: 'Pagamento antecipado', sev: 'media', desc: 'Pago muito antes do vencimento ou antes da própria competência, fora de conta de adiantamento. Antecipar sem desconto é perda financeira e pode indicar favorecimento.'},
    R06: {nome: 'Pagamento em fim de semana/feriado', sev: 'media', desc: 'Baixa registrada em sábado, domingo ou feriado nacional — fora do expediente bancário normal.'},
    R08: {nome: 'Possível fracionamento', sev: 'alta', desc: 'Vários títulos do mesmo fornecedor pagos no mesmo dia, cada um abaixo da alçada de aprovação, mas que somados passam dela.'},
    R09: {nome: 'Valor atípico', sev: 'media', desc: 'Valor muito acima do padrão histórico do mesmo fornecedor na mesma conta contábil.'},
    R10: {nome: 'Lei de Benford', sev: 'baixa', desc: 'A distribuição do 1º dígito dos valores pagos ao fornecedor foge do padrão natural (Benford). Indica valores "inventados" ou ajustados.'},
    R11: {nome: 'Cadastro de fornecedor duplicado', sev: 'media', desc: 'Nomes de fornecedor quase iguais (grafia, espaços, sufixos). Cadastro duplicado facilita pagamento em dobro e desvio.'},
    R12: {nome: 'Pagamento a possível pessoa física', sev: 'media', desc: 'Fornecedor com nome de pessoa (sem razão social) recebendo fora das contas de folha. Conferir vínculo com funcionários e nota fiscal.'},
    R13: {nome: 'Conta sensível', sev: 'media', desc: 'Saídas em contas de alto risco (retirada bancária, partes relacionadas, adiantamentos, acordos, ajuda de custo…). Exigem comprovação individual.'},
    R14: {nome: 'Valores redondos altos', sev: 'baixa', desc: 'Pagamentos altos em valor "cheio" (múltiplos de R$ 1.000) fora de compra de mercadoria — típico de estimativas sem documento.'},
    R15: {nome: 'Fornecedor novo com valor alto', sev: 'media', desc: 'Fornecedor que apareceu recentemente e já recebeu valor relevante. Validar cadastro, CNPJ, sócios e entrega.'},
    R16: {nome: 'Mesmo valor, mesmo dia, fornecedores diferentes', sev: 'baixa', desc: 'O mesmo valor exato pago no mesmo dia a fornecedores diferentes. Pode ser coincidência ou o mesmo documento usado duas vezes.'},
    R17: {nome: 'Datas incoerentes', sev: 'baixa', desc: 'Vencimento antes da competência ou competência muito distante do vencimento (lançamento retroativo).'},
    R18: {nome: 'Vencido em aberto', sev: 'media', desc: 'Título vencido há mais de 30 dias sem pagamento: risco de juros, multa, protesto e corte de fornecimento.'},
    R19: {nome: 'Classificação contábil inconsistente', sev: 'baixa', desc: 'O mesmo fornecedor lançado em muitas contas contábeis diferentes. Distorce o DRE e pode esconder despesa.'},
  };
  const PESO = {alta: 10, media: 4, baixa: 1};

  // ---------- utilidades ----------
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const dia = s => s ? String(s).slice(0, 10) : null;
  const ms = iso => Date.parse(iso + 'T12:00:00Z');
  const difDias = (a, b) => Math.round((ms(a) - ms(b)) / 86400000);
  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const limpaNome = s => semAcento(s).toUpperCase().replace(/\s+/g, ' ').trim();
  // chave para comparar cadastros: sem sufixos societários, pontuação e espaços
  const chaveNome = s => limpaNome(s).replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\b(LTDA|ME|EPP|EIRELI|SA|S A|CIA|MEI|E|DE|DA|DO|DOS|DAS)\b/g, ' ').replace(/\s+/g, '').trim();
  const mediana = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const quartil = (a, q) => { const s = [...a].sort((x, y) => x - y); const p = (s.length - 1) * q, b = Math.floor(p); return s[b] + ((s[b + 1] ?? s[b]) - s[b]) * (p - b); };
  const diaSemana = iso => new Date(ms(iso)).getUTCDay();
  const hojeSP = () => new Date().toLocaleDateString('en-CA', {timeZone: 'America/Sao_Paulo'});
  function levenshtein(a, b) {
    if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
    let ant = Array.from({length: b.length + 1}, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(ant[j] + 1, cur[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      ant = cur;
    }
    return ant[b.length];
  }
  const similar = (a, b) => 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  const contaSensivel = c => { for (const [rx, nome] of CONTAS_SENSIVEIS) if (rx.test(c)) return nome; return null; };
  const pareceEmpresa = nome => RX_EMPRESA.test(nome) || /\d/.test(nome) || /[\/&\.]/.test(nome);
  // Pessoa física: começa por um prenome comum, 2 a 6 palavras só com letras e nenhum termo de empresa
  const PRENOMES = new Set(('ADRIANA ADRIANO AILTON ALAN ALESSANDRA ALEX ALEXANDRE ALINE ALISSON AMANDA ANA ANDERSON ANDRE ANDREA ANDREIA ANGELA ANTONIO ARTHUR AUGUSTO BEATRIZ BRUNA BRUNO CAIO CAMILA CARLA CARLOS CAROLINA CASSIO CELSO CESAR CICERO CLARA CLAUDIA CLAUDIO CLEBER CRISTIANE CRISTIANO DANIEL DANIELA DANIELE DANILO DAVI DAVID DEBORA DENISE DIANA DIEGO DOUGLAS EDSON EDUARDO ELAINE ELIANE ELIAS ELISANGELA EMERSON ENILDO ERICA ERIK EVANDRO EVERTON FABIANA FABIANO FABIO FABRICIO FATIMA FELIPE FERNANDA FERNANDO FLAVIA FLAVIO FRANCISCA FRANCISCO GABRIEL GABRIELA GERALDO GERSON GILBERTO GILSON GIOVANA GISELE GLAUCIA GUILHERME GUSTAVO HELENA HELIO HENRIQUE HUGO IGOR ISABEL ISABELA ISRAEL IVAN JACKSON JAIR JAQUELINE JEFERSON JEFFERSON JESSICA JOANA JOAO JOAQUIM JONAS JONATHAN JORGE JOSE JOSEFA JOSUE JULIA JULIANA JULIANO JULIO KARINA KATIA KELLY LARISSA LAURA LEANDRO LEONARDO LETICIA LIDIANE LUANA LUCAS LUCIA LUCIANA LUCIANO LUIS LUIZ LUIZA MANOEL MANUEL MARCELA MARCELO MARCIA MARCIO MARCO MARCOS MARCUS MARIA MARIANA MARINA MARIO MARLENE MATEUS MATHEUS MAURICIO MAURO MICHAEL MICHELE MIGUEL MILENA MIRIAM MOISES MONICA NATALIA NATHALIA NELSON NILTON NIVALDO OSVALDO OTAVIO PATRICIA PAULA PAULO PEDRO PRISCILA RAFAEL RAFAELA RAIMUNDO RAQUEL REGINA REGINALDO RENAN RENATA RENATO RICARDO RITA ROBERTA ROBERTO ROBSON RODOLFO RODRIGO ROGERIO RONALDO ROSA ROSANA ROSANGELA RUBENS SAMUEL SANDRA SANDRO SARA SERGIO SEVERINO SILVANA SILVIA SILVIO SIMONE SONIA SUELI TAIS TALITA TATIANA TATIANE THIAGO TIAGO VALDIR VALERIA VANESSA VERA VICTOR VINICIUS VITOR VIVIANE WAGNER WALTER WANDERLEY WASHINGTON WELLINGTON WESLEY WILLIAM WILSON').split(' '));
  const parecePessoa = nome => { const p = nome.split(' ').filter(Boolean); return p.length >= 2 && p.length <= 6 && PRENOMES.has(p[0]) && !pareceEmpresa(nome) && p.every(x => /^[A-Z]+$/.test(x)); };

  // ---------- normalização ----------
  // Cada linha da API vira um "título" (parcela/rateio). id = código + posição dentro do código (estável para a mesma consulta).
  function normalizar(dados) {
    const vistos = {};
    return (dados || []).map((x, i) => {
      const cod = x.codigo;
      vistos[cod] = (vistos[cod] || 0) + 1;
      const fornecedorBruto = String(x.fornecedor ?? '');
      return {
        i, id: `${cod}#${vistos[cod]}`, codigo: cod,
        status: String(x.status || '').trim(),
        fornecedor: limpaNome(fornecedorBruto) || '(SEM FORNECEDOR)', fornecedorBruto,
        valorParcela: r2(x.valorParcela), valorPago: r2(x.valorPago), saldo: r2(x.saldo),
        vencimento: dia(x.vencimento), competencia: dia(x.competencia), pagamento: dia(x.dataPagamento),
        conta: String(x.contaContabil || '(sem conta)').trim(), cc: String(x.centroCusto || '(sem centro)').replace(/\s+/g, ' ').trim(),
      };
    });
  }

  // ---------- análise ----------
  function analisar(dados, opcoes) {
    const cfg = Object.assign({}, PADRAO, opcoes || {});
    const hoje = cfg.hoje || hojeSP();
    const T = normalizar(dados);
    const pagos = T.filter(t => t.valorPago > 0 && t.pagamento);
    const ocorrencias = [];
    const add = (regra, chave, o) => ocorrencias.push(Object.assign({
      id: regra + '|' + chave, regra, nome: REGRAS[regra].nome, sev: o.sev || REGRAS[regra].sev, impacto: 0, titulos: [],
    }, o));
    // início real da base = primeiro pagamento registrado (a competência pode vir de lançamentos antigos)
    const inicioBase = pagos.map(t => t.pagamento).sort()[0] || hoje;

    // R01 — duplicidade: mesmo fornecedor + mesmo valor pago + mesmo vencimento + mesmo centro de custo, em códigos
    // (títulos) diferentes. Não entram: parcelas de contrato (vencimentos diferentes), cobrança por loja (centros de
    // custo diferentes) e lote de vários pedidos iguais de mercadoria (grade de calçado).
    const porFV = agrupar(pagos.filter(t => t.valorPago >= cfg.dupMin && t.vencimento), t => [t.fornecedor, t.valorPago.toFixed(2), t.vencimento, t.cc].join('|'));
    for (const [k, g] of porFV) {
      const cods = unicos(g.map(t => t.codigo));
      if (cods.length < 2) continue;
      const merc = RX_MERCADORIA.test(g[0].conta);
      if (merc && cods.length >= 3) continue;
      if (cods.length >= cfg.dupRecorrente && RX_RECORRENTE.test(g[0].conta)) continue;
      const mesmaComp = new Set(g.map(t => t.competencia)).size === 1;
      const pags = unicos(g.map(t => t.pagamento)).sort();
      const x = g[0];
      add('R01', k + '|' + cods.join('-'), {
        sev: !merc && mesmaComp ? 'alta' : 'media', fornecedor: x.fornecedor, conta: unicos(g.map(t => t.conta)).join(' / '), cc: unicos(g.map(t => t.cc)).join(' / '),
        impacto: r2(x.valorPago * (cods.length - 1)), titulos: g.map(t => t.i),
        detalhe: `${brl(x.valorPago)} pago ${cods.length}× com vencimento ${dBRa(x.vencimento)} no ${x.cc} · códigos ${cods.join(', ')} · pago em ${pags.map(dBR).join(', ')}` +
          (mesmaComp ? ' · mesma competência' : ''),
      });
    }

    // R02 — linhas idênticas dentro do mesmo código
    const porLinha = agrupar(T, t => [t.codigo, t.valorParcela.toFixed(2), t.vencimento, t.conta, t.cc].join('|'));
    for (const [k, g] of porLinha) {
      if (g.length < 2) continue;
      const x = g[0];
      add('R02', k, {fornecedor: x.fornecedor, conta: x.conta, cc: x.cc, impacto: r2(x.valorParcela * (g.length - 1)), titulos: g.map(t => t.i),
        detalhe: `Cód. ${x.codigo}: ${g.length} linhas idênticas de ${brl(x.valorParcela)} (venc. ${dBR(x.vencimento)}) · total ${brl(x.valorParcela * g.length)}`});
    }

    // R03 — pago a maior
    for (const t of pagos) {
      const dif = r2(t.valorPago - t.valorParcela);
      if (dif <= cfg.tolerancia) continue;
      const atraso = t.vencimento ? difDias(t.pagamento, t.vencimento) : 0;
      const pct = t.valorParcela ? dif / t.valorParcela : 1;
      const juros = atraso > 0;
      add('R03', t.id, {sev: juros && pct < 0.1 ? 'media' : 'alta', fornecedor: t.fornecedor, conta: t.conta, cc: t.cc, impacto: dif, titulos: [t.i],
        detalhe: `Cód. ${t.codigo}: parcela ${brl(t.valorParcela)}, pago ${brl(t.valorPago)} (+${brl(dif)} · ${(pct * 100).toFixed(1)}%)` +
          (juros ? ` · pago ${atraso} dia(s) após o vencimento → juros/multa` : ' · pago em dia → pagamento indevido')});
    }

    // R04 — status incoerente
    for (const t of T) {
      let m = null;
      if (t.status === 'Pago' && t.saldo > cfg.tolerancia) m = `"Pago" com saldo de ${brl(t.saldo)} em aberto (pago ${brl(t.valorPago)} de ${brl(t.valorParcela)})`;
      else if (t.status === 'Pago' && !t.pagamento) m = '"Pago" sem data de pagamento';
      else if (/cancel/i.test(t.status) && (t.valorPago > 0 || t.pagamento)) m = `Cancelado mas com pagamento de ${brl(t.valorPago)}`;
      else if (/(vencido|renegociado|a vencer|previsto)/i.test(t.status) && t.valorPago > 0) m = `"${t.status}" mas já tem ${brl(t.valorPago)} pago em ${dBR(t.pagamento)}`;
      else if (/a vencer|previsto/i.test(t.status) && t.vencimento && t.vencimento < hoje && t.saldo > 0) m = `"${t.status}" com vencimento já passado (${dBR(t.vencimento)})`;
      if (m) add('R04', t.id, {sev: /Cancelado/.test(m) ? 'alta' : 'media', fornecedor: t.fornecedor, conta: t.conta, cc: t.cc, impacto: t.saldo > 0 ? t.saldo : t.valorPago, titulos: [t.i], detalhe: `Cód. ${t.codigo}: ${m}`});
    }

    // R05 — antecipado
    for (const t of pagos) {
      if (RX_ADIANTAMENTO.test(t.conta)) continue;
      const antesVenc = t.vencimento ? difDias(t.vencimento, t.pagamento) : 0;
      const antesComp = t.competencia ? difDias(t.competencia, t.pagamento) : 0;
      if (antesComp > cfg.antecipDias) add('R05', t.id, {sev: 'media', fornecedor: t.fornecedor, conta: t.conta, cc: t.cc, impacto: t.valorPago, titulos: [t.i],
        detalhe: `Cód. ${t.codigo}: pago em ${dBR(t.pagamento)}, ${antesComp} dias ANTES da competência (${dBR(t.competencia)}) — pagou antes do fato gerador`});
      else if (antesVenc >= cfg.antecipDias) add('R05', t.id, {sev: antesVenc >= 60 ? 'media' : 'baixa', fornecedor: t.fornecedor, conta: t.conta, cc: t.cc, impacto: t.valorPago, titulos: [t.i],
        detalhe: `Cód. ${t.codigo}: pago em ${dBR(t.pagamento)}, ${antesVenc} dias antes do vencimento (${dBR(t.vencimento)})`});
    }

    // R06 — fim de semana / feriado
    for (const t of pagos) {
      const ds = diaSemana(t.pagamento), fer = FERIADOS.has(t.pagamento);
      if (ds !== 0 && ds !== 6 && !fer) continue;
      add('R06', t.id, {fornecedor: t.fornecedor, conta: t.conta, cc: t.cc, impacto: t.valorPago, titulos: [t.i],
        detalhe: `Cód. ${t.codigo}: ${brl(t.valorPago)} pago em ${dBR(t.pagamento)} (${fer ? 'feriado nacional' : ds === 0 ? 'domingo' : 'sábado'})`});
    }

    // R08 — fracionamento
    const porFD = agrupar(pagos.filter(t => !RX_MERCADORIA.test(t.conta) && t.valorPago < cfg.alcada), t => t.fornecedor + '|' + t.pagamento);
    for (const [k, g] of porFD) {
      const cods = new Set(g.map(t => t.codigo));
      const soma = r2(g.reduce((s, t) => s + t.valorPago, 0));
      if (cods.size < cfg.fracMin || soma < cfg.alcada) continue;
      add('R08', k, {sev: soma >= cfg.alcada * 2 ? 'alta' : 'media', fornecedor: g[0].fornecedor, conta: unicos(g.map(t => t.conta)).join(' / '), cc: unicos(g.map(t => t.cc)).join(' / '),
        impacto: soma, titulos: g.map(t => t.i),
        detalhe: `${cods.size} títulos pagos em ${dBR(g[0].pagamento)}, todos abaixo de ${brl(cfg.alcada)}, somando ${brl(soma)}`});
    }

    // R09 — valor atípico por fornecedor + conta
    for (const [, g] of agrupar(pagos, t => t.fornecedor + '|' + t.conta)) {
      if (g.length < 6) continue;
      const v = g.map(t => t.valorPago), med = mediana(v), q1 = quartil(v, .25), q3 = quartil(v, .75), lim = q3 + 3 * (q3 - q1);
      for (const t of g) if (t.valorPago >= cfg.atipicoMin && t.valorPago > med * cfg.atipicoFator && t.valorPago > lim)
        add('R09', t.id, {sev: t.valorPago > med * 10 ? 'alta' : 'media', fornecedor: t.fornecedor, conta: t.conta, cc: t.cc, impacto: r2(t.valorPago - med), titulos: [t.i],
          detalhe: `Cód. ${t.codigo}: ${brl(t.valorPago)} contra mediana de ${brl(med)} em ${g.length} pagamentos (${(t.valorPago / med).toFixed(1)}× o normal)`});
    }

    // R10 — Benford (geral + por fornecedor)
    const benford = benfordDe(pagos.map(t => t.valorPago));
    // preço de mercadoria segue a tabela do fornecedor (não é "natural") e tributo é calculado: ficam fora do teste
    for (const [f, g] of agrupar(pagos.filter(t => t.valorPago >= 10 && !RX_MERCADORIA.test(t.conta) && !RX_TRIBUTO.test(t.conta)), t => t.fornecedor)) {
      if (g.length < cfg.benfordMinLinhas) continue;
      const b = benfordDe(g.map(t => t.valorPago));
      if (b.mad > cfg.benfordMAD) add('R10', f, {fornecedor: f, conta: unicos(g.map(t => t.conta)).slice(0, 3).join(' / '), impacto: r2(g.reduce((s, t) => s + t.valorPago, 0)), titulos: g.map(t => t.i), benford: b,
        detalhe: `${g.length} pagamentos · MAD ${b.mad.toFixed(4)} (${b.conformidade}) · dígito mais fora do padrão: ${b.pior.d} (${(b.pior.obs * 100).toFixed(1)}% vs ${(b.pior.esp * 100).toFixed(1)}% esperado)`});
    }

    // R11 — cadastro duplicado
    const fornecedores = new Map();
    for (const t of T) { const k = t.fornecedor; if (!fornecedores.has(k)) fornecedores.set(k, {nome: k, brutos: new Set(), total: 0, n: 0}); const f = fornecedores.get(k); f.brutos.add(t.fornecedorBruto); f.total += t.valorPago; f.n++; }
    const porChave = agrupar([...fornecedores.values()], f => chaveNome(f.nome));
    const jaPar = new Set();
    for (const [k, g] of porChave) if (k && g.length > 1) {
      jaPar.add(k);
      add('R11', 'eq|' + k, {fornecedor: g.map(f => f.nome).join(' ≈ '), impacto: r2(g.reduce((s, f) => s + f.total, 0)), titulos: T.filter(t => g.some(f => f.nome === t.fornecedor)).map(t => t.i),
        detalhe: `${g.length} cadastros que só mudam em sufixo/pontuação: ${g.map(f => `"${f.nome}" (${f.n} títulos)`).join(', ')}`});
    }
    const chaves = [...porChave.keys()].filter(k => k.length >= 8);
    const blocos = agrupar(chaves, k => k.slice(0, 4));
    for (const [, bl] of blocos) for (let a = 0; a < bl.length; a++) for (let b = a + 1; b < bl.length; b++) {
      const x = bl[a], y = bl[b];
      if (Math.abs(x.length - y.length) > 3) continue;
      const s = similar(x, y);
      if (s < 0.9) continue;
      const fx = porChave.get(x)[0], fy = porChave.get(y)[0];
      add('R11', 'sim|' + [x, y].sort().join('|'), {sev: 'media', fornecedor: `${fx.nome} ≈ ${fy.nome}`, impacto: r2(fx.total + fy.total),
        titulos: T.filter(t => t.fornecedor === fx.nome || t.fornecedor === fy.nome).map(t => t.i),
        detalhe: `Nomes ${(s * 100).toFixed(0)}% iguais: "${fx.nome}" (${fx.n} títulos, ${brl(fx.total)}) e "${fy.nome}" (${fy.n} títulos, ${brl(fy.total)})`});
    }

    // R12 — possível pessoa física fora da folha
    for (const [f, g] of agrupar(pagos.filter(t => !RX_FOLHA.test(t.conta)), t => t.fornecedor)) {
      if (!parecePessoa(f)) continue;
      const tot = r2(g.reduce((s, t) => s + t.valorPago, 0));
      if (tot < cfg.pfMin) continue;
      add('R12', f, {sev: tot >= 30000 ? 'alta' : 'media', fornecedor: f, conta: unicos(g.map(t => t.conta)).join(' / '), cc: unicos(g.map(t => t.cc)).slice(0, 4).join(' / '), impacto: tot, titulos: g.map(t => t.i),
        detalhe: `${g.length} pagamento(s) somando ${brl(tot)} em ${unicos(g.map(t => t.conta)).length} conta(s): ${unicos(g.map(t => t.conta)).slice(0, 3).join(', ')}`});
    }

    // R13 — contas sensíveis (agrupado por conta + fornecedor)
    for (const [k, g] of agrupar(pagos.filter(t => contaSensivel(t.conta)), t => t.conta + '|' + t.fornecedor)) {
      const tot = r2(g.reduce((s, t) => s + t.valorPago, 0));
      if (tot < 500) continue;
      const tipo = contaSensivel(g[0].conta);
      add('R13', k, {sev: /retirada|partes/i.test(g[0].conta) && tot >= 20000 ? 'alta' : 'media', fornecedor: g[0].fornecedor, conta: g[0].conta, cc: unicos(g.map(t => t.cc)).slice(0, 4).join(' / '), impacto: tot, titulos: g.map(t => t.i),
        detalhe: `${tipo}: ${g.length} pagamento(s) somando ${brl(tot)} · maior ${brl(Math.max(...g.map(t => t.valorPago)))}`});
    }

    // R14 — redondos altos (agrupado por fornecedor)
    for (const [f, g] of agrupar(pagos.filter(t => !RX_MERCADORIA.test(t.conta) && !RX_RECORRENTE.test(t.conta) && t.valorPago >= cfg.redondoMin && t.valorPago % 1000 === 0), t => t.fornecedor)) {
      const tot = r2(g.reduce((s, t) => s + t.valorPago, 0));
      add('R14', f, {fornecedor: f, conta: unicos(g.map(t => t.conta)).join(' / '), impacto: tot, titulos: g.map(t => t.i),
        detalhe: `${g.length} pagamento(s) redondo(s): ${g.slice(0, 5).map(t => brl(t.valorPago)).join(', ')}${g.length > 5 ? '…' : ''} · total ${brl(tot)}`});
    }

    // R15 — fornecedor novo com valor alto
    const limiteNovo = addDias(inicioBase, cfg.novoDias);
    for (const [f, g] of agrupar(T, t => t.fornecedor)) {
      const prim = g.map(t => t.competencia).filter(Boolean).sort()[0];
      if (!prim || prim < limiteNovo) continue;
      const tot = r2(g.reduce((s, t) => s + t.valorPago, 0));
      if (tot < cfg.novoValor) continue;
      add('R15', f, {sev: tot >= cfg.novoValor * 5 ? 'alta' : 'media', fornecedor: f, conta: unicos(g.map(t => t.conta)).join(' / '), impacto: tot, titulos: g.map(t => t.i),
        detalhe: `Primeiro lançamento em ${dBRa(prim)} e já recebeu ${brl(tot)} em ${g.filter(t => t.valorPago > 0).length} pagamento(s)`});
    }

    // R16 — mesmo valor, mesmo dia, fornecedores diferentes
    for (const [k, g] of agrupar(pagos.filter(t => t.valorPago >= cfg.mesmoValorMin), t => t.pagamento + '|' + t.valorPago.toFixed(2))) {
      const fs = unicos(g.map(t => t.fornecedor));
      if (fs.length < 2) continue;
      if (g[0].valorPago % 1000 === 0 && RX_RECORRENTE.test(g[0].conta)) continue;
      add('R16', k, {fornecedor: fs.join(' / '), conta: unicos(g.map(t => t.conta)).join(' / '), impacto: g[0].valorPago, titulos: g.map(t => t.i),
        detalhe: `${brl(g[0].valorPago)} pago em ${dBR(g[0].pagamento)} a ${fs.length} fornecedores: ${fs.slice(0, 4).join('; ')}`});
    }

    // R17 — datas incoerentes
    for (const t of T) {
      if (!t.vencimento || !t.competencia) continue;
      const d = difDias(t.vencimento, t.competencia);
      let m = null;
      if (d < -5) m = `vencimento (${dBRa(t.vencimento)}) ${-d} dias ANTES da competência (${dBRa(t.competencia)})`;
      else if (d > 365) m = `vencimento ${d} dias depois da competência (${dBRa(t.competencia)} → ${dBRa(t.vencimento)})`;
      if (m) add('R17', t.id, {fornecedor: t.fornecedor, conta: t.conta, cc: t.cc, impacto: t.valorParcela, titulos: [t.i], detalhe: `Cód. ${t.codigo}: ${m}`});
    }

    // R18 — vencidos em aberto
    for (const t of T) {
      if (t.saldo < cfg.vencidoMin || !t.vencimento || /cancel|pago/i.test(t.status)) continue;
      const atraso = difDias(hoje, t.vencimento);
      if (atraso < cfg.vencidoDias) continue;
      add('R18', t.id, {sev: atraso > 90 || t.saldo > 50000 ? 'alta' : 'media', fornecedor: t.fornecedor, conta: t.conta, cc: t.cc, impacto: t.saldo, titulos: [t.i],
        detalhe: `Cód. ${t.codigo}: ${brl(t.saldo)} vencido em ${dBRa(t.vencimento)} (${atraso} dias) · status "${t.status}"`});
    }

    // R19 — classificação inconsistente
    for (const [f, g] of agrupar(T, t => t.fornecedor)) {
      const cs = unicos(g.map(t => t.conta));
      if (cs.length < cfg.contasMin) continue;
      add('R19', f, {fornecedor: f, conta: cs.join(' / '), impacto: r2(g.reduce((s, t) => s + t.valorPago, 0)), titulos: g.map(t => t.i),
        detalhe: `${cs.length} contas contábeis diferentes para o mesmo fornecedor: ${cs.slice(0, 6).join(', ')}${cs.length > 6 ? '…' : ''}`});
    }

    for (const o of ocorrencias) o.impacto = r2(o.impacto);
    ocorrencias.sort((a, b) => PESO[b.sev] - PESO[a.sev] || b.impacto - a.impacto);

    return {cfg, hoje, titulos: T, ocorrencias, benford, indicadores: indicadores(T, pagos, hoje), riscoFornecedor: risco(ocorrencias, T, 'fornecedor'), riscoCC: riscoCentro(ocorrencias, T)};
  }

  // ---------- indicadores ----------
  function indicadores(T, pagos, hoje) {
    const soma = (a, f) => r2(a.reduce((s, t) => s + f(t), 0));
    const abertos = T.filter(t => t.saldo > 0 && !/cancel/i.test(t.status) && t.status !== 'Pago');
    const vencidos = abertos.filter(t => t.vencimento && t.vencimento < hoje);
    const faixas = [['A vencer', -Infinity, 0], ['1–30 dias', 1, 30], ['31–60 dias', 31, 60], ['61–90 dias', 61, 90], ['+90 dias', 91, Infinity]];
    const aging = faixas.map(([nome, de, ate]) => { const g = abertos.filter(t => { const d = t.vencimento ? difDias(hoje, t.vencimento) : 0; return d >= de && d <= ate; }); return {nome, n: g.length, valor: soma(g, t => t.saldo)}; });
    const comPrazo = pagos.filter(t => t.vencimento);
    const atraso = comPrazo.map(t => difDias(t.pagamento, t.vencimento));
    const pagosAtraso = comPrazo.filter((t, i) => atraso[i] > 0);
    const juros = r2(pagos.filter(t => t.valorPago > t.valorParcela + 0.01 && t.vencimento && t.pagamento > t.vencimento).reduce((s, t) => s + t.valorPago - t.valorParcela, 0));
    const porForn = [...agrupar(pagos, t => t.fornecedor)].map(([f, g]) => ({f, v: soma(g, t => t.valorPago), n: g.length})).sort((a, b) => b.v - a.v);
    const totPago = soma(pagos, t => t.valorPago);
    const hhi = porForn.reduce((s, x) => s + Math.pow(x.v / (totPago || 1) * 100, 2), 0);
    const porMes = [...agrupar(pagos, t => t.pagamento.slice(0, 7))].map(([m, g]) => ({m, v: soma(g, t => t.valorPago), n: g.length})).sort((a, b) => a.m.localeCompare(b.m));
    const porConta = [...agrupar(pagos, t => t.conta)].map(([c, g]) => ({c, v: soma(g, t => t.valorPago), n: g.length})).sort((a, b) => b.v - a.v);
    const porCC = [...agrupar(pagos, t => t.cc)].map(([c, g]) => ({c, v: soma(g, t => t.valorPago), n: g.length})).sort((a, b) => b.v - a.v);
    const status = [...agrupar(T, t => t.status)].map(([s, g]) => ({s, n: g.length, valor: soma(g, t => t.valorParcela), saldo: soma(g, t => t.saldo)})).sort((a, b) => b.valor - a.valor);
    return {
      titulos: T.length, codigos: new Set(T.map(t => t.codigo)).size, fornecedores: new Set(T.map(t => t.fornecedor)).size,
      valorTotal: soma(T, t => t.valorParcela), totalPago: totPago, emAberto: soma(abertos, t => t.saldo), vencido: soma(vencidos, t => t.saldo), nVencidos: vencidos.length,
      prazoMedioAtraso: pagosAtraso.length ? r2(atraso.filter(d => d > 0).reduce((s, d) => s + d, 0) / pagosAtraso.length) : 0,
      pctPagoAtraso: comPrazo.length ? r2(pagosAtraso.length / comPrazo.length * 100) : 0, juros,
      top10: porForn.slice(0, 10), pctTop10: totPago ? r2(porForn.slice(0, 10).reduce((s, x) => s + x.v, 0) / totPago * 100) : 0, hhi: Math.round(hhi),
      porMes, porConta, porCC, status, aging,
    };
  }

  function risco(ocs, T, campo) {
    const m = new Map();
    for (const o of ocs) {
      const nomes = o.regra === 'R11' || o.regra === 'R16' ? [] : [o.fornecedor];
      for (const n of nomes) { if (!n) continue; if (!m.has(n)) m.set(n, {nome: n, pontos: 0, alta: 0, media: 0, baixa: 0, regras: new Set(), pior: {}, impacto: 0}); const x = m.get(n); x.pontos += PESO[o.sev]; x[o.sev]++; x.regras.add(o.regra); x.impacto += o.impacto;
        if (!x.pior[o.regra] || PESO[o.sev] > PESO[x.pior[o.regra]]) x.pior[o.regra] = o.sev; }
    }
    const pago = new Map(); for (const t of T) pago.set(t[campo], (pago.get(t[campo]) || 0) + t.valorPago);
    return [...m.values()].map(x => Object.assign(x, {regras: [...x.regras].sort(), impacto: r2(x.impacto), pago: r2(pago.get(x.nome) || 0),
      // pontuação 0–100 por CRUZAMENTO de indícios: cada regra diferente soma o peso da sua pior ocorrência
      // (volume não infla a nota — 50 notas de um fornecedor grande não valem mais que 2 indícios distintos)
      score: Math.min(100, Math.round([...x.regras].reduce((s, r) => s + PESO[x.pior[r]] * 2.5, 0)))})).sort((a, b) => b.score - a.score || b.impacto - a.impacto);
  }
  function riscoCentro(ocs, T) {
    const m = new Map();
    for (const o of ocs) for (const i of new Set(o.titulos.map(i => T[i].cc))) {
      if (!m.has(i)) m.set(i, {nome: i, pontos: 0, alta: 0, media: 0, baixa: 0, regras: new Set(), n: 0}); const x = m.get(i); x.pontos += PESO[o.sev]; x[o.sev]++; x.regras.add(o.regra); x.n++;
    }
    return [...m.values()].map(x => Object.assign(x, {regras: [...x.regras].sort()})).sort((a, b) => b.pontos - a.pontos);
  }

  // Benford (1º dígito) com MAD de Nigrini: <0,006 conforme · <0,012 aceitável · <0,015 marginal · acima não conforme
  function benfordDe(valores) {
    const cont = Array(10).fill(0); let n = 0;
    for (const v of valores) { const s = String(Math.abs(v)).replace(/^[0.]+/, ''); const d = Number(s[0]); if (d >= 1 && d <= 9) { cont[d]++; n++; } }
    const digitos = []; let mad = 0, pior = null;
    for (let d = 1; d <= 9; d++) {
      const esp = Math.log10(1 + 1 / d), obs = n ? cont[d] / n : 0, dif = Math.abs(obs - esp);
      mad += dif; digitos.push({d, esp, obs, n: cont[d]});
      if (!pior || dif > Math.abs(pior.obs - pior.esp)) pior = {d, esp, obs};
    }
    mad /= 9;
    const conformidade = mad < 0.006 ? 'conforme' : mad < 0.012 ? 'aceitável' : mad < 0.015 ? 'marginal' : 'não conforme';
    return {n, digitos, mad, conformidade, pior};
  }

  // ---------- helpers ----------
  function agrupar(a, chave) { const m = new Map(); for (const x of a) { const k = chave(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }
  function unicos(a) { return [...new Set(a)]; }
  function addDias(iso, n) { const d = new Date(ms(iso)); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function brl(v) { return Number(v || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'}); }
  function dBR(d) { return d ? d.split('-').reverse().slice(0, 2).join('/') : '—'; }
  function dBRa(d) { return d ? d.split('-').reverse().join('/') : '—'; }

  // ---------- busca em vários formatos ----------
  // Cada termo separado por espaço precisa casar (E). Formatos aceitos:
  //   R01            regra                         16097        código do título (ou valor exato)
  //   R$ 16.381,30 · 16381,30 · 16.381,30 · 16381.30          valor (parcela, pago, saldo ou impacto, ±1 centavo)
  //   >10000 · <500 · >=1.000,00 · 1000-5000 · 1.000,00..5.000,00   faixa de valor
  //   15/06/2026 · 15/06/26 · 15/06 · 2026-06-15                data (vencimento, competência ou pagamento)
  //   06/2026 · 2026-06                                          mês
  //   "texto com espaço" · liber · aluguel                       texto (fornecedor, conta, centro de custo, detalhe)
  const numBR = s => {
    let t = String(s).replace(/R\$|\s/gi, '');
    if (/,/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    const n = Number(t); return isFinite(n) && t !== '' ? r2(n) : NaN;
  };
  const RX_NUM = '(?:R\\$\\s*)?\\d[\\d.,]*';
  function interpretarBusca(q) {
    const termos = [];
    const pedacos = String(q || '').match(/"[^"]+"|R\$\s*[\d.,]+|\S+/gi) || [];
    for (let p of pedacos) {
      let m;
      if (/^"/.test(p)) { const t = semAcento(p.slice(1, -1)).toUpperCase().trim(); if (t) termos.push({tipo: 'texto', v: t, rotulo: `texto "${t}"`}); continue; }
      if ((m = p.match(/^R(\d{2})$/i)) && REGRAS['R' + m[1]]) { termos.push({tipo: 'regra', v: 'R' + m[1], rotulo: `regra R${m[1]}`}); continue; }
      if ((m = p.match(new RegExp(`^(>=|<=|>|<)(${RX_NUM})$`, 'i'))) && isFinite(numBR(m[2]))) { termos.push({tipo: 'faixa', op: m[1], v: numBR(m[2]), rotulo: `valor ${m[1]} ${brl(numBR(m[2]))}`}); continue; }
      if ((m = p.match(/^(\d{4})-(\d{2})-(\d{2})$/))) { termos.push({tipo: 'data', v: p, rotulo: `data ${dBRa(p)}`}); continue; }
      if ((m = p.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) {
        const ano = m[3].length === 2 ? '20' + m[3] : m[3], iso = `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        termos.push({tipo: 'data', v: iso, rotulo: `data ${dBRa(iso)}`}); continue;
      }
      if ((m = p.match(/^(\d{1,2})\/(\d{4})$/)) || (m = p.match(/^(\d{4})-(\d{1,2})$/))) {
        const [ano, mes] = m[1].length === 4 ? [m[1], m[2]] : [m[2], m[1]];
        if (+mes >= 1 && +mes <= 12) { const v = `${ano}-${mes.padStart(2, '0')}`; termos.push({tipo: 'mes', v, rotulo: `mês ${mes.padStart(2, '0')}/${ano}`}); continue; }
      }
      if ((m = p.match(new RegExp(`^(${RX_NUM})(?:\\.\\.|-|a)(${RX_NUM})$`, 'i'))) && !/\//.test(p) && isFinite(numBR(m[1])) && isFinite(numBR(m[2]))) {
        const a = numBR(m[1]), b = numBR(m[2]); termos.push({tipo: 'faixa', op: 'entre', v: Math.min(a, b), v2: Math.max(a, b), rotulo: `valor entre ${brl(Math.min(a, b))} e ${brl(Math.max(a, b))}`}); continue;
      }
      if ((m = p.match(/^(\d{1,2})\/(\d{1,2})$/)) && +m[2] <= 12 && +m[1] <= 31) { const v = `-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; termos.push({tipo: 'diames', v, rotulo: `dia ${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')} (qualquer ano)`}); continue; }
      if (/^\d+$/.test(p)) { termos.push({tipo: 'codigo', v: p, n: Number(p), rotulo: `código ${p} ou valor ${brl(Number(p))}`}); continue; }
      if (new RegExp(`^${RX_NUM}$`, 'i').test(p) && /[,.$]/.test(p) && isFinite(numBR(p))) { termos.push({tipo: 'valor', v: numBR(p), rotulo: `valor ${brl(numBR(p))}`}); continue; }
      const t = semAcento(p).toUpperCase(); termos.push({tipo: 'texto', v: t, rotulo: `texto "${t}"`});
    }
    return termos;
  }
  const igual = (a, b) => Math.abs(a - b) < 0.011;
  const naFaixa = (x, t) => t.op === '>' ? x > t.v : t.op === '>=' ? x >= t.v : t.op === '<' ? x < t.v : t.op === '<=' ? x <= t.v : x >= t.v && x <= t.v2;
  const datasDe = t => [t.vencimento, t.competencia, t.pagamento].filter(Boolean);
  const valoresDe = t => [t.valorParcela, t.valorPago, t.saldo];
  const textoTitulo = t => semAcento([t.fornecedor, t.fornecedorBruto, t.conta, t.cc, t.status, t.codigo].join(' ')).toUpperCase();
  // Um título casa com um termo?
  function casaTitulo(t, x) {
    switch (x.tipo) {
      case 'texto': return textoTitulo(t).includes(x.v);
      case 'codigo': return String(t.codigo) === x.v || valoresDe(t).some(v => igual(v, x.n));
      case 'valor': return valoresDe(t).some(v => igual(v, x.v));
      case 'faixa': return valoresDe(t).some(v => v > 0 && naFaixa(v, x));
      case 'data': return datasDe(t).includes(x.v);
      case 'mes': return datasDe(t).some(d => d.startsWith(x.v));
      case 'diames': return datasDe(t).some(d => d.endsWith(x.v));
      case 'regra': return x.regras ? x.regras.has(t.i) : true;
    }
    return false;
  }
  // Uma ocorrência casa com um termo? (regra, impacto, texto da ocorrência ou algum título dela)
  function casaOcorrencia(o, x, T) {
    if (x.tipo === 'regra') return o.regra === x.v;
    if (x.tipo === 'texto' && semAcento([o.fornecedor, o.detalhe, o.conta, o.cc, o.nome].join(' ')).toUpperCase().includes(x.v)) return true;
    if ((x.tipo === 'valor' && igual(o.impacto, x.v)) || (x.tipo === 'codigo' && igual(o.impacto, x.n)) || (x.tipo === 'faixa' && naFaixa(o.impacto, x))) return true;
    return o.titulos.some(i => casaTitulo(T[i], x));
  }
  const filtrarOcorrencias = (ocs, termos, T) => termos.length ? ocs.filter(o => termos.every(x => casaOcorrencia(o, x, T))) : ocs;
  // Na busca de títulos, um termo de regra (R01…) pega os títulos que estão em alguma ocorrência daquela regra
  function filtrarTitulos(T, termos, ocorrencias) {
    if (!termos.length) return T;
    for (const x of termos) if (x.tipo === 'regra' && ocorrencias) { x.regras = new Set(); for (const o of ocorrencias) if (o.regra === x.v) o.titulos.forEach(i => x.regras.add(i)); }
    return T.filter(t => termos.every(x => casaTitulo(t, x)));
  }

  const api = {analisar, normalizar, benfordDe, REGRAS, PADRAO, PESO, brl, dBR, dBRa, chaveNome, parecePessoa,
    interpretarBusca, filtrarOcorrencias, filtrarTitulos, casaTitulo, numBR};
  if (typeof module === 'object' && module.exports) module.exports = api; else raiz.FinAudit = api;
})(typeof self !== 'undefined' ? self : this);
