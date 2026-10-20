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
    dupJanela: 7,              // R23: dias entre um pagamento e outro de mesmo valor para ser "o mesmo dinheiro saindo de novo"
    dupAgenteMin: 50,          // R23: valor mínimo (pega reembolso de Uber, vale-transporte, pensão…)
    dupAgenteNota: 30,         // R23: nota de confiança mínima (0–100) para virar ocorrência
  };

  // Contas onde certos padrões são normais
  const RX_MERCADORIA = /compras a prazo|compras a vista|frete de compra|adiantamentos? (a|à) fornecedores de mercadoria/i;
  const RX_ADIANTAMENTO = /adiantamento/i;
  const RX_TRIBUTO = /icms|iss\b|iptu|ipva|tribut|imposto|fgts|inss|pis|cofins|irrf|csll|contribui[cç][aã]o|taxa de|parcelamento|das\b|simples/i;
  const RX_FOLHA = /sal[aá]ri|f[eé]rias|re[cs]+is|pens[aã]o|fgts|13º|d[eé]cimo|pr[oó].?labore|vale transporte|ajuda de custo|pr[eê]mio|bolsa|est[aá]gi|inss|comiss|trabalhist|rpa\b|aut[oô]nomo|di[aá]ria|reembolso/i;
  const RX_RECORRENTE = /aluguel|condom[ií]nio|energia|[aá]gua|internet|link de|tarifa|taxas? administrativa|mensalidade|alarme|seguro|iptu|benef[ií]cio|sindicato|sa[uú]de ocupacional|credsystem|parcelamento|icms|cim\b/i;
  // R23 (hiperfoco): contas de pessoas — folha, benefícios e reembolsos — onde pagar 2× a mesma pessoa é erro comum
  const RX_FOLHA_DUP = /sal[aá]ri|pens[aã]o|pr[oó].?labore|vale|transporte|uber|t[aá]xi|reembolso|ajuda de custo|di[aá]ria|f[eé]rias|rescis|re[cs]+is|d[eé]cimo|13º|bolsa|est[aá]gi|comiss|pr[eê]mio|adiantamento salarial|plano de sa[uú]de|odonto|benef[ií]cio|deslocamento|combust[ií]vel|prestadores de servi[cç]os pf|rpa\b|aut[oô]nomo/i;
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

  // Categorias de despesa (grupo → tipo = conta contábil). A ordem importa: a primeira que casar vence.
  const CATEGORIAS = [
    ['transporte', '🚕 Transporte e deslocamento', /taxi|uber|deslocamento|combust[ií]vel|estacionamento|ped[aá]gio|seguro de frota/i],
    ['viagem', '🏨 Viagens e hospedagem', /hospedagem|viage[mn]|passage/i],
    ['alimentacao', '🍽️ Alimentação', /^\(-\) alimenta|servi[cç]os de alimenta|confraterniza|refei/i],
    ['treinamento', '🎓 Treinamentos', /curso|treinamento/i],
    ['pessoal', '👥 Pessoal e benefícios', /sal[aá]ri|f[eé]rias|re[cs]+is|fgts|13o|13º|pr[oó].?labore|pens[aã]o|vale |benef[ií]cio|plano de sa[uú]de|seguro de vida|ajuda de custo|pr[eê]mio|bonifica|exames|sa[uú]de ocupacional|uniforme|adiantamento salarial|sindicato|custas trabalhistas|dep[oó]sito judicial trabalhista|inss \(|prestadores de servi[cç]os pf/i],
    ['marketing', '📣 Marketing e publicidade', /marketing|publicidade|m[ií]dia|outdoor|ag[eê]ncias? public|eventos|campanha|ecad|fundo de promo/i],
    ['ocupacao', '🏬 Ocupação (aluguel, condomínio, energia, água)', /aluguel|condom[ií]nio|energia|[aá]gua e esgoto|iptu|laudemio|seguro predial|seguro das lojas|alarme|vigil[aâ]ncia|monitoramento/i],
    ['manutencao', '🔧 Manutenção, obras e instalações', /manuten[cç][aã]o|obras|consertos|reparos|materiais de seguran|aquisi[cç][aã]o de/i],
    ['ti', '💻 TI e telecomunicações', /inform[aá]tica|sistemas|link de internet|telefonia|infraestrutura de ti/i],
    ['impostos', '🧾 Impostos, taxas e multas', /icms|iss\b|irrf|ipva|alvar[aá]|tpei|cim\b|parcelamento|contribui[cç][aã]o social|multa|inss reparcel|taxa/i],
    ['juridico', '⚖️ Jurídico e assessorias', /assessoria|jur[ií]dic|judicial/i],
    ['mercadoria', '📦 Mercadorias e fretes', /compras a|adiantamentos? (a|à) fornecedores|frete/i],
    ['financeiro', '🏦 Financeiro e bancário', /tarifa|banc[aá]ri|financeir|credsystem|estorno|cart[aã]o|aporte/i],
    ['grupo', '🤝 Partes relacionadas e retiradas', /partes relacionadas|retirada|operacional dok|adiantamentos financeiros/i],
    ['consumo', '📎 Material de consumo e expediente', /material|correios|xerox|impress/i],
  ];
  const CAT_NOME = Object.fromEntries(CATEGORIAS.map(([k, n]) => [k, n]).concat([['outros', '📁 Outras despesas'], ['receita', '➕ Receitas e entradas']]));
  const categoriaDe = conta => { if (/^\(\+\)|receita|venda de mercadoria/i.test(conta)) return 'receita'; for (const [k, , rx] of CATEGORIAS) if (rx.test(conta)) return k; return 'outros'; };
  // Pelo NOME do fornecedor dá para saber o que é a despesa — e conferir se está na conta certa (R21)
  const TIPO_POR_FORNECEDOR = [
    [/\b(UBER|99 ?TAXI|99APP|99 TECNOLOGIA|CABIFY|TAXI|INDRIVE)\b/, 'transporte', 'transporte por aplicativo/táxi', /taxi|uber|deslocamento/i],
    [/\b(POSTO|COMBUSTIVE(L|IS)|AUTO POSTO|PETROBRAS|IPIRANGA|SHELL|BR DISTRIBUIDORA)\b/, 'transporte', 'posto de combustível', /combust|deslocamento|frota|ve[ií]culo/i],
    [/\b(HOTEL|HOTEIS|POUSADA|POUSADAS|RESORT|FLAT|BOOKING|AIRBNB|HOSTEL|INN)\b/, 'viagem', 'hotel/hospedagem', /hospedagem|viage/i],
    [/\b(LATAM|GOL LINHAS|AZUL LINHAS|AZUL VIAGENS|TAM LINHAS|DECOLAR|123 ?MILHAS|MAXMILHAS|AEREAS?)\b/, 'viagem', 'companhia aérea/passagem', /viage|passage|deslocamento|hospedagem/i],
    [/\b(RESTAURANTE|CHURRASCARIA|LANCHONETE|LANCHES|PIZZARIA|PADARIA|IFOOD|BUFFET|SELF SERVICE)\b/, 'alimentacao', 'restaurante/alimentação', /aliment|refei|confraterniza|evento/i],
  ];
  const tipoPorFornecedor = nome => { for (const [rx, cat, rot, contaOk] of TIPO_POR_FORNECEDOR) if (rx.test(nome)) return {cat, rot, contaOk}; return null; };
  // Campos extras que a API pode passar a enviar (observação, desconto, abatimento, juros, multa) — lidos automaticamente
  const pegaTexto = (x, ks) => { for (const k of ks) if (x[k] != null && String(x[k]).trim()) return String(x[k]).trim(); return ''; };
  const pegaValor = (x, ks) => { for (const k of ks) if (x[k] != null && x[k] !== '' && isFinite(Number(x[k]))) return r2(x[k]); return 0; };
  const K_OBS = ['observacao', 'observacoes', 'observação', 'obs', 'historico', 'histórico', 'complemento', 'descricao', 'descrição', 'observacaoPagamento', 'obsPagamento', 'motivo'];
  const K_DESC = ['valorDesconto', 'desconto', 'descontos', 'vlDesconto'];
  const K_ABAT = ['valorAbatimento', 'abatimento', 'abatimentos', 'vlAbatimento'];
  const K_JUROS = ['valorJuros', 'juros', 'vlJuros'];
  const K_MULTA = ['valorMulta', 'multa', 'vlMulta'];
  // Para comparar comprovantes (R23): nº da NF/duplicata, forma de pagamento, quem baixou e link do comprovante
  const K_DOC = ['numeroDocumento', 'documento', 'numeroNota', 'numeroNF', 'notaFiscal', 'nf', 'duplicata', 'numeroDuplicata'];
  const K_FORMA = ['formaPagamento', 'forma_pagamento', 'meioPagamento'];
  const K_USUARIO = ['usuarioBaixa', 'usuario_baixa', 'baixadoPor'];
  const K_COMPROVANTE = ['comprovante', 'urlComprovante', 'linkComprovante', 'comprovanteUrl'];

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
    R04: {nome: 'Status incoerente', sev: 'media', desc: 'Situação do título não bate com os valores: cancelado com pagamento, vencido/renegociado já pago por inteiro, "A vencer" já vencido, pago sem data. (Pago a menor fica na R20.)'},
    R05: {nome: 'Pagamento antecipado', sev: 'media', desc: 'Pago muito antes do vencimento ou antes da própria competência, fora de conta de adiantamento. Antecipar sem desconto é perda financeira e pode indicar favorecimento.'},
    R06: {nome: 'Pagamento em fim de semana/feriado', sev: 'media', desc: 'Baixa registrada em sábado, domingo ou feriado nacional — fora do expediente bancário normal.'},
    R08: {nome: 'Possível fracionamento', sev: 'alta', desc: 'Vários títulos do mesmo fornecedor pagos no mesmo dia, cada um abaixo da alçada de aprovação, mas que somados passam dela.'},
    R09: {nome: 'Valor atípico', sev: 'media', desc: 'Valor muito acima do padrão histórico do mesmo fornecedor na mesma conta contábil.'},
    R10: {nome: 'Lei de Benford', sev: 'baixa', volume: true, desc: 'Teste estatístico, NÃO é duplicidade. Em valores naturais cerca de 30% começam com 1 e só 5% com 9. Quando um fornecedor tem muito mais valores começando por um mesmo número do que o normal, pode haver valores combinados ou ajustados — ou só preço fixo que se repete. O valor mostrado é o total pago ao fornecedor (referência), não perda.'},
    R11: {nome: 'Cadastro de fornecedor duplicado', sev: 'media', volume: true, desc: 'Nomes de fornecedor quase iguais (grafia, espaços, sufixos). Cadastro duplicado facilita pagamento em dobro e desvio.'},
    R12: {nome: 'Pagamento a possível pessoa física', sev: 'media', volume: true, desc: 'Fornecedor com nome de pessoa (sem razão social) recebendo fora das contas de folha. Conferir vínculo com funcionários e nota fiscal.'},
    R13: {nome: 'Conta sensível', sev: 'media', volume: true, desc: 'Saídas em contas de alto risco (retirada bancária, partes relacionadas, adiantamentos, acordos, ajuda de custo…). Exigem comprovação individual.'},
    R14: {nome: 'Valores redondos altos', sev: 'baixa', volume: true, desc: 'Pagamentos altos em valor "cheio" (múltiplos de R$ 1.000) fora de compra de mercadoria — típico de estimativas sem documento.'},
    R15: {nome: 'Fornecedor novo com valor alto', sev: 'media', volume: true, desc: 'Fornecedor que apareceu recentemente e já recebeu valor relevante. Validar cadastro, CNPJ, sócios e entrega.'},
    R16: {nome: 'Mesmo valor, mesmo dia, fornecedores diferentes', sev: 'baixa', desc: 'O mesmo valor exato pago no mesmo dia a fornecedores diferentes. Pode ser coincidência ou o mesmo documento usado duas vezes.'},
    R17: {nome: 'Datas incoerentes', sev: 'baixa', desc: 'Vencimento antes da competência ou competência muito distante do vencimento (lançamento retroativo).'},
    R18: {nome: 'Vencido em aberto', sev: 'media', desc: 'Título vencido há mais de 30 dias sem pagamento: risco de juros, multa, protesto e corte de fornecimento.'},
    R19: {nome: 'Classificação contábil inconsistente', sev: 'baixa', volume: true, desc: 'O mesmo fornecedor lançado em muitas contas contábeis diferentes. Distorce o DRE e pode esconder despesa.'},
    R20: {nome: 'Pago a menor (desconto/abatimento)', sev: 'media', desc: 'Duplicata paga por valor menor que a parcela. Se a baixa foi total ("Pago"), a diferença é desconto ou abatimento e precisa de documento (acordo, devolução, nota de crédito); se não, é pagamento parcial com saldo devedor.'},
    R21: {nome: 'Despesa na conta errada', sev: 'media', volume: true, desc: 'O nome do fornecedor indica um tipo de despesa (hotel, posto, Uber, restaurante, companhia aérea…) mas o lançamento está em outra conta contábil. Despesa "escondida" em conta que não é dela.'},
    R22: {nome: 'Duplicata com observação/abatimento', sev: 'media', desc: 'Pagamento com observação, desconto, abatimento, juros ou multa informados no Sallamo. Ler a observação e conferir o documento que justifica a diferença. (Depende da API enviar esses campos.)'},
    R23: {nome: 'Possível duplicidade (Agente)', sev: 'alta', desc: 'Agente de Duplicidade: o mesmo valor exato saindo mais de uma vez para o mesmo fornecedor/pessoa — no mesmo dia, em dias próximos, no mesmo título (código), em centros de custo diferentes ou, na folha (pensão, salário, vale-transporte, Uber, reembolso…), na mesma competência. Cada caso tem nota de confiança 0–100 e os eventos lado a lado para comparar. Impacto = o que pode ter saído a mais.'},
  };
  // Regras de duplicidade (o "impacto" delas é dinheiro que pode ter saído em dobro)
  const REGRAS_DUP = ['R01', 'R23'];
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
        obs: pegaTexto(x, K_OBS), desconto: pegaValor(x, K_DESC), abatimento: pegaValor(x, K_ABAT), juros: pegaValor(x, K_JUROS), multa: pegaValor(x, K_MULTA),
        documento: pegaTexto(x, K_DOC), forma: pegaTexto(x, K_FORMA), usuario: pegaTexto(x, K_USUARIO), comprovante: pegaTexto(x, K_COMPROVANTE),
      };
    }).map(t => Object.assign(t, {categoria: categoriaDe(t.conta)}));
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
        dup: avaliarDuplicidade(g.map(t => ({t, valor: t.valorPago, data: t.pagamento, pago: true}))),
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
      // "Pago" com saldo (pago a menor) e pagamento parcial ficam na R20
      if (t.status === 'Pago' && !t.pagamento) m = '"Pago" sem data de pagamento';
      else if (/cancel/i.test(t.status) && (t.valorPago > 0 || t.pagamento)) m = `Cancelado mas com pagamento de ${brl(t.valorPago)}`;
      else if (/(vencido|renegociado|a vencer|previsto)/i.test(t.status) && t.valorPago > 0 && t.valorPago >= t.valorParcela - cfg.tolerancia) m = `"${t.status}" mas já tem ${brl(t.valorPago)} pago em ${dBR(t.pagamento)}`;
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

    // R20 — pago a menor (desconto/abatimento ou pagamento parcial)
    for (const t of T) {
      if (!(t.valorPago > 0 && t.valorPago < t.valorParcela - cfg.tolerancia) || /cancel/i.test(t.status)) continue;
      const dif = r2(t.valorParcela - t.valorPago), pct = dif / t.valorParcela;
      const baixaTotal = t.status === 'Pago';
      let m = baixaTotal ? `baixado como "Pago" por ${brl(t.valorPago)} de ${brl(t.valorParcela)} — diferença de ${brl(dif)} (${(pct * 100).toFixed(1)}%): desconto/abatimento ou baixa errada`
        : `pagamento parcial de ${brl(t.valorPago)} de ${brl(t.valorParcela)}, saldo devedor ${brl(t.saldo)} · status "${t.status}"`;
      if (t.desconto || t.abatimento) m += ` · Sallamo informa desconto ${brl(t.desconto)} / abatimento ${brl(t.abatimento)}`;
      add('R20', t.id, {sev: baixaTotal && (dif >= 5000 || pct >= 0.2) ? 'alta' : baixaTotal ? 'media' : 'baixa', fornecedor: t.fornecedor, conta: t.conta, cc: t.cc, impacto: dif, titulos: [t.i],
        tipo: baixaTotal ? 'baixa_com_diferenca' : 'parcial', detalhe: `Cód. ${t.codigo}: ${m}${t.obs ? ` · obs.: "${t.obs.slice(0, 160)}"` : ''}`});
    }

    // R21 — despesa na conta errada (pelo nome do fornecedor)
    for (const [k, g] of agrupar(pagos, t => t.fornecedor + '|' + t.conta)) {
      const tp = tipoPorFornecedor(g[0].fornecedor);
      if (!tp || tp.contaOk.test(g[0].conta)) continue;
      const tot = r2(g.reduce((s, t) => s + t.valorPago, 0));
      add('R21', k, {sev: tot >= 10000 ? 'alta' : 'media', fornecedor: g[0].fornecedor, conta: g[0].conta, cc: unicos(g.map(t => t.cc)).join(' / '), impacto: tot, titulos: g.map(t => t.i),
        detalhe: `Fornecedor parece ${tp.rot}, mas ${g.length} pagamento(s) somando ${brl(tot)} estão em "${g[0].conta}" (esperado: ${CAT_NOME[tp.cat]})`});
    }

    // R22 — observação / desconto / abatimento / juros / multa informados no pagamento
    for (const t of T) {
      const extra = t.desconto + t.abatimento + t.juros + t.multa;
      if (!t.obs && !extra) continue;
      const partes = [t.desconto && `desconto ${brl(t.desconto)}`, t.abatimento && `abatimento ${brl(t.abatimento)}`, t.juros && `juros ${brl(t.juros)}`, t.multa && `multa ${brl(t.multa)}`].filter(Boolean);
      const forte = t.abatimento > 0 || t.desconto > 0 || /abat|devolu|cr[eé]dito|acordo|desconto|bonifica|estorno|compensa/i.test(t.obs);
      add('R22', t.id, {sev: forte ? 'alta' : 'media', fornecedor: t.fornecedor, conta: t.conta, cc: t.cc, impacto: r2((t.desconto + t.abatimento) || Math.abs(t.valorParcela - t.valorPago) || t.valorPago), titulos: [t.i],
        detalhe: `Cód. ${t.codigo}: ${partes.join(' · ') || 'observação no pagamento'}${t.obs ? ` · obs.: "${t.obs.slice(0, 200)}"` : ''}`});
    }

    // R23 — Agente de Duplicidade: mesmo fornecedor (cadastro normalizado) + mesmo valor exato saindo mais de uma vez
    // em datas próximas (≤ dupJanela dias entre um e outro) — ou, nas contas de pessoas (folha, benefício, reembolso),
    // na mesma competência. Entram também títulos em aberto (duplicidade que ainda dá para evitar).
    // Casos já inteiros na R01 não se repetem aqui.
    const naR01 = ocorrencias.filter(o => o.regra === 'R01').map(o => new Set(o.titulos));
    const linhasDup = [];
    for (const t of T) {
      if (/cancel/i.test(t.status)) continue;
      const pago = t.valorPago > 0 && !!t.pagamento;
      const valor = pago ? t.valorPago : t.saldo;
      if (!pago && !(t.saldo > 0 && t.vencimento && t.status !== 'Pago')) continue;
      if (valor < cfg.dupAgenteMin || t.categoria === 'receita') continue;
      linhasDup.push({t, valor, data: pago ? t.pagamento : t.vencimento, pago, chave: chaveNome(t.fornecedor) || t.fornecedor});
    }
    const mesComp = t => (t.competencia || '').slice(0, 7);
    for (const [, g] of agrupar(linhasDup, x => x.chave + '|' + x.valor.toFixed(2))) {
      if (g.length < 2) continue;
      g.sort((a, b) => a.data.localeCompare(b.data) || a.t.i - b.t.i);
      const grupos = [[g[0]]];
      for (let k = 1; k < g.length; k++) {
        const b = g[k], atual = grupos[grupos.length - 1], a = atual[atual.length - 1];
        const perto = difDias(b.data, a.data) <= cfg.dupJanela;
        const mesmaFolha = RX_FOLHA_DUP.test(b.t.conta) && mesComp(b.t) && atual.some(x => x.t.conta === b.t.conta && mesComp(x.t) === mesComp(b.t));
        if (perto || mesmaFolha) atual.push(b); else grupos.push([b]);
      }
      for (const grupo of grupos) {
        if (grupo.length < 2 || unicos(grupo.map(x => x.t.i)).length < 2) continue;
        if (naR01.some(s => grupo.every(x => s.has(x.t.i)))) continue;
        const d = avaliarDuplicidade(grupo);
        if (d.nota < cfg.dupAgenteNota) continue;
        const ts = grupo.map(x => x.t), cods = unicos(ts.map(t => t.codigo)).sort();
        add('R23', [grupo[0].chave, d.valor.toFixed(2), cods.join('-'), grupo[0].data].join('|'), {
          sev: d.nota >= 70 ? 'alta' : d.nota >= 45 ? 'media' : 'baixa',
          fornecedor: unicos(ts.map(t => t.fornecedor)).join(' / '), conta: unicos(ts.map(t => t.conta)).join(' / '), cc: unicos(ts.map(t => t.cc)).join(' / '),
          impacto: d.excesso + d.evitavel, titulos: ts.map(t => t.i), dup: d,
          detalhe: `${brl(d.valor)} ${d.pagos >= 2 ? `pago ${d.pagos}×` : `lançado ${grupo.length}×`}${d.abertos ? ` (${d.abertos} em aberto)` : ''} · ` +
            `${unicos(grupo.map(x => x.data)).map(dBRa).join(', ')} · cód. ${cods.join(', ')} · confiança ${d.nota}/100`,
        });
      }
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
    for (const v of valores) { const d = primeiroDigito(v); if (d >= 1 && d <= 9) { cont[d]++; n++; } }
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

  // ---------- Agente de Duplicidade: nota de confiança ----------
  // Recebe os eventos de mesmo valor ({t, valor, data, pago}) e soma os sinais de "mesmo dinheiro saindo de novo",
  // descontando os padrões legítimos (rateio entre lojas, cobrança por loja, lote de mercadoria, cobrança recorrente).
  // sinais = o que pesa a favor da duplicidade · alivios = o que pode explicar (conferir antes de concluir)
  function avaliarDuplicidade(grupo) {
    const ts = grupo.map(x => x.t), n = grupo.length;
    const cods = unicos(ts.map(t => t.codigo)), datas = unicos(grupo.map(x => x.data)).sort(), ccs = unicos(ts.map(t => t.cc));
    const vencs = unicos(ts.map(t => t.vencimento).filter(Boolean)).sort(), comps = unicos(ts.map(t => t.competencia).filter(Boolean));
    const contas = unicos(ts.map(t => t.conta)), nomes = unicos(ts.map(t => t.fornecedorBruto || t.fornecedor));
    const docs = ts.map(t => t.documento).filter(Boolean);
    const valor = grupo[0].valor, pagos = grupo.filter(x => x.pago).length, abertos = n - pagos;
    const span = datas.length > 1 ? difDias(datas[datas.length - 1], datas[0]) : 0;
    const vencSpan = vencs.length > 1 ? difDias(vencs[vencs.length - 1], vencs[0]) : 0;
    const folha = ts.some(t => RX_FOLHA_DUP.test(t.conta));
    let nota = 20; const sinais = [], alivios = [], marcas = [];
    sinais.push(`mesmo valor exato (${brl(valor)}) ${n}× para o mesmo ${folha ? 'favorecido' : 'fornecedor'}`);
    if (datas.length === 1) { nota += 25; marcas.push('mesmo_dia'); sinais.push(`${pagos === n ? 'pagos' : 'lançados'} no mesmo dia (${dBRa(datas[0])})`); }
    else if (span <= 3) { nota += 15; marcas.push('dias_proximos'); sinais.push(`datas coladas: ${datas.map(dBRa).join(', ')} (${span} dia(s) de diferença)`); }
    else { nota += 5; marcas.push('dias_proximos'); sinais.push(`datas próximas: ${datas.map(dBRa).join(', ')}`); }
    const rateio = cods.length === 1 && ccs.length === n && datas.length === 1;  // um título dividido entre lojas no mesmo dia
    if (cods.length === 1 && !rateio) {
      marcas.push('mesmo_titulo');
      if (vencSpan <= 3) { nota += 25; sinais.push(`mesmo título (cód. ${cods[0]}) baixado ${n}× com o mesmo valor`); }
      else { nota += 5; alivios.push(`mesmo título (cód. ${cods[0]}) com vencimentos diferentes — podem ser parcelas`); }
    }
    if (docs.length === n && unicos(docs).length === 1) { nota += 30; sinais.push(`mesmo nº de documento/NF (${docs[0]})`); }
    if (vencs.length === 1 && ts.every(t => t.vencimento)) { nota += 15; sinais.push(`mesmo vencimento (${dBRa(vencs[0])})`); }
    if (comps.length === 1 && ts.every(t => t.competencia)) { nota += 10; sinais.push(`mesma competência (${dBRa(comps[0])})`); }
    if (ccs.length === 1) { nota += 10; sinais.push(`mesmo centro de custo (${ccs[0]})`); }
    else { marcas.push('centros'); sinais.push(`centros de custo diferentes (${ccs.join(', ')}) — conferir se a mesma nota foi lançada em mais de uma loja`); }
    if (contas.length > 1) { nota += 5; sinais.push(`contas contábeis diferentes (${contas.join(', ')})`); }
    if (nomes.length > 1) { nota += 10; marcas.push('cadastro'); sinais.push(`cadastros com grafia diferente: ${nomes.join(' · ')}`); }
    if (folha) {
      nota += 10; marcas.push('folha');
      sinais.push('conta de pessoas (folha, pensão, vale-transporte, Uber, reembolso…) — pagar 2× a mesma pessoa é erro comum');
      const mc = unicos(ts.map(t => (t.competencia || '').slice(0, 7)).filter(Boolean));
      if (mc.length === 1 && comps.length > 1) { nota += 10; sinais.push(`mesmo mês de competência (${mc[0].split('-').reverse().join('/')})`); }
    }
    // padrões legítimos
    if (ts.every(t => RX_MERCADORIA.test(t.conta)) && cods.length >= 3) { nota -= 35; alivios.push('lote de pedidos iguais de mercadoria (grade de calçado)'); }
    if (rateio) { nota -= 40; alivios.push(`mesmo título (cód. ${cods[0]}) dividido entre centros de custo no mesmo dia (rateio)`); }
    else if (cods.length === n && ccs.length === n && contas.every(c => RX_RECORRENTE.test(c) || /monitoramento/i.test(c))) { nota -= n >= 3 ? 45 : 30; alivios.push('cada loja com o seu próprio título de cobrança mensal (pode ser o preço por loja)'); }
    if (datas.length >= 4 && cods.length > 1) { nota -= 25; alivios.push(`${datas.length} datas diferentes em sequência — parece cobrança recorrente`); }
    if (!pagos) { nota -= 10; alivios.push('nenhum foi pago ainda (lançamento repetido)'); }
    if (abertos) { marcas.push('aberto'); sinais.push(`${abertos} ainda em aberto — dá para segurar antes de pagar`); }
    // rateio: vencimento e competência iguais são da própria nota dividida — não somam como indício
    nota = Math.max(0, Math.min(rateio ? 20 : 100, nota));
    return {nota, valor, n, pagos, abertos, sinais, alivios, marcas: unicos(marcas),
      excesso: r2(valor * Math.max(0, pagos - 1)), evitavel: r2(pagos ? valor * abertos : valor * Math.max(0, abertos - 1))};
  }
  // ---------- Arquivo do banco / RH (folha, adiantamento) ----------
  // Lê o que o RH manda para o banco e os comprovantes, e cruza com o Contas a Pagar do Sallamo:
  // o mesmo dinheiro não pode sair pelo arquivo do banco E por um título no Sallamo (nem o lote ser lançado 2×).
  const numBRv = s => Number(String(s).replace(/\./g, '').replace(',', '.'));
  const isoDe = s => { const m = String(s).match(/(\d{2})\/?(\d{2})\/?(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
  // CNAB 240 (FEBRABAN) — qualquer remessa de pagamento: segmento A (TED/crédito em conta/PIX) + B (CPF/CNPJ),
  // J (boleto: código de barras, beneficiário, vencimento, valor) + J-52 (CNPJ do beneficiário) e O (contas de consumo e
  // tributos com código de barras). O tipo de serviço do lote (posição 10-11 do header de lote) diz se é salário (30)
  // ou pagamento a fornecedor/diversos — salário é conferido como folha; o resto, título a título no Sallamo.
  const SERVICO_CNAB = {'20': 'Pagamento a fornecedor', '22': 'Tributos', '30': 'Salários', '98': 'Pagamentos diversos'};
  function lerCNAB240(texto) {
    const linhas = String(texto).split(/\r?\n/).filter(l => l.length >= 200);
    const itens = []; let empresa = '', b = null, servico = '', ultJ = null;
    for (const l of linhas) {
      if (l[7] === '0') empresa = l.slice(72, 102).trim();
      if (l[7] === '1') servico = l.slice(9, 11);
      if (l[7] !== '3') continue;
      const modo = servico === '30' ? 'folha' : 'fornecedor', seg = l[13];
      if (seg === 'A') { b = {origem: 'cnab', modo, servico: SERVICO_CNAB[servico] || 'serviço ' + servico, forma: 'Transferência/crédito', nome: l.slice(43, 73).trim(), cod: l.slice(73, 93).trim().replace(/^R/, ''),
        data: isoDe(l.slice(93, 101)), valor: Number(l.slice(119, 134)) / 100, conta: `${l.slice(20, 23)}.${l.slice(24, 28)}-${l.slice(30, 41)}${l[41]}`, cpf: ''}; itens.push(b); }
      else if (seg === 'B' && b) { b.cpf = l.slice(18, 32).replace(/^0+/, '').padStart(l[17] === '2' ? 14 : 11, '0'); b = null; }
      else if (seg === 'J' && l.slice(17, 19) === '52' && ultJ) { const doc = l.slice(76, 91).replace(/^0+/, ''); if (doc) ultJ.cpf = doc.padStart(l[75] === '2' ? 14 : 11, '0'); const nm = l.slice(91, 131).trim(); if (nm) ultJ.nome = nm; ultJ = null; }
      else if (seg === 'J') { ultJ = {origem: 'cnab', modo, servico: SERVICO_CNAB[servico] || 'serviço ' + servico, forma: 'Boleto', barras: l.slice(17, 61).trim(), nome: l.slice(61, 91).trim(), vencimento: isoDe(l.slice(91, 99)),
        data: isoDe(l.slice(144, 152)), valor: Number(l.slice(152, 167)) / 100 || Number(l.slice(99, 114)) / 100, cod: l.slice(182, 202).trim(), cpf: ''}; itens.push(ultJ); b = null; }
      else if (seg === 'O') { itens.push({origem: 'cnab', modo: 'fornecedor', servico: SERVICO_CNAB[servico] || 'serviço ' + servico, forma: 'Conta/tributo', barras: l.slice(17, 61).trim(), nome: l.slice(61, 91).trim(),
        vencimento: isoDe(l.slice(91, 99)), data: isoDe(l.slice(99, 107)), valor: Number(l.slice(107, 122)) / 100, cod: l.slice(122, 142).trim(), cpf: ''}); b = null; }
    }
    const datas = itens.map(x => x.data).filter(Boolean).sort();
    return {tipo: 'cnab', empresa, itens, data: datas[0] || null};
  }
  // Texto de PDF (uma string por linha) — "Relação para Depósito Bancário" e "Lista de Comprovantes" do Internet Banking
  function lerTextoBanco(linhas) {
    const L = linhas.map(l => String(l).replace(/\s+/g, ' ').trim());
    const txt = L.join('\n');
    const comprovante = /Lista de Comprovantes|Número do Pagamento/i.test(txt);
    const empresa = (L.find(l => /^[A-Z][A-Z .&]{6,}$/.test(l) && !/RELA|INTERNET|RESULTADO/.test(l)) || '').trim();
    const itens = [];
    for (let i = 0; i < L.length; i++) {
      let m;
      if (comprovante && (m = L[i].match(/^(9\d{8}) (\d{6,10}) ?(.*?) ?(\d{2}\/\d{2}\/\d{4}) (\S+) ([\d.]+,\d{2})$/)))
        itens.push({origem: 'comprovante', modo: 'folha', npag: m[1], cod: m[2], nome: (m[3] || [L[i - 1], L[i + 1]].filter(x => x && /^[A-Z ]+$/.test(x)).join(' ')).trim(), data: isoDe(m[4]), valor: numBRv(m[6])});
      else if (!comprovante && (m = L[i].match(/^(\d{3}\.\d{4}-\d{6,13}) ([\d.]+,\d{2}) (\d{6,10}) (.+?) (\d{11}) ([\d.]+)$/)))
        itens.push({origem: 'relacao', modo: 'folha', conta: m[1], valor: numBRv(m[2]), cod: m[3], nome: m[4], cpf: m[5]});
    }
    const data = isoDe((txt.match(/Data de Pagamento:?\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1] || (itens[0] && itens[0].data ? itens[0].data.split('-').reverse().join('/') : ''));
    if (data) itens.forEach(x => { if (!x.data) x.data = data; });
    const competencia = ((txt.match(/Compet[eê]ncia:?\s*([^\n]+?)(\s{2,}|\n|$)/i) || [])[1] || '').trim();
    const remessa = ((txt.match(/N[uú]mero da Remessa:?\s*(\S+)/i) || [])[1] || '');
    const totalTxt = (txt.match(/(?:Total do valor transmitido|Valor Total):?\s*(?:R\$\s*)?([\d.]+,\d{2})/i) || [])[1];
    return {tipo: comprovante ? 'comprovante' : 'relacao', empresa, data, competencia, remessa, itens, totalInformado: totalTxt ? numBRv(totalTxt) : null};
  }
  const RX_FOLHA_PAGTO = /sal[aá]ri|folha|adiantamento salarial|adiantamento de sal|f[eé]rias|rescis|re[cs]+is|13º|d[eé]cimo|pr[oó].?labore|l[ií]quido/i;
  // lotes: [{nome, tipo, data, itens}] · T: títulos normalizados do Sallamo
  function cruzarArquivoBanco(lotes, T, opcoes) {
    const cfg = Object.assign({janelaLote: 5, janelaPessoa: 20}, opcoes || {});
    const achados = [], add = (sev, tipo, titulo, detalhe, extra) => achados.push(Object.assign({sev, tipo, titulo, detalhe, titulos: [], itens: []}, extra || {}));
    const pagos = T.filter(t => t.valorPago > 0 && t.pagamento && !/cancel/i.test(t.status));
    const resumo = [];
    // 1) dentro de cada arquivo: mesma pessoa (CPF/código) ou mesma conta 2×, contas compartilhadas
    for (const L of lotes) {
      const tot = r2(L.itens.reduce((s, x) => s + x.valor, 0));
      resumo.push({nome: L.nome, tipo: L.tipo, data: L.data, competencia: L.competencia, n: L.itens.length, total: tot, totalInformado: L.totalInformado});
      if (L.totalInformado != null && Math.abs(L.totalInformado - tot) > 0.01) add('alta', 'total', `Total do arquivo não fecha: ${L.nome}`, `Soma das linhas ${brl(tot)} × total informado ${brl(L.totalInformado)} — linha faltando ou a mais.`);
      // na folha a mesma pessoa só recebe uma vez; no pagamento a fornecedor o mesmo CNPJ/conta pode ter várias notas — lá vale o código de barras
      const camposFolha = [['cpf', 'CPF'], ['cod', 'código do funcionário'], ['conta', 'conta bancária']], camposForn = [['barras', 'código de barras (mesmo boleto)'], ['cod', 'nº do documento (seu número)']];
      for (const [modo, campos] of [['folha', camposFolha], ['fornecedor', camposForn]]) for (const [campo, rot] of campos) {
        for (const [k, g] of agrupar(L.itens.filter(x => x.modo === modo && x[campo]), x => x[campo])) if (g.length > 1)
          add('alta', 'repetido_arquivo', `Mesmo ${rot} ${g.length}× no arquivo ${L.nome}`, `${unicos(g.map(x => x.nome)).join(' / ')} · ${g.map(x => brl(x.valor)).join(' + ')} = ${brl(g.reduce((s, x) => s + x.valor, 0))}`, {itens: g, valor: r2(g.slice(1).reduce((s, x) => s + x.valor, 0))});
      }
      for (const [k, g] of agrupar(L.itens.filter(x => x.modo === 'folha' && x.conta && x.cpf), x => x.conta)) if (unicos(g.map(x => x.cpf)).length > 1)
        add('alta', 'conta_compartilhada', `Conta bancária ${k} recebe para pessoas diferentes`, unicos(g.map(x => x.nome)).join(' / '), {itens: g, valor: r2(g.reduce((s, x) => s + x.valor, 0))});
    }
    // 2) arquivo × comprovante do mesmo pagamento (mesma data): sem comprovante, comprovante a mais, valor diferente, pago 2×
    const rel = lotes.filter(L => L.tipo !== 'comprovante'), comp = lotes.filter(L => L.tipo === 'comprovante');
    for (const C of comp) {
      const R = rel.find(L => L.data === C.data); if (!R) continue;
      const porCod = agrupar(C.itens, x => x.cod), relCod = new Map(R.itens.map(x => [x.cod, x]));
      for (const x of R.itens) { const c = porCod.get(x.cod);
        if (!c) add('media', 'sem_comprovante', `Sem comprovante: ${x.nome}`, `${brl(x.valor)} no arquivo de ${dBRa(R.data)} sem comprovante do banco (não foi pago ou foi rejeitado).`, {itens: [x], valor: x.valor});
        else if (c.length > 1) add('alta', 'pago_2x_banco', `Banco pagou ${c.length}×: ${x.nome}`, `Comprovantes ${c.map(y => y.npag).join(', ')} · ${c.map(y => brl(y.valor)).join(' + ')}`, {itens: [x, ...c], valor: r2(c.slice(1).reduce((s, y) => s + y.valor, 0))});
        else if (Math.abs(c[0].valor - x.valor) > 0.01) add('alta', 'valor_diferente', `Valor pago ≠ arquivo: ${x.nome}`, `arquivo ${brl(x.valor)} × comprovante ${brl(c[0].valor)}`, {itens: [x, c[0]], valor: r2(Math.abs(c[0].valor - x.valor))}); }
      for (const c of C.itens) if (!relCod.has(c.cod)) add('alta', 'comprovante_fora', `Pago sem estar no arquivo: ${c.nome}`, `Comprovante ${c.npag} de ${brl(c.valor)} — pessoa não está no arquivo do RH.`, {itens: [c], valor: c.valor});
    }
    // 3) adiantamento × folha do mesmo mês: recebeu adiantamento e sumiu da folha (desligado? o adiantamento precisa ser descontado na rescisão)
    const ehAdto = L => /adto|adiant/i.test(L.nome + ' ' + (L.competencia || ''));
    const temFolha = L => L.itens.some(x => x.modo === 'folha');
    const adto = rel.filter(temFolha).find(ehAdto), folha = rel.filter(temFolha).find(L => !ehAdto(L));
    if (adto && folha) {
      const naFolha = new Set(folha.itens.map(x => x.cpf || x.cod));
      const fora = adto.itens.filter(x => !naFolha.has(x.cpf || x.cod));
      if (fora.length) add('media', 'adto_sem_folha', `${fora.length} pessoa(s) receberam adiantamento e não estão na folha`, `Somam ${brl(fora.reduce((s, x) => s + x.valor, 0))}. Se foram desligadas, o adiantamento tem de ser descontado na rescisão; se não, a folha delas está faltando.`, {itens: fora, valor: r2(fora.reduce((s, x) => s + x.valor, 0))});
    }
    // o mesmo lote pode vir em dois formatos (CNAB + relação em PDF, ou só comprovante): conta uma vez só
    const unicosLotes = [];
    for (const L of rel.length ? rel : comp) { const tot = r2(L.itens.reduce((s, x) => s + x.valor, 0)); if (!unicosLotes.some(u => u.L.data === L.data && Math.abs(u.tot - tot) < 0.01)) unicosLotes.push({L, tot}); }
    // mesmo boleto (código de barras) em arquivos diferentes = boleto mandado pagar 2×
    for (const [k, g] of agrupar(unicosLotes.flatMap(({L}) => L.itens.filter(x => x.barras).map(x => Object.assign({lote: L.nome}, x))), x => x.barras))
      if (unicos(g.map(x => x.lote)).length > 1) add('alta', 'boleto_2_arquivos', `Mesmo boleto em ${unicos(g.map(x => x.lote)).length} arquivos: ${g[0].nome}`, `Código de barras ${k} · ${g.map(x => `${x.lote}: ${brl(x.valor)} em ${dBRa(x.data)}`).join(' · ')}`, {itens: g, valor: r2(g.slice(1).reduce((s, x) => s + x.valor, 0))});
    // 4) o LOTE DA FOLHA no Sallamo: o total do arquivo deve aparecer pago uma vez (± dias). Duas vezes = lote pago em dobro.
    for (const {L} of unicosLotes) {
      const tot = r2(L.itens.filter(x => x.modo === 'folha').reduce((s, x) => s + x.valor, 0));
      if (!L.data || !tot) continue;
      const g = pagos.filter(t => Math.abs(t.valorPago - tot) <= 0.01 && Math.abs(difDias(t.pagamento, L.data)) <= cfg.janelaLote);
      const doDia = pagos.filter(t => RX_FOLHA_PAGTO.test(t.conta) && Math.abs(difDias(t.pagamento, L.data)) <= 1);
      const somaDia = r2(doDia.reduce((s, t) => s + t.valorPago, 0));
      L.sallamo = {exatos: g.map(t => t.i), contasFolhaDia: doDia.map(t => t.i), somaDia};
      if (g.length > 1) add('alta', 'lote_2x', `Lote ${L.nome} lançado ${g.length}× no Sallamo`, `${brl(tot)} pago em ${g.map(t => dBRa(t.pagamento) + ' (cód. ' + t.codigo + ')').join(', ')}`, {titulos: g.map(t => t.i), valor: r2(tot * (g.length - 1))});
      else if (g.length === 1) add('ok', 'lote_ok', `Lote ${L.nome} encontrado 1× no Sallamo`, `Cód. ${g[0].codigo} · ${g[0].fornecedor} · ${brl(g[0].valorPago)} pago em ${dBRa(g[0].pagamento)} · ${g[0].conta}`, {titulos: [g[0].i], valor: 0});
      else add('info', 'lote_nao_achado', `Lote ${L.nome} (${brl(tot)}) não aparece com esse total no Sallamo`, doDia.length ? `Em contas de folha perto de ${dBRa(L.data)} o Sallamo tem ${doDia.length} título(s) somando ${brl(somaDia)} (diferença ${brl(r2(somaDia - tot))}). Pode estar lançado por loja/centro de custo.` : `Nenhum título de folha pago perto de ${dBRa(L.data)} — o lote pode não estar no Contas a Pagar ou estar em outra empresa/período.`, {titulos: doDia.map(t => t.i), valor: 0});
    }
    // 5) PESSOA a pessoa: quem recebeu pelo arquivo do banco e TAMBÉM tem pagamento no Sallamo no mesmo período
    const porNome = agrupar(pagos, t => chaveNome(t.fornecedor));
    const porPessoa = new Map();  // fica só o achado mais grave de cada pessoa × títulos do Sallamo
    // 5a) FORNECEDORES: cada pagamento do arquivo deve casar com UM título pago no Sallamo (mesmo valor, nome compatível, ± dias)
    const nomeCasa = (a, b) => a && b && (a.startsWith(b.slice(0, 10)) || b.startsWith(a.slice(0, 10)));
    const forn = unicosLotes.flatMap(({L}) => L.itens.filter(x => x.modo === 'fornecedor').map(x => ({x, L})));
    const semTitulo = [], conciliados = [];
    for (const {x, L} of forn) {
      const k = chaveNome(x.nome), dia = x.data || L.data;
      const g = pagos.filter(t => Math.abs(t.valorPago - x.valor) <= 0.01 && dia && Math.abs(difDias(t.pagamento, dia)) <= cfg.janelaLote && nomeCasa(chaveNome(t.fornecedor), k));
      if (g.length === 1) conciliados.push(x);
      else if (g.length > 1) add('alta', 'fornecedor_2x_sallamo', `${x.nome}: 1 pagamento no banco e ${g.length} títulos pagos no Sallamo`, `Banco (${x.forma}): ${brl(x.valor)} em ${dBRa(dia)} · Sallamo: ${g.map(t => `cód. ${t.codigo} em ${dBRa(t.pagamento)} (${t.conta})`).join('; ')}`, {itens: [x], titulos: g.map(t => t.i), valor: r2(x.valor * (g.length - 1))});
      else semTitulo.push(x);
    }
    if (semTitulo.length) add('media', 'banco_sem_titulo', `${semTitulo.length} pagamento(s) do arquivo sem título correspondente no Sallamo`, `Somam ${brl(semTitulo.reduce((s, x) => s + x.valor, 0))}. Saiu dinheiro pelo banco sem título igual (valor/fornecedor/data ±${cfg.janelaLote} dias) no Sallamo — confira o lançamento, o período carregado e a grafia do fornecedor.`, {itens: semTitulo, valor: r2(semTitulo.reduce((s, x) => s + x.valor, 0))});
    if (conciliados.length) add('ok', 'fornecedor_ok', `${conciliados.length} pagamento(s) a fornecedores conferem 1× com o Sallamo`, `Somam ${brl(conciliados.reduce((s, x) => s + x.valor, 0))}.`, {itens: conciliados, valor: 0});
    // 5b) FOLHA, pessoa a pessoa: quem recebeu pelo arquivo do banco e TAMBÉM tem pagamento no Sallamo no mesmo período
    for (const {L} of unicosLotes) for (const x of L.itens) {
      if (x.modo !== 'folha') continue;
      const k = chaveNome(x.nome); if (!k || k.length < 8) continue;
      const g = (porNome.get(k) || []).filter(t => Math.abs(difDias(t.pagamento, L.data)) <= cfg.janelaPessoa);
      if (!g.length) continue;
      const id = k + '|' + g.map(t => t.i).join(',');
      const igual = g.filter(t => Math.abs(t.valorPago - x.valor) <= 0.01), folhaS = g.filter(t => RX_FOLHA_PAGTO.test(t.conta));
      const sev = igual.length ? 'alta' : folhaS.length ? 'media' : 'baixa';
      const ant = porPessoa.get(id); if (ant && {alta: 0, media: 1, baixa: 2}[ant.sev] <= {alta: 0, media: 1, baixa: 2}[sev]) continue;
      if (ant) achados.splice(achados.indexOf(ant), 1);
      add(sev, igual.length ? 'pessoa_mesmo_valor' : folhaS.length ? 'pessoa_folha_sallamo' : 'pessoa_outro_pagto',
        igual.length ? `${x.nome}: mesmo valor pago no arquivo e no Sallamo` : folhaS.length ? `${x.nome}: recebeu no arquivo e tem pagamento de folha no Sallamo` : `${x.nome}: recebeu no arquivo e tem outro pagamento no Sallamo`,
        `Arquivo ${L.nome}: ${brl(x.valor)} em ${dBRa(x.data || L.data)} · Sallamo: ${g.map(t => `${brl(t.valorPago)} em ${dBRa(t.pagamento)} (${t.conta}, cód. ${t.codigo})`).join('; ')}`,
        {itens: [x], titulos: g.map(t => t.i), valor: igual.length ? x.valor : 0});
      porPessoa.set(id, achados[achados.length - 1]);
    }
    const P = {alta: 0, media: 1, baixa: 2, info: 3, ok: 4};
    achados.sort((a, b) => P[a.sev] - P[b.sev] || (b.valor || 0) - (a.valor || 0));
    return {resumo, achados};
  }

  // 1º algarismo significativo de um valor (Benford)
  const primeiroDigito = v => Number(String(Math.abs(v)).replace(/^[0.]+/, '')[0]) || 0;

  // ---------- helpers ----------
  function agrupar(a, chave) { const m = new Map(); for (const x of a) { const k = chave(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }
  function unicos(a) { return [...new Set(a)]; }
  function addDias(iso, n) { const d = new Date(ms(iso)); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function brl(v) { return Number(v || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'}); }
  function dBR(d) { return d ? d.split('-').reverse().slice(0, 2).join('/') : '—'; }
  function dBRa(d) { return d ? d.split('-').reverse().join('/') : '—'; }

  // ---------- despesas por categoria / tipo / centro de custo ----------
  // base 'pago' = dinheiro que saiu (valor pago, mês do pagamento) · base 'lancado' = despesa lançada (parcela, mês da competência)
  function despesas(T, opt) {
    const o = Object.assign({base: 'pago', cc: '', categoria: '', conta: '', mes: '', fornecedor: ''}, opt || {});
    const valor = t => o.base === 'pago' ? t.valorPago : t.valorParcela;
    const mesDe = t => (o.base === 'pago' ? t.pagamento : t.competencia) || '';
    const linhas = T.filter(t => t.categoria !== 'receita' && valor(t) > 0 && (o.base !== 'pago' || t.pagamento)
      && (!o.cc || t.cc === o.cc) && (!o.categoria || t.categoria === o.categoria) && (!o.conta || t.conta === o.conta)
      && (!o.mes || mesDe(t).startsWith(o.mes)) && (!o.fornecedor || t.fornecedor === o.fornecedor));
    const total = r2(linhas.reduce((s, t) => s + valor(t), 0));
    const por = chave => [...agrupar(linhas, chave)].map(([k, g]) => ({k, n: g.length, v: r2(g.reduce((s, t) => s + valor(t), 0)), idx: g.map(t => t.i)})).sort((a, b) => b.v - a.v);
    return {opt: o, linhas, total, n: linhas.length, valor, mesDe, porCategoria: por(t => t.categoria), porConta: por(t => t.conta), porCC: por(t => t.cc),
      porFornecedor: por(t => t.fornecedor), porMes: por(t => mesDe(t).slice(0, 7)).sort((a, b) => a.k.localeCompare(b.k))};
  }

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

  const api = {analisar, normalizar, benfordDe, primeiroDigito, avaliarDuplicidade, lerCNAB240, lerTextoBanco, cruzarArquivoBanco, REGRAS, REGRAS_DUP, PADRAO, PESO, brl, dBR, dBRa, chaveNome, parecePessoa,
    interpretarBusca, filtrarOcorrencias, filtrarTitulos, casaTitulo, numBR, despesas, CATEGORIAS, CAT_NOME, categoriaDe, tipoPorFornecedor};
  if (typeof module === 'object' && module.exports) module.exports = api; else raiz.FinAudit = api;
})(typeof self !== 'undefined' ? self : this);
