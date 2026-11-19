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
  /* Acento quebrado (UTF-8 lido como Windows-1252, ex.: "RECUPERAÃ‡ÃƒO" → "RECUPERAÇÃO").
     Só troca se a sequência inteira for UTF-8 válido — "LIMÃO" legítimo fica como está. */
  var CP1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E,
    0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
  function consertaAcento(v) {
    var s = String(v == null ? '' : v);
    if (!/[\u00C2\u00C3]/.test(s)) return s;
    return s.replace(/[\u00C2-\u00C3][\u0080-\u00BF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013-\u2122]/g, function (par) {
      var b = []; for (var i = 0; i < par.length; i++) { var c = par.charCodeAt(i); b.push(c < 256 ? c : CP1252[c]); }
      if (b.some(function (x) { return x == null; })) return par;
      try { return decodeURIComponent(b.map(function (x) { return '%' + ('0' + x.toString(16)).slice(-2); }).join('')); } catch (e) { return par; }
    });
  }

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
    var s = norm(consertaAcento(desc));
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
    var mkLoja = {};
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
          else { var L = R.lojas[lj] || (R.lojas[lj] = vazio()); soma(L, q, custo, venda); var MK = mkLoja[lj] || (mkLoja[lj] = {}); MK[marca] = (MK[marca] || 0) + q; }
        }
      }
    });
    ['E', 'D', 'ENV', 'C', 'DESC', 'REAP', 'cNeg', 'envSemLoja'].forEach(function (k) { R[k].c = r2(R[k].c); R[k].v = r2(R[k].v); });
    Object.keys(R.lojas).forEach(function (k) {
      var L = R.lojas[k]; L.c = r2(L.c); L.v = r2(L.v);
      var MK = mkLoja[k] || {}; L.marca = Object.keys(MK).sort(function (a, b) { return MK[b] - MK[a]; })[0] || ''; L.marcaQ = L.marca ? MK[L.marca] : 0;
    });
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

  root.SaciRede = { resumirAoA: resumirAoA, resumirWorkbook: resumirWorkbook, conta: conta, extractMarca: extractMarca, consertaAcento: consertaAcento, tipoAba: tipoAba };
})(typeof module !== 'undefined' && module.exports ? module.exports : (typeof window !== 'undefined' ? window : this));
