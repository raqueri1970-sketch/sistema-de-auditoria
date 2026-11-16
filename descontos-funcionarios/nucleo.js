/* Descontos de Funcionários — núcleo (leitura dos arquivos, cruzamento de nomes e regras de auditoria).
 * Roda no navegador (window.DF) e no Node (module.exports), com o mesmo código, para conferir os números.
 *
 * Regras (Controladoria, 16/11/2026):
 *  - Limite do desconto de funcionário: 10% do item. Desconto até R$ 0,50 acima do limite é tolerado (arredondamento).
 *  - Item Democrata com R$ 0,01 de desconto (sem percentual) = brinde de carteira: desconsiderado (desconto tratado como zero).
 *  - Outro desconto de centavos sem percentual é arredondamento do caixa, não desconto.
 *  - Venda com Meia Hoahi + calçado = Campanha Meias (não aponta): fica separada, não entra nas suspeitas.
 *  - Funcionário = nome no cadastro de Funcionários Ativos, aceitando erro de digitação ("RODIGUES" × "RODRIGUES")
 *    e nome abreviado ("MARIA DE FATIMA G DE OLIVEIRA"). Nome curto demais (2 palavras) não é confirmado.
 */
(function (raiz) {
  'use strict';
  const TOL = 0.5;          // tolerância em R$ acima do limite
  const LIMITE = 10;        // % do desconto de funcionário
  const PART = new Set(['DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'D']);
  const SEM_NOME = /^(CONSUMIDOR|CLIENTE|CLIENTE BALCAO|NAO INFORMADO|NAO IDENTIFICADO|DIVERSOS|VENDA BALCAO)?$/;

  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const toks = s => norm(s).replace(/[^A-Z ]/g, ' ').split(' ').filter(t => t && !PART.has(t));
  const num = v => {
    if (typeof v === 'number') return v;
    let s = String(v == null ? '' : v).trim(); if (!s) return 0;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s); return isFinite(n) ? n : 0;
  };
  const r2 = v => Math.round(v * 100) / 100;

  // ---------- similaridade de nomes ----------
  function lev(a, b) {
    if (a === b) return 0; const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let p = new Array(n + 1), c = new Array(n + 1);
    for (let j = 0; j <= n; j++) p[j] = j;
    for (let i = 1; i <= m; i++) { c[0] = i; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); [p, c] = [c, p]; }
    return p[n];
  }
  const sim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);
  const tokOk = (x, y) => x === y || (x.length === 1 ? y.startsWith(x) : x.length >= 4 && x[0] === y[0] && sim(x, y) >= 0.8);
  function subseq(t, e) { let j = 0; for (const x of t) { while (j < e.length && !tokOk(x, e[j])) j++; if (j === e.length) return false; j++; } return true; }

  // índice do cadastro: casa um nome de cliente com um funcionário
  function indiceFuncionarios(func) {
    const exato = new Map(), porPrimeiro = new Map();
    func.forEach((f, i) => {
      const t = toks(f[1]); if (!t.length) return; const k = t.join(' ');
      if (!exato.has(k)) exato.set(k, i);
      if (!porPrimeiro.has(t[0])) porPrimeiro.set(t[0], []); porPrimeiro.get(t[0]).push([i, t, k]);
    });
    const cache = new Map();
    function casar(nome) {
      if (cache.has(nome)) return cache.get(nome);
      const t = toks(nome), k = t.join(' '); let r;
      if (exato.has(k)) r = {i: exato.get(k), modo: 'exato'};
      else if (t.length < 2) r = {i: -1, modo: 'incompleto'};
      else {
        const cand = [];
        for (const [i, e, ek] of porPrimeiro.get(t[0]) || []) {
          if (e.length < 2) continue;
          const s = sim(k, ek);
          if (s >= 0.9 && tokOk(t[t.length - 1], e[e.length - 1])) cand.push([s + 1, i, 'grafia']);
          else if (t.length >= 3 && subseq(t, e) && tokOk(t[t.length - 1], e[e.length - 1])) cand.push([s, i, 'abreviado']);
          else if (t.length === 2 && subseq(t, e)) cand.push([s - 1, i, 'incompleto']);
        }
        if (!cand.length) r = {i: -1, modo: 'nao'};
        else {
          cand.sort((a, b) => b[0] - a[0]); const top = cand[0];
          if (top[2] === 'abreviado' && cand.filter(c => c[2] === 'abreviado').length > 1) r = {i: top[1], modo: 'ambiguo'};
          else r = {i: top[1], modo: top[2]};
        }
      }
      cache.set(nome, r); return r;
    }
    return casar;
  }

  // ---------- leitura de arquivos ----------
  function splitCSV(linha, sep) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < linha.length; i++) {
      const ch = linha[i];
      if (q) { if (ch === '"') { if (linha[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true; else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur); return out;
  }
  function csvParaLinhas(texto) {
    const ls = texto.replace(/\r/g, '').split('\n').filter(l => l.trim());
    if (!ls.length) return [];
    const sep = (ls[0].match(/;/g) || []).length >= (ls[0].match(/,/g) || []).length ? ';' : ',';
    return ls.map(l => splitCSV(l, sep));
  }
  const acharCab = (rows, nomes) => rows.findIndex(r => r && nomes.every(n => r.some(c => norm(c) === n)));
  function dataISO(v, ordem) { // -> 'AAAA-MM-DD' ou ''
    if (v == null || v === '') return '';
    if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
    if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 864e5)); return isNaN(d) ? '' : d.toISOString().slice(0, 10); }
    const s = String(v).trim(); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (!m) return '';
    let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
    const [dd, mm] = ordem === 'md' ? [b, a] : [a, b];
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
    return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  function ordemDatas(vals) { // descobre se a coluna é dia/mês ou mês/dia
    let md = 0, dm = 0;
    for (const v of vals) { const m = String(v || '').match(/^(\d{1,2})\/(\d{1,2})\//); if (!m) continue; if (+m[1] > 12) dm++; if (+m[2] > 12) md++; }
    return md > dm ? 'md' : 'dm';
  }

  // Base de descontos (CSV/XLSX do sistema): REPORTGROUP;CODIGO;DATA;...;VDESCITEM;...;PERCENTOX;AUTORIZADORX;VENDEDOR;OBS
  function lerDescontos(rows) {
    const h = acharCab(rows, ['CODIGO', 'VDESCITEM']);
    if (h < 0) throw new Error('Base de Descontos: não achei as colunas CODIGO e VDESCITEM. Confira se é o relatório de descontos do sistema.');
    const cab = rows[h].map(norm), ix = n => cab.indexOf(n);
    const c = {loja: ix('REPORTGROUP'), cod: ix('CODIGO'), data: ix('DATA'), prod: ix('PRODUTOX'), cli: ix('NOMECLIENTE'), qtd: ix('QUANTIDADE'),
      preco: ix('VPRECOITEM'), desc: ix('VDESCITEM'), pct: ix('PERCENTOX'), aut: ix('AUTORIZADORX'), vend: ix('VENDEDOR'), obs: ix('OBS')};
    const falta = Object.entries(c).filter(([k, v]) => v < 0 && !['aut', 'obs', 'qtd'].includes(k)).map(([k]) => k);
    if (falta.length) throw new Error('Base de Descontos: faltam colunas ' + falta.join(', '));
    const corpo = rows.slice(h + 1).filter(r => r && r[c.cod] != null && String(r[c.cod]).trim());
    const ordem = ordemDatas(corpo.slice(0, 3000).map(r => r[c.data]));
    return corpo.map(r => ({
      loja: norm(r[c.loja]), cod: String(r[c.cod]).trim(), data: dataISO(r[c.data], ordem), prod: norm(r[c.prod]), cli: norm(r[c.cli]),
      qtd: c.qtd >= 0 ? num(r[c.qtd]) || 1 : 1, preco: num(r[c.preco]), desc: num(r[c.desc]), pct: num(r[c.pct]),
      aut: c.aut >= 0 ? norm(r[c.aut]) : '', vend: norm(r[c.vend]), obs: c.obs >= 0 ? norm(r[c.obs]) : ''
    })).filter(x => x.data);
  }
  // Funcionários Ativos: Codigo | Nome | Cpf | Data Nacimento | Estado Civel | Data Admissão
  function lerFuncionarios(rows) {
    let h = rows.findIndex(r => r && r.some(c => norm(c) === 'NOME') && r.some(c => /^CPF/.test(norm(c))));
    if (h < 0) throw new Error('Cadastro de Funcionários: não achei as colunas Nome e CPF.');
    const cab = rows[h].map(norm), ix = re => cab.findIndex(c => re.test(c));
    const c = {cod: ix(/^COD/), nome: ix(/^NOME$/), cpf: ix(/^CPF/), nasc: ix(/NAS?CIM/), adm: ix(/ADMIS/), cargo: ix(/CARGO|FUNCAO/), loja: ix(/^LOJA|FILIAL/)};
    const corpo = rows.slice(h + 1).filter(r => r && r[c.nome] && String(r[c.nome]).trim());
    const oN = ordemDatas(corpo.map(r => r[c.nasc])), oA = ordemDatas(corpo.map(r => r[c.adm]));
    return corpo.map(r => [String(r[c.cod] ?? '').trim(), norm(r[c.nome]), String(r[c.cpf] ?? '').replace(/\D/g, '').padStart(11, '0'),
      c.nasc >= 0 ? dataISO(r[c.nasc], oN) : '', c.adm >= 0 ? dataISO(r[c.adm], oA) : '', c.cargo >= 0 ? norm(r[c.cargo]) : '', c.loja >= 0 ? norm(r[c.loja]) : '']);
  }
  // Regional: Filial | Verba | Regional | Tipo | CNPJ | E-mail | UF | ...
  function lerRegional(rows) {
    const h = rows.findIndex(r => r && r.some(c => norm(c) === 'FILIAL') && r.some(c => norm(c) === 'REGIONAL'));
    if (h < 0) throw new Error('Regional: não achei as colunas Filial e Regional.');
    const cab = rows[h].map(norm), ix = n => cab.indexOf(n);
    return rows.slice(h + 1).filter(r => r && r[ix('FILIAL')]).map(r => [norm(r[ix('FILIAL')]), norm(r[ix('REGIONAL')]), norm(r[ix('TIPO')]), norm(r[ix('UF')]), num(r[ix('VERBA')])]);
  }
  // que arquivo é este? (pelo conteúdo, não pelo nome)
  function tipoDoArquivo(rows) {
    if (acharCab(rows, ['CODIGO', 'VDESCITEM']) >= 0) return 'descontos';
    if (rows.findIndex(r => r && r.some(c => norm(c) === 'FILIAL') && r.some(c => norm(c) === 'REGIONAL')) >= 0) return 'regional';
    if (rows.findIndex(r => r && r.some(c => norm(c) === 'NOME') && r.some(c => /^CPF/.test(norm(c)))) >= 0) return 'funcionarios';
    return '';
  }

  // ---------- base compacta (é o que vai para a nuvem) ----------
  function montarBase(desc, func, reg, arquivos) {
    const dic = () => { const m = new Map(), a = []; return {id: v => { if (!m.has(v)) { m.set(v, a.length); a.push(v); } return m.get(v); }, a}; };
    const D = {loja: dic(), cli: dic(), prod: dic(), vend: dic(), aut: dic(), obs: dic()};
    const col = {loja: [], cod: [], data: [], prod: [], cli: [], qtd: [], preco: [], desc: [], pct: [], aut: [], vend: [], obs: []};
    desc.sort((a, b) => a.data < b.data ? -1 : a.data > b.data ? 1 : a.cod < b.cod ? -1 : a.cod > b.cod ? 1 : 0);
    for (const x of desc) {
      col.loja.push(D.loja.id(x.loja)); col.cod.push(x.cod); col.data.push(+x.data.replace(/-/g, '')); col.prod.push(D.prod.id(x.prod));
      col.cli.push(D.cli.id(x.cli)); col.qtd.push(x.qtd); col.preco.push(r2(x.preco)); col.desc.push(r2(x.desc)); col.pct.push(x.pct);
      col.aut.push(D.aut.id(x.aut)); col.vend.push(D.vend.id(x.vend)); col.obs.push(D.obs.id(x.obs));
    }
    const dic2 = {}; for (const k in D) dic2[k] = D[k].a;
    return {v: 1, geradoEm: new Date().toISOString(), arquivos: arquivos || {}, dic: dic2, col, func: func || [], reg: reg || []};
  }

  // ---------- auditoria ----------
  const SIT = {
    FUNC: 'Funcionário', FUNC_PROV: 'Funcionário (nome com grafia diferente)', COLAB: 'Colaborador fora do cadastro',
    INCOMP: 'Nome incompleto (não confirmado)', TERC: 'Não é funcionário', SEMNOME: 'Cliente sem nome'
  };
  const CAT = {
    BRINDE: 'Brinde de carteira (Democrata) — desconsiderado', ARRED: 'Arredondamento (centavos)', CAMP: 'Campanha Meias (não aponta)', FUNC_OK: 'Funcionário dentro do limite (10%)',
    FUNC_ACIMA: 'Funcionário acima do limite', COLAB: 'Colaborador fora do cadastro', TERC: 'Desconto a não funcionário',
    INCOMP: 'Nome incompleto', SEMNOME: 'Cliente sem nome', SEM_DESC: 'Sem desconto'
  };

  function analisar(B) {
    const C = B.col, n = C.cod.length, dic = B.dic;
    const casar = indiceFuncionarios(B.func);
    // vendedores (nome curto do sistema) — para achar quem compra e também vende
    const vendTok = dic.vend.map(v => toks(v));
    const porPrim = new Map();
    vendTok.forEach((t, i) => { if (t.length >= 2) { if (!porPrim.has(t[0])) porPrim.set(t[0], []); porPrim.get(t[0]).push(i); } });
    const ehVendedor = t => { if (t.length < 2) return -1; for (const i of porPrim.get(t[0]) || []) { const vt = vendTok[i]; if (tokOk(vt[1], t[1]) && subseq(vt, t)) return i; } return -1; };
    // situação de cada cliente
    const cli = dic.cli.map(nome => {
      const t = toks(nome);
      if (SEM_NOME.test(nome) || !t.length) return {nome, sit: 'SEMNOME', f: -1, modo: ''};
      const m = casar(nome);
      if (m.modo === 'exato') return {nome, sit: 'FUNC', f: m.i, modo: m.modo};
      if (m.modo === 'grafia' || m.modo === 'abreviado') return {nome, sit: 'FUNC_PROV', f: m.i, modo: m.modo};
      const v = ehVendedor(t);
      if (v >= 0) return {nome, sit: 'COLAB', f: m.i, modo: m.modo, vend: v};
      if (m.modo === 'incompleto' || m.modo === 'ambiguo') return {nome, sit: 'INCOMP', f: m.i, modo: m.modo};
      return {nome, sit: 'TERC', f: -1, modo: m.modo};
    });
    // campanha Meias: venda com Meia Hoahi e com algum item que não é meia
    const prodDemo = dic.prod.map(p => /^DEMOCRATA\b/.test(p));
    const prodMeia = dic.prod.map(p => /\bMEIAS?\b/.test(p)), prodHoahi = dic.prod.map(p => p.includes('HOAHI'));
    const vendaH = new Set(), vendaNM = new Set();
    for (let i = 0; i < n; i++) { if (prodHoahi[C.prod[i]]) vendaH.add(C.cod[i]); if (!prodMeia[C.prod[i]]) vendaNM.add(C.cod[i]); }
    // auto-venda: o vendedor da venda é o próprio cliente
    const autoCache = new Map();
    const autoVenda = (c, v) => {
      const k = c * 100000 + v; if (autoCache.has(k)) return autoCache.get(k);
      const vt = vendTok[v], ct = toks(dic.cli[c]);
      const r = vt.length >= 2 && ct.length >= 2 && tokOk(vt[0], ct[0]) && tokOk(vt[1], ct[1]) && subseq(vt, ct);
      autoCache.set(k, r); return r;
    };
    const adm = B.func.map(f => f[4] ? +f[4].replace(/-/g, '') : 0);
    const cat = new Array(n), excesso = new Float64Array(n), flags = new Uint8Array(n); // 1 auto-venda · 2 antes da admissão
    for (let i = 0; i < n; i++) {
      const p = C.preco[i], d = C.desc[i], s = cli[C.cli[i]];
      if (autoVenda(C.cli[i], C.vend[i])) flags[i] |= 1;
      if (s.f >= 0 && (s.sit === 'FUNC' || s.sit === 'FUNC_PROV') && adm[s.f] && C.data[i] < adm[s.f]) flags[i] |= 2;
      if (d <= 0) { cat[i] = 'SEM_DESC'; continue; }
      if (C.pct[i] < 1 && d <= TOL) { cat[i] = prodDemo[C.prod[i]] ? 'BRINDE' : 'ARRED'; continue; }
      if (vendaH.has(C.cod[i]) && vendaNM.has(C.cod[i])) { cat[i] = 'CAMP'; continue; }
      const ex = d - p * LIMITE / 100;
      if (s.sit === 'FUNC' || s.sit === 'FUNC_PROV') { if (ex > TOL) { cat[i] = 'FUNC_ACIMA'; excesso[i] = r2(ex); } else cat[i] = 'FUNC_OK'; }
      else cat[i] = s.sit;
      if (s.sit !== 'FUNC' && s.sit !== 'FUNC_PROV' && ex > TOL) excesso[i] = r2(ex);
    }
    return {B, n, cli, cat, excesso, flags, casar};
  }

  // linha legível (para tabela, relatório e Excel)
  function linha(A, i) {
    const C = A.B.col, d = A.B.dic, s = A.cli[C.cli[i]], dt = String(C.data[i]);
    const f = s.f >= 0 ? A.B.func[s.f] : null;
    return {i, data: `${dt.slice(6, 8)}/${dt.slice(4, 6)}/${dt.slice(0, 4)}`, dataN: C.data[i], venda: C.cod[i], loja: d.loja[C.loja[i]],
      cliente: d.cli[C.cli[i]], sit: s.sit, sitTxt: SIT[s.sit] || s.sit, cadastro: f && (s.sit === 'FUNC' || s.sit === 'FUNC_PROV') ? f[1] : '',
      cpf: f && (s.sit === 'FUNC' || s.sit === 'FUNC_PROV') ? f[2] : '', admissao: f ? f[4] : '',
      vendedor: d.vend[C.vend[i]], produto: d.prod[C.prod[i]], qtd: C.qtd[i], preco: C.preco[i], pct: C.pct[i], desc: A.cat[i] === 'BRINDE' ? 0 : C.desc[i],
      pago: A.cat[i] === 'BRINDE' ? C.preco[i] : r2(C.preco[i] - C.desc[i]), autorizador: d.aut[C.aut[i]] || '', obs: d.obs[C.obs[i]] || '', cat: A.cat[i], catTxt: CAT[A.cat[i]],
      excesso: A.excesso[i], auto: !!(A.flags[i] & 1), antesAdm: !!(A.flags[i] & 2)};
  }

  const api = {TOL, LIMITE, SIT, CAT, norm, toks, num, r2, sim, csvParaLinhas, lerDescontos, lerFuncionarios, lerRegional, tipoDoArquivo, montarBase, analisar, linha, indiceFuncionarios};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else raiz.DF = api;
})(typeof window !== 'undefined' ? window : globalThis);
