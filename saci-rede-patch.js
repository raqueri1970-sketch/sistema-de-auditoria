/* Casamento de Saci — "Saci na Rede" (conta oficial) — 20261117-2
 *
 *   Pé Direito + Pé Esquerdo + Enviados 2026 = Saci na Rede (pés reais aguardando par)
 *   Casados = pares já resolvidos (10.217 pares = 20.434 pés) — histórico, NÃO sai da conta.
 *
 * O módulo Casamento de Saci (iframe ifr-saci, arquivo do Portal no Supabase Storage) ganha:
 *  - bloco "Saci na Rede — Conta Oficial" no topo (Direito + Esquerdo + Enviados = Saci na Rede, em pés,
 *    custo e venda; Casados à parte), por marca e por loja de origem dos Enviados;
 *  - os cartões do Resumo Geral passam a mostrar essa conta (Saci na Rede, Casados, Total recebido, custos, taxa);
 *  - exportação Excel da conta;
 *  - ao carregar um D1.xlsx novo (no botão do bloco ou no upload normal do módulo) a conta é refeita e
 *    gravada no Supabase (portal_sync, module_id "saci_rede") para todos os usuários.
 * Base inicial embutida: D1.xlsx de 17/11/2026 (só totais por aba, marca e loja — sem dados pessoais).
 * Fonte: repositório sistema-de-auditoria, pasta saci/ (gerado por saci/gerar_patch.js).
 * Uso no index.html do Portal:
 *   inserirAntesDoFimDoBody(html,'<scr'+'ipt src="'+new URL('saci-rede-patch.js?v=20261117-2',location.href).href+'"></scr'+'ipt>');
 */
/* Casamento de Saci — cálculo oficial "Saci na Rede" a partir do D1.xlsx.
 *
 *   Pé Direito + Pé Esquerdo + Enviados 2026  =  Saci na Rede (pés reais aguardando par)
 *   Casados = pares já resolvidos (histórico) — mostrado à parte, não sai da conta.
 *
 * Abas lidas pelo NOME (sem acento/maiúscula): "Direito", "Esquerdo", "Enviados 2026", "Casados";
 * "Descarte" e "Código Reaproveitado" aparecem como informação, fora da conta.
 *
 * Regras de valor (conferidas no D1.xlsx de 17/11/2026):
 *  - Direito / Esquerdo / Código Reaproveitado: "Custo" = total da linha; venda = Pdv_Unitario × Qtd.
 *  - Casados / Descarte: "Custo" e "Venda" = total da linha (Qtde 2 → Venda 9,98).
 *  - Enviados 2026: "Custo" e "Venda" = UNITÁRIOS (mesmo produto com Qtde 1 e 2 tem o mesmo custo) → × Qtde.
 *  - Linha de "Total" no rodapé (sem Descrição) é ignorada — senão a quantidade dobra.
 *
 * Usado no navegador (patch do módulo) e no Node (ferramenta que gera a base inicial).
 */
(function (root) {
  function norm(v) {
    if (v == null) return '';
    var s = String(v).trim();
    if (!s) return '';
    s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s.toUpperCase().replace(/\s+/g, ' ');
  }
  function num(v) {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v;
    var s = String(v).trim().replace(/R\$\s*/i, '');
    if (/^-?[\d.]+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(',', '.');
    return parseFloat(s);
  }

  /* Mesma regra de marca do módulo (primeira palavra da descrição, com marcas compostas). */
  var MARCA_3W = ['FIO DE OURO'];
  var MARCA_2W = ['VIA SCARPA', 'VIA MARTE', 'VIA UNO', 'VIA VIP', 'BEIRA RIO', 'SUA CIA', 'WEST COAST', 'STAR WHITE'];
  var SKIP = ['TENIS FEMININO', 'TENIS MASCULINO', 'TENIS INFANTIL', 'TENIS'];
  function extractMarca(desc) {
    var s = norm(desc);
    if (!s) return '(Sem marca)';
    for (var i = 0; i < SKIP.length; i++) { if (s.indexOf(SKIP[i] + ' ') === 0) { s = s.slice(SKIP[i].length).trim(); break; } }
    for (var j = 0; j < MARCA_3W.length; j++) if (s.indexOf(MARCA_3W[j]) === 0) return MARCA_3W[j];
    for (var k = 0; k < MARCA_2W.length; k++) if (s.indexOf(MARCA_2W[k]) === 0) return MARCA_2W[k];
    return s.split(' ')[0] || '(Sem marca)';
  }

  function tipoAba(nome) {
    var n = norm(nome);
    if (/REAPROV/.test(n)) return 'REAP';
    if (/DESCART/.test(n)) return 'DESC';
    if (/ENVIAD/.test(n)) return 'ENV';
    if (/CASAD/.test(n)) return 'C';
    if (/ESQ/.test(n)) return 'E';
    if (/DIR/.test(n)) return 'D';
    return null;
  }

  function colunas(header) {
    var m = {};
    header.forEach(function (h, i) {
      var n = norm(h);
      if (!n) return;
      if (m.qtd == null && /^(QTD|QTDE|QUANT)/.test(n)) m.qtd = i;
      else if (m.desc == null && /DESCRI/.test(n)) m.desc = i;
      else if (m.custoUnit == null && /CUSTO.*UNIT/.test(n)) m.custoUnit = i;
      else if (m.custo == null && /^CUSTO/.test(n)) m.custo = i;
      else if (m.vendaUnit == null && /(PDV|VENDA|PRECO).*UNIT/.test(n)) m.vendaUnit = i;
      else if (m.venda == null && /^(VENDA|PDV|PRECO)/.test(n)) m.venda = i;
      else if (m.marca == null && /^MARCA/.test(n)) m.marca = i;
      else if (m.origem == null && /(ORIGEM|LOJA|FILIAL)/.test(n)) m.origem = i;
    });
    return m;
  }

  function vazio() { return { q: 0, c: 0, v: 0, linhas: 0 }; }
  function soma(a, q, c, v) { a.q += q; a.c += c; a.v += v; a.linhas++; }
  function r2(x) { return Math.round(x * 100) / 100; }

  /* aoaPorAba: { "Nome da aba": [[cabeçalho...], [linha...], ...] } */
  function resumirAoA(aoaPorAba, meta) {
    var R = { versao: 1, geradoEm: (meta && meta.geradoEm) || new Date().toISOString(), arquivo: (meta && meta.arquivo) || '',
      E: vazio(), D: vazio(), ENV: vazio(), C: vazio(), DESC: vazio(), REAP: vazio(),
      cNeg: vazio(), envSemLoja: vazio(), marcas: {}, lojas: {}, abas: [] };
    Object.keys(aoaPorAba).forEach(function (nome) {
      var t = tipoAba(nome);
      var aoa = aoaPorAba[nome] || [];
      if (!t || !aoa.length) return;
      var hi = -1, col = null;
      for (var i = 0; i < Math.min(10, aoa.length); i++) {
        var c = colunas(aoa[i] || []);
        if (c.qtd != null && c.desc != null) { hi = i; col = c; break; }
      }
      if (hi < 0) return;
      R.abas.push({ nome: nome, tipo: t });
      for (var r = hi + 1; r < aoa.length; r++) {
        var row = aoa[r] || [];
        var desc = row[col.desc];
        if (desc == null || String(desc).trim() === '') continue; // linha de Total / vazia
        var q = num(row[col.qtd]);
        if (isNaN(q)) continue;
        var custo, venda;
        if (t === 'ENV') {
          custo = q * (num(row[col.custoUnit != null ? col.custoUnit : col.custo]) || 0);
          venda = q * (num(row[col.vendaUnit != null ? col.vendaUnit : col.venda]) || 0);
        } else {
          custo = col.custo != null ? (num(row[col.custo]) || 0) : q * (num(row[col.custoUnit]) || 0);
          venda = col.venda != null ? (num(row[col.venda]) || 0) : q * (num(row[col.vendaUnit]) || 0);
        }
        soma(R[t], q, custo, venda);
        if (t === 'C' && (custo < 0 || venda < 0 || q < 0)) soma(R.cNeg, q, custo, venda);
        if (t === 'DESC' || t === 'REAP') continue;
        var marca = extractMarca(desc);
        var mk = R.marcas[marca] || (R.marcas[marca] = { E: 0, D: 0, ENV: 0, C: 0, cRede: 0, cC: 0 });
        mk[t] += q;
        if (t === 'C') mk.cC += custo; else mk.cRede += custo;
        if (t === 'ENV') {
          var lj = col.origem != null ? row[col.origem] : '';
          lj = (lj == null || String(lj).trim() === '') ? '' : String(lj).trim().replace(/\.0+$/, '');
          if (!lj) soma(R.envSemLoja, q, custo, venda);
          else { var L = R.lojas[lj] || (R.lojas[lj] = vazio()); soma(L, q, custo, venda); }
        }
      }
    });
    ['E', 'D', 'ENV', 'C', 'DESC', 'REAP', 'cNeg', 'envSemLoja'].forEach(function (k) { R[k].c = r2(R[k].c); R[k].v = r2(R[k].v); });
    Object.keys(R.lojas).forEach(function (k) { R.lojas[k].c = r2(R.lojas[k].c); R.lojas[k].v = r2(R.lojas[k].v); });
    Object.keys(R.marcas).forEach(function (k) { R.marcas[k].cRede = r2(R.marcas[k].cRede); R.marcas[k].cC = r2(R.marcas[k].cC); });
    return R;
  }

  /* Workbook do SheetJS → resumo. Retorna null se não tiver as abas da conta. */
  function resumirWorkbook(XLSX, wb, meta) {
    var aoa = {};
    wb.SheetNames.forEach(function (sn) {
      if (!tipoAba(sn)) return;
      aoa[sn] = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', raw: true, blankrows: false });
    });
    var R = resumirAoA(aoa, meta);
    var tipos = R.abas.map(function (a) { return a.tipo; });
    var temRede = tipos.indexOf('E') >= 0 || tipos.indexOf('D') >= 0 || tipos.indexOf('ENV') >= 0;
    return temRede && tipos.indexOf('C') >= 0 ? R : null;
  }

  /* Conta oficial derivada do resumo.
   * Saci na Rede (Direito + Esquerdo + Enviados 2026) = pés REAIS aguardando par.
   * Casados NÃO sai da conta: a aba Casados traz PARES já resolvidos (10.217 pares = 20.434 pés),
   * é histórico. Total recebido = Saci na Rede + pés casados; taxa = pés casados ÷ total recebido. */
  function conta(R) {
    var rede = { q: R.D.q + R.E.q + R.ENV.q, c: r2(R.D.c + R.E.c + R.ENV.c), v: r2(R.D.v + R.E.v + R.ENV.v) };
    var casadosPes = R.C.q * 2;
    var recebido = rede.q + casadosPes;
    return { rede: rede, casadosPares: R.C.q, casadosPes: casadosPes, recebido: recebido, taxa: recebido > 0 ? casadosPes / recebido * 100 : 0 };
  }

  root.SaciRede = { resumirAoA: resumirAoA, resumirWorkbook: resumirWorkbook, conta: conta, extractMarca: extractMarca, tipoAba: tipoAba };
})(typeof module !== 'undefined' && module.exports ? module.exports : (typeof window !== 'undefined' ? window : this));

(function () {
  if (window.__saciRedePatch) return;
  window.__saciRedePatch = '20261117-2';
  var SR = window.SaciRede;
  var BASE = {"versao":1,"geradoEm":"2026-11-17T16:00:00-03:00","arquivo":"D1.xlsx","E":{"q":5276,"c":236966.62,"v":230699.24,"linhas":4427},"D":{"q":5753,"c":256568.03,"v":250035.47,"linhas":4811},"ENV":{"q":8487,"c":427930.54,"v":638055.95,"linhas":8148},"C":{"q":10217,"c":444574.49,"v":352235.59,"linhas":8644},"DESC":{"q":412,"c":19603.26,"v":14081.88,"linhas":354},"REAP":{"q":54,"c":2270.69,"v":2804.46,"linhas":50},"cNeg":{"q":221,"c":-19267.79,"v":-43854.61,"linhas":181},"envSemLoja":{"q":0,"c":0,"v":0,"linhas":0},"marcas":{"MOLEKINHA":{"E":210,"D":212,"ENV":339,"C":240,"cRede":25116.41,"cC":7689.67},"UMBRO":{"E":49,"D":52,"ENV":42,"C":85,"cRede":10192.66,"cC":5681.05},"CARTAGO":{"E":224,"D":261,"ENV":290,"C":370,"cRede":21080.44,"cC":8641.76},"IPANEMA":{"E":415,"D":396,"ENV":540,"C":604,"cRede":16004.7,"cC":6153.62},"MOLECA":{"E":289,"D":334,"ENV":477,"C":401,"cRede":33670.22,"cC":10973.28},"OLYMPIKUS":{"E":215,"D":231,"ENV":397,"C":478,"cRede":86323.48,"cC":41895.34},"ORTOPE":{"E":105,"D":91,"ENV":212,"C":163,"cRede":10620.64,"cC":5331.43},"BEIRA RIO":{"E":207,"D":233,"ENV":230,"C":288,"cRede":20571.97,"cC":8400.4},"GSN":{"E":6,"D":6,"ENV":0,"C":4,"cRede":415.46,"cC":126.24},"GRENDHA":{"E":111,"D":125,"ENV":99,"C":239,"cRede":4707.07,"cC":3053.23},"MOOVE":{"E":5,"D":4,"ENV":0,"C":1,"cRede":313.33,"cC":26.9},"MODARE":{"E":245,"D":251,"ENV":365,"C":418,"cRede":38153.95,"cC":12410.14},"NASA":{"E":1,"D":0,"ENV":0,"C":0,"cRede":21.66,"cC":0},"FUN":{"E":7,"D":7,"ENV":1,"C":5,"cRede":584.45,"cC":210.6},"ZAXY":{"E":104,"D":105,"ENV":134,"C":209,"cRede":11959.69,"cC":7167.27},"TERRA":{"E":23,"D":21,"ENV":46,"C":11,"cRede":2490.72,"cC":313.2},"VIA SCARPA":{"E":75,"D":68,"ENV":81,"C":152,"cRede":7580.31,"cC":4797.37},"KIDY":{"E":21,"D":28,"ENV":3,"C":24,"cRede":2026.41,"cC":815.17},"MOLEKINHO":{"E":98,"D":109,"ENV":161,"C":129,"cRede":13513.69,"cC":4148.33},"DIJEAN":{"E":175,"D":189,"ENV":517,"C":358,"cRede":24141.22,"cC":11138.12},"ORTOPA?":{"E":3,"D":1,"ENV":0,"C":0,"cRede":162,"cC":0},"PAMPILI":{"E":1,"D":3,"ENV":2,"C":3,"cRede":184.91,"cC":174.4},"DOK":{"E":65,"D":45,"ENV":12,"C":130,"cRede":4926.49,"cC":5204.73},"BARBIE":{"E":32,"D":34,"ENV":19,"C":83,"cRede":2976.65,"cC":2864.24},"LOL":{"E":2,"D":1,"ENV":0,"C":2,"cRede":78.76,"cC":35.44},"BABY":{"E":1,"D":1,"ENV":0,"C":0,"cRede":69.32,"cC":0},"BEBECE":{"E":42,"D":42,"ENV":50,"C":52,"cRede":8402.57,"cC":3182.92},"MISSISSIPI":{"E":108,"D":113,"ENV":115,"C":255,"cRede":15665.3,"cC":12721.14},"VIZZANO":{"E":109,"D":137,"ENV":188,"C":179,"cRede":19852.51,"cC":6774},"GIULIA":{"E":11,"D":11,"ENV":0,"C":5,"cRede":422.3,"cC":74.4},"RIDER":{"E":35,"D":179,"ENV":209,"C":306,"cRede":9428.11,"cC":5956.57},"PEGADA":{"E":226,"D":113,"ENV":362,"C":463,"cRede":60256.9,"cC":32628.48},"ADIDAS":{"E":35,"D":74,"ENV":149,"C":113,"cRede":35980.02,"cC":16702.9},"BLACK":{"E":11,"D":5,"ENV":1,"C":4,"cRede":736.05,"cC":177.06},"DEMOCRATA":{"E":121,"D":62,"ENV":301,"C":243,"cRede":58304.26,"cC":25678.35},"FERRACINI":{"E":20,"D":14,"ENV":0,"C":40,"cRede":3719.12,"cC":4582.92},"WEST COAST":{"E":17,"D":9,"ENV":4,"C":8,"cRede":1377.98,"cC":421.38},"VIA MARTE":{"E":56,"D":72,"ENV":49,"C":70,"cRede":11837.42,"cC":3556.52},"TOPPER":{"E":8,"D":8,"ENV":11,"C":1,"cRede":1625.04,"cC":75.98},"PINK":{"E":12,"D":15,"ENV":24,"C":26,"cRede":3000.68,"cC":1449.05},"JELLY":{"E":1,"D":1,"ENV":0,"C":0,"cRede":82,"cC":0},"UNDER":{"E":10,"D":15,"ENV":1,"C":7,"cRede":1884.28,"cC":591.46},"FIRE":{"E":8,"D":7,"ENV":0,"C":3,"cRede":919,"cC":162},"ITAPUA":{"E":10,"D":10,"ENV":18,"C":2,"cRede":2407.51,"cC":125.3},"MR-POST":{"E":5,"D":4,"ENV":0,"C":4,"cRede":356.53,"cC":151.63},"SERENITY":{"E":15,"D":17,"ENV":0,"C":30,"cRede":566.8,"cC":548},"HAVAIANAS":{"E":173,"D":229,"ENV":452,"C":451,"cRede":19734.67,"cC":9316.37},"RAINHA":{"E":8,"D":15,"ENV":26,"C":12,"cRede":3432.99,"cC":748.32},"PUMA":{"E":8,"D":16,"ENV":49,"C":26,"cRede":11020.02,"cC":3025.28},"KAPPA":{"E":1,"D":1,"ENV":0,"C":0,"cRede":91.3,"cC":0},"BORUTO":{"E":2,"D":2,"ENV":0,"C":0,"cRede":88.6,"cC":0},"AKAZZO":{"E":74,"D":63,"ENV":4,"C":95,"cRede":4098.58,"cC":2593.45},"WIN":{"E":8,"D":10,"ENV":2,"C":17,"cRede":534.6,"cC":474.3},"BATMAN":{"E":3,"D":2,"ENV":1,"C":6,"cRede":258,"cC":258},"DISPORT":{"E":20,"D":8,"ENV":4,"C":15,"cRede":1322.16,"cC":636},"RAFARILLO":{"E":3,"D":6,"ENV":0,"C":4,"cRede":878.4,"cC":401.7},"QUIZ":{"E":1,"D":0,"ENV":0,"C":0,"cRede":58.3,"cC":0},"KOLOSH":{"E":53,"D":30,"ENV":79,"C":80,"cRede":12826.29,"cC":5969.75},"OPANKA":{"E":1,"D":16,"ENV":1,"C":8,"cRede":414.25,"cC":191},"K2":{"E":7,"D":7,"ENV":2,"C":24,"cRede":512,"cC":768},"BICAL":{"E":25,"D":30,"ENV":9,"C":45,"cRede":2138.36,"cC":1370.8},"DISNEY":{"E":20,"D":17,"ENV":30,"C":28,"cRede":2351.63,"cC":967.04},"AUTHENTIC":{"E":1,"D":4,"ENV":0,"C":1,"cRede":133.97,"cC":21.49},"MARVEL":{"E":5,"D":3,"ENV":1,"C":10,"cRede":247.24,"cC":284.11},"GRENDENE":{"E":17,"D":17,"ENV":48,"C":10,"cRede":3176.21,"cC":352.62},"ALL":{"E":5,"D":39,"ENV":65,"C":27,"cRede":12582.71,"cC":843.5},"FILA":{"E":24,"D":35,"ENV":53,"C":70,"cRede":13712.92,"cC":7660.44},"PENALTY":{"E":26,"D":32,"ENV":13,"C":66,"cRede":4732.96,"cC":4491.3},"MUNDO":{"E":7,"D":5,"ENV":0,"C":5,"cRede":349.96,"cC":152.95},"ZAXYNINA":{"E":2,"D":5,"ENV":1,"C":1,"cRede":183.88,"cC":25.79},"LIGA":{"E":5,"D":3,"ENV":1,"C":6,"cRede":271.24,"cC":164.92},"AVURA":{"E":1,"D":4,"ENV":1,"C":8,"cRede":212.4,"cC":286.4},"BOX200":{"E":108,"D":86,"ENV":199,"C":254,"cRede":13425,"cC":8361.33},"SANDILI":{"E":4,"D":2,"ENV":0,"C":0,"cRede":167.4,"cC":0},"SUA CIA":{"E":99,"D":105,"ENV":202,"C":192,"cRede":15559.01,"cC":7533.49},"FIO DE OURO":{"E":28,"D":32,"ENV":16,"C":66,"cRede":2075.59,"cC":1709.47},"HOMEM":{"E":3,"D":3,"ENV":3,"C":16,"cRede":369.19,"cC":657.78},"SETA":{"E":4,"D":3,"ENV":0,"C":1,"cRede":195.3,"cC":27.9},"SALOME":{"E":92,"D":116,"ENV":276,"C":258,"cRede":14938.61,"cC":7989.38},"VIA UNO":{"E":59,"D":61,"ENV":49,"C":151,"cRede":8123.82,"cC":7635.48},"HANNA":{"E":4,"D":8,"ENV":0,"C":13,"cRede":763.96,"cC":851.98},"RUBRO":{"E":10,"D":3,"ENV":2,"C":7,"cRede":549,"cC":268},"TERRA&AGUA":{"E":3,"D":2,"ENV":0,"C":1,"cRede":160,"cC":32},"LULUCA":{"E":1,"D":1,"ENV":0,"C":7,"cRede":62.8,"cC":265.86},"MARK":{"E":4,"D":0,"ENV":0,"C":4,"cRede":151.96,"cC":151.96},"DEFINITIVA":{"E":16,"D":10,"ENV":0,"C":12,"cRede":804,"cC":368},"ASICS":{"E":20,"D":32,"ENV":64,"C":54,"cRede":21142.83,"cC":8362.41},"YKES":{"E":14,"D":9,"ENV":10,"C":29,"cRede":1341.12,"cC":1163.6},"SOUND":{"E":16,"D":18,"ENV":66,"C":6,"cRede":5814.62,"cC":345.25},"STIR":{"E":13,"D":11,"ENV":9,"C":63,"cRede":1534.6,"cC":3013.4},"STRIKE":{"E":13,"D":9,"ENV":9,"C":14,"cRede":1955.74,"cC":829.92},"VELOCE":{"E":11,"D":37,"ENV":36,"C":84,"cRede":3621.86,"cC":3684.76},"WEST":{"E":3,"D":2,"ENV":0,"C":5,"cRede":220,"cC":220},"REDSUN":{"E":3,"D":5,"ENV":2,"C":14,"cRede":448,"cC":614},"ACTVITTA":{"E":19,"D":33,"ENV":65,"C":35,"cRede":9114.66,"cC":2323.31},"OLIMPAK":{"E":2,"D":1,"ENV":0,"C":1,"cRede":120,"cC":40},"ZAGGER":{"E":2,"D":2,"ENV":0,"C":7,"cRede":160,"cC":286},"RENATA":{"E":118,"D":101,"ENV":63,"C":190,"cRede":10771.05,"cC":8786.48},"ADRUN":{"E":30,"D":26,"ENV":35,"C":64,"cRede":5116.06,"cC":3580.49},"MANCHESTER":{"E":3,"D":4,"ENV":0,"C":10,"cRede":361.9,"cC":513.7},"STAR WHITE":{"E":2,"D":23,"ENV":60,"C":122,"cRede":4205.6,"cC":5675.3},"ONITY":{"E":4,"D":5,"ENV":0,"C":5,"cRede":432,"cC":240},"SANTINELLI":{"E":2,"D":3,"ENV":0,"C":6,"cRede":300.76,"cC":347.15},"ZATZ":{"E":4,"D":2,"ENV":1,"C":0,"cRede":480,"cC":0},"DAKOTA":{"E":72,"D":72,"ENV":94,"C":153,"cRede":16659.53,"cC":10252.71},"AMAROK":{"E":2,"D":2,"ENV":1,"C":3,"cRede":496.8,"cC":299.7},"MIZUNO":{"E":23,"D":30,"ENV":46,"C":45,"cRede":15609.77,"cC":6687.47},"MAGIA":{"E":14,"D":13,"ENV":13,"C":29,"cRede":1079.61,"cC":787.24},"TENIS":{"E":5,"D":4,"ENV":3,"C":12,"cRede":589.95,"cC":437.58},"MENDII":{"E":35,"D":41,"ENV":144,"C":72,"cRede":6998,"cC":1774},"CONFORT":{"E":8,"D":7,"ENV":0,"C":9,"cRede":652,"cC":296},"FUFFY":{"E":7,"D":4,"ENV":2,"C":3,"cRede":518.7,"cC":119.7},"JET":{"E":5,"D":4,"ENV":1,"C":3,"cRede":516.54,"cC":173.97},"NATHIELLY":{"E":3,"D":1,"ENV":1,"C":4,"cRede":210,"cC":168},"ZEUZ":{"E":27,"D":30,"ENV":21,"C":78,"cRede":2482.4,"cC":2485.9},"COMFORTFLEX":{"E":4,"D":2,"ENV":0,"C":4,"cRede":355.95,"cC":191.92},"ONEFLIP":{"E":9,"D":12,"ENV":1,"C":48,"cRede":1124.7,"cC":2416.2},"LOGUS":{"E":2,"D":1,"ENV":0,"C":2,"cRede":168,"cC":112},"AZALEIA":{"E":25,"D":46,"ENV":48,"C":64,"cRede":4572.12,"cC":1885.62},"SONIC":{"E":1,"D":2,"ENV":2,"C":0,"cRede":138.4,"cC":0},"BOTA":{"E":8,"D":4,"ENV":7,"C":16,"cRede":1881,"cC":1287},"ANA":{"E":7,"D":4,"ENV":1,"C":27,"cRede":524,"cC":1027},"DIJEANINJETADO":{"E":1,"D":1,"ENV":3,"C":5,"cRede":109.9,"cC":109.9},"BR":{"E":21,"D":26,"ENV":41,"C":49,"cRede":3215.83,"cC":1641.48},"STARFLEX":{"E":25,"D":40,"ENV":78,"C":46,"cRede":6447.34,"cC":2042.78},"IZABELA":{"E":1,"D":1,"ENV":0,"C":2,"cRede":68,"cC":68},"VELUTTI":{"E":7,"D":5,"ENV":13,"C":10,"cRede":1534.38,"cC":602},"PICADILLY":{"E":16,"D":20,"ENV":25,"C":29,"cRede":3247.2,"cC":1461.45},"VELLUTI":{"E":11,"D":8,"ENV":20,"C":16,"cRede":2285.47,"cC":875.91},"VELLUTINHO":{"E":1,"D":0,"ENV":0,"C":0,"cRede":46,"cC":0},"SILVER":{"E":2,"D":5,"ENV":1,"C":20,"cRede":296,"cC":740},"OPX":{"E":7,"D":8,"ENV":0,"C":18,"cRede":450,"cC":540},"ADDAN":{"E":10,"D":16,"ENV":0,"C":15,"cRede":468,"cC":270},"VULCANIZADO":{"E":3,"D":2,"ENV":1,"C":5,"cRede":360,"cC":300},"BOX":{"E":30,"D":20,"ENV":25,"C":41,"cRede":3060,"cC":1728},"RAYVE":{"E":16,"D":17,"ENV":6,"C":37,"cRede":1413.8,"cC":1369.4},"BLITZ":{"E":20,"D":6,"ENV":6,"C":57,"cRede":932.4,"cC":1646.5},"CONFORTWAY":{"E":4,"D":2,"ENV":2,"C":2,"cRede":347,"cC":88},"SAPATO":{"E":1,"D":0,"ENV":2,"C":3,"cRede":116.7,"cC":116.7},"SAPATILHA":{"E":2,"D":4,"ENV":6,"C":4,"cRede":487.8,"cC":167.6},"NIKE":{"E":8,"D":16,"ENV":49,"C":18,"cRede":13808.6,"cC":3556.71},"MAIS":{"E":13,"D":10,"ENV":35,"C":15,"cRede":2137,"cC":453},"RECUPERACAO":{"E":1,"D":0,"ENV":0,"C":5,"cRede":1,"cC":5},"SUZANA":{"E":4,"D":4,"ENV":1,"C":3,"cRede":216,"cC":72},"RED":{"E":5,"D":3,"ENV":20,"C":1,"cRede":1904.96,"cC":65},"SOFTLI":{"E":15,"D":16,"ENV":57,"C":5,"cRede":4163.23,"cC":247.31},"OFF":{"E":1,"D":3,"ENV":2,"C":1,"cRede":339,"cC":65},"KENNER":{"E":18,"D":26,"ENV":59,"C":20,"cRede":7356.88,"cC":1371.91},"SLIDE":{"E":6,"D":3,"ENV":13,"C":4,"cRede":760.54,"cC":138.28},"OXN":{"E":3,"D":1,"ENV":25,"C":3,"cRede":1980.71,"cC":173.07},"ALEGREMENTE":{"E":2,"D":1,"ENV":0,"C":1,"cRede":144,"cC":48},"MORMAII":{"E":2,"D":4,"ENV":4,"C":0,"cRede":283.36,"cC":0},"SKECHERS":{"E":0,"D":27,"ENV":18,"C":58,"cRede":5421.08,"cC":7167},"NOVOPE":{"E":0,"D":2,"ENV":0,"C":0,"cRede":50,"cC":0},"MR":{"E":0,"D":3,"ENV":0,"C":1,"cRede":114.12,"cC":42.57},"VIVAICE":{"E":0,"D":6,"ENV":1,"C":5,"cRede":303.86,"cC":245.61},"SAINT":{"E":0,"D":2,"ENV":0,"C":0,"cRede":116.6,"cC":0},"NEW":{"E":0,"D":2,"ENV":2,"C":0,"cRede":661.22,"cC":0},"ARK":{"E":0,"D":7,"ENV":0,"C":11,"cRede":335.16,"cC":495.3},"BOAONDA":{"E":0,"D":2,"ENV":2,"C":2,"cRede":175.98,"cC":97.36},"POLO":{"E":0,"D":3,"ENV":1,"C":1,"cRede":213.8,"cC":52},"VIASCARPA":{"E":0,"D":1,"ENV":2,"C":12,"cRede":100,"cC":424},"LEVECONFORT":{"E":0,"D":3,"ENV":0,"C":0,"cRede":333.75,"cC":0},"TORRENEZZI":{"E":0,"D":3,"ENV":0,"C":6,"cRede":108.79,"cC":241.7},"LEVETERAPIA":{"E":0,"D":2,"ENV":10,"C":0,"cRede":1541.52,"cC":0},"BR2":{"E":0,"D":7,"ENV":1,"C":11,"cRede":563.47,"cC":775.35},"OPEN":{"E":0,"D":3,"ENV":2,"C":16,"cRede":209.5,"cC":670.4},"COMPARINI":{"E":0,"D":2,"ENV":0,"C":1,"cRede":80,"cC":40},"TENNIS":{"E":0,"D":2,"ENV":0,"C":3,"cRede":70,"cC":105},"SANDALIA":{"E":0,"D":5,"ENV":1,"C":7,"cRede":227.8,"cC":272.96},"REED":{"E":0,"D":51,"ENV":32,"C":139,"cRede":2005.8,"cC":3208.8},"STAR":{"E":0,"D":3,"ENV":1,"C":2,"cRede":207.6,"cC":103.8},"DRAY":{"E":0,"D":0,"ENV":0,"C":1,"cRede":0,"cC":31.99},"SPACE":{"E":0,"D":0,"ENV":0,"C":3,"cRede":0,"cC":64.98},"YEPP":{"E":0,"D":0,"ENV":0,"C":2,"cRede":0,"cC":12},"FISHER":{"E":0,"D":0,"ENV":0,"C":1,"cRede":0,"cC":21.49},"FREE":{"E":0,"D":0,"ENV":0,"C":2,"cRede":0,"cC":60.16},"PETITE":{"E":0,"D":0,"ENV":0,"C":1,"cRede":0,"cC":46.94},"RAFITTHY":{"E":0,"D":0,"ENV":3,"C":4,"cRede":258.72,"cC":167.71},"ZAXININA":{"E":0,"D":0,"ENV":0,"C":2,"cRede":0,"cC":60.16},"CONECTOR":{"E":0,"D":0,"ENV":0,"C":1,"cRede":0,"cC":1.69},"SUPER":{"E":0,"D":0,"ENV":0,"C":1,"cRede":0,"cC":17.72},"HOT":{"E":0,"D":0,"ENV":0,"C":1,"cRede":0,"cC":17.72},"MARIA":{"E":0,"D":0,"ENV":0,"C":1,"cRede":0,"cC":30.33},"AVENGERS":{"E":0,"D":0,"ENV":0,"C":1,"cRede":0,"cC":40.82},"MEIA":{"E":0,"D":0,"ENV":1,"C":0,"cRede":10.55,"cC":0},"XERYUS":{"E":0,"D":0,"ENV":1,"C":0,"cRede":88.31,"cC":0},"RECUPERAA‡AƑO":{"E":0,"D":0,"ENV":64,"C":0,"cRede":64,"cC":0},"DIVERSAO":{"E":0,"D":0,"ENV":1,"C":0,"cRede":38.42,"cC":0},"PAR":{"E":0,"D":0,"ENV":1,"C":0,"cRede":5.25,"cC":0},"NB":{"E":0,"D":0,"ENV":2,"C":0,"cRede":802.45,"cC":0},"REPPLAY":{"E":0,"D":0,"ENV":1,"C":0,"cRede":60,"cC":0},"OLLIE":{"E":0,"D":0,"ENV":3,"C":0,"cRede":177.8,"cC":0}},"lojas":{"5":{"q":535,"c":29773.42,"v":46772.65,"linhas":517},"6":{"q":268,"c":8518.56,"v":14002.32,"linhas":209},"7":{"q":300,"c":12980.53,"v":15470,"linhas":298},"8":{"q":134,"c":7103.72,"v":11654.66,"linhas":134},"9":{"q":48,"c":4557.4,"v":7079.52,"linhas":47},"12":{"q":32,"c":1596.58,"v":2294.68,"linhas":32},"13":{"q":449,"c":22758.63,"v":33933.51,"linhas":430},"14":{"q":101,"c":6134.93,"v":8918.99,"linhas":100},"15":{"q":846,"c":37880.56,"v":47593.45,"linhas":821},"16":{"q":289,"c":22435.89,"v":38825.11,"linhas":279},"17":{"q":4,"c":42.43,"v":94.96,"linhas":3},"18":{"q":116,"c":6110.45,"v":8608.84,"linhas":108},"19":{"q":175,"c":6397.47,"v":7567.25,"linhas":175},"20":{"q":244,"c":13822.78,"v":23116.56,"linhas":234},"21":{"q":131,"c":4304.38,"v":6342.69,"linhas":126},"23":{"q":20,"c":806.06,"v":1109.8,"linhas":18},"24":{"q":68,"c":3381.83,"v":5819.32,"linhas":66},"26":{"q":52,"c":2064.12,"v":2998.48,"linhas":52},"27":{"q":214,"c":10288.73,"v":11017.86,"linhas":205},"28":{"q":21,"c":3871.65,"v":6599.79,"linhas":20},"30":{"q":14,"c":622.51,"v":1209.86,"linhas":14},"32":{"q":97,"c":4436.71,"v":5484.03,"linhas":94},"33":{"q":280,"c":9182.37,"v":15015.2,"linhas":263},"34":{"q":16,"c":830.66,"v":1679.84,"linhas":16},"35":{"q":255,"c":15534.87,"v":23447.45,"linhas":230},"36":{"q":80,"c":4226.59,"v":7012.2,"linhas":80},"37":{"q":17,"c":1602.81,"v":2709.83,"linhas":17},"38":{"q":118,"c":6927.4,"v":9436.82,"linhas":114},"39":{"q":27,"c":1394.22,"v":1989.73,"linhas":26},"40":{"q":33,"c":1652.38,"v":3199.67,"linhas":33},"41":{"q":116,"c":5745.84,"v":8358.84,"linhas":104},"42":{"q":148,"c":6036.83,"v":8013.52,"linhas":139},"43":{"q":10,"c":352.86,"v":489.9,"linhas":8},"44":{"q":8,"c":1291.8,"v":1259.92,"linhas":8},"45":{"q":101,"c":5038.71,"v":7424.99,"linhas":98},"48":{"q":37,"c":2187.71,"v":4240.63,"linhas":32},"49":{"q":737,"c":42204.18,"v":62358.63,"linhas":717},"50":{"q":59,"c":3195.56,"v":5189.41,"linhas":43},"54":{"q":198,"c":11447.3,"v":16003.02,"linhas":192},"55":{"q":101,"c":4951.31,"v":7038.99,"linhas":98},"56":{"q":173,"c":6721.87,"v":9189.27,"linhas":173},"57":{"q":65,"c":3656.78,"v":5364.35,"linhas":64},"58":{"q":26,"c":1704.2,"v":2999.74,"linhas":23},"60":{"q":155,"c":7162.67,"v":10833.45,"linhas":154},"61":{"q":21,"c":1373.44,"v":2249.79,"linhas":21},"63":{"q":215,"c":8353.57,"v":12657.85,"linhas":205},"72":{"q":94,"c":5820.91,"v":8945.06,"linhas":92},"74":{"q":54,"c":4173.15,"v":6989.46,"linhas":54},"75":{"q":235,"c":8961.27,"v":14713.65,"linhas":230},"77":{"q":43,"c":2249.03,"v":4557.57,"linhas":42},"78":{"q":22,"c":978.21,"v":1977.78,"linhas":22},"80":{"q":40,"c":1931.26,"v":2734.6,"linhas":39},"82":{"q":36,"c":2861.44,"v":4714.64,"linhas":36},"83":{"q":134,"c":5414.33,"v":9194.66,"linhas":134},"91":{"q":151,"c":5023.88,"v":9418.49,"linhas":149},"92":{"q":107,"c":4771.22,"v":6553.84,"linhas":107},"93":{"q":110,"c":5885.02,"v":6358.9,"linhas":108},"94":{"q":197,"c":10685.92,"v":16451.03,"linhas":188},"95":{"q":76,"c":4629.72,"v":7929.24,"linhas":73},"96":{"q":34,"c":1879.91,"v":2839.66,"linhas":34}},"abas":[{"nome":"Esquerdo","tipo":"E"},{"nome":"Direito","tipo":"D"},{"nome":"Casados","tipo":"C"},{"nome":"Enviados 2026","tipo":"ENV"},{"nome":"Código Reaproveitado","tipo":"REAP"},{"nome":"Descarte","tipo":"DESC"}]};
  var LS_KEY = 'saci_rede_v1';
  var MOD_ID = 'saci_rede';

  function fInt(v) { return Math.round(v || 0).toLocaleString('pt-BR'); }
  function fMoney(v) { return 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fMoney0(v) { return 'R$ ' + Math.round(v || 0).toLocaleString('pt-BR'); }
  function dataBase(R) { try { return new Date(R.geradoEm).toLocaleDateString('pt-BR'); } catch (e) { return ''; } }
  function fPct(v) { return (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function quando(iso) { try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return iso || ''; } }
  function maisNovo(a, b) { if (!a) return b; if (!b) return a; return new Date(b.geradoEm) > new Date(a.geradoEm) ? b : a; }

  var CSS = [
    '#saciRedeSec{margin-bottom:28px}',
    '#saciRedeSec .srflow{display:grid;grid-template-columns:1fr auto 1fr auto 1fr auto 1.25fr auto 1.1fr;gap:8px;align-items:stretch}',
    '#saciRedeSec .srop{display:flex;align-items:center;justify-content:center;font:800 22px "JetBrains Mono",monospace;color:var(--tx3)}',
    '#saciRedeSec .src{background:linear-gradient(135deg,var(--bg2),var(--bg3));border:1px solid var(--b2);border-radius:12px;padding:12px 10px;text-align:center;min-width:0}',
    '#saciRedeSec .src .l{font-size:10px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px}',
    '#saciRedeSec .src .q{font:800 26px "JetBrains Mono",monospace;line-height:1.05}',
    '#saciRedeSec .src .u{font-size:10px;color:var(--tx3);margin-top:2px}',
    '#saciRedeSec .src .m{font-size:11px;color:var(--tx2);margin-top:8px;line-height:1.5;font-family:"JetBrains Mono",monospace}',
    '#saciRedeSec .src.dir{border-top:2.5px solid #f472b6}#saciRedeSec .src.dir .q{color:#f472b6}',
    '#saciRedeSec .src.esq{border-top:2.5px solid var(--blu)}#saciRedeSec .src.esq .q{color:var(--blu)}',
    '#saciRedeSec .src.env{border-top:2.5px solid var(--amb)}#saciRedeSec .src.env .q{color:var(--amb)}',
    '#saciRedeSec .src.rede{border:1px solid var(--pbdr);border-top:3px solid var(--pur);background:linear-gradient(135deg,rgba(139,92,246,.10),var(--bg3))}#saciRedeSec .src.rede .q{color:var(--pur);font-size:30px}',
    '#saciRedeSec .src.cas{border-top:2.5px solid var(--grn)}#saciRedeSec .src.cas .q{color:var(--grn)}',
    '#saciRedeSec .src.sal{border:1px solid var(--rbdr);border-top:3px solid var(--red);background:linear-gradient(135deg,rgba(255,51,85,.10),var(--bg3))}#saciRedeSec .src.sal .q{color:var(--red);font-size:30px}',
    '#saciRedeSec .srbars{margin:14px 0 10px;display:grid;gap:8px}',
    '#saciRedeSec .srbar{display:flex;height:26px;border-radius:7px;overflow:hidden;background:var(--bg3);border:1px solid var(--b2)}',
    '#saciRedeSec .srbar div{display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;min-width:0}',
    '#saciRedeSec .srbl{font-size:10.5px;color:var(--tx3);margin-bottom:3px}',
    '#saciRedeSec .srchips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}',
    '#saciRedeSec .srchip{background:var(--bg2);border:1px solid var(--b2);border-radius:8px;padding:7px 11px;font-size:11.5px;color:var(--tx2)}',
    '#saciRedeSec .srchip b{color:var(--tx1);font-family:"JetBrains Mono",monospace}',
    '#saciRedeSec .srchip.warn{border-color:var(--abdr);background:var(--abg);color:var(--amb)}',
    '#saciRedeSec .srgrid{display:grid;grid-template-columns:1.6fr 1fr;gap:12px}',
    '#saciRedeSec .srbox{background:var(--bg2);border:1px solid var(--b1);border-radius:10px;padding:12px;min-width:0}',
    '#saciRedeSec .srbox h3{font-size:12.5px;font-weight:800;margin:0 0 2px}',
    '#saciRedeSec .srbox .s{font-size:10.5px;color:var(--tx3);margin-bottom:8px}',
    '#saciRedeSec .srtw{overflow:auto;max-height:420px}',
    '#saciRedeSec table{width:100%;border-collapse:collapse;font-size:11.5px}',
    '#saciRedeSec th{position:sticky;top:0;background:var(--bg3);color:var(--tx3);font-weight:700;font-size:10px;text-transform:uppercase;padding:6px 7px;text-align:right;white-space:nowrap}',
    '#saciRedeSec th:first-child,#saciRedeSec td:first-child{text-align:left}',
    '#saciRedeSec td{padding:5px 7px;border-top:1px solid var(--b1);text-align:right;font-family:"JetBrains Mono",monospace;color:var(--tx2);white-space:nowrap}',
    '#saciRedeSec td:first-child{font-family:Inter,sans-serif;color:var(--tx1);font-weight:600}',
    '#saciRedeSec td.rd{color:var(--red);font-weight:700}#saciRedeSec td.gr{color:var(--grn)}#saciRedeSec td.pu{color:var(--pur);font-weight:700}',
    '#saciRedeSec tfoot td{border-top:1px solid var(--b3);font-weight:800;color:var(--tx1)}',
    '#saciRedeSec .srfonte{font-size:10.5px;color:var(--tx3);margin-top:10px}',
    '#saciRedeSec .srmais{margin-top:8px}',
    '@media(max-width:1100px){#saciRedeSec .srflow{grid-template-columns:1fr 1fr 1fr}#saciRedeSec .srop{display:none}#saciRedeSec .srgrid{grid-template-columns:1fr}}',
    '@media(max-width:600px){#saciRedeSec .srflow{grid-template-columns:1fr 1fr}#saciRedeSec .src .q{font-size:22px}}'
  ].join('\n');

  /* ---------- estado ---------- */
  function lerLocal(w) { try { var x = JSON.parse(w.localStorage.getItem(LS_KEY) || 'null'); return x && x.versao ? x : null; } catch (e) { return null; } }
  function gravarLocal(w, R) { try { w.localStorage.setItem(LS_KEY, JSON.stringify(R)); } catch (e) { } }
  function clienteSb(d) {
    var w = d.defaultView;
    if (w.__saciRedeSb !== undefined) return w.__saciRedeSb;
    try { var s = d.createElement('script'); s.textContent = 'try{window.__saciRedeSb=(typeof sb!=="undefined"&&sb)?sb:null}catch(e){window.__saciRedeSb=null}'; d.body.appendChild(s); s.remove(); } catch (e) { w.__saciRedeSb = null; }
    return w.__saciRedeSb || null;
  }
  /* Na nuvem, marcas/lojas vão como listas: o gatilho portal_sync_preserva_cargas mescla chaves de
     objetos (uma marca que sumiu no D1 novo ficaria presa), mas lista nova com dados substitui a antiga. */
  function paraNuvem(R) { var o = JSON.parse(JSON.stringify(R)); o.marcas = Object.keys(R.marcas).map(function (k) { return [k, R.marcas[k]]; }); o.lojas = Object.keys(R.lojas).map(function (k) { return [k, R.lojas[k]]; }); return o; }
  function deNuvem(P) { var o = JSON.parse(JSON.stringify(P)); ['marcas', 'lojas'].forEach(function (k) { if (Array.isArray(o[k])) { var m = {}; o[k].forEach(function (e) { m[e[0]] = e[1]; }); o[k] = m; } }); return o; }
  function puxarNuvem(d) {
    var c = clienteSb(d);
    if (!c) return Promise.resolve(null);
    return c.from('portal_sync').select('payload,updated_at').eq('module_id', MOD_ID).maybeSingle()
      .then(function (r) { return r && !r.error && r.data && r.data.payload && r.data.payload.versao ? deNuvem(r.data.payload) : null; }, function () { return null; });
  }
  function enviarNuvem(d, R) {
    var c = clienteSb(d);
    if (!c) return;
    c.from('portal_sync').upsert({ module_id: MOD_ID, payload: paraNuvem(R), updated_at: new Date().toISOString() }).then(function () { }, function () { });
  }
  function toast(d, msg, tipo) { var w = d.defaultView; if (typeof w.toast === 'function') try { w.toast(msg, tipo || 'g'); } catch (e) { } }

  /* ---------- cartões do Resumo Geral ---------- */
  function setTxt(d, id, t) { var e = d.getElementById(id); if (e && e.textContent !== t) e.textContent = t; }
  function setLbl(d, id, t) {
    var e = d.getElementById(id); if (!e) return;
    var card = e.closest('.hc,.kc'); var l = card && card.querySelector('.hl,.kl');
    if (l && l.textContent !== t) l.textContent = t;
    if (card && card.title !== t) card.title = t;
  }
  function aplicarCards(d) {
    var R = d.__saciRedeR; if (!R) return;
    var K = SR.conta(R), pos = ' · posição de ' + dataBase(R);
    setLbl(d, 'gTotalSaci', '🧦 Saci na Rede — aguardando par');
    setTxt(d, 'gTotalSaci', fInt(K.rede.q));
    setTxt(d, 'gTotalSaciBrk', 'Direito ' + fInt(R.D.q) + ' + Esquerdo ' + fInt(R.E.q) + ' + Enviados 2026 ' + fInt(R.ENV.q) + pos);
    setLbl(d, 'gTotalCasados', '✅ Pés Casados — Total');
    setTxt(d, 'gTotalCasados', fInt(K.casadosPes));
    setTxt(d, 'gTotalCasadosBrk', fInt(K.casadosPares) + ' pares já casados (aba Casados) · histórico, fora da conta' + pos);
    setLbl(d, 'gTotalRecebido', '📦 Total de Saci Recebido');
    setTxt(d, 'gTotalRecebido', fInt(K.recebido));
    setTxt(d, 'gTotalRecebidoBrk', 'Saci na Rede ' + fInt(K.rede.q) + ' + Pés Casados ' + fInt(K.casadosPes) + pos);
    // ordem: Saci na Rede → Casados → Total recebido
    var a = d.getElementById('gTotalSaci'), b = d.getElementById('gTotalCasados'), c = d.getElementById('gTotalRecebido');
    a = a && a.closest('.hc'); b = b && b.closest('.hc'); c = c && c.closest('.hc');
    if (a && b && c && a.parentNode === b.parentNode && b.parentNode === c.parentNode && (a.nextElementSibling !== b || b.nextElementSibling !== c)) {
      a.parentNode.insertBefore(a, a.parentNode.firstChild); a.parentNode.insertBefore(b, a.nextSibling); a.parentNode.insertBefore(c, b.nextSibling);
    }
    setLbl(d, 'd1kCusto', 'Custo Total Casado'); setTxt(d, 'd1kCusto', fMoney0(R.C.c));
    setLbl(d, 'd1kVenda', 'Venda Total Casado'); setTxt(d, 'd1kVenda', fMoney0(R.C.v));
    setLbl(d, 'd1kCustoSaci', 'Custo Total Saci na Rede'); setTxt(d, 'd1kCustoSaci', fMoney0(K.rede.c));
    setLbl(d, 'd1kVendaSaci', 'Venda Total Saci na Rede'); setTxt(d, 'd1kVendaSaci', fMoney0(K.rede.v));
    setLbl(d, 'd1kTaxa', 'Taxa de Casamento (pés casados ÷ total recebido)'); setTxt(d, 'd1kTaxa', fPct(K.taxa));
    setLbl(d, 'd1kDescarte', 'Descarte (fora da conta)'); setTxt(d, 'd1kDescarte', fInt(R.DESC.q));
    setTxt(d, 'd1kCustoDescarte', fMoney0(R.DESC.c));
    setTxt(d, 'd1kVendaDescarte', fMoney0(R.DESC.v));
  }

  /* ---------- tabelas ---------- */
  function linhasMarcas(R) {
    return Object.keys(R.marcas).map(function (m) {
      var x = R.marcas[m], rede = x.D + x.E + x.ENV;
      return { marca: m, D: x.D, E: x.E, ENV: x.ENV, rede: rede, C: x.C, cRede: x.cRede };
    }).sort(function (a, b) { return b.rede - a.rede || b.C - a.C; });
  }
  function linhasLojas(R) {
    return Object.keys(R.lojas).map(function (l) { var x = R.lojas[l]; return { loja: l, q: x.q, c: x.c, v: x.v, pct: R.ENV.q > 0 ? x.q / R.ENV.q * 100 : 0 }; })
      .sort(function (a, b) { return b.q - a.q; });
  }
  function nomeLoja(d, l) {
    var w = d.defaultView, reg = '';
    try { var m = w.REGIONAL_MAP; var k = typeof w.normCode === 'function' ? w.normCode(l) : l; if (m && m[k]) reg = m[k].regional || m[k].nome || (typeof m[k] === 'string' ? m[k] : ''); } catch (e) { }
    return 'Loja ' + l + (reg ? ' · ' + reg : '');
  }

  function render(d) {
    var R = d.__saciRedeR, sec = d.getElementById('saciRedeSec');
    if (!R || !sec) return;
    var K = SR.conta(R);
    function card(cls, lbl, o, un) {
      return '<div class="src ' + cls + '"><div class="l">' + lbl + '</div><div class="q">' + fInt(o.q) + '</div><div class="u">' + (un || 'pés') + '</div>' +
        '<div class="m">Custo ' + fMoney0(o.c) + '<br>Venda ' + fMoney0(o.v) + '</div></div>';
    }
    var tot = Math.max(K.rede.q, 1);
    function seg(q, cor, txt, base) { var p = q / (base || tot) * 100; return '<div style="width:' + p.toFixed(3) + '%;background:' + cor + '" title="' + esc(txt) + '">' + (p > 9 ? esc(txt) : '') + '</div>'; }
    var M = linhasMarcas(R), L = linhasLojas(R);
    var verTodas = !!d.__saciRedeTodas;
    var MV = verTodas ? M : M.slice(0, 15);
    var mHtml = MV.map(function (r) {
      return '<tr><td>' + esc(r.marca) + '</td><td>' + fInt(r.D) + '</td><td>' + fInt(r.E) + '</td><td>' + fInt(r.ENV) + '</td><td class="rd">' + fInt(r.rede) +
        '</td><td>' + fMoney(r.cRede) + '</td><td class="gr">' + fInt(r.C) + '</td></tr>';
    }).join('');
    var lHtml = L.map(function (r) {
      return '<tr><td>' + esc(nomeLoja(d, r.loja)) + '</td><td class="pu">' + fInt(r.q) + '</td><td>' + fMoney(r.c) + '</td><td>' + fPct(r.pct) + '</td></tr>';
    }).join('') + (R.envSemLoja.q ? '<tr><td>(Sem loja de origem)</td><td class="pu">' + fInt(R.envSemLoja.q) + '</td><td>' + fMoney(R.envSemLoja.c) + '</td><td>' + fPct(R.envSemLoja.q / Math.max(R.ENV.q, 1) * 100) + '</td></tr>' : '');
    var neg = R.cNeg && R.cNeg.linhas ? '<div class="srchip warn">⚠️ Casados: <b>' + fInt(R.cNeg.linhas) + '</b> linha(s) com valor negativo (custo ' + fMoney(R.cNeg.c) + ') — conferir estorno/devolução</div>' : '';

    sec.innerHTML =
      '<div class="sechd"><div><h2>🧮 Saci na Rede — Conta Oficial · posição de ' + esc(dataBase(R)) + '</h2>' +
      '<div class="shsub">Pé Direito + Pé Esquerdo + Enviados 2026 = <b>Saci na Rede</b> (pés reais que precisamos casar) · Casados é histórico, fica fora da conta</div></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap" class="no-print">' +
      '<button class="btn" data-sr="up">📤 Atualizar com novo D1.xlsx</button>' +
      '<button class="btn" data-sr="xls">📥 Excel da conta</button>' +
      '<input type="file" data-sr="file" accept=".xlsx,.xls" style="display:none"></div></div>' +
      '<div class="srflow">' +
      card('dir', '🟥 Pé Direito', R.D) + '<div class="srop">+</div>' +
      card('esq', '🟦 Pé Esquerdo', R.E) + '<div class="srop">+</div>' +
      card('env', '🚚 Enviados 2026', R.ENV) + '<div class="srop">=</div>' +
      card('sal', '🧦 Saci na Rede — a casar', K.rede) + '<div class="srop">|</div>' +
      card('cas', '✅ Já casados (histórico)', { q: K.casadosPes, c: R.C.c, v: R.C.v }, 'pés = ' + fInt(K.casadosPares) + ' pares') +
      '</div>' +
      '<div class="srbars"><div><div class="srbl">De onde vem o Saci na Rede (' + fInt(K.rede.q) + ' pés a casar)</div><div class="srbar">' +
      seg(R.D.q, '#db2777', 'Direito ' + fInt(R.D.q)) + seg(R.E.q, '#2563eb', 'Esquerdo ' + fInt(R.E.q)) + seg(R.ENV.q, '#d97706', 'Enviados 2026 ' + fInt(R.ENV.q)) + '</div></div>' +
      '<div><div class="srbl">Tudo que já entrou (' + fInt(K.recebido) + ' pés)</div><div class="srbar">' +
      seg(K.casadosPes, '#059669', 'Casados ' + fInt(K.casadosPes) + ' pés (' + fPct(K.taxa) + ')', K.recebido) + seg(K.rede.q, '#e11d48', 'Saci na Rede ' + fInt(K.rede.q) + ' (' + fPct(100 - K.taxa) + ')', K.recebido) + '</div></div></div>' +
      '<div class="srchips">' +
      '<div class="srchip">Taxa de casamento <b>' + fPct(K.taxa) + '</b> (pés casados ÷ total recebido)</div>' +
      '<div class="srchip">Descarte (fora da conta) <b>' + fInt(R.DESC.q) + '</b> pés · ' + fMoney(R.DESC.c) + '</div>' +
      '<div class="srchip">Código reaproveitado (fora da conta) <b>' + fInt(R.REAP.q) + '</b> pés · ' + fMoney(R.REAP.c) + '</div>' + neg +
      '</div>' +
      '<div class="srgrid">' +
      '<div class="srbox"><h3>🏷️ Saci na Rede por Marca</h3><div class="s">Ordenado pelo maior Saci na Rede · marca = primeira palavra da descrição</div><div class="srtw"><table>' +
      '<thead><tr><th>Marca</th><th>Direito</th><th>Esquerdo</th><th>Enviados</th><th>Saci na Rede</th><th>Custo</th><th>Casados (pares)</th></tr></thead><tbody>' + mHtml + '</tbody>' +
      '<tfoot><tr><td>Total (' + fInt(M.length) + ' marcas)</td><td>' + fInt(R.D.q) + '</td><td>' + fInt(R.E.q) + '</td><td>' + fInt(R.ENV.q) + '</td><td>' + fInt(K.rede.q) + '</td><td>' + fMoney(K.rede.c) + '</td><td>' + fInt(R.C.q) + '</td></tr></tfoot></table></div>' +
      (M.length > 15 ? '<button class="btn srmais" data-sr="todas">' + (verTodas ? '▲ Mostrar só as 15 maiores' : '▼ Ver todas as ' + M.length + ' marcas') + '</button>' : '') + '</div>' +
      '<div class="srbox"><h3>🚚 Enviados 2026 por Loja de Origem</h3><div class="s">Pés de saci enviados pelas lojas ao D1 em 2026</div><div class="srtw"><table>' +
      '<thead><tr><th>Loja</th><th>Pés</th><th>Custo</th><th>% enviados</th></tr></thead><tbody>' + (lHtml || '<tr><td colspan="4">Sem loja de origem na planilha</td></tr>') + '</tbody>' +
      '<tfoot><tr><td>Total (' + fInt(L.length) + ' lojas)</td><td>' + fInt(R.ENV.q) + '</td><td>' + fMoney(R.ENV.c) + '</td><td>100%</td></tr></tfoot></table></div></div>' +
      '</div>' +
      '<div class="srfonte">Fonte: ' + esc(R.arquivo || 'D1.xlsx') + ' · conta atualizada em ' + esc(quando(R.geradoEm)) +
      ' · Direito/Esquerdo: custo da linha e venda = Pdv unitário × qtd · Enviados: custo e venda unitários × qtde · Casados: Qtde = pares · linhas de "Total" do rodapé não entram.</div>';

    sec.querySelector('[data-sr="up"]').onclick = function () { sec.querySelector('[data-sr="file"]').click(); };
    sec.querySelector('[data-sr="file"]').onchange = function () { var f = this.files && this.files[0]; this.value = ''; if (f) lerArquivo(d, f, true); };
    sec.querySelector('[data-sr="xls"]').onclick = function () { exportarExcel(d); };
    var bt = sec.querySelector('[data-sr="todas"]');
    if (bt) bt.onclick = function () { d.__saciRedeTodas = !d.__saciRedeTodas; render(d); };
    aplicarCards(d);
  }

  function usar(d, R, origem) {
    var atual = d.__saciRedeR;
    if (atual && origem !== 'upload' && maisNovo(atual, R) === atual) return;
    d.__saciRedeR = R;
    render(d);
  }

  /* ---------- upload ---------- */
  function lerArquivo(d, file, avisarSeNaoFor) {
    var w = d.defaultView;
    if (!/\.xlsx?$/i.test(file.name) || !w.XLSX) return;
    var fr = new w.FileReader();
    fr.onload = function (ev) {
      try {
        var wb = w.XLSX.read(ev.target.result, { type: 'array' });
        var R = SR.resumirWorkbook(w.XLSX, wb, { arquivo: file.name });
        if (!R) { if (avisarSeNaoFor) toast(d, '⚠ "' + file.name + '" não tem as abas Direito/Esquerdo/Enviados 2026 e Casados', 'a'); return; }
        gravarLocal(w, R); enviarNuvem(d, R); usar(d, R, 'upload');
        var K = SR.conta(R);
        toast(d, '🧮 Saci na Rede atualizado: ' + fInt(K.rede.q) + ' pés a casar · ' + fInt(K.casadosPares) + ' pares já casados', 'g');
      } catch (e) { toast(d, 'Erro ao ler "' + file.name + '": ' + e.message, 'r'); }
    };
    fr.readAsArrayBuffer(file);
  }

  /* ---------- Excel ---------- */
  function exportarExcel(d) {
    var w = d.defaultView, R = d.__saciRedeR; if (!R || !w.XLSX) return;
    var K = SR.conta(R), X = w.XLSX, wb = X.utils.book_new();
    var conta = [['Saci na Rede — Conta Oficial', '', '', ''], ['Fonte: ' + (R.arquivo || 'D1.xlsx') + ' · ' + quando(R.geradoEm), '', '', ''], [],
      ['Item', 'Pés', 'Custo', 'Venda'],
      ['(+) Pé Direito', R.D.q, R.D.c, R.D.v], ['(+) Pé Esquerdo', R.E.q, R.E.c, R.E.v], ['(+) Enviados 2026', R.ENV.q, R.ENV.c, R.ENV.v],
      ['(=) Saci na Rede — pés a casar', K.rede.q, K.rede.c, K.rede.v], [],
      ['Já casados (histórico, fora da conta) — ' + K.casadosPares + ' pares', K.casadosPes, R.C.c, R.C.v],
      ['Total de saci recebido (Saci na Rede + pés casados)', K.recebido], ['Taxa de casamento (pés casados ÷ total recebido)', K.taxa / 100], [],
      ['Descarte (fora da conta)', R.DESC.q, R.DESC.c, R.DESC.v], ['Código reaproveitado (fora da conta)', R.REAP.q, R.REAP.c, R.REAP.v]];
    if (R.cNeg && R.cNeg.linhas) conta.push(['Casados com valor negativo (' + R.cNeg.linhas + ' linhas)', R.cNeg.q, R.cNeg.c, R.cNeg.v]);
    var s1 = X.utils.aoa_to_sheet(conta); s1['!cols'] = [{ wch: 42 }, { wch: 12 }, { wch: 16 }, { wch: 16 }];
    X.utils.book_append_sheet(wb, s1, 'Conta');
    var m = [['Marca', 'Direito', 'Esquerdo', 'Enviados 2026', 'Saci na Rede (pés)', 'Custo Saci na Rede', 'Casados (pares)']].concat(linhasMarcas(R).map(function (r) { return [r.marca, r.D, r.E, r.ENV, r.rede, r.cRede, r.C]; }));
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(m), 'Por Marca');
    var l = [['Loja de origem', 'Pés enviados', 'Custo', 'Venda', '% dos enviados']].concat(linhasLojas(R).map(function (r) { return [r.loja, r.q, r.c, r.v, r.pct / 100]; }));
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(l), 'Enviados por Loja');
    X.writeFile(wb, 'Saci_na_Rede_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }

  /* ---------- instalação no módulo ---------- */
  function ehSaci(d) {
    return d.readyState !== 'loading' && d.getElementById('gTotalSaci') && d.getElementById('gTotalRecebido') && d.getElementById('finpUnified') && d.defaultView && d.defaultView.XLSX;
  }
  function instalar(d) {
    if (d.__saciRede || !ehSaci(d)) return;
    d.__saciRede = 1;
    var w = d.defaultView;
    var st = d.createElement('style'); st.setAttribute('data-saci-rede', '1'); st.textContent = CSS; d.head.appendChild(st);
    var hero = d.getElementById('gTotalSaci').closest('.section') || d.getElementById('gTotalSaci').parentNode;
    var sec = d.createElement('div'); sec.className = 'section'; sec.id = 'saciRedeSec';
    hero.parentNode.insertBefore(sec, hero);
    // recálculo do módulo → reaplica a conta oficial nos cartões
    if (typeof w.recomputeGrandTotals === 'function' && !w.recomputeGrandTotals.__sr) {
      var orig = w.recomputeGrandTotals;
      w.recomputeGrandTotals = function () { var r = orig.apply(this, arguments); try { aplicarCards(d); } catch (e) { } return r; };
      w.recomputeGrandTotals.__sr = 1;
    }
    // upload normal do módulo → também refaz a conta se o arquivo tiver as abas
    if (typeof w.handleFilesUnified === 'function' && !w.handleFilesUnified.__sr) {
      var origUp = w.handleFilesUnified;
      w.handleFilesUnified = function (fl) { try { Array.prototype.slice.call(fl || []).forEach(function (f) { lerArquivo(d, f, false); }); } catch (e) { } return origUp.apply(this, arguments); };
      w.handleFilesUnified.__sr = 1;
    }
    usar(d, maisNovo(BASE, lerLocal(w)), 'local');
    puxarNuvem(d).then(function (R) { if (R) { gravarLocal(w, maisNovo(lerLocal(w), R)); usar(d, R, 'nuvem'); } });
  }
  function docs(w, a, p) { if (p > 4) return a; try { if (w.document) a.push(w.document); } catch (e) { return a; } for (var i = 0; i < w.frames.length; i++) try { docs(w.frames[i], a, p + 1); } catch (e) { } return a; }
  function varrer() {
    docs(window, [], 0).forEach(function (d) {
      try { instalar(d); if (d.__saciRede) aplicarCards(d); } catch (e) { console.warn('[Portal] Saci na Rede:', e); }
    });
  }
  varrer(); setInterval(varrer, 1500);
})();
