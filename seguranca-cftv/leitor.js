/* Segurança Patrimonial e CFTV — leitor de documentos (notas fiscais, planilhas).
 *
 * Funciona no navegador (window.CFTV_LEITOR) e no Node (module.exports), para que o teste automático use exatamente o
 * mesmo código da tela. Não acessa rede nem banco: recebe o texto já posicionado de cada página e devolve um objeto.
 *
 * Entrada de página: lista de "peças" de texto {p, x, y, w, s}, com y crescendo para baixo (topo da página = 0).
 *   - PDF com texto: vem do pdf.js (getTextContent), convertido por itensPdfjs().
 *   - PDF escaneado: vem do OCR (tesseract.js), palavras agrupadas em frases por frasesOcr().
 * O mesmo leitor por rótulo ("célula abaixo do rótulo") serve para os dois casos.
 *
 * Regra: quando um campo não pode ser lido com segurança ele fica vazio e o documento vai para conferência manual,
 * com o motivo. Nada é inventado.
 */
(function (raiz) {
  'use strict';

  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

  // "1.906,7700" → 1906.77 · "R$ 4.560,00" → 4560 · "0, 00" → 0 · "-" → null
  function num(s) {
    if (s === null || s === undefined) return null;
    if (typeof s === 'number') return s;
    const t = String(s).replace(/R\$/g, '').replace(/\s+/g, '').replace(/[^\d,.-]/g, '');
    if (!/\d/.test(t)) return null;
    let v;
    if (t.includes(',')) v = Number(t.replace(/\./g, '').replace(',', '.'));
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) v = Number(t.replace(/\./g, ''));
    else v = Number(t);
    return Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null;
  }
  const r2 = v => v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100;
  // dd/mm/aaaa → aaaa-mm-dd
  function data(s) {
    const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  }
  const soDig = s => String(s || '').replace(/\D/g, '');
  function cnpjFmt(s) {
    const d = soDig(s);
    return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : (d.length === 11 ? d : null);
  }

  // ---------- peças de texto ----------
  // pdf.js: transform[4]=x, transform[5]=y (origem embaixo). Converte para y de cima para baixo.
  function itensPdfjs(textContent, alturaPagina, pagina) {
    const out = [];
    for (const it of textContent.items || []) {
      const s = String(it.str || '').replace(/\u0000/g, '').trim();
      if (!s) continue;
      const h = Math.abs(it.transform[3]) || it.height || 8;
      out.push({p: pagina, x: it.transform[4], y: alturaPagina - it.transform[5], w: it.width || s.length * h * 0.5, h, s});
    }
    return out;
  }

  // OCR: palavras {text, bbox:{x0,y0,x1,y1}} viram frases (palavras vizinhas na mesma linha com espaço pequeno).
  // escala: fator para trazer as coordenadas da imagem para a escala de pontos do PDF (72 dpi).
  function frasesOcr(palavras, pagina, escala) {
    const ws = (palavras || []).filter(w => String(w.text || '').trim()).map(w => ({
      x: w.bbox.x0 * escala, x1: w.bbox.x1 * escala, y: ((w.bbox.y0 + w.bbox.y1) / 2) * escala, h: (w.bbox.y1 - w.bbox.y0) * escala, s: String(w.text).trim()}));
    ws.sort((a, b) => a.y - b.y || a.x - b.x);
    const linhas = [];
    for (const w of ws) {
      const l = linhas.find(l => Math.abs(l.y - w.y) <= Math.max(2, Math.min(l.h, w.h) * 0.45));
      if (l) { l.ws.push(w); l.h = Math.max(l.h, w.h); } else linhas.push({y: w.y, h: w.h, ws: [w]});
    }
    const out = [];
    for (const l of linhas) {
      l.ws.sort((a, b) => a.x - b.x);
      let cur = null;
      for (const w of l.ws) {
        const gap = cur ? w.x - cur.x1 : Infinity;
        if (cur && gap < Math.max(4, l.h * 0.9)) { cur.s += ' ' + w.s; cur.x1 = w.x1; }
        else { cur = {p: pagina, x: w.x, x1: w.x1, y: l.y, h: l.h, s: w.s}; out.push(cur); }
      }
    }
    return out.map(o => ({p: o.p, x: o.x, y: o.y, w: o.x1 - o.x, h: o.h, s: o.s}));
  }

  // Texto corrido (para busca por expressão), na ordem de leitura.
  function textoCorrido(itens) {
    const ord = [...itens].sort((a, b) => a.p - b.p || a.y - b.y || a.x - b.x);
    const linhas = [];
    for (const it of ord) {
      const l = linhas.length ? linhas[linhas.length - 1] : null;
      if (l && l.p === it.p && Math.abs(l.y - it.y) <= 2) l.it.push(it); else linhas.push({p: it.p, y: it.y, it: [it]});
    }
    return linhas.map(l => l.it.sort((a, b) => a.x - b.x).map(i => i.s).join('  ')).join('\n');
  }

  // ---------- busca por rótulo ----------
  function rotulo(itens, rx, aposY, pagina) {
    const c = itens.filter(i => rx.test(norm(i.s)) && (aposY === undefined || i.p > pagina || (i.p === pagina && i.y > aposY)));
    c.sort((a, b) => a.p - b.p || a.y - b.y || a.x - b.x);
    return c[0] || null;
  }
  // Valor logo abaixo do rótulo, entre o x do rótulo e o próximo rótulo da mesma linha.
  function celula(itens, rot, o = {}) {
    if (!rot) return null;
    const tol = o.tol ?? 8, maxDy = o.maxDy ?? 22, linhasMax = o.linhas ?? 1;
    const vizinhos = itens.filter(i => i !== rot && i.p === rot.p && Math.abs(i.y - rot.y) <= 2.2 && i.x > rot.x + 4);
    const xFim = o.xFim ?? (vizinhos.length ? Math.min(...vizinhos.map(i => i.x)) - 1 : 1e9);
    const xIni = rot.x - tol;
    const cand = itens.filter(i => i.p === rot.p && i.y > rot.y + 2 && i.y <= rot.y + maxDy * linhasMax && i.x >= xIni && i.x < xFim);
    if (!cand.length) return null;
    cand.sort((a, b) => a.y - b.y || a.x - b.x);
    const y0 = cand[0].y, linhas = [];
    for (const c of cand) {
      if (o.pararEm && o.pararEm.test(norm(c.s))) break;
      let l = linhas.find(l => Math.abs(l.y - c.y) <= 2.2);
      if (!l) { if (linhas.length >= linhasMax) break; if (linhas.length && c.y - linhas[linhas.length - 1].y > maxDy) break; l = {y: c.y, it: []}; linhas.push(l); }
      l.it.push(c);
    }
    if (!linhas.length || linhas[0].y - y0 > maxDy) return null;
    return linhas.map(l => l.it.sort((a, b) => a.x - b.x).map(i => i.s).join(' ')).join(' ').replace(/\s+/g, ' ').trim();
  }
  const cel = (itens, rx, o = {}) => celula(itens, rotulo(itens, rx, o.aposY, o.pagina), o);

  // ---------- tipo de documento ----------
  function tipoDocumento(itens) {
    const t = norm(textoCorrido(itens));
    if (/DANFSE|DOCUMENTO AUXILIAR DA NFS-?E|NOTA FISCAL DE SERVICO/.test(t)) return 'NFS-e';
    if (/DANFE|DOCUMENTO AUXILIAR DA NOTA FISCAL/.test(t)) return 'NF-e';
    if (/RECIBO/.test(t)) return 'recibo';
    if (/RELATORIO|LAUDO|ORDEM DE SERVICO/.test(t)) return 'relatorio';
    return null;
  }

  // ---------- NFS-e (padrão nacional DANFSe v1.0) ----------
  function lerNFSe(itens) {
    const txt = textoCorrido(itens), T = norm(txt);
    const d = {tipo: 'NFS-e', itens: [], avisos: []};
    const chave = (txt.replace(/\s/g, '').match(/\d{50}/) || [])[0] || null;
    d.chave = chave;
    d.numero = (cel(itens, /^NUMERO DA NFS-?E$/) || '').match(/\d+/)?.[0] || null;
    d.serie = 'NFS-e';
    d.competencia = data(cel(itens, /^COMPETENCIA DA NFS-?E$/));
    d.emissao = data(cel(itens, /^DATA E HORA DA EMISSAO DA NFS-?E$/)) || d.competencia;
    const emit = rotulo(itens, /^EMITENTE DA NFS-?E/);
    const tom = rotulo(itens, /^(TOMADOR|INTERMEDIARIO) DO SERVICO$/);
    const fimEmit = tom ? tom.y : 1e9;
    const dentro = (r, ini, fim) => r && r.p === ini.p && r.y > ini.y - 3 && r.y < fim;
    if (emit) {
      const rc = itens.filter(i => /^CNPJ \/ CPF/.test(norm(i.s)) && dentro(i, emit, fimEmit))[0];
      const rn = itens.filter(i => /^NOME \/ NOME EMPRESARIAL$/.test(norm(i.s)) && dentro(i, emit, fimEmit))[0];
      d.fornecedor_cnpj = cnpjFmt(celula(itens, rc));
      d.fornecedor = celula(itens, rn);
    }
    if (tom) {
      const fimTom = (rotulo(itens, /^SERVICO PRESTADO$/, tom.y, tom.p) || {y: 1e9}).y;
      const rc = itens.filter(i => /^CNPJ \/ CPF/.test(norm(i.s)) && dentro(i, tom, fimTom))[0];
      const rn = itens.filter(i => /^NOME \/ NOME EMPRESARIAL$/.test(norm(i.s)) && dentro(i, tom, fimTom))[0];
      const re = itens.filter(i => /^ENDERECO$/.test(norm(i.s)) && dentro(i, tom, fimTom))[0];
      const rm = itens.filter(i => /^MUNICIPIO$/.test(norm(i.s)) && dentro(i, tom, fimTom))[0];
      d.destinatario_cnpj = cnpjFmt(celula(itens, rc));
      d.destinatario = celula(itens, rn);
      d.destinatario_endereco = celula(itens, re, {linhas: 2, maxDy: 12});
      d.destinatario_municipio = celula(itens, rm);
      if (/INTERMEDIARIO/.test(norm(tom.s))) d.avisos.push('A nota identifica o estabelecimento como intermediário do serviço (tomador não identificado).');
    }
    const rd = rotulo(itens, /^DESCRICAO DO SERVICO$/);
    if (rd) {
      const fim = (rotulo(itens, /^TRIBUTACAO MUNICIPAL$/, rd.y, rd.p) || {y: rd.y + 80}).y;
      d.descricao = itens.filter(i => i.p === rd.p && i.y > rd.y + 2 && i.y < fim - 1).sort((a, b) => a.y - b.y || a.x - b.x).map(i => i.s).join(' ').replace(/\s+/g, ' ').trim() || null;
    }
    d.valor_servico = num(cel(itens, /^VALOR DO SERVICO$/));
    d.valor_liquido = num(cel(itens, /^VALOR LIQUIDO DA NFS-?E$/));
    d.valor_total = r2(d.valor_liquido ?? d.valor_servico);
    d.valor_produtos = null; d.frete = 0; d.outras = 0; d.desconto = num(cel(itens, /^DESCONTO INCONDICIONADO$/)) || 0;
    if (d.valor_servico !== null) d.itens.push({codigo: null, descricao: d.descricao || 'Serviço', ncm: null, unidade: 'SV', quantidade: 1,
      valor_unit: r2(d.valor_servico), valor_total: r2(d.valor_servico), categoria: 'servico'});
    if (!/DANFSE|NFS-?E/.test(T)) d.avisos.push('Layout de NFS-e não reconhecido.');
    return d;
  }

  // ---------- NF-e (DANFE) ----------
  function lerDANFE(itens) {
    const txt = textoCorrido(itens);
    const d = {tipo: 'NF-e', itens: [], avisos: []};
    const ch = txt.match(/(\d{4}\s?){10}\d{4}/g) || [];
    d.chave = ch.map(c => c.replace(/\s/g, '')).find(c => c.length === 44) || null;
    const mn = txt.match(/N[º°o]\.?\s*([\d.]{3,})/);
    d.numero = mn ? String(Number(mn[1].replace(/\./g, ''))) : (d.chave ? String(Number(d.chave.slice(25, 34))) : null);
    const ms = txt.match(/S[ée]rie\s*(\d+)/i);
    d.serie = ms ? ms[1] : (d.chave ? String(Number(d.chave.slice(22, 25))) : null);
    const mr = txt.match(/RECEBEMOS DE (.+?) OS PRODUTOS/i);
    d.fornecedor = mr ? mr[1].trim() : null;
    // CNPJ do emitente: a célula "CNPJ / CPF" da faixa do emitente (antes do quadro DESTINATÁRIO)
    const rDest = rotulo(itens, /^DESTINATARIO ?\/ ?REMETENTE$/);
    const cnpjs = itens.filter(i => /^CNPJ( \/ CPF)?$/.test(norm(i.s)) && (!rDest || i.p < rDest.p || (i.p === rDest.p && i.y < rDest.y)));
    d.fornecedor_cnpj = cnpjFmt(celula(itens, cnpjs[cnpjs.length - 1])) || (d.chave ? cnpjFmt(d.chave.slice(6, 20)) : null);
    if (!d.fornecedor) { const re = rotulo(itens, /^IDENTIFICACAO DO EMITENTE$/); d.fornecedor = re ? celula(itens, re, {maxDy: 40}) : null; }
    const o = rDest ? {aposY: rDest.y, pagina: rDest.p} : {};
    d.natureza_operacao = cel(itens, /^NATUREZA DA OPERACAO$/);
    d.destinatario = cel(itens, /^NOME ?\/ ?RAZAO SOCIAL$/, o);
    d.destinatario_cnpj = cnpjFmt(cel(itens, /^CNPJ ?\/ ?CPF$/, o));
    d.emissao = data(cel(itens, /^DATA DA EMISSAO$/, o));
    d.destinatario_endereco = cel(itens, /^ENDERECO$/, o);
    d.destinatario_bairro = cel(itens, /^BAIRRO ?\/ ?DISTRITO$/, o);
    d.destinatario_municipio = cel(itens, /^MUNICIPIO$/, o);
    d.destinatario_uf = cel(itens, /^UF$/, o);
    d.valor_produtos = num(cel(itens, /^V\. TOTAL PRODUTOS$|^VALOR TOTAL DOS PRODUTOS$/));
    d.frete = num(cel(itens, /^VALOR DO FRETE$/)) || 0;
    d.seguro = num(cel(itens, /^VALOR DO SEGURO$/)) || 0;
    d.desconto = num(cel(itens, /^DESCONTO$/)) || 0;
    d.outras = num(cel(itens, /^OUTRAS DESPESAS$/)) || 0;
    d.ipi = num(cel(itens, /^VALOR TOTAL IPI$/)) || 0;
    d.valor_total = num(cel(itens, /^V\. TOTAL DA NOTA$|^VALOR TOTAL DA NOTA$/));
    const mp = txt.match(/Pedido:\s*(\d+)/i);
    d.pedido = mp ? mp[1] : null;
    const ri = rotulo(itens, /^INFORMACOES COMPLEMENTARES$/);
    d.info_complementar = ri ? itens.filter(i => i.p === ri.p && i.y > ri.y + 2 && i.y < ri.y + 70 && i.x < 380).sort((a, b) => a.y - b.y || a.x - b.x).map(i => i.s).join(' ').slice(0, 600) : null;
    d.itens = itensDANFE(itens);
    d.descricao = d.itens.map(i => `${fmtQ(i.quantidade)} ${i.unidade || ''} ${i.descricao}`.trim()).join('; ').slice(0, 1000) || null;
    return d;
  }
  const fmtQ = q => q === null ? '?' : (Number.isInteger(q) ? String(q) : String(q).replace('.', ','));

  // Linhas de produto: localizadas pela coluna CFOP (4 dígitos) + quantidade/valores, em todas as páginas.
  function itensDANFE(itens) {
    const out = [];
    const paginas = [...new Set(itens.map(i => i.p))];
    for (const p of paginas) {
      const pi = itens.filter(i => i.p === p);
      const hDesc = pi.find(i => /^DESCRICAO DO PRODUTO/.test(norm(i.s)));
      const hNcm = pi.find(i => /^NCM/.test(norm(i.s)));
      const hCfop = pi.find(i => /^CFOP$/.test(norm(i.s)));
      if (!hDesc || !hCfop) continue;
      const yIni = Math.max(hDesc.y, hCfop.y) + 4;
      const yFim = (pi.find(i => /^DADOS ADICIONAIS$|^CALCULO DO ISSQN$/.test(norm(i.s)) && i.y > yIni) || {y: 1e9}).y;
      const xCod = Math.min(hDesc.x - 8, 70), xNcm = hNcm ? hNcm.x - 6 : hCfop.x - 60;
      const temVol = pi.some(i => /^VOL$/.test(norm(i.s)) && Math.abs(i.y - hCfop.y) < 4);
      // agrupa por linha
      const linhas = [];
      for (const it of pi.filter(i => i.y > yIni).sort((a, b) => a.y - b.y || a.x - b.x)) {
        const l = linhas.find(l => Math.abs(l.y - it.y) <= 1.8);
        if (l) l.it.push(it); else linhas.push({y: it.y, it: [it]});
      }
      let atual = null;
      for (const l of linhas) {
        l.it.sort((a, b) => a.x - b.x);
        const cfop = l.it.find(i => /^[1-7]\d{3}$/.test(i.s) && Math.abs(i.x - hCfop.x) < 18);
        const nums = l.it.filter(i => i.x > hCfop.x + 5);
        if (cfop && nums.length >= 4) {
          const antes = l.it.filter(i => i.x < cfop.x - 2);
          // código: primeira peça à esquerda da descrição. Às vezes vem grudado na descrição ("0088 Sirene...").
          let cod = null, desc = [], ncm = null, cst = null;
          for (const a of antes) {
            const s = a.s.trim();
            if (a.x < xCod && /^\d{2,6}$/.test(s) && cod === null) { cod = s; continue; }
            if (/^\d{8}$/.test(s) && a.x >= xNcm - 30) { ncm = s; continue; }
          if (/^(DADOS|ADICIONAIS)$/.test(norm(s))) continue;
            if (/^\d{3,4}$/.test(s) && a.x > xNcm) { cst = s; continue; }
            let t = s;
            const mNcm = t.match(/\s(\d{8})$/); if (mNcm && a.x < xNcm) { ncm = mNcm[1]; t = t.slice(0, -9); }
            const mCod = t.match(/^(\d{2,6})\s+(.+)$/); if (!cod && a.x < xCod + 10 && mCod) { cod = mCod[1]; t = mCod[2]; }
            desc.push(t);
          }
          // quantidade e unitário às vezes chegam numa peça só ("1,0000 1.150,0000"): separa por espaço
          // alguns emissores têm a coluna VOL entre UN e QTD
          const tk = nums.flatMap(i => i.s.split(/\s+/)).filter(Boolean);
          if (temVol) tk.splice(1, 1);
          const [un, q, vu, vt, vd] = tk;
          atual = {codigo: cod, descricao: desc.join(' '), ncm, cfop: cfop.s, unidade: un, quantidade: num(q), valor_unit: num(vu),
            valor_total: r2(num(vt)), desconto: num(vd) || 0, _y: l.y, _p: p};
          out.push(atual);
          continue;
        }
        // continuação da descrição: só peças na coluna da descrição, logo abaixo do item
        if (atual && l.y < yFim + 40 && l.y - atual._y < 30 && l.it.every(i => i.x >= hDesc.x - 25 && i.x < xNcm)) {
          const pecas = l.it.filter(i => !/^(DADOS|ADICIONAIS|INFORMACOES)/.test(norm(i.s)));
          if (!pecas.length) continue;
          atual.descricao += ' ' + pecas.map(i => i.s).join(' ');
          atual._y = l.y;
        } else if (l.y >= yFim && !cfop) atual = atual && l.y - atual._y < 30 ? atual : null;
      }
    }
    for (const i of out) {
      i.descricao = i.descricao.replace(/\s*SEM\s*GTIN\s*$/i, '').replace(/\s*SEM\s*$/i, '').replace(/SEM\s+GTIN/gi, '').replace(/\s+/g, ' ').trim();
      i.categoria = categoria(i.descricao);
      delete i._y; delete i._p;
    }
    return out;
  }

  // ---------- categoria do equipamento ----------
  const CATEGORIAS = {
    camera: 'Câmeras', dvr_nvr: 'DVR / NVR', hd: 'HD de gravação', alarme_sensor: 'Alarme e sensores', perimetro: 'Proteção perimetral',
    incendio: 'Incêndio', fonte_energia: 'Fontes e energia', rede_rack: 'Switch, rack e rede', cabeamento: 'Cabeamento',
    conector_acessorio: 'Conectores e acessórios', servico: 'Serviços', outro: 'Outros'};
  function categoria(desc) {
    const t = norm(desc);
    if (/GRAVADOR|\bDVR\b|\bNVR\b|\bXVR\b|MHDX|\bNVD\b|\bVMD\b/.test(t)) return 'dvr_nvr';
    if (/CAMERA|\bBUL+ET+\b|\bDOME\b|\bVHL\b|\bVHD\b|\bVIPC?\b|\bIM\d|MINI DOME/.test(t)) return 'camera';
    if (/DISCO RIGIDO|\bHD\s*\d+\s*TB|PURZ|PURPLE|\bHDD\b|\bSSD\b|CARTAO DE MEMORIA|MICRO ?SD/.test(t)) return 'hd';
    // cabos antes de alarme/incêndio: "CABO ALARME FIRE" é cabeamento vendido em metro, não sensor
    if (/\bCABO\b|\bUTP\b|COAXIAL|ELETRODUTO|CANALETA|CAIXA DE PASSAGEM|VBOX|\bCAT ?5|\bCAT ?6|CONDULETE|ABRACADEIRA|FITA ISOLANTE|ELETROCALHA/.test(t)) return 'cabeamento';
    if (/CONCERTINA|CERCA ELETRICA|ELETRIFICADOR|HASTE|ARAME FARPADO|CONCERTINA/.test(t)) return 'perimetro';
    if (/EXTINTOR|INCENDIO|FUMACA|LUZ DE EMERGENCIA|ACIONADOR MANUAL|DETECTOR DE CALOR|HIDRANTE/.test(t)) return 'incendio';
    if (/SENSOR|\bIVP\b|ALARME|SIRENE|TECLADO PARA CENTRA|\bAMT\b|\bXAT\b|MAGNETICO|CONTROLE REMOTO|BOTAO DE PANICO|INTRUSAO/.test(t)) return 'alarme_sensor';
    if (/FONTE|NOBREAK|NO-BREAK|BATERIA|ESTABILIZAD|COLMEIA/.test(t)) return 'fonte_energia';
    if (/SWITCH|\bRACK\b|BANDEJA|ROTEADOR|ORGANIZADOR|PATCH|\bPOE\b|ACCESS POINT|\bONU\b/.test(t)) return 'rede_rack';
    if (/KIT FIXACAO|PORCA GAIOLA|CONECTOR|BALUN|ESPELHO|\bP4\b|\bBNC\b|SUPORTE|KEYSTONE|PARAFUSO|BUCHA|TOMADA|PLUG|ADAPTADOR|EXTENSAO|FILTRO DE LINHA/.test(t)) return 'conector_acessorio';
    if (/MAO DE OBRA|SERVICO|VISITA|INSTALACAO|DESLOCAMENTO|ESTADIA|MONITORAMENTO/.test(t)) return 'servico';
    return 'outro';
  }
  const FISICOS = ['camera', 'dvr_nvr', 'hd', 'alarme_sensor', 'perimetro', 'incendio', 'fonte_energia', 'rede_rack'];

  // ---------- natureza da despesa ----------
  // aquisicao (equipamento), instalacao (serviço de instalação/ampliação), manutencao, monitoramento, outro.
  function natureza(doc, nomeArquivo) {
    const t = norm([doc.descricao, nomeArquivo].join(' '));
    if (doc.tipo === 'NFS-e') {
      if (/MONITORAMENTO|VIDEO ?VERIFICACAO/.test(t)) return {natureza: 'monitoramento', motivo: 'Serviço mensal de monitoramento.'};
      if (/VISITA TECNICA|MANUTENCAO|REPARO|CONSERTO|CORRETIVA|PREVENTIVA/.test(t)) return {natureza: 'manutencao', motivo: 'Descrição de visita técnica/manutenção.'};
      if (/MAO DE OBRA|INSTALACAO|DESLOCAMENTO|ESTADIA|DIARIAS|REDE ESTABILIZADA|INFRA|DESMOBILIZ|REALOCA|RETIRADA|DESPESAS? (DE )?VIAGEM/.test(t))
        return {natureza: 'instalacao', motivo: 'Mão de obra, deslocamento, realocação ou viagem de equipe de instalação.', conferir: 'Serviço classificado como instalação: confirmar (pode ser manutenção).'};
      return {natureza: 'outro', motivo: 'Serviço sem descrição conclusiva.', conferir: 'Serviço sem descrição conclusiva.'};
    }
    if (doc.tipo === 'NF-e') {
      const its = doc.itens || [];
      const fis = its.filter(i => FISICOS.includes(i.categoria) && i.categoria !== 'fonte_energia');
      if (its.length && !fis.length && Number(doc.valor_total || 0) < 1000)
        return {natureza: 'manutencao', motivo: 'Nota só com acessórios/cabos/fontes, abaixo de R$ 1.000: material de reparo.', conferir: 'Classificada como material de manutenção pelo conteúdo: confirmar.'};
      return {natureza: 'aquisicao', motivo: 'Nota de mercadoria com equipamentos.'};
    }
    return {natureza: 'outro', motivo: 'Documento sem tipo reconhecido.', conferir: 'Documento sem tipo reconhecido.'};
  }

  // ---------- loja de destino ----------
  // lojas: [{codigo, nome, apelidos:[...], cidade, cnpj}] · cnpjs: {cnpj: codigo} aprendidos/confirmados.
  // Devolve {codigo, confianca:'alta'|'media'|null, motivo, candidatos:[...] }.
  const MATRIZ = '44.616.854/0001-72';
  function contemFrase(texto, frase) {
    const f = norm(frase).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!f) return false;
    return (' ' + texto + ' ').includes(' ' + f + ' ');
  }
  function identificarLoja(doc, nomeArquivo, lojas, cnpjs) {
    const res = {codigo: null, confianca: null, motivo: null, candidatos: []};
    const cnpj = doc.destinatario_cnpj;
    if (cnpj && cnpj !== MATRIZ && cnpjs && cnpjs[cnpj] !== undefined && cnpjs[cnpj] !== null) {
      return {codigo: cnpjs[cnpj], confianca: 'alta', motivo: `CNPJ do destinatário ${cnpj} já vinculado à loja.`, candidatos: [cnpjs[cnpj]]};
    }
    const limpa = s => ' ' + norm(s).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
    const arq = limpa(String(nomeArquivo || '').replace(/\.[a-z0-9]+$/i, '').replace(/#U00([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))));
    // peso da fonte: destinatário (3) > nome do arquivo e descrição (2) > endereço (1, nome de rua costuma coincidir com loja)
    const fontes = [['nome do arquivo', arq, 2], ['destinatário', limpa(doc.destinatario), 3], ['endereço de entrega', limpa([doc.destinatario_endereco, doc.destinatario_bairro].join(' ')), 1],
      ['descrição', limpa(doc.descricao), 2]];
    // apelidos: nome distintivo da loja ("~" na frente = apelido inferido, só sugere) · chaves: palavra comum a mais de uma
    // loja (MACEIO, MANGABEIRA, PETROLINA…), que nunca decide sozinha.
    const achados = [], fracos = [];
    for (const l of lojas || []) {
      for (const a0 of (l.apelidos || [])) {
        const fraco = a0.startsWith('~'), a = a0.replace(/^~/, '');
        for (const [fonte, t, rank] of fontes) if (contemFrase(t, a)) achados.push({codigo: l.codigo, apelido: a, fonte, fraco, rank, peso: norm(a).length});
      }
      for (const c of (l.chaves || [])) for (const [, t] of fontes) if (contemFrase(t, c)) fracos.push(l.codigo);
    }
    const cd = /\bCD\b|CENTRO DE DISTRIBUICAO|DA RECUPERACAO/.test(arq + limpa(doc.destinatario_endereco));
    if (achados.length) {
      achados.sort((a, b) => b.rank - a.rank || b.peso - a.peso);
      const top = achados[0];
      // outro achado de outra loja, na fonte de mesmo peso, que não seja parte do apelido vencedor → ambíguo
      const outros = achados.filter(a => a.codigo !== top.codigo && a.rank === top.rank && !norm(top.apelido).includes(norm(a.apelido)));
      res.candidatos = [...new Set(achados.map(a => a.codigo))];
      if (outros.length) return {...res, motivo: `Mais de uma loja citada (${[...new Set(achados.map(a => a.apelido))].join(', ')}).`};
      res.codigo = top.codigo;
      const noDocumento = achados.some(a => a.codigo === top.codigo && a.fonte !== 'nome do arquivo');
      // alta: nome da loja no próprio documento, ou no nome do arquivo com nota faturada no CNPJ da filial.
      res.confianca = !top.fraco && !cd && (noDocumento || (cnpj && cnpj !== MATRIZ)) ? 'alta' : 'media';
      res.motivo = `"${top.apelido}" no ${top.fonte}` + (top.fraco ? ' (apelido inferido)' : '') + (cd ? '; a nota também cita o CD' : '') +
        (cnpj === MATRIZ ? '; faturada no CNPJ da matriz' : '') + '.';
      return res;
    }
    if (fracos.length) {
      res.candidatos = [...new Set(fracos)];
      if (res.candidatos.length === 1) return {codigo: res.candidatos[0], confianca: 'media', motivo: 'Loja sugerida por palavra-chave.', candidatos: res.candidatos};
      return {...res, motivo: `Loja ambígua: ${res.candidatos.length} lojas possíveis.`};
    }
    if (cd) return {codigo: 0, confianca: 'media', motivo: 'Entrega no CD / matriz, sem loja citada.', candidatos: [0]};
    // cidade: só sugere
    const cid = norm(doc.destinatario_municipio || '');
    if (cid) res.candidatos = (lojas || []).filter(l => l.cidade && norm(l.cidade) === cid).map(l => l.codigo);
    res.motivo = 'Loja não identificada com segurança' + (res.candidatos.length ? ` (${res.candidatos.length} loja(s) na cidade ${doc.destinatario_municipio}).` : '.');
    return res;
  }

  // ---------- orçamento citado ----------
  function orcamentoRef(doc, nomeArquivo) {
    const t = norm(String(nomeArquivo || '').replace(/#U00([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))));
    const m = t.match(/ORC(?:AMENTO)?\.?\s*(\d{2,6})/);
    return m ? m[1] : (doc.pedido || null);
  }

  // ---------- documento completo ----------
  // paginas: [{itens}] já em coordenadas de cima para baixo. ocr: true quando veio de imagem.
  function lerDocumento(itens, nomeArquivo, opts = {}) {
    const tipo = tipoDocumento(itens);
    let d;
    if (tipo === 'NFS-e') d = lerNFSe(itens);
    else if (tipo === 'NF-e') d = lerDANFE(itens);
    else d = {tipo: tipo || 'outro', itens: [], avisos: ['Tipo de documento não reconhecido.'], descricao: textoCorrido(itens).slice(0, 500)};
    d.arquivo_nome = nomeArquivo;
    d.ocr = !!opts.ocr;
    return finalizar(d, nomeArquivo, opts);
  }

  // Etapa final (separada para poder ser reaplicada quando o cadastro de lojas muda): conferências, natureza, loja.
  function finalizar(d, nomeArquivo, opts = {}) {
    d.itens = d.itens || [];
    for (const k of ['frete', 'seguro', 'outras', 'ipi', 'desconto']) d[k] = Number(d[k] || 0);
    const conferir = [];
    if (d.ocr) conferir.push('Lido por OCR (documento escaneado): conferir número, data e valor.');
    if (!d.numero) conferir.push('Número da nota não lido.');
    if (!d.emissao) conferir.push('Data de emissão não lida.');
    if (d.valor_total === null || d.valor_total === undefined) conferir.push('Valor total não lido.');
    if (!d.fornecedor) conferir.push('Fornecedor não lido.');
    if ((d.tipo === 'NF-e' || d.tipo === 'NFS-e') && !d.chave) conferir.push('Chave de acesso não lida.');
    if (d.tipo === 'NF-e') {
      const soma = r2((d.itens || []).reduce((s, i) => s + Number(i.valor_total || 0), 0));
      if (!d.itens.length) conferir.push('Nenhum item lido na nota.');
      else if (d.valor_produtos !== null && Math.abs(soma - d.valor_produtos) > 0.05) conferir.push(`Soma dos itens (${soma}) diferente do total de produtos (${d.valor_produtos}).`);
      for (const i of d.itens) if (i.quantidade !== null && i.valor_unit !== null && Math.abs(r2(i.quantidade * i.valor_unit) - i.valor_total) > Math.max(0.05, i.valor_total * 0.001))
        conferir.push(`Item ${i.codigo || ''} ${i.descricao.slice(0, 30)}: quantidade × unitário ≠ total.`);
      if (d.valor_produtos !== null && d.valor_total !== null) {
        const esperado = r2(d.valor_produtos + d.frete + d.seguro + d.outras + d.ipi - d.desconto);
        if (Math.abs(esperado - d.valor_total) > 0.05) conferir.push(`Total da nota (${d.valor_total}) ≠ produtos + frete + outras − desconto (${esperado}).`);
      }
    }
    const nat = natureza(d, nomeArquivo);
    d.natureza = nat.natureza; d.natureza_motivo = nat.motivo;
    if (nat.conferir) conferir.push(nat.conferir);
    const lj = identificarLoja(d, nomeArquivo, opts.lojas, opts.cnpjs);
    d.loja_codigo = lj.codigo; d.loja_confianca = lj.confianca; d.loja_motivo = lj.motivo; d.loja_candidatos = lj.candidatos;
    if (lj.codigo === null) conferir.push(lj.motivo);
    else if (lj.confianca !== 'alta') conferir.push('Loja sugerida (' + lj.motivo + ') — confirmar.');
    d.orcamento_ref = orcamentoRef(d, nomeArquivo);
    d.conferir = [...new Set([...conferir, ...(d.avisos || [])])];
    d.status = d.conferir.length ? 'conferir' : 'ok';
    for (const i of d.itens || []) i.loja_codigo = d.loja_codigo;
    return d;
  }

  // ---------- planilhas ----------
  // Linha "05 - CAMARAGIBE" → 905 (código do Portal = 900 + número da filial)
  function codigoFilial(s) {
    const m = String(s || '').match(/^\s*(\d{1,3})\s*-/);
    return m ? 900 + Number(m[1]) : null;
  }
  // "21 dias" → 21
  const dias = s => { const m = String(s || '').match(/(\d+)/); return m ? Number(m[1]) : null; };

  // Necessidade por área a partir do texto do levantamento ("6 RUAS 1 NA COPA TOTAL 7 CAMERAS").
  // RUAS/CORREDORES = estoque. Devolve {estoque, caixa, vendas, recebimento, entrada, outra, completo, sem_cameras_estoque}.
  function necessidadeAreas(texto, total) {
    const t = norm(texto).replace(/\+/g, ' ').replace(/-/g, ' ');
    const r = {estoque: 0, caixa: 0, vendas: 0, recebimento: 0, entrada: 0, outra: 0, completo: /^COMPLETO\b/.test(t),
      sem_cameras_estoque: /NENHUMA CAMERA/.test(t), indefinido: false};
    if (r.completo) return r;
    const pega = (rx, area) => { let m; const g = new RegExp(rx.source, 'g'); while ((m = g.exec(t))) r[area] += Number(m[1]); };
    pega(/(\d+)\s*(?:CAMERAS? (?:NAS|NOS) )?(?:RUAS?|CORREDOR(?:ES)?)\b(?!\s*(?:NENHUMA|MUITO|FRENTE))/, 'estoque');
    pega(/(\d+)\s*(?:NA |NO |NOS |NAS )?(?:CAIXAS?|PDV|PROXIMO AO CAIXA)\b/, 'caixa');
    pega(/(\d+)\s*(?:NO |NA )?(?:TETO )?(?:SALAO|SALAO PDV|AREA DE VENDAS)\b/, 'vendas');
    pega(/(\d+)\s*(?:NO |NA )?(?:AREA )?(?:DE )?RECEBIMENTO\b/, 'recebimento');
    pega(/(\d+)\s*(?:NA |NO )?(?:FRENTE (?:DA )?LOJA|ENTRADA(?: LOJA)?)\b/, 'entrada');
    pega(/(\d+)\s*(?:NA |NO )?(?:COPA|ESCADA|QUARTINHO|QUARTO|EMBALAGEM|FUNDOS|REFEITORIO|COMPUTADORES|PEGANDO COFRE|CORREDOR FRENTE ESCADA|CAMERA FRENTE ESCADA)\b/, 'outra');
    pega(/(\d+)\s*ESTOQUE (?:CIMA|EXTRA|BAIXO)\b/, 'estoque');
    // "8 RUAS ... NECESSIDADE 8 CAMERAS NO ESTOQUE MAIS 2 NO SALAO": a frase de necessidade manda
    const mNec = t.match(/NECESSIDADE (\d+) CAMERAS? (?:NAS )?(?:NO )?ESTOQUE/);
    if (mNec) r.estoque = Number(mNec[1]);
    if (/(\d+) CAMERAS? EM DUAS RUAS/.test(t)) r.estoque = Number(total || 0) || r.estoque;
    if (/ESTOQUE (?:BAIXO|EXTRA|PRINCIPAL|1|2)/.test(t) && !r.estoque) {
      let m; const g = /ESTOQUE[^0-9]{0,15}(\d+)\s*RUAS?/g; while ((m = g.exec(t))) r.estoque += Number(m[1]);
    }
    const soma = r.estoque + r.caixa + r.vendas + r.recebimento + r.entrada + r.outra;
    const tot = Number(total || 0);
    if (tot && soma !== tot) {
      if (soma < tot) { if (/RUA|CORREDOR|ESTOQUE/.test(t)) r.estoque += tot - soma; else r.outra += tot - soma; }
      // soma acima do total da planilha (vale a coluna QUANT.): corta o excesso do estoque e marca para revisão
      if (soma > tot) { r.estoque = Math.max(0, r.estoque - (soma - tot)); r.indefinido = true; }
    }
    if (!tot && !soma) r.indefinido = true;
    return r;
  }

  // Planilha (linhas já como matriz de células) → {tipo, linhas} no formato de cftv_importar_planilha.
  //   cadastro_lojas: FILIAL, TIPO, REGIONAL, Dias de Armazenamento, Capacidade DVR, Analogico Livre, IP Livre
  //   levantamento  : as mesmas + RESPONSAVEL, LEVANTAMENTO DE NECESSIDADES, QUANT.
  //   inventario    : LOJA, CATEGORIA/EQUIPAMENTO, MARCA, MODELO, SERIE, QUANTIDADE, CUSTO, DATA AQUISICAO, AREA, SITUACAO
  //   movimentos    : LOJA, DATA, TIPO (instalação/retirada/substituição/baixa/transferência), CATEGORIA, QUANTIDADE, OBSERVACAO
  function lerPlanilha(matriz, nomeArquivo) {
    const linhas = (matriz || []).map(r => (r || []).map(c => c === null || c === undefined ? '' : c));
    const iCab = linhas.findIndex(r => r.some(c => /^(FILIAL|LOJA)$/.test(norm(c))));
    if (iCab < 0) return {tipo: null, linhas: [], aviso: 'Cabeçalho com FILIAL ou LOJA não encontrado.'};
    const cab = linhas[iCab].map(c => norm(c));
    const col = rx => cab.findIndex(c => rx.test(c));
    const cF = col(/^(FILIAL|LOJA)$/), cTipo = col(/^TIPO$/), cReg = col(/^REGIONAL/), cDias = col(/ARMAZENAMENTO|DIAS/), cCap = col(/CAPACIDADE/),
      cAn = col(/ANALOGICO/), cIp = col(/^IP/), cResp = col(/RESPONSAVEL/), cNec = col(/LEVANTAMENTO|NECESSIDADE/), cQ = col(/^QUANT/),
      cCat = col(/CATEGORIA|EQUIPAMENTO/), cMarca = col(/MARCA/), cMod = col(/MODELO/), cSerie = col(/SERIE/), cCusto = col(/CUSTO|VALOR/),
      cDataAq = col(/AQUISICAO/), cArea = col(/^AREA|LOCAL/), cSit = col(/SITUACAO/), cData = col(/^DATA$/), cMov = col(/MOVIMENTO|^TIPO DE/), cObs = col(/OBS/);
    const v = (r, c) => c >= 0 ? r[c] : '';
    const lojaDe = s => { const c = codigoFilial(s); if (c) return c; const n = String(s).match(/^\s*(\d{3})\b/); return n ? Number(n[1]) : null; };
    const dt = x => { if (x instanceof Date) return x.toISOString().slice(0, 10); const d = data(String(x)); if (d) return d; return /^\d{4}-\d{2}-\d{2}/.test(String(x)) ? String(x).slice(0, 10) : null; };
    const AREAS = {ENTRADA: 'entrada', CAIXA: 'caixa', VENDAS: 'vendas', SALAO: 'vendas', ESTOQUE: 'estoque', RECEBIMENTO: 'recebimento'};
    const area = s => { const t = norm(s); for (const k in AREAS) if (t.includes(k)) return AREAS[k]; return t ? 'outra' : null; };
    const SIT = {INSTALADO: 'instalado', ESTOQUE: 'em_estoque', DEFEITO: 'defeito', 'FORA': 'fora_operacao', RETIRADO: 'retirado', BAIXA: 'baixado', SUBSTITUIDO: 'substituido'};
    const sit = s => { const t = norm(s); for (const k in SIT) if (t.includes(k)) return SIT[k]; return 'instalado'; };
    const MOV = {INSTAL: 'instalacao', RETIR: 'retirada', SUBST: 'substituicao', BAIXA: 'baixa', TRANSF: 'transferencia'};
    const mov = s => { const t = norm(s); for (const k in MOV) if (t.includes(k)) return MOV[k]; return null; };
    let tipo = null;
    if (cNec >= 0) tipo = 'levantamento';
    else if (cCap >= 0) tipo = 'cadastro_lojas';
    else if (cMov >= 0 || (cData >= 0 && cTipo >= 0)) tipo = 'movimentos';
    else if (cCat >= 0) tipo = 'inventario';
    if (!tipo) return {tipo: null, linhas: [], aviso: 'Planilha sem colunas reconhecidas.'};
    const out = [];
    linhas.slice(iCab + 1).forEach((r, i) => {
      const fil = String(v(r, cF) || '').trim();
      if (!fil || /^TOTAL/.test(norm(fil))) return;
      const loja = lojaDe(fil);
      const nome = fil.replace(/^\s*\d+\s*-\s*/, '').trim();
      if (tipo === 'cadastro_lojas' || tipo === 'levantamento') {
        const o = {filial: fil, loja_codigo: loja, nome, tipo: String(v(r, cTipo) || '').trim() || null, regional: String(v(r, cReg) || '').trim() || null,
          dias_gravacao: dias(v(r, cDias)), capacidade_canais: num(v(r, cCap)), canais_analog_livres: num(v(r, cAn)), canais_ip_livres: num(v(r, cIp))};
        if (tipo === 'levantamento') {
          const txt = String(v(r, cNec) || '').trim(), q = num(v(r, cQ));
          o.responsavel = String(v(r, cResp) || '').trim() || null;
          o.necessidade_texto = txt || null;
          o.necessidade_cameras = /^COMPLETO/.test(norm(txt)) ? 0 : q;
          o.situacao_cftv = /DESATIVADA/.test(norm(txt)) ? 'LOJA DESATIVADA' : /REALOCADA/.test(norm(txt)) ? 'LOJA SENDO REALOCADA' : /NAO CONSEGUIMOS/.test(norm(txt)) ? 'SEM CONTATO' : null;
          o.areas = txt ? necessidadeAreas(txt, o.necessidade_cameras) : null;
        }
        out.push(o);
      } else if (tipo === 'inventario') {
        const desc = String(v(r, cCat) || '');
        out.push({filial: fil, loja_codigo: loja, categoria: categoria(desc) === 'servico' ? 'outro' : categoria(desc), descricao: desc, marca: String(v(r, cMarca) || '') || null,
          modelo: String(v(r, cMod) || '') || null, numero_serie: String(v(r, cSerie) || '') || null, quantidade: num(v(r, cQ)) || 1, custo_unit: num(v(r, cCusto)),
          data_aquisicao: dt(v(r, cDataAq)), area: area(v(r, cArea)), situacao: sit(v(r, cSit)),
          fonte_chave: 'inv:' + norm(nomeArquivo) + ':' + (String(v(r, cSerie) || '') || (i + 1))});
      } else {
        out.push({filial: fil, loja_codigo: loja, data: dt(v(r, cData)), tipo: mov(v(r, cMov >= 0 ? cMov : cTipo)), categoria: categoria(String(v(r, cCat) || '')),
          quantidade: num(v(r, cQ)) || 1, observacao: String(v(r, cObs) || '') || null, fonte_chave: 'mov:' + norm(nomeArquivo) + ':' + (i + 1)});
      }
    });
    return {tipo, linhas: out};
  }

  const API = {norm, num, data, cnpjFmt, itensPdfjs, frasesOcr, textoCorrido, tipoDocumento, lerNFSe, lerDANFE, lerDocumento, finalizar, lerPlanilha, categoria, CATEGORIAS,
    FISICOS, natureza, identificarLoja, codigoFilial, dias, necessidadeAreas, MATRIZ};
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else raiz.CFTV_LEITOR = API;
})(typeof window !== 'undefined' ? window : globalThis);
