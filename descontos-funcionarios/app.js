/* Descontos de Funcionários — tela do Portal Esposende.
 * A base fica no Supabase (cmpaud_cargas + cmpaud_cargas_partes, compactada em partes pequenas): quem carrega
 * os arquivos envia uma vez e todos os usuários passam a ver a mesma base (a tela confere a nuvem a cada minuto).
 * Regras e cruzamento de nomes ficam em nucleo.js (mesmo código usado na conferência dos números).
 */
'use strict';
const SB_URL = 'https://rdztzurfesnobfkazgpm.supabase.co';
const SB_KEY = 'sb_publishable_4LHSO4TrP7F4m4tpJyH44g_BGmfC92h';
const NO_PORTAL = /github\.io$/.test(location.hostname);
const sb = supabase.createClient(SB_URL, SB_KEY, {auth: {persistSession: true, autoRefreshToken: true, ...(NO_PORTAL ? {} : {storageKey: 'df-auth'})}});
const PARTE = 400000; // caracteres por parte (cada INSERT fica bem abaixo do limite de 8 s do banco)

// ---------------- utilidades ----------------
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const brl = v => Number(v || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
const brl0 = v => 'R$ ' + Math.round(Number(v || 0)).toLocaleString('pt-BR');
const nf = (v, d = 0) => Number(v || 0).toLocaleString('pt-BR', {minimumFractionDigits: d, maximumFractionDigits: d});
const pct = (a, b) => b ? nf(a / b * 100, 1) + '%' : '—';
const dBR = n => { const s = String(n); return s.length === 8 ? `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}` : s ? s.slice(0, 10).split('-').reverse().join('/') : '—'; };
const iso2n = s => s ? +s.replace(/-/g, '') : 0;
const n2iso = n => { const s = String(n); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; };
const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const mesRot = m => MESES[m % 100 - 1] + '/' + String(Math.floor(m / 100)).slice(2);
const cpfF = c => c && c.length === 11 ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : (c || '—');
const lojaNum = l => { const m = String(l).match(/^\s*0*(\d+)/); return m ? +m[1] : -1; };
function toast(m, ms = 5000) { const t = $('toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(t._t); t._t = setTimeout(() => t.style.display = 'none', ms); }
function mostrar(v) { ['vLogin', 'vSem', 'vApp'].forEach(x => $(x).classList.toggle('hidden', x !== v)); }
const soma = (arr, f) => { let s = 0; for (const x of arr) s += f(x); return s; };

// ---------------- estado ----------------
let CARGA = null;   // registro de cmpaud_cargas em uso
let A = null;       // análise (nucleo.analisar)
let X = null;       // índices auxiliares (regional da loja, meses…)
let F = [];         // linhas que passam nos filtros
let ABA = 'painel';
let BUSCA = null;   // {tipo, valor, rotulo}
const ORD = {};     // ordenação por tabela

// ---------------- login ----------------
async function entrar() {
  $('lErr').textContent = '';
  const {error} = await sb.auth.signInWithPassword({email: $('lEmail').value.trim().toLowerCase(), password: $('lSenha').value});
  if (error) { $('lErr').textContent = /invalid/i.test(error.message) ? 'E-mail ou senha incorretos.' : error.message; return; }
  iniciar();
}
async function iniciar() {
  const {data: {session}} = await sb.auth.getSession();
  if (!session) { mostrar('vLogin'); return; }
  const st = await sb.rpc('portal_is_staff');
  if (!st.error && st.data === false) { mostrar('vSem'); return; }
  mostrar('vApp');
  ligarTela();
  await recarregarNuvem(false);
  setInterval(conferirNovaCarga, 60000);
}

// ---------------- nuvem ----------------
async function cargaAtiva() {
  const r = await sb.from('cmpaud_cargas').select('*').eq('status', 'ativa').order('ativada_em', {ascending: false}).limit(1);
  if (r.error) throw r.error; return r.data[0] || null;
}
function b64ParaBytes(b64) { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
function bytesParaB64(u) { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
async function gunzip(u) { return await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).text(); }
async function gzip(txt) { return new Uint8Array(await new Response(new Blob([txt]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()); }

async function baixarCarga(c) {
  const partes = [];
  for (let p = 0; p < c.partes; p += 4) { // até 4 partes por pedido (≈1,6 MB)
    const r = await sb.from('cmpaud_cargas_partes').select('parte,dados').eq('carga_id', c.id).gte('parte', p).lt('parte', p + 4).order('parte');
    if (r.error) throw r.error; partes.push(...r.data);
  }
  if (partes.length !== c.partes) throw new Error(`Base incompleta na nuvem (${partes.length} de ${c.partes} partes).`);
  return JSON.parse(await gunzip(b64ParaBytes(partes.map(x => x.dados).join(''))));
}
async function recarregarNuvem(avisar) {
  try {
    statusTela('carregando');
    const c = await cargaAtiva();
    if (!c) { CARGA = null; A = null; statusTela(); abrirAba('carregar'); return; }
    if (CARGA && CARGA.id === c.id && A) { CARGA = c; statusTela(); if (avisar) toast('A base já é a mais recente da nuvem.'); return; }
    const B = await baixarCarga(c);
    CARGA = c; usarBase(B);
    if (avisar) toast('Base atualizada da nuvem.');
  } catch (e) { console.error(e); statusTela(); avisoTopo('bad', 'Não foi possível ler a base da nuvem: ' + esc(e.message || e)); }
}
async function conferirNovaCarga() {
  try {
    const c = await cargaAtiva();
    if (c && (!CARGA || c.id !== CARGA.id)) {
      avisoTopo('warn', `<b>Nova base enviada</b> por ${esc(c.usuario || '—')} em ${new Date(c.ativada_em).toLocaleString('pt-BR')}. ` +
        `<button class="btn peq pri" onclick="recarregarNuvem(true)">Atualizar agora</button>`, 'nova');
    }
  } catch (e) { /* silencioso: tenta de novo no próximo minuto */ }
}

// ---------------- base em memória ----------------
function usarBase(B) {
  A = DF.analisar(B);
  const C = B.col, d = B.dic;
  const reg = new Map(); for (const r of B.reg) reg.set(lojaNum(r[0]), r);
  const lojaReg = d.loja.map(l => { const r = reg.get(lojaNum(l)); return r && r[1] ? r[1] : 'SEM REGIONAL'; });
  let min = 99999999, max = 0; for (const x of C.data) { if (x < min) min = x; if (x > max) max = x; }
  X = {lojaReg, min, max, mes: Int32Array.from(C.data, x => Math.floor(x / 100)), regionais: [...new Set(lojaReg)].sort()};
  // filtros
  $('fDe').value = n2iso(min); $('fAte').value = n2iso(max); $('fDe').min = $('fAte').min = n2iso(min); $('fDe').max = $('fAte').max = n2iso(max);
  $('fReg').innerHTML = '<option value="">Todas</option>' + X.regionais.map(r => `<option>${esc(r)}</option>`).join('');
  preencherLojas();
  $('fSit').innerHTML = '<option value="">Todos</option>' + Object.entries(DF.SIT).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  $('fCat').innerHTML = '<option value="">Todas (sem arredondamento)</option>' + Object.entries(DF.CAT).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  statusTela(); aplicar();
}
function preencherLojas() {
  const r = $('fReg').value, d = A.B.dic.loja;
  const ls = d.map((l, i) => [l, i]).filter(([l, i]) => !r || X.lojaReg[i] === r).sort((a, b) => lojaNum(a[0]) - lojaNum(b[0]));
  const atual = $('fLoja').value;
  $('fLoja').innerHTML = '<option value="">Todas</option>' + ls.map(([l, i]) => `<option value="${i}">${esc(l)}</option>`).join('');
  if (ls.some(([, i]) => String(i) === atual)) $('fLoja').value = atual;
}

// ---------------- filtros ----------------
function casaBusca() {
  if (!BUSCA) return null;
  const C = A.B.col, d = A.B.dic, b = BUSCA;
  if (b.tipo === 'cli') return i => C.cli[i] === b.valor;
  if (b.tipo === 'vend') return i => C.vend[i] === b.valor;
  if (b.tipo === 'loja') return i => C.loja[i] === b.valor;
  if (b.tipo === 'reg') return i => X.lojaReg[C.loja[i]] === b.valor;
  if (b.tipo === 'venda') return i => C.cod[i] === b.valor;
  if (b.tipo === 'prod') return i => C.prod[i] === b.valor;
  if (b.tipo === 'func') { const s = new Set(A.cli.map((c, k) => c.f === b.valor && (c.sit === 'FUNC' || c.sit === 'FUNC_PROV') ? k : -1).filter(k => k >= 0)); return i => s.has(C.cli[i]); }
  // texto livre: cada palavra precisa aparecer em algum campo da linha
  const ts = DF.norm(b.valor).split(' ').filter(Boolean);
  const sets = ts.map(t => ({t, cli: new Set(), vend: new Set(), prod: new Set(), loja: new Set()}));
  for (const s of sets) for (const k of ['cli', 'vend', 'prod', 'loja']) d[k].forEach((v, i) => { if (v.includes(s.t)) s[k].add(i); });
  return i => sets.every(s => s.cli.has(C.cli[i]) || s.vend.has(C.vend[i]) || s.prod.has(C.prod[i]) || s.loja.has(C.loja[i]) || C.cod[i].includes(s.t));
}
function aplicar() {
  if (!A) return;
  const C = A.B.col, de = iso2n($('fDe').value) || 0, ate = iso2n($('fAte').value) || 99999999;
  const reg = $('fReg').value, loja = $('fLoja').value === '' ? -1 : +$('fLoja').value, sit = $('fSit').value, cat = $('fCat').value;
  const bq = casaBusca();
  F = [];
  for (let i = 0; i < A.n; i++) {
    const c = A.cat[i];
    if (cat ? c !== cat : (c === 'ARRED' || c === 'SEM_DESC')) continue;
    if (C.data[i] < de || C.data[i] > ate) continue;
    if (loja >= 0 && C.loja[i] !== loja) continue;
    if (reg && X.lojaReg[C.loja[i]] !== reg) continue;
    if (sit && A.cli[C.cli[i]].sit !== sit) continue;
    if (bq && !bq(i)) continue;
    F.push(i);
  }
  // mesmo recorte, mas com todas as classificações (para "funcionário comprando como cliente" e arredondamentos)
  X.todos = [];
  for (let i = 0; i < A.n; i++) {
    if (C.data[i] < de || C.data[i] > ate) continue;
    if (loja >= 0 && C.loja[i] !== loja) continue;
    if (reg && X.lojaReg[C.loja[i]] !== reg) continue;
    if (sit && A.cli[C.cli[i]].sit !== sit) continue;
    if (bq && !bq(i)) continue;
    X.todos.push(i);
  }
  calcular(); chipsAtivos(); desenhar();
}
function limparFiltros() {
  BUSCA = null; $('busca').value = '';
  $('fDe').value = n2iso(X.min); $('fAte').value = n2iso(X.max); $('fReg').value = ''; preencherLojas(); $('fLoja').value = ''; $('fSit').value = ''; $('fCat').value = '';
  aplicar();
}
function chipsAtivos() {
  const ch = [];
  if (BUSCA) ch.push(['busca', '🔎 ' + BUSCA.rotulo]);
  if ($('fReg').value) ch.push(['fReg', 'Regional: ' + $('fReg').value]);
  if ($('fLoja').value) ch.push(['fLoja', 'Loja: ' + A.B.dic.loja[+$('fLoja').value]]);
  if ($('fSit').value) ch.push(['fSit', DF.SIT[$('fSit').value]]);
  if ($('fCat').value) ch.push(['fCat', DF.CAT[$('fCat').value]]);
  $('ativos').innerHTML = `<span class="chip">Período: ${dBR($('fDe').value)} a ${dBR($('fAte').value)}</span>` +
    ch.map(([k, t]) => `<span class="chip roxo">${esc(t)}<button title="Remover" onclick="tirarFiltro('${k}')">×</button></span>`).join('');
}
function tirarFiltro(k) { if (k === 'busca') { BUSCA = null; $('busca').value = ''; } else { $(k).value = ''; if (k === 'fReg') preencherLojas(); } aplicar(); }
const periodoTxt = () => `${dBR($('fDe').value)} a ${dBR($('fAte').value)}`;
function filtrosTxt() {
  const p = [];
  if (BUSCA) p.push('Pesquisa: ' + BUSCA.rotulo);
  if ($('fReg').value) p.push('Regional: ' + $('fReg').value);
  if ($('fLoja').value) p.push('Loja: ' + A.B.dic.loja[+$('fLoja').value]);
  if ($('fSit').value) p.push(DF.SIT[$('fSit').value]);
  if ($('fCat').value) p.push(DF.CAT[$('fCat').value]);
  return p.join(' · ') || 'Sem filtros';
}

// ---------------- cálculos ----------------
let P = null; // pessoas · V vendedores · L lojas · K cards
function calcular() {
  const C = A.B.col, d = A.B.dic;
  // pessoas (beneficiários) — campanha não entra nas suspeitas
  const pes = new Map();
  for (const i of F) {
    const c = C.cli[i]; let p = pes.get(c);
    if (!p) { p = {c, nome: d.cli[c], s: A.cli[c], linhas: [], vendas: new Set(), lojas: new Set(), vends: new Set(), meses: new Set(), pares: 0, bruto: 0, desc: 0, camp: 0, exc: 0, nExc: 0, auto: new Set(), antes: 0, maxMesmo: 0, terc: 0}; pes.set(c, p); }
    p.linhas.push(i);
    if (A.cat[i] === 'CAMP') { p.camp += C.desc[i]; continue; }
    p.vendas.add(C.cod[i]); p.lojas.add(C.loja[i]); p.vends.add(C.vend[i]); p.meses.add(X.mes[i]);
    p.pares += C.qtd[i]; p.bruto += C.preco[i]; p.desc += C.desc[i];
    if (A.excesso[i] > 0) { p.exc += A.excesso[i]; p.nExc++; }
    if (A.flags[i] & 1) p.auto.add(C.cod[i]);
    if (A.flags[i] & 2) p.antes++;
  }
  // mesmo produto várias unidades na mesma venda
  for (const p of pes.values()) {
    const m = new Map(); for (const i of p.linhas) { if (A.cat[i] === 'CAMP') continue; const k = C.cod[i] + '|' + C.prod[i]; m.set(k, (m.get(k) || 0) + C.qtd[i]); }
    for (const v of m.values()) if (v > p.maxMesmo) p.maxMesmo = v;
    pontuar(p);
  }
  // vendedores (quem concede)
  const ven = new Map();
  for (const i of F) {
    if (A.cat[i] === 'CAMP') continue;
    const v = C.vend[i]; let x = ven.get(v);
    if (!x) { x = {v, nome: d.vend[v] || '(sem vendedor)', lojas: new Set(), vendas: new Set(), benef: new Set(), terc: new Set(), descTerc: 0, desc: 0, bruto: 0, auto: new Set(), nExc: 0, linhas: []}; ven.set(v, x); }
    x.linhas.push(i); x.lojas.add(C.loja[i]); x.vendas.add(C.cod[i]); x.benef.add(C.cli[i]); x.desc += C.desc[i]; x.bruto += C.preco[i];
    const s = A.cli[C.cli[i]].sit;
    if (s === 'TERC' || s === 'COLAB' || s === 'INCOMP' || s === 'SEMNOME') { if (!(A.flags[i] & 1)) { x.terc.add(C.cli[i]); x.descTerc += C.desc[i]; } }
    if (A.flags[i] & 1) x.auto.add(C.cod[i]);
    if (A.excesso[i] > 0) x.nExc++;
  }
  for (const x of ven.values()) {
    x.pontos = (x.terc.size >= 5 ? 40 : x.terc.size >= 3 ? 20 : x.terc.size ? 5 : 0) + (x.nExc ? 30 : 0) + (x.descTerc >= 500 ? 15 : 0);
    x.nivel = x.pontos >= 50 ? 'alto' : x.pontos >= 25 ? 'medio' : x.pontos > 0 ? 'baixo' : '';
  }
  // lojas
  const lj = new Map();
  for (const i of F) {
    const l = C.loja[i]; let x = lj.get(l);
    if (!x) { x = {l, nome: d.loja[l], reg: X.lojaReg[l], linhas: [], vendas: new Set(), desc: 0, bruto: 0, func: 0, terc: 0, colab: 0, camp: 0, exc: 0, pessoas: new Set()}; lj.set(l, x); }
    x.linhas.push(i); x.vendas.add(C.cod[i]); x.desc += C.desc[i]; x.bruto += C.preco[i]; x.pessoas.add(C.cli[i]);
    const c = A.cat[i];
    if (c === 'FUNC_OK' || c === 'FUNC_ACIMA') x.func += C.desc[i]; else if (c === 'CAMP') x.camp += C.desc[i]; else if (c === 'COLAB') x.colab += C.desc[i]; else x.terc += C.desc[i];
    if (A.excesso[i] > 0) x.exc++;
  }
  P = {pes: [...pes.values()], ven: [...ven.values()], lojas: [...lj.values()]};
  P.susp = P.pes.filter(p => p.nivel).sort((a, b) => b.pontos - a.pontos || b.desc - a.desc);
  P.suspVend = P.ven.filter(x => x.nivel).sort((a, b) => b.pontos - a.pontos || b.descTerc - a.descTerc);
  cardsCalc();
}
function pontuar(p) {
  const m = [], s = p.s.sit, n = p.vendas.size, meses = Math.max(p.meses.size, 1), pm = p.pares / meses;
  let pt = 0;
  if (s === 'TERC' && n) { pt += n >= 5 ? 40 : 30; m.push(`Recebeu desconto sem ser funcionário (${n} compra${n > 1 ? 's' : ''})`); }
  if (s === 'COLAB' && n) { pt += 30; m.push('Vende nas lojas (aparece como vendedor) mas não está no cadastro de Funcionários Ativos — confirmar vínculo'); }
  if (s === 'INCOMP' && n >= 3) { pt += 10; m.push('Nome incompleto no cadastro do cliente: não dá para confirmar se é funcionário'); }
  if (p.nExc) { pt += 30; m.push(`${p.nExc} item(ns) com desconto acima de ${DF.LIMITE}% (excesso ${brl(p.exc)}, já descontada a tolerância de R$ 0,50)`); }
  if (p.antes) { pt += 30; m.push(`${p.antes} item(ns) comprados com desconto antes da data de admissão`); }
  if (n && p.pares >= 15 && pm >= 10) { pt += 20; m.push(`Volume alto: ${nf(pm, 1)} pares por mês (possível revenda)`); }
  else if (n && p.pares >= 12 && pm >= 6) { pt += 10; m.push(`Volume acima do comum: ${nf(pm, 1)} pares por mês`); }
  if (p.maxMesmo >= 3) { pt += 15; m.push(`${nf(p.maxMesmo)} unidades do mesmo produto numa única venda`); }
  if (p.lojas.size >= 4) { pt += 10; m.push(`Comprou com desconto em ${p.lojas.size} lojas diferentes`); }
  if (n >= 10 && p.auto.size / n >= 0.8) { pt += 10; m.push(`Registra a própria venda em ${nf(p.auto.size / n * 100)}% das compras (sem segregação)`); }
  if (p.desc >= 1000) { pt += 10; m.push(`Desconto acumulado alto: ${brl(p.desc)}`); }
  p.pontos = pt; p.motivos = m; p.nivel = pt >= 50 ? 'alto' : pt >= 30 ? 'medio' : pt > 0 ? 'baixo' : '';
}

// cards inteligentes — título diz o número, base com data, comparação e composição ao clicar
function serieMensal(idx, val = i => A.B.col.desc[i]) { const m = new Map(); for (const i of idx) m.set(X.mes[i], (m.get(X.mes[i]) || 0) + val(i)); return m; }
function comparar(idx, val) {
  const s = serieMensal(idx, val), meses = [...new Set(F.map(i => X.mes[i]).concat(X.todos.map(i => X.mes[i])))].sort((a, b) => a - b);
  if (meses.length < 2) return null;
  const ult = meses[meses.length - 1], ant = meses.slice(0, -1), media = soma(ant, m => s.get(m) || 0) / ant.length, v = s.get(ult) || 0;
  const diaFim = X.max % 100, mesAberto = Math.floor(X.max / 100) === ult && diaFim < 28;
  const ref = mesAberto ? media * diaFim / 30 : media;
  if (!ref && !v) return null;
  const p = ref ? (v - ref) / ref * 100 : 100;
  return {txt: `${mesRot(ult)}${mesAberto ? ' (até dia ' + diaFim + ')' : ''}: ${val === undefined ? brl0(v) : nf(v)} · ${p >= 0 ? '▲' : '▼'} ${nf(Math.abs(p))}% vs média${mesAberto ? ' proporcional' : ''}`, cls: Math.abs(p) < 5 ? 'eq' : p > 0 ? 'up' : 'down'};
}
let K = [];
function cardsCalc() {
  const C = A.B.col, por = cat => F.filter(i => A.cat[i] === cat);
  const real = F.filter(i => A.cat[i] !== 'CAMP');
  const func = F.filter(i => A.cat[i] === 'FUNC_OK' || A.cat[i] === 'FUNC_ACIMA');
  const exc = F.filter(i => A.excesso[i] > 0), terc = por('TERC'), colab = por('COLAB'), camp = por('CAMP'), incomp = F.filter(i => A.cat[i] === 'INCOMP' || A.cat[i] === 'SEMNOME');
  const auto = real.filter(i => A.flags[i] & 1), antes = real.filter(i => A.flags[i] & 2);
  const semAut = real.filter(i => !A.B.dic.aut[C.aut[i]]);
  const revenda = P.pes.filter(p => p.motivos.some(m => /possível revenda|mesmo produto/.test(m)));
  // clientes que são funcionários (todo o recorte, com e sem desconto)
  const fc = new Map();
  for (const i of X.todos) {
    const s = A.cli[C.cli[i]]; if (s.sit !== 'FUNC' && s.sit !== 'FUNC_PROV') continue;
    let x = fc.get(s.f); if (!x) { x = {f: s.f, nomes: new Set(), com: new Set(), sem: new Set(), linhas: [], desc: 0, bruto: 0}; fc.set(s.f, x); }
    x.nomes.add(C.cli[i]); x.linhas.push(i); x.bruto += C.preco[i];
    if (A.cat[i] === 'ARRED' || A.cat[i] === 'SEM_DESC') x.sem.add(C.cod[i]); else { x.com.add(C.cod[i]); x.desc += C.desc[i]; }
  }
  X.funcCli = [...fc.values()];
  const clientesId = new Set(X.todos.filter(i => A.cli[C.cli[i]].sit !== 'SEMNOME').map(i => C.cli[i])).size;
  const soSem = X.funcCli.filter(x => x.sem.size && !x.com.size).length, ambos = X.funcCli.filter(x => x.sem.size && x.com.size).length;
  const s = idx => soma(idx, i => C.desc[i]), v = idx => new Set(idx.map(i => C.cod[i])).size, pp = idx => new Set(idx.map(i => C.cli[i])).size;
  const base = `base até ${dBR(X.max)}`;
  K = [
    {id: 'total', cls: 'neu', t: 'Desconto concedido no período', n: brl0(s(F)), d: `${nf(v(F))} vendas · ${nf(pp(F))} beneficiários · inclui campanha Meias (${brl0(s(camp))})`, cmp: comparar(F), idx: F},
    {id: 'funccli', cls: 'roxo', t: 'Clientes que são funcionários', n: nf(X.funcCli.length), d: `de ${nf(clientesId)} clientes com nome no período · ${nf(X.funcCli.length - soSem - ambos)} só com desconto de funcionário · ${nf(soSem + ambos)} compraram também sem o desconto (como cliente comum)`, base: 'cruzamento por nome com o cadastro de Funcionários Ativos (aceita grafia diferente)', abrir: abrirFuncCli},
    {id: 'func', cls: 'ok', t: `Desconto a funcionários (até ${DF.LIMITE}%)`, n: brl0(s(func)), d: `${nf(v(func))} vendas · ${nf(pp(func))} funcionários · ${pct(s(func), s(real))} do desconto fora da campanha`, cmp: comparar(func), idx: func},
    {id: 'exc', cls: exc.length ? 'bad' : 'ok', t: `Acima do limite de ${DF.LIMITE}% (tolerância R$ 0,50)`, n: nf(exc.length) + ' itens', d: `excesso ${brl(soma(exc, i => A.excesso[i]))} · desconto total ${brl(s(exc))} · ${nf(pp(exc))} pessoas`, idx: exc, cmp: comparar(exc, i => 1)},
    {id: 'terc', cls: terc.length ? 'bad' : 'ok', t: 'Desconto a quem não é funcionário', n: brl0(s(terc)), d: `${nf(v(terc))} vendas · ${nf(pp(terc))} pessoas fora do cadastro e que não vendem nas lojas`, cmp: comparar(terc), idx: terc},
    {id: 'colab', cls: colab.length ? 'warn' : 'ok', t: 'Colaboradores fora do cadastro de ativos', n: brl0(s(colab)), d: `${nf(pp(colab))} pessoas que aparecem como vendedor e recebem desconto sem estar na lista de Funcionários Ativos · ${nf(v(colab))} vendas`, cmp: comparar(colab), idx: colab},
    {id: 'auto', cls: 'warn', t: 'Auto-venda: vendedor = quem recebeu', n: nf(v(auto)) + ' vendas', d: `${brl(s(auto))} de desconto · ${nf(pp(auto))} pessoas registraram a própria compra`, cmp: comparar(auto, i => 1), idx: auto},
    {id: 'antes', cls: antes.length ? 'bad' : 'ok', t: 'Desconto antes da admissão', n: nf(pp(antes)) + ' pessoas', d: `${nf(v(antes))} vendas · ${brl(s(antes))} de desconto antes da data de admissão no cadastro`, idx: antes},
    {id: 'revenda', cls: revenda.length ? 'warn' : 'ok', t: 'Possível revenda (volume alto)', n: nf(revenda.length) + ' pessoas', d: `≥10 pares/mês ou 3+ unidades do mesmo produto numa venda · ${brl(soma(revenda, p => p.desc))} de desconto`, abrir: () => abrirPessoas('Possível revenda (volume alto)', revenda)},
    {id: 'susp', cls: P.susp.filter(p => p.nivel === 'alto').length ? 'bad' : 'warn', t: 'Pessoas com suspeita (risco alto)', n: nf(P.susp.filter(p => p.nivel === 'alto').length), d: `${nf(P.susp.filter(p => p.nivel === 'medio').length)} risco médio · ${nf(P.suspVend.filter(x => x.nivel === 'alto').length)} vendedores concedendo a vários terceiros`, abrir: () => abrirAba('suspeitas')},
    {id: 'semaut', cls: semAut.length ? 'warn' : 'ok', t: 'Sem responsável pela liberação', n: pct(semAut.length, real.length), d: `${nf(semAut.length)} de ${nf(real.length)} itens com desconto não informam quem autorizou (campo AUTORIZADOR vazio)`, idx: semAut},
    {id: 'incomp', cls: 'neu', t: 'Nome incompleto / sem nome', n: brl0(s(incomp)), d: `${nf(pp(incomp))} clientes com 1–2 nomes: não dá para confirmar se é funcionário · ${nf(v(incomp))} vendas`, idx: incomp},
    {id: 'camp', cls: 'neu', t: 'Campanha Meias (não aponta)', n: brl0(s(camp)), d: `${nf(v(camp))} vendas com Meia Hoahi + calçado · separado das suspeitas`, cmp: comparar(camp), idx: camp}
  ];
  const arred = X.todos.filter(i => A.cat[i] === 'ARRED');
  X.arred = {n: arred.length, v: s(arred)};
  $('cSusp').textContent = P.susp.filter(p => p.nivel === 'alto').length || '';
}

// ---------------- topo ----------------
function statusTela(est) {
  const el = $('status');
  if (est === 'carregando') { el.innerHTML = '<span class="chip">☁ Lendo a base da nuvem…</span>'; return; }
  if (!CARGA) { el.innerHTML = '<span class="chip warn">☁ Nenhuma base na nuvem — carregue os arquivos</span>'; return; }
  const dias = Math.floor((Date.now() - new Date(CARGA.ativada_em)) / 864e5);
  const a = CARGA.arquivos || {};
  el.innerHTML = `<span class="chip ok">☁ Na nuvem: enviada ${new Date(CARGA.ativada_em).toLocaleString('pt-BR')} por ${esc(CARGA.usuario || '—')}${dias ? ' (há ' + dias + ' dia' + (dias > 1 ? 's' : '') + ')' : ''}</span>` +
    `<span class="chip">Vendas de ${dBR(CARGA.periodo_ini)} a ${dBR(CARGA.periodo_fim)}</span>` +
    `<span class="chip">${nf(CARGA.linhas)} itens · ${nf(CARGA.funcionarios)} funcionários no cadastro</span>` +
    (a.funcionarios ? `<span class="chip">Cadastro: ${esc(a.funcionarios.nome)}</span>` : '') +
    (A && A.B.reg.length ? '' : '<span class="chip warn">Sem planilha Regional</span>');
  // base desatualizada: alerta visível
  const atraso = X ? Math.floor((Date.now() - new Date(n2iso(X.max) + 'T12:00:00')) / 864e5) : 0;
  if (atraso > 7) avisoTopo('warn', `A última venda da base é de <b>${dBR(X.max)}</b> (${atraso} dias atrás). Carregue o relatório de descontos atualizado.`, 'atraso');
}
function avisoTopo(cls, html, id = 'geral') {
  let el = $('aviso-' + id);
  if (!el) { el = document.createElement('div'); el.id = 'aviso-' + id; $('avisos').appendChild(el); }
  el.className = 'df-aviso ' + cls; el.innerHTML = html;
}

// ---------------- busca inteligente ----------------
let SUG = [], SUGi = -1;
function sugerir(q) {
  const box = $('sug');
  q = DF.norm(q);
  if (!A || q.length < 2) { box.classList.add('hidden'); SUG = []; return; }
  const C = A.B.col, d = A.B.dic, ts = q.split(' ').filter(Boolean), out = [];
  const bate = s => ts.every(t => s.includes(t));
  const aprox = s => { const st = DF.toks(s); return ts.every(t => st.some(x => x.startsWith(t) || (t.length >= 4 && DF.sim(t, x.slice(0, Math.max(t.length, 4))) >= 0.75))); };
  // totais por cliente/vendedor/loja no período
  const tc = new Map(), tv = new Map();
  for (const i of F) { tc.set(C.cli[i], (tc.get(C.cli[i]) || 0) + C.desc[i]); tv.set(C.vend[i], (tv.get(C.vend[i]) || 0) + C.desc[i]); }
  if (/^\d{4,}$/.test(q)) {
    const vs = new Map(); for (let i = 0; i < A.n; i++) if (C.cod[i].includes(q)) { const k = C.cod[i]; if (!vs.has(k)) vs.set(k, [0, i]); vs.get(k)[0] += C.desc[i]; if (vs.size > 12) break; }
    for (const [k, [v, i]] of vs) out.push({g: 'Vendas', tipo: 'venda', valor: k, rotulo: 'Venda nº ' + k, txt: `Venda nº ${k} · ${dBR(C.data[i])} · ${d.loja[C.loja[i]]}`, v: brl(v)});
  }
  const fs = []; A.B.func.forEach((f, k) => { if (bate(f[1]) || bate(f[2]) || bate(f[0]) || aprox(f[1])) fs.push(k); });
  for (const k of fs.slice(0, 8)) {
    const f = A.B.func[k]; const nomes = A.cli.map((c, j) => c.f === k && (c.sit === 'FUNC' || c.sit === 'FUNC_PROV') ? j : -1).filter(j => j >= 0);
    out.push({g: 'Funcionários (cadastro)', tipo: 'func', valor: k, rotulo: f[1], txt: `${f[1]} <span class="mut">· CPF ${cpfF(f[2])}</span>`, v: brl(soma(nomes, j => tc.get(j) || 0))});
  }
  const cl = []; d.cli.forEach((c, k) => { if (c && (bate(c) || aprox(c))) cl.push(k); });
  cl.sort((a, b) => (tc.get(b) || 0) - (tc.get(a) || 0));
  for (const k of cl.slice(0, 8)) out.push({g: 'Quem recebeu o desconto', tipo: 'cli', valor: k, rotulo: d.cli[k], txt: `${esc(d.cli[k])} <span class="mut">· ${esc(DF.SIT[A.cli[k].sit])}</span>`, v: brl(tc.get(k) || 0)});
  const vl = []; d.vend.forEach((c, k) => { if (c && bate(c)) vl.push(k); });
  vl.sort((a, b) => (tv.get(b) || 0) - (tv.get(a) || 0));
  for (const k of vl.slice(0, 6)) out.push({g: 'Vendedores (quem concedeu)', tipo: 'vend', valor: k, rotulo: 'Vendedor ' + d.vend[k], txt: esc(d.vend[k]), v: brl(tv.get(k) || 0)});
  d.loja.forEach((l, k) => { if (bate(l)) out.push({g: 'Lojas', tipo: 'loja', valor: k, rotulo: l, txt: esc(l), v: X.lojaReg[k]}); });
  X.regionais.forEach(r => { if (bate(r)) out.push({g: 'Regionais', tipo: 'reg', valor: r, rotulo: 'Regional ' + r, txt: esc(r), v: ''}); });
  const pr = []; d.prod.forEach((p, k) => { if (bate(p)) pr.push(k); });
  for (const k of pr.slice(0, 5)) out.push({g: 'Produtos', tipo: 'prod', valor: k, rotulo: d.prod[k], txt: esc(d.prod[k]), v: ''});
  out.unshift({g: 'Pesquisa livre', tipo: 'texto', valor: q, rotulo: '"' + q + '"', txt: `Filtrar tudo que contém <b>${esc(q)}</b> (nome, vendedor, produto, loja ou nº da venda)`, v: 'Enter'});
  SUG = out; SUGi = -1;
  let g = '';
  box.innerHTML = out.map((o, k) => (o.g !== g ? `<div class="g">${esc(g = o.g)}</div>` : '') + `<button type="button" data-k="${k}"><span>${o.txt}</span><span class="v">${esc(o.v)}</span></button>`).join('');
  box.querySelectorAll('button').forEach(b => b.addEventListener('mousedown', e => { e.preventDefault(); escolher(+b.dataset.k); }));
  box.classList.remove('hidden');
}
function escolher(k) {
  const o = SUG[k]; if (!o) return;
  $('sug').classList.add('hidden'); $('busca').value = o.tipo === 'texto' ? o.valor : o.rotulo;
  BUSCA = {tipo: o.tipo, valor: o.valor, rotulo: o.rotulo};
  aplicar();
  if (o.tipo === 'cli') fichaPessoa(o.valor);
  else if (o.tipo === 'func') fichaFuncionario(o.valor);
  else if (o.tipo === 'vend') fichaVendedor(o.valor);
  else if (o.tipo === 'venda') abrirLinhas('Venda nº ' + o.valor, F.slice());
}

// ---------------- desenho ----------------
function ligarTela() {
  if (ligarTela.ok) return; ligarTela.ok = true;
  ['fDe', 'fAte', 'fLoja', 'fSit', 'fCat'].forEach(id => $(id).addEventListener('change', aplicar));
  $('fReg').addEventListener('change', () => { preencherLojas(); aplicar(); });
  $('abas').querySelectorAll('button').forEach(b => b.addEventListener('click', () => abrirAba(b.dataset.a)));
  const bi = $('busca'); let t;
  bi.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => sugerir(bi.value), 160); if (!bi.value && BUSCA) { BUSCA = null; aplicar(); } });
  bi.addEventListener('keydown', e => {
    const bs = $('sug').querySelectorAll('button');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); SUGi = Math.max(0, Math.min(bs.length - 1, SUGi + (e.key === 'ArrowDown' ? 1 : -1))); bs.forEach((b, k) => b.classList.toggle('on', k === SUGi)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (!SUG.length) sugerir(bi.value); escolher(SUGi >= 0 ? SUGi : 0); }
    else if (e.key === 'Escape') $('sug').classList.add('hidden');
  });
  bi.addEventListener('blur', () => setTimeout(() => $('sug').classList.add('hidden'), 150));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('modal').classList.contains('hidden')) { e.stopPropagation(); fecharModal(); } }, true);
}
function abrirAba(a) {
  ABA = a; $('abas').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.a === a)); desenhar();
}
function desenhar() {
  const el = $('conteudo');
  if (ABA === 'carregar') return telaCarregar(el);
  if (!A) { el.innerHTML = '<div class="card vazio">Ainda não há base na nuvem. Use <b>Carregar arquivos</b>.</div>'; return; }
  ({painel: telaPainel, suspeitas: telaSuspeitas, pessoas: telaPessoas, vendedores: telaVendedores, lojas: telaLojas, lanc: telaLanc, relatorios: telaRelatorios})[ABA](el);
}
function cardHTML(k) {
  return `<button class="df-card ${k.cls}" data-card="${k.id}" title="Clique para ver a composição"><span class="abrir">Abrir ↗</span><div class="t">${esc(k.t)}</div><div class="n">${k.n}</div><div class="d">${esc(k.d)}</div>` +
    (k.cmp ? `<div class="cmp ${k.cmp.cls}">${esc(k.cmp.txt)}</div>` : '') + `<div class="base">${esc(k.base || 'base até ' + dBR(X.max) + ' · período ' + periodoTxt())}</div></button>`;
}
function ligarCards(el) {
  el.querySelectorAll('[data-card]').forEach(b => b.addEventListener('click', () => {
    const k = K.find(x => x.id === b.dataset.card); if (!k) return;
    if (k.abrir) k.abrir(); else abrirLinhas(k.t, k.idx, {agrupar: true});
  }));
}
function telaPainel(el) {
  const C = A.B.col;
  // por mês e categoria
  const meses = [...new Set(F.map(i => X.mes[i]))].sort((a, b) => a - b);
  const grupos = [['Funcionário', '#22c55e', c => c === 'FUNC_OK'], ['Acima do limite', '#ef4444', c => c === 'FUNC_ACIMA'], ['Não funcionário', '#f87171', c => c === 'TERC'],
    ['Fora do cadastro', '#f5b301', c => c === 'COLAB'], ['Nome incompleto', '#64748b', c => c === 'INCOMP' || c === 'SEMNOME'], ['Campanha Meias', '#a78bfa', c => c === 'CAMP']];
  const tab = meses.map(m => grupos.map(g => soma(F.filter(i => X.mes[i] === m && g[2](A.cat[i])), i => C.desc[i])));
  const maxM = Math.max(1, ...tab.map(r => soma(r, x => x)));
  const barras = meses.map((m, k) => `<div class="col" data-mes="${m}" title="${mesRot(m)}: ${brl(soma(tab[k], x => x))}"><div class="val">${brl0(soma(tab[k], x => x)).replace('R$ ', '')}</div><div class="pilha" style="height:${Math.round(soma(tab[k], x => x) / maxM * 150)}px">${tab[k].map((v, g) => `<span style="height:${v / Math.max(soma(tab[k], x => x), 1) * 100}%;background:${grupos[g][1]}"></span>`).join('')}</div><div class="rot">${mesRot(m)}</div></div>`).join('');
  const rg = new Map(); for (const l of P.lojas) { const r = rg.get(l.reg) || {d: 0, t: 0}; r.d += l.desc - l.camp; r.t += l.terc + l.colab; rg.set(l.reg, r); }
  const rgs = [...rg.entries()].sort((a, b) => b[1].d - a[1].d), maxR = Math.max(1, ...rgs.map(r => r[1].d));
  const top = P.susp.slice(0, 8);
  el.innerHTML = `<h2>Indicadores do período</h2><div class="df-cards">${K.map(cardHTML).join('')}</div>
    ${X.arred.n ? `<div class="df-aviso warn" style="margin-top:12px">Desconsiderados <b>${nf(X.arred.n)}</b> itens com desconto de centavos sem percentual (arredondamento do caixa, total ${brl(X.arred.v)}) e excessos de até R$ 0,50 acima do limite de ${DF.LIMITE}%.</div>` : ''}
    <div class="df-grid2" style="margin-top:12px">
      <div class="card"><h2 style="margin-top:0">Desconto por mês (R$)</h2><div class="df-barras">${barras || '<div class="vazio">Sem dados</div>'}</div>
        <div class="df-leg">${grupos.map(g => `<span><i style="background:${g[1]}"></i>${g[0]}</span>`).join('')}</div></div>
      <div class="card"><h2 style="margin-top:0">Por regional (sem campanha)</h2>${rgs.map(([r, v]) => `<div class="df-hbar" data-reg="${esc(r)}"><span>${esc(r)}</span><div class="tr"><span style="width:${v.d / maxR * 100}%"></span></div><span class="nw">${brl0(v.d)}${v.t ? ` <span class="vbad">· ${brl0(v.t)} fora</span>` : ''}</span></div>`).join('')}</div>
    </div>
    <h2>Maiores suspeitas <button class="btn peq" onclick="abrirAba('suspeitas')">Ver todas</button></h2>
    <div class="card">${tabelaPessoas(top, 'painelSusp', true)}</div>`;
  ligarCards(el);
  el.querySelectorAll('[data-mes]').forEach(b => b.addEventListener('click', () => { const m = +b.dataset.mes; abrirLinhas('Descontos de ' + mesRot(m), F.filter(i => X.mes[i] === m), {agrupar: true}); }));
  el.querySelectorAll('[data-reg]').forEach(b => b.addEventListener('click', () => { $('fReg').value = b.dataset.reg; preencherLojas(); aplicar(); }));
  ligarTabela(el);
}
const nivelChip = n => n === 'alto' ? '<span class="chip bad">Alto</span>' : n === 'medio' ? '<span class="chip warn">Médio</span>' : n === 'baixo' ? '<span class="chip">Baixo</span>' : '<span class="chip ok">—</span>';
const sitChip = s => `<span class="chip ${s === 'FUNC' ? 'ok' : s === 'FUNC_PROV' ? 'ok' : s === 'TERC' ? 'bad' : s === 'COLAB' ? 'warn' : ''}">${esc(DF.SIT[s])}</span>`;

// tabela genérica com ordenação, totais e clique
function tabela(id, cols, linhas, onClick, total) {
  const o = ORD[id] || {k: cols.find(c => c.ord)?.k, d: -1};
  const col = cols.find(c => c.k === o.k);
  if (col) linhas = linhas.slice().sort((a, b) => { const x = col.v(a), y = col.v(b); return (x > y ? 1 : x < y ? -1 : 0) * o.d; });
  const lim = 500, mostra = linhas.slice(0, lim);
  TAB[id] = {linhas: mostra, onClick, cols, todas: linhas};
  return `<div class="tw"><table data-tab="${id}"><thead><tr>${cols.map(c => `<th class="${c.cls || ''}" data-k="${c.k}">${esc(c.t)}${o.k === c.k ? (o.d > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
    <tbody>${mostra.map((r, k) => `<tr class="${onClick ? 'cl' : ''}" data-r="${k}">${cols.map(c => `<td class="${c.cls || ''}">${c.h ? c.h(r) : esc(c.v(r))}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="vazio">Nada no recorte</td></tr>`}</tbody>
    ${total ? `<tfoot><tr>${cols.map((c, k) => `<td class="${c.cls || ''}">${k === 0 ? 'TOTAL (' + nf(linhas.length) + ')' : c.tot ? c.tot(linhas) : ''}</td>`).join('')}</tr></tfoot>` : ''}</table></div>` +
    (linhas.length > lim ? `<div class="df-pag">Mostrando ${lim} de ${nf(linhas.length)} — o total acima considera todas. Use o Excel ou o relatório para a lista completa.</div>` : '');
}
const TAB = {};
function ligarTabela(el) {
  el.querySelectorAll('table[data-tab]').forEach(tb => {
    const id = tb.dataset.tab, T = TAB[id]; if (!T) return;
    tb.querySelectorAll('th[data-k]').forEach(th => th.addEventListener('click', () => { const o = ORD[id] || {}; ORD[id] = {k: th.dataset.k, d: o.k === th.dataset.k ? -o.d : -1}; desenhar(); if (!$('modal').classList.contains('hidden') && $('mCorpo').contains(tb)) reabrirModal(); }));
    if (T.onClick) tb.querySelectorAll('tbody tr[data-r]').forEach(tr => tr.addEventListener('click', () => T.onClick(T.linhas[+tr.dataset.r])));
  });
}
const colsPessoa = [
  {k: 'nivel', t: 'Risco', v: p => p.pontos, h: p => nivelChip(p.nivel) + ` <span class="mut">${p.pontos}</span>`, ord: true},
  {k: 'nome', t: 'Quem recebeu', v: p => p.nome, h: p => `<b>${esc(p.nome)}</b>${p.s.sit === 'FUNC_PROV' ? `<div class="mut">cadastro: ${esc(A.B.func[p.s.f][1])}</div>` : ''}`},
  {k: 'sit', t: 'Situação', v: p => p.s.sit, h: p => sitChip(p.s.sit)},
  {k: 'vendas', t: 'Compras', cls: 'r', v: p => p.vendas.size, h: p => nf(p.vendas.size), tot: L => nf(soma(L, p => p.vendas.size))},
  {k: 'pares', t: 'Pares/itens', cls: 'r', v: p => p.pares, h: p => nf(p.pares), tot: L => nf(soma(L, p => p.pares))},
  {k: 'bruto', t: 'Valor vendido', cls: 'r', v: p => p.bruto, h: p => brl(p.bruto), tot: L => brl(soma(L, p => p.bruto))},
  {k: 'desc', t: 'Desconto', cls: 'r', v: p => p.desc, h: p => `<b>${brl(p.desc)}</b>`, tot: L => brl(soma(L, p => p.desc))},
  {k: 'lojas', t: 'Lojas', cls: 'c', v: p => p.lojas.size, h: p => nf(p.lojas.size)},
  {k: 'auto', t: 'Auto-venda', cls: 'c', v: p => p.auto.size, h: p => p.auto.size ? nf(p.auto.size) : '—'},
  {k: 'motivos', t: 'Por que aponta', v: p => p.motivos.length, h: p => p.motivos.length ? '<ul class="df-motivos" style="margin:0">' + p.motivos.map(m => `<li>${esc(m)}</li>`).join('') + '</ul>' : '<span class="mut">—</span>'}
];
function tabelaPessoas(lista, id, compacta) { return tabela(id, compacta ? colsPessoa.filter(c => c.k !== 'lojas' && c.k !== 'pares') : colsPessoa, lista, p => fichaPessoa(p.c), true); }
function telaSuspeitas(el) {
  const vend = P.suspVend;
  el.innerHTML = `<h2>Pessoas que receberam desconto com sinais de irregularidade</h2>
    <div class="df-aviso warn" style="margin-top:0">Pontuação: não é funcionário (+30/+40), colaborador fora do cadastro (+30), acima do limite de ${DF.LIMITE}% (+30), antes da admissão (+30), volume de possível revenda (+10/+20), 3+ unidades do mesmo produto (+15), 4+ lojas (+10), sempre registra a própria venda (+10), desconto acumulado ≥ R$ 1.000 (+10). <b>Alto ≥ 50 · Médio ≥ 30.</b> É indício para conferir, não conclusão.</div>
    <div class="df-acoes" style="margin:10px 0"><button class="btn" onclick="relatorioPessoas('Suspeitas — pessoas', P.susp)">🖨 Relatório</button><button class="btn" onclick="excelPessoas('suspeitas', P.susp)">⬇ Excel</button></div>
    <div class="card">${tabelaPessoas(P.susp, 'susp')}</div>
    <h2>Vendedores que concedem desconto a quem não é funcionário</h2>
    <div class="card">${tabelaVend(vend, 'suspV')}</div>`;
  ligarTabela(el);
}
function telaPessoas(el) {
  const L = P.pes.filter(p => p.vendas.size);
  el.innerHTML = `<h2>Todas as pessoas que receberam desconto no período (sem campanha)</h2>
    <div class="df-acoes" style="margin-bottom:10px"><button class="btn" onclick="relatorioPessoas('Descontos por pessoa', P.pes.filter(p=>p.vendas.size))">🖨 Relatório</button><button class="btn" onclick="excelPessoas('por-pessoa', P.pes.filter(p=>p.vendas.size))">⬇ Excel</button></div>
    <div class="card">${tabelaPessoas(L, 'pessoas')}</div>`;
  ligarTabela(el);
}
const colsVend = [
  {k: 'nivel', t: 'Risco', v: x => x.pontos, h: x => nivelChip(x.nivel), ord: true},
  {k: 'nome', t: 'Vendedor (quem concedeu)', v: x => x.nome, h: x => `<b>${esc(x.nome)}</b><div class="mut">${esc([...x.lojas].map(l => A.B.dic.loja[l]).join(' · '))}</div>`},
  {k: 'vendas', t: 'Vendas c/ desconto', cls: 'r', v: x => x.vendas.size, h: x => nf(x.vendas.size), tot: L => nf(soma(L, x => x.vendas.size))},
  {k: 'desc', t: 'Desconto concedido', cls: 'r', v: x => x.desc, h: x => brl(x.desc), tot: L => brl(soma(L, x => x.desc))},
  {k: 'benef', t: 'Beneficiários', cls: 'c', v: x => x.benef.size, h: x => nf(x.benef.size)},
  {k: 'terc', t: 'Não func./fora do cadastro', cls: 'c', v: x => x.terc.size, h: x => x.terc.size ? `<span class="vbad">${nf(x.terc.size)}</span>` : '—', tot: L => nf(soma(L, x => x.terc.size))},
  {k: 'descTerc', t: 'Desconto a eles', cls: 'r', v: x => x.descTerc, h: x => x.descTerc ? `<span class="vbad">${brl(x.descTerc)}</span>` : '—', tot: L => brl(soma(L, x => x.descTerc))},
  {k: 'auto', t: 'Auto-vendas', cls: 'c', v: x => x.auto.size, h: x => x.auto.size ? nf(x.auto.size) : '—'},
  {k: 'nExc', t: 'Acima do limite', cls: 'c', v: x => x.nExc, h: x => x.nExc ? `<span class="vbad">${nf(x.nExc)}</span>` : '—'}
];
function tabelaVend(lista, id) { return tabela(id, colsVend, lista, x => fichaVendedor(x.v), true); }
function telaVendedores(el) {
  el.innerHTML = `<h2>Quem concede os descontos (vendedor da venda)</h2>
    <div class="df-acoes" style="margin-bottom:10px"><button class="btn" onclick="relatorioVendedores()">🖨 Relatório</button><button class="btn" onclick="excelVendedores()">⬇ Excel</button></div>
    <div class="card">${tabelaVend(P.ven, 'vend')}</div>`;
  ligarTabela(el);
}
const colsLoja = [
  {k: 'nome', t: 'Loja', v: x => lojaNum(x.nome), h: x => `<b>${esc(x.nome)}</b>`},
  {k: 'reg', t: 'Regional', v: x => x.reg},
  {k: 'vendas', t: 'Vendas', cls: 'r', v: x => x.vendas.size, h: x => nf(x.vendas.size), tot: L => nf(soma(L, x => x.vendas.size))},
  {k: 'func', t: 'Funcionários', cls: 'r', v: x => x.func, h: x => brl(x.func), tot: L => brl(soma(L, x => x.func))},
  {k: 'terc', t: 'Não func. / incompleto', cls: 'r', v: x => x.terc, h: x => x.terc ? `<span class="vbad">${brl(x.terc)}</span>` : '—', tot: L => brl(soma(L, x => x.terc))},
  {k: 'colab', t: 'Fora do cadastro', cls: 'r', v: x => x.colab, h: x => x.colab ? `<span class="vwarn">${brl(x.colab)}</span>` : '—', tot: L => brl(soma(L, x => x.colab))},
  {k: 'camp', t: 'Campanha', cls: 'r', v: x => x.camp, h: x => brl(x.camp), tot: L => brl(soma(L, x => x.camp))},
  {k: 'desc', t: 'Desconto total', cls: 'r', v: x => x.desc, h: x => `<b>${brl(x.desc)}</b>`, tot: L => brl(soma(L, x => x.desc)), ord: true},
  {k: 'exc', t: 'Acima limite', cls: 'c', v: x => x.exc, h: x => x.exc ? `<span class="vbad">${x.exc}</span>` : '—'}
];
function telaLojas(el) {
  el.innerHTML = `<h2>Por loja</h2><div class="df-acoes" style="margin-bottom:10px"><button class="btn" onclick="relatorioLojas()">🖨 Relatório</button><button class="btn" onclick="excelLojas()">⬇ Excel</button></div>
    <div class="card">${tabela('lojas', colsLoja, P.lojas, x => abrirLinhas(x.nome, x.linhas, {agrupar: true}), true)}</div>`;
  ligarTabela(el);
}
const colsLanc = [
  {k: 'dataN', t: 'Data', v: r => r.dataN, h: r => r.data, ord: true},
  {k: 'venda', t: 'Nº venda', v: r => r.venda, h: r => `<b>${esc(r.venda)}</b>`},
  {k: 'loja', t: 'Loja', v: r => r.loja},
  {k: 'cliente', t: 'Quem recebeu', v: r => r.cliente, h: r => `${esc(r.cliente)}${r.cadastro && r.cadastro !== r.cliente ? `<div class="mut">cadastro: ${esc(r.cadastro)}</div>` : ''}`},
  {k: 'sit', t: 'Situação', v: r => r.sit, h: r => sitChip(r.sit)},
  {k: 'vendedor', t: 'Vendedor', v: r => r.vendedor, h: r => esc(r.vendedor) + (r.auto ? ' <span class="chip warn">auto-venda</span>' : '')},
  {k: 'produto', t: 'Produto', v: r => r.produto},
  {k: 'qtd', t: 'Qtd', cls: 'r', v: r => r.qtd, h: r => nf(r.qtd), tot: L => nf(soma(L, r => r.qtd))},
  {k: 'preco', t: 'Valor venda', cls: 'r', v: r => r.preco, h: r => brl(r.preco), tot: L => brl(soma(L, r => r.preco))},
  {k: 'pct', t: '%', cls: 'r', v: r => r.pct, h: r => `<span class="${r.excesso > 0 ? 'vbad' : ''}">${nf(r.pct, 1)}%</span>`},
  {k: 'desc', t: 'Desconto', cls: 'r', v: r => r.desc, h: r => `<b>${brl(r.desc)}</b>${r.excesso > 0 ? `<div class="vbad">+${brl(r.excesso)} acima</div>` : ''}`, tot: L => brl(soma(L, r => r.desc))},
  {k: 'pago', t: 'Valor pago', cls: 'r', v: r => r.pago, h: r => brl(r.pago), tot: L => brl(soma(L, r => r.pago))},
  {k: 'autorizador', t: 'Liberação', v: r => r.autorizador, h: r => r.autorizador ? esc(r.autorizador) : '<span class="vwarn">não informado</span>'},
  {k: 'cat', t: 'Classificação', v: r => r.catTxt, h: r => esc(r.catTxt) + (r.antesAdm ? ' <span class="chip bad">antes da admissão</span>' : '')}
];
function telaLanc(el) {
  const L = F.map(i => DF.linha(A, i));
  el.innerHTML = `<h2>Lançamentos do recorte (${nf(L.length)} itens)</h2>${totaisHTML(F)}
    <div class="df-acoes" style="margin-bottom:10px"><button class="btn" onclick="relatorioLinhas('Lançamentos com desconto', F, {agrupar:true})">🖨 Relatório (agrupado por pessoa)</button><button class="btn" onclick="relatorioLinhas('Lançamentos com desconto', F)">🖨 Relatório (por data)</button><button class="btn" onclick="excelLancamentos()">⬇ Excel</button></div>
    <div class="card">${tabela('lanc', colsLanc, L, r => fichaPessoa(A.B.col.cli[r.i]), true)}</div>`;
  ligarTabela(el);
}
function totaisHTML(idx) {
  const C = A.B.col, b = soma(idx, i => C.preco[i]), d = soma(idx, i => C.desc[i]);
  return `<div class="df-tot"><div>Valor vendido<b>${brl(b)}</b></div><div>Desconto<b>${brl(d)}</b></div><div>% médio<b>${pct(d, b)}</b></div><div>Valor pago<b>${brl(b - d)}</b></div><div>Vendas<b>${nf(new Set(idx.map(i => C.cod[i])).size)}</b></div><div>Itens<b>${nf(idx.length)}</b></div><div>Pessoas<b>${nf(new Set(idx.map(i => C.cli[i])).size)}</b></div></div>`;
}

// ---------------- modal e fichas ----------------
let MODAL = null;
function abrirModal(tit, sub, corpo, acoes) {
  MODAL = {tit, sub, corpo, acoes};
  $('mTit').textContent = tit; $('mSub').textContent = sub || '';
  $('mAcoes').innerHTML = ''; (acoes || []).forEach(([t, f, c]) => { const b = document.createElement('button'); b.className = 'btn ' + (c || ''); b.textContent = t; b.onclick = f; $('mAcoes').appendChild(b); });
  const fe = document.createElement('button'); fe.className = 'btn'; fe.textContent = 'Fechar'; fe.onclick = fecharModal; $('mAcoes').appendChild(fe);
  $('mCorpo').innerHTML = typeof corpo === 'function' ? corpo() : corpo; ligarTabela($('mCorpo'));
  $('modal').classList.remove('hidden'); document.body.style.overflow = 'hidden';
}
function reabrirModal() { if (MODAL) abrirModal(MODAL.tit, MODAL.sub, MODAL.corpo, MODAL.acoes); }
function fecharModal() { $('modal').classList.add('hidden'); document.body.style.overflow = ''; MODAL = null; }
function abrirLinhas(tit, idx, op = {}) {
  const L = idx.map(i => DF.linha(A, i));
  abrirModal(tit, `${periodoTxt()} · ${filtrosTxt()}`, () => totaisHTML(idx) + tabela('m-lanc', colsLanc, L, r => fichaPessoa(A.B.col.cli[r.i]), true),
    [['🖨 Imprimir / PDF', () => relatorioLinhas(tit, idx, op), 'pri'], ['⬇ Excel', () => excelLinhas(tit, idx)]]);
}
function abrirPessoas(tit, lista) {
  abrirModal(tit, periodoTxt(), () => tabelaPessoas(lista, 'm-pes'), [['🖨 Imprimir / PDF', () => relatorioPessoas(tit, lista), 'pri'], ['⬇ Excel', () => excelPessoas(tit, lista)]]);
}
function abrirFuncCli() {
  const L = X.funcCli.map(x => ({x, f: A.B.func[x.f]}));
  const cols = [
    {k: 'nome', t: 'Funcionário (cadastro)', v: r => r.f[1], h: r => `<b>${esc(r.f[1])}</b><div class="mut">CPF ${cpfF(r.f[2])} · admissão ${dBR(r.f[4])}</div>`},
    {k: 'como', t: 'Nome na venda', v: r => [...r.x.nomes].map(c => A.B.dic.cli[c]).join(' / ')},
    {k: 'com', t: 'Compras c/ desconto', cls: 'r', v: r => r.x.com.size, h: r => nf(r.x.com.size), tot: T => nf(soma(T, r => r.x.com.size)), ord: true},
    {k: 'sem', t: 'Compras sem desconto (como cliente)', cls: 'r', v: r => r.x.sem.size, h: r => r.x.sem.size ? `<span class="vwarn">${nf(r.x.sem.size)}</span>` : '—', tot: T => nf(soma(T, r => r.x.sem.size))},
    {k: 'bruto', t: 'Valor comprado', cls: 'r', v: r => r.x.bruto, h: r => brl(r.x.bruto), tot: T => brl(soma(T, r => r.x.bruto))},
    {k: 'desc', t: 'Desconto recebido', cls: 'r', v: r => r.x.desc, h: r => brl(r.x.desc), tot: T => brl(soma(T, r => r.x.desc))}
  ];
  abrirModal('Clientes que são funcionários', `${periodoTxt()} · funcionário identificado entre os clientes da base (com e sem desconto)`, () => tabela('m-fc', cols, L, r => fichaFuncionario(r.x.f), true),
    [['🖨 Imprimir / PDF', () => relatorioFuncCli(L, cols), 'pri'], ['⬇ Excel', () => excelGen('clientes-que-sao-funcionarios', cols, L)]]);
}
function fichaPessoa(c) {
  const s = A.cli[c], todas = X.todos.filter(i => A.B.col.cli[i] === c), p = P.pes.find(x => x.c === c);
  const f = s.f >= 0 && (s.sit === 'FUNC' || s.sit === 'FUNC_PROV') ? A.B.func[s.f] : null;
  fichaHTML(A.B.dic.cli[c], s.sit, f, todas, p);
}
function fichaFuncionario(k) {
  const nomes = new Set(A.cli.map((c, j) => c.f === k && (c.sit === 'FUNC' || c.sit === 'FUNC_PROV') ? j : -1).filter(j => j >= 0));
  const todas = X.todos.filter(i => nomes.has(A.B.col.cli[i]));
  const p = P.pes.filter(x => nomes.has(x.c)).sort((a, b) => b.pontos - a.pontos)[0];
  fichaHTML(A.B.func[k][1], 'FUNC', A.B.func[k], todas, p);
}
function fichaHTML(nome, sit, f, todas, p) {
  const C = A.B.col, com = todas.filter(i => A.cat[i] !== 'ARRED' && A.cat[i] !== 'SEM_DESC'), sem = todas.filter(i => A.cat[i] === 'ARRED' || A.cat[i] === 'SEM_DESC');
  const meses = [...new Set(com.map(i => X.mes[i]))].sort((a, b) => a - b);
  const vend = new Map(); com.forEach(i => vend.set(C.vend[i], (vend.get(C.vend[i]) || 0) + C.desc[i]));
  const corpo = () => `<div class="df-ficha">
      <div>Situação<b>${esc(DF.SIT[sit])}</b></div>
      ${f ? `<div>Cadastro<b>${esc(f[1])}</b></div><div>CPF<b>${cpfF(f[2])}</b></div><div>Admissão<b>${dBR(f[4])}</b></div><div>Matrícula<b>${esc(f[0])}</b></div>` : ''}
      <div>Compras com desconto<b>${nf(new Set(com.map(i => C.cod[i])).size)}</b></div><div>Compras sem desconto<b>${nf(new Set(sem.map(i => C.cod[i])).size)}</b></div>
      <div>Valor comprado<b>${brl(soma(todas, i => C.preco[i]))}</b></div><div>Desconto recebido<b>${brl(soma(com, i => C.desc[i]))}</b></div>
      <div>Pares/itens<b>${nf(soma(todas, i => C.qtd[i]))}</b></div><div>Risco<b>${p ? nivelChip(p.nivel) + ' ' + p.pontos + ' pts' : '—'}</b></div></div>
    ${p && p.motivos.length ? `<div class="df-aviso ${p.nivel === 'alto' ? 'bad' : 'warn'}" style="margin:0 0 12px"><b>Por que aponta:</b><ul class="df-motivos">${p.motivos.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}
    <div class="df-tot">${meses.map(m => `<div>${mesRot(m)}<b>${brl(soma(com.filter(i => X.mes[i] === m), i => C.desc[i]))}</b></div>`).join('')}</div>
    <div class="sub" style="margin:6px 0">Vendedores que atenderam: ${[...vend.entries()].sort((a, b) => b[1] - a[1]).map(([v, d]) => esc(A.B.dic.vend[v]) + ' (' + brl(d) + ')').join(' · ')}</div>
    ${tabela('m-ficha', colsLanc, todas.map(i => DF.linha(A, i)), null, true)}`;
  abrirModal(nome, `Ficha completa · ${periodoTxt()} · inclui compras sem desconto`, corpo,
    [['🖨 Imprimir / PDF', () => relatorioLinhas('Ficha — ' + nome, todas, {ficha: {nome, sit, f, p}}), 'pri'], ['⬇ Excel', () => excelLinhas('ficha-' + nome, todas)]]);
}
function fichaVendedor(v) {
  const x = P.ven.find(y => y.v === v); const idx = x ? x.linhas : [];
  const ben = new Map(); idx.forEach(i => { const c = A.B.col.cli[i]; ben.set(c, (ben.get(c) || 0) + A.B.col.desc[i]); });
  abrirModal('Vendedor ' + A.B.dic.vend[v], `${periodoTxt()} · descontos que este vendedor registrou`, () =>
    `${x ? `<div class="df-ficha"><div>Vendas c/ desconto<b>${nf(x.vendas.size)}</b></div><div>Desconto concedido<b>${brl(x.desc)}</b></div><div>Beneficiários<b>${nf(x.benef.size)}</b></div><div>Não func./fora do cadastro<b>${nf(x.terc.size)}</b></div><div>Desconto a eles<b>${brl(x.descTerc)}</b></div><div>Auto-vendas<b>${nf(x.auto.size)}</b></div></div>` : ''}
     <div class="sub" style="margin:6px 0">Para quem: ${[...ben.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([c, d]) => `${esc(A.B.dic.cli[c])} <span class="mut">(${esc(DF.SIT[A.cli[c].sit])}, ${brl(d)})</span>`).join(' · ')}</div>
     ${tabela('m-vend', colsLanc, idx.map(i => DF.linha(A, i)), r => fichaPessoa(A.B.col.cli[r.i]), true)}`,
    [['🖨 Imprimir / PDF', () => relatorioLinhas('Vendedor ' + A.B.dic.vend[v], idx, {agrupar: true}), 'pri'], ['⬇ Excel', () => excelLinhas('vendedor-' + A.B.dic.vend[v], idx)]]);
}

// ---------------- relatórios (impressão / PDF) ----------------
let LOGO = null;
async function logo() {
  if (LOGO) return LOGO;
  try { const b = await (await fetch('logo-esposende.jpg')).blob(); LOGO = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }); } catch (e) { LOGO = ''; }
  return LOGO;
}
const CSS_REL = `@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font:10.5px Arial,Helvetica,sans-serif;color:#0f172a;margin:0}
.cab{display:flex;align-items:center;gap:14px;border-bottom:3px solid #0b2a5b;padding-bottom:8px;margin-bottom:10px}.cab img{height:46px}.cab h1{font-size:17px;margin:0;color:#0b2a5b}.cab .st{font-size:10.5px;color:#475569;margin-top:2px}.cab .selo{margin-left:auto;text-align:right;font-weight:800;color:#0b2a5b;font-size:10px}
.cards{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 10px}.cards div{border:1px solid #cbd5e1;border-left:4px solid #0b2a5b;border-radius:6px;padding:6px 10px;min-width:120px;font-size:9.5px;color:#475569}.cards b{display:block;font-size:14px;color:#0f172a}
.cards .bad{border-left-color:#dc2626}.cards .warn{border-left-color:#d97706}.cards .ok{border-left-color:#16a34a}
table{width:100%;border-collapse:collapse;margin-bottom:10px}th{background:#0b2a5b;color:#fff;font-size:9px;text-transform:uppercase;padding:5px;text-align:left}td{padding:4px 5px;border-bottom:1px solid #e2e8f0;font-size:9.5px;vertical-align:top}
tr:nth-child(even) td{background:#f1f5f9}.r{text-align:right;white-space:nowrap}.c{text-align:center}.tot td{background:#dbe4f3!important;font-weight:800;border-top:2px solid #0b2a5b}.sub td{background:#eef2f8!important;font-weight:700}
.gr td{background:#0b2a5b!important;color:#fff;font-weight:800;font-size:10.5px;padding:6px 8px}thead{display:table-header-group}tr{page-break-inside:avoid}.av{border:1px solid #f59e0b;background:#fffbeb;padding:6px 9px;border-radius:6px;margin:6px 0;font-size:10px}
h2{font-size:12px;color:#0b2a5b;border-bottom:1px solid #cbd5e1;padding-bottom:3px;margin:14px 0 6px}ul{margin:2px 0 2px 16px;padding:0}.rod{margin-top:12px;border-top:1px solid #cbd5e1;padding-top:5px;font-size:9px;color:#64748b;display:flex;justify-content:space-between}
.vbad{color:#b91c1c;font-weight:700}`;
async function imprimir(titulo, sub, corpo) {
  const lg = await logo();
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${CSS_REL}</style></head><body>
    <div class="cab">${lg ? `<img src="${lg}" alt="Esposende">` : ''}<div><h1>${esc(titulo)}</h1><div class="st">${esc(sub)}</div></div><div class="selo">AUDITORIA<br>&amp; CONTROLE</div></div>
    ${corpo}<div class="rod"><span>Esposende · Central de Auditoria &amp; Controle · Descontos de Funcionários</span><span>Base enviada por ${esc(CARGA?.usuario || '—')} em ${CARGA ? new Date(CARGA.ativada_em).toLocaleString('pt-BR') : '—'} · gerado em ${new Date().toLocaleString('pt-BR')}</span></div></body></html>`;
  const ifr = document.createElement('iframe'); ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(ifr);
  const d = ifr.contentDocument; d.open(); d.write(html); d.close();
  setTimeout(() => { try { ifr.contentWindow.focus(); ifr.contentWindow.print(); } catch (e) { const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); w.print(); } } setTimeout(() => ifr.remove(), 60000); }, 400);
}
const subRel = () => `Período ${periodoTxt()} · ${filtrosTxt()} · última venda da base ${dBR(X.max)}`;
function cardsRel(idx) {
  const C = A.B.col, b = soma(idx, i => C.preco[i]), d = soma(idx, i => C.desc[i]);
  return `<div class="cards"><div>Valor vendido<b>${brl(b)}</b></div><div class="bad">Desconto<b>${brl(d)}</b></div><div>% médio<b>${pct(d, b)}</b></div><div>Valor pago<b>${brl(b - d)}</b></div><div>Vendas<b>${nf(new Set(idx.map(i => C.cod[i])).size)}</b></div><div>Itens<b>${nf(idx.length)}</b></div><div>Pessoas<b>${nf(new Set(idx.map(i => C.cli[i])).size)}</b></div></div>`;
}
const linhaRel = r => `<tr><td class="nw">${r.data}</td><td><b>${esc(r.venda)}</b></td><td>${esc(r.loja)}</td><td>${esc(r.cliente)}${r.cadastro && r.cadastro !== r.cliente ? `<br><i>cad.: ${esc(r.cadastro)}</i>` : ''}</td><td>${esc(r.sitTxt)}</td><td>${esc(r.vendedor)}${r.auto ? ' (auto-venda)' : ''}</td><td>${esc(r.produto)}</td><td class="r">${nf(r.qtd)}</td><td class="r">${brl(r.preco)}</td><td class="r ${r.excesso > 0 ? 'vbad' : ''}">${nf(r.pct, 1)}%</td><td class="r"><b>${brl(r.desc)}</b>${r.excesso > 0 ? `<br><span class="vbad">+${brl(r.excesso)}</span>` : ''}</td><td class="r">${brl(r.pago)}</td><td>${r.autorizador ? esc(r.autorizador) : 'NÃO INFORMADO'}</td></tr>`;
const cabRel = '<tr><th>Data</th><th>Nº venda</th><th>Loja</th><th>Quem recebeu</th><th>Situação</th><th>Vendedor</th><th>Produto</th><th class="r">Qtd</th><th class="r">Valor venda</th><th class="r">%</th><th class="r">Desconto</th><th class="r">Valor pago</th><th>Liberação</th></tr>';
const totRel = (L, rot) => `<tr class="${rot ? 'sub' : 'tot'}"><td colspan="7">${esc(rot || 'TOTAL GERAL')} — ${nf(new Set(L.map(r => r.venda)).size)} vendas · ${nf(L.length)} itens</td><td class="r">${nf(soma(L, r => r.qtd))}</td><td class="r">${brl(soma(L, r => r.preco))}</td><td class="r">${pct(soma(L, r => r.desc), soma(L, r => r.preco))}</td><td class="r">${brl(soma(L, r => r.desc))}</td><td class="r">${brl(soma(L, r => r.pago))}</td><td></td></tr>`;
function relatorioLinhas(tit, idx, op = {}) {
  if (idx.length > 8000 && !confirm(`São ${nf(idx.length)} itens — o relatório fica muito grande para imprimir. Continuar? (Para a lista completa, prefira o Excel.)`)) return;
  const L = idx.map(i => DF.linha(A, i)).sort((a, b) => a.dataN - b.dataN || (a.venda < b.venda ? -1 : 1));
  let corpo = cardsRel(idx);
  if (op.ficha) {
    const {sit, f, p} = op.ficha;
    corpo += `<div class="cards"><div>Situação<b>${esc(DF.SIT[sit])}</b></div>${f ? `<div>Cadastro<b>${esc(f[1])}</b></div><div>CPF<b>${cpfF(f[2])}</b></div><div>Admissão<b>${dBR(f[4])}</b></div>` : ''}${p ? `<div class="${p.nivel === 'alto' ? 'bad' : 'warn'}">Risco<b>${p.nivel || '—'} (${p.pontos} pts)</b></div>` : ''}</div>` +
      (p && p.motivos.length ? `<div class="av"><b>Por que aponta:</b><ul>${p.motivos.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>` : '');
  }
  if (op.agrupar) {
    const g = new Map(); L.forEach(r => { if (!g.has(r.cliente)) g.set(r.cliente, []); g.get(r.cliente).push(r); });
    const gs = [...g.entries()].sort((a, b) => soma(b[1], r => r.desc) - soma(a[1], r => r.desc));
    corpo += `<table><thead>${cabRel}</thead><tbody>` + gs.map(([c, ls]) => `<tr class="gr"><td colspan="13">${esc(c)} — ${esc(ls[0].sitTxt)}${ls[0].cpf ? ' · CPF ' + cpfF(ls[0].cpf) : ''}</td></tr>${ls.map(linhaRel).join('')}${totRel(ls, 'Subtotal ' + c)}`).join('') +
      `${totRel(L)}</tbody></table>`;
  } else corpo += `<table><thead>${cabRel}</thead><tbody>${L.map(linhaRel).join('')}${totRel(L)}</tbody></table>`;
  imprimir(tit, subRel(), corpo);
}
function tabelaRelPessoas(lista) {
  return `<table><thead><tr><th>Risco</th><th>Quem recebeu</th><th>Situação</th><th class="r">Compras</th><th class="r">Pares</th><th class="r">Valor vendido</th><th class="r">Desconto</th><th class="c">Lojas</th><th>Por que aponta</th></tr></thead><tbody>
    ${lista.map(p => `<tr><td>${p.nivel || '—'} (${p.pontos})</td><td><b>${esc(p.nome)}</b>${p.s.sit === 'FUNC_PROV' ? `<br><i>cad.: ${esc(A.B.func[p.s.f][1])}</i>` : ''}</td><td>${esc(DF.SIT[p.s.sit])}</td><td class="r">${nf(p.vendas.size)}</td><td class="r">${nf(p.pares)}</td><td class="r">${brl(p.bruto)}</td><td class="r"><b>${brl(p.desc)}</b></td><td class="c">${p.lojas.size}</td><td>${p.motivos.length ? '<ul>' + p.motivos.map(m => `<li>${esc(m)}</li>`).join('') + '</ul>' : '—'}</td></tr>`).join('')}
    <tr class="tot"><td colspan="3">TOTAL — ${nf(lista.length)} pessoas</td><td class="r">${nf(soma(lista, p => p.vendas.size))}</td><td class="r">${nf(soma(lista, p => p.pares))}</td><td class="r">${brl(soma(lista, p => p.bruto))}</td><td class="r">${brl(soma(lista, p => p.desc))}</td><td></td><td></td></tr></tbody></table>`;
}
function relatorioPessoas(tit, lista) { lista = lista.slice().sort((a, b) => b.pontos - a.pontos || b.desc - a.desc); imprimir(tit, subRel(), tabelaRelPessoas(lista)); }
function tabelaRelGen(cols, L) {
  return `<table><thead><tr>${cols.map(c => `<th class="${c.cls || ''}">${esc(c.t)}</th>`).join('')}</tr></thead><tbody>${L.map(r => `<tr>${cols.map(c => `<td class="${c.cls || ''}">${c.h ? c.h(r) : esc(c.v(r))}</td>`).join('')}</tr>`).join('')}
    <tr class="tot">${cols.map((c, k) => `<td class="${c.cls || ''}">${k === 0 ? 'TOTAL (' + nf(L.length) + ')' : c.tot ? c.tot(L) : ''}</td>`).join('')}</tr></tbody></table>`.replace(/<span class="chip[^"]*">([^<]*)<\/span>/g, '$1');
}
function relatorioVendedores() { imprimir('Descontos por vendedor (quem concedeu)', subRel(), tabelaRelGen(colsVend, P.ven.slice().sort((a, b) => b.pontos - a.pontos || b.desc - a.desc))); }
function relatorioLojas() { imprimir('Descontos por loja', subRel(), tabelaRelGen(colsLoja, P.lojas.slice().sort((a, b) => lojaNum(a.nome) - lojaNum(b.nome)))); }
function relatorioFuncCli(L, cols) { imprimir('Clientes que são funcionários', subRel(), tabelaRelGen(cols, L.slice().sort((a, b) => b.x.com.size - a.x.com.size))); }
function relatorioExecutivo() {
  if (!A) return;
  const cards = K.map(k => `<div class="${k.cls === 'roxo' || k.cls === 'neu' ? '' : k.cls}">${esc(k.t)}<b>${k.n}</b>${esc(k.d)}</div>`).join('');
  const susp = P.susp.filter(p => p.nivel === 'alto').slice(0, 40);
  const vend = P.suspVend.slice(0, 25);
  imprimir('Relatório executivo — Descontos de Funcionários', subRel(),
    `<div class="cards">${cards}</div>
     <div class="av">Regras: limite de ${DF.LIMITE}% por item com tolerância de R$ 0,50; descontos de centavos sem percentual (arredondamento) desconsiderados (${nf(X.arred.n)} itens, ${brl(X.arred.v)}); campanha Meias (Meia Hoahi + calçado) separada. Funcionário identificado pelo nome no cadastro de Funcionários Ativos, aceitando erro de digitação e nome abreviado.</div>
     <h2>Pessoas com risco alto (${nf(P.susp.filter(p => p.nivel === 'alto').length)})</h2>${tabelaRelPessoas(susp)}
     <h2>Vendedores que concedem desconto a quem não é funcionário</h2>${tabelaRelGen(colsVend, vend)}
     <h2>Por loja</h2>${tabelaRelGen(colsLoja, P.lojas.slice().sort((a, b) => b.desc - a.desc))}`);
}

// ---------------- Excel ----------------
function baixarXLSX(nome, linhas) {
  const ws = XLSX.utils.json_to_sheet(linhas); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Dados');
  XLSX.writeFile(wb, (nome || 'descontos').replace(/[^\w\-À-ú ]+/g, '').slice(0, 80) + '.xlsx');
}
function excelLinhas(nome, idx) {
  const L = idx.map(i => DF.linha(A, i)).sort((a, b) => a.dataN - b.dataN);
  const out = L.map(r => ({'Data': r.data, 'Nº venda': r.venda, 'Loja': r.loja, 'Regional': X.lojaReg[A.B.col.loja[r.i]], 'Quem recebeu': r.cliente, 'Situação': r.sitTxt, 'Nome no cadastro': r.cadastro, 'CPF': cpfF(r.cpf), 'Admissão': r.admissao ? dBR(r.admissao) : '',
    'Vendedor': r.vendedor, 'Auto-venda': r.auto ? 'SIM' : '', 'Produto': r.produto, 'Qtd': r.qtd, 'Valor venda': r.preco, '%': r.pct, 'Desconto': r.desc, 'Acima do limite (R$)': r.excesso || '', 'Valor pago': r.pago,
    'Liberação': r.autorizador || 'NÃO INFORMADO', 'Classificação': r.catTxt, 'Antes da admissão': r.antesAdm ? 'SIM' : '', 'Obs': r.obs}));
  out.push({'Data': 'TOTAL', 'Nº venda': new Set(L.map(r => r.venda)).size + ' vendas', 'Qtd': soma(L, r => r.qtd), 'Valor venda': DF.r2(soma(L, r => r.preco)), 'Desconto': DF.r2(soma(L, r => r.desc)), 'Valor pago': DF.r2(soma(L, r => r.pago))});
  baixarXLSX(nome, out);
}
function excelLancamentos() { if (A) excelLinhas('descontos-lancamentos', F); }
function excelPessoas(nome, lista) {
  const out = lista.map(p => ({'Risco': p.nivel, 'Pontos': p.pontos, 'Quem recebeu': p.nome, 'Situação': DF.SIT[p.s.sit], 'Nome no cadastro': p.s.f >= 0 ? A.B.func[p.s.f][1] : '', 'CPF': p.s.f >= 0 && (p.s.sit === 'FUNC' || p.s.sit === 'FUNC_PROV') ? cpfF(A.B.func[p.s.f][2]) : '',
    'Compras': p.vendas.size, 'Pares/itens': p.pares, 'Valor vendido': DF.r2(p.bruto), 'Desconto': DF.r2(p.desc), 'Lojas': p.lojas.size, 'Auto-vendas': p.auto.size, 'Motivos': p.motivos.join(' | ')}));
  out.push({'Quem recebeu': 'TOTAL', 'Compras': soma(lista, p => p.vendas.size), 'Pares/itens': soma(lista, p => p.pares), 'Valor vendido': DF.r2(soma(lista, p => p.bruto)), 'Desconto': DF.r2(soma(lista, p => p.desc))});
  baixarXLSX(nome, out);
}
function excelGen(nome, cols, L) {
  const tira = s => String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const out = L.map(r => Object.fromEntries(cols.map(c => [c.t, typeof c.v(r) === 'number' ? DF.r2(c.v(r)) : tira(c.h ? c.h(r) : c.v(r))])));
  out.push(Object.fromEntries(cols.map((c, k) => [c.t, k === 0 ? 'TOTAL' : c.tot ? tira(c.tot(L)) : ''])));
  baixarXLSX(nome, out);
}
function excelVendedores() { excelGen('por-vendedor', colsVend, P.ven); }
function excelLojas() { excelGen('por-loja', colsLoja, P.lojas); }

// ---------------- relatórios (aba) ----------------
function telaRelatorios(el) {
  const R = [
    ['Relatório executivo', 'Cards, pessoas com risco alto, vendedores e lojas.', 'relatorioExecutivo()', null],
    ['Todos os lançamentos (agrupado por pessoa)', 'Data, nº da venda, loja, quem recebeu, vendedor, produto, valores e liberação — subtotal por pessoa.', "relatorioLinhas('Lançamentos com desconto',F,{agrupar:true})", 'excelLancamentos()'],
    ['Todos os funcionários — totalizado', 'Cada funcionário que recebeu desconto, com compras, pares, valor e desconto.', "relatorioPessoas('Funcionários — descontos recebidos',P.pes.filter(p=>p.vendas.size&&(p.s.sit==='FUNC'||p.s.sit==='FUNC_PROV')))", "excelPessoas('funcionarios',P.pes.filter(p=>p.vendas.size&&(p.s.sit==='FUNC'||p.s.sit==='FUNC_PROV')))"],
    ['Clientes que são funcionários', 'Funcionários que aparecem como clientes, com e sem desconto.', 'abrirFuncCli()', null],
    ['Desconto a quem não é funcionário', 'Detalhado por pessoa, com data e nº da venda.', "relatorioLinhas('Desconto a quem não é funcionário',F.filter(i=>A.cat[i]==='TERC'),{agrupar:true})", "excelLinhas('nao-funcionarios',F.filter(i=>A.cat[i]==='TERC'))"],
    ['Colaboradores fora do cadastro de ativos', 'Quem vende nas lojas e recebe desconto sem estar na lista de ativos.', "relatorioLinhas('Colaboradores fora do cadastro',F.filter(i=>A.cat[i]==='COLAB'),{agrupar:true})", "excelLinhas('fora-do-cadastro',F.filter(i=>A.cat[i]==='COLAB'))"],
    ['Acima do limite de 10%', 'Itens com desconto acima do limite (tolerância de R$ 0,50).', "relatorioLinhas('Acima do limite',F.filter(i=>A.excesso[i]>0),{agrupar:true})", "excelLinhas('acima-do-limite',F.filter(i=>A.excesso[i]>0))"],
    ['Auto-venda', 'Vendas em que o vendedor é quem recebeu o desconto.', "relatorioLinhas('Auto-venda',F.filter(i=>A.cat[i]!=='CAMP'&&(A.flags[i]&1)),{agrupar:true})", "excelLinhas('auto-venda',F.filter(i=>A.cat[i]!=='CAMP'&&(A.flags[i]&1)))"],
    ['Desconto antes da admissão', 'Compras com desconto antes da data de admissão.', "relatorioLinhas('Antes da admissão',F.filter(i=>A.cat[i]!=='CAMP'&&(A.flags[i]&2)),{agrupar:true})", "excelLinhas('antes-da-admissao',F.filter(i=>A.cat[i]!=='CAMP'&&(A.flags[i]&2)))"],
    ['Suspeitas (todas as pessoas pontuadas)', 'Risco, motivos e totais.', "relatorioPessoas('Suspeitas',P.susp)", "excelPessoas('suspeitas',P.susp)"],
    ['Por vendedor', 'Quem concedeu, para quantos não funcionários.', 'relatorioVendedores()', 'excelVendedores()'],
    ['Por loja', 'Desconto por loja e regional, separado por tipo.', 'relatorioLojas()', 'excelLojas()']
  ];
  el.innerHTML = `<h2>Relatórios — respeitam o período, a pesquisa e os filtros do topo</h2><div class="df-aviso ok" style="margin-top:0">${esc(subRel())}</div>
    <div class="df-cards" style="margin-top:12px">${R.map(r => `<div class="card"><b>${esc(r[0])}</b><div class="sub" style="margin:6px 0 10px">${esc(r[1])}</div><div class="df-acoes"><button class="btn pri" onclick="${r[2]}">🖨 Imprimir / PDF</button>${r[3] ? `<button class="btn" onclick="${r[3]}">⬇ Excel</button>` : ''}</div></div>`).join('')}</div>`;
}

// ---------------- carregar arquivos e enviar à nuvem ----------------
let NOVOS = {};
function telaCarregar(el) {
  const a = CARGA ? CARGA.arquivos || {} : {};
  el.innerHTML = `<h2>Carregar arquivos e enviar para a nuvem</h2>
    <div class="df-aviso ok" style="margin-top:0">Pode enviar os 3 arquivos juntos ou só o que mudou: o que não for enviado continua o da base atual da nuvem. Assim que o envio termina, <b>todos os usuários</b> passam a ver a base nova (a tela confere a nuvem a cada minuto).</div>
    <div class="df-up" id="up" tabindex="0">📂 <b>Arraste aqui</b> ou clique para escolher — Base de Descontos (.csv/.xlsx), Funcionários Ativos (.xlsx) e Regional (.xlsx). O tipo é reconhecido pelo conteúdo.<input type="file" id="upIn" multiple accept=".csv,.xlsx,.xls,.txt" class="hidden"></div>
    <div class="df-arqs">${['descontos', 'funcionarios', 'regional'].map(t => `<div><b>${{descontos: 'Base de Descontos', funcionarios: 'Funcionários Ativos', regional: 'Regional'}[t]}</b><div class="sub">${NOVOS[t] ? `<span class="vok">Novo: ${esc(NOVOS[t].nome)} · ${nf(NOVOS[t].dados.length)} linhas</span>` : a[t] ? 'Na nuvem: ' + esc(a[t].nome) + ' · ' + nf(a[t].linhas) + ' linhas' : '<span class="vwarn">Ainda não carregado</span>'}</div></div>`).join('')}</div>
    <div id="upMsg"></div>
    <div class="df-acoes" style="margin-top:12px"><button class="btn verde" id="btEnviar" ${Object.keys(NOVOS).length ? '' : 'disabled'} onclick="enviar()">☁ Enviar para a nuvem</button><button class="btn" onclick="NOVOS={};desenhar()">Limpar seleção</button></div>
    <div class="df-barra hidden" id="upBar"><span></span></div>
    <h2>Histórico de cargas</h2><div class="card" id="hist">Carregando…</div>`;
  const up = $('up'), inp = $('upIn');
  up.onclick = () => inp.click(); up.onkeydown = e => { if (e.key === 'Enter') inp.click(); };
  inp.onchange = () => lerArquivos(inp.files);
  up.ondragover = e => { e.preventDefault(); up.classList.add('drag'); }; up.ondragleave = () => up.classList.remove('drag');
  up.ondrop = e => { e.preventDefault(); up.classList.remove('drag'); lerArquivos(e.dataTransfer.files); };
  historico();
}
async function historico() {
  const r = await sb.from('cmpaud_cargas').select('id,criado_em,ativada_em,usuario,status,linhas,periodo_ini,periodo_fim,total_desconto,funcionarios,arquivos').order('id', {ascending: false}).limit(30);
  if (!$('hist')) return;
  if (r.error) { $('hist').textContent = 'Não foi possível ler o histórico: ' + r.error.message; return; }
  $('hist').innerHTML = `<div class="tw"><table><thead><tr><th>Enviada em</th><th>Por</th><th>Situação</th><th>Vendas de</th><th class="r">Itens</th><th class="r">Desconto</th><th class="r">Funcionários</th><th>Arquivos</th></tr></thead><tbody>${r.data.map(c => `<tr><td class="nw">${new Date(c.ativada_em || c.criado_em).toLocaleString('pt-BR')}</td><td>${esc(c.usuario || '—')}</td><td>${c.status === 'ativa' ? '<span class="chip ok">em uso</span>' : c.status === 'substituida' ? '<span class="chip">histórico</span>' : `<span class="chip warn">${esc(c.status)}</span>`}</td><td class="nw">${dBR(c.periodo_ini)} a ${dBR(c.periodo_fim)}</td><td class="r">${nf(c.linhas)}</td><td class="r">${brl(c.total_desconto)}</td><td class="r">${nf(c.funcionarios)}</td><td class="mut">${esc(Object.values(c.arquivos || {}).map(a => a.nome).join(' · '))}</td></tr>`).join('') || '<tr><td colspan="8" class="vazio">Nenhuma carga ainda</td></tr>'}</tbody></table></div>`;
}
async function lerLinhasDoArquivo(f) {
  const buf = await f.arrayBuffer();
  if (/\.(csv|txt)$/i.test(f.name)) {
    let txt; try { txt = new TextDecoder('utf-8', {fatal: true}).decode(buf); } catch (e) { txt = new TextDecoder('windows-1252').decode(buf); }
    return DF.csvParaLinhas(txt);
  }
  const wb = XLSX.read(buf, {type: 'array', cellDates: true});
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header: 1, raw: true, defval: ''});
}
async function lerArquivos(files) {
  const msg = [];
  for (const f of files) {
    try {
      const rows = await lerLinhasDoArquivo(f), t = DF.tipoDoArquivo(rows);
      if (!t) { msg.push(`<span class="vbad">${esc(f.name)}: não reconheci o arquivo (esperado: Base de Descontos, Funcionários Ativos ou Regional).</span>`); continue; }
      const dados = t === 'descontos' ? DF.lerDescontos(rows) : t === 'funcionarios' ? DF.lerFuncionarios(rows) : DF.lerRegional(rows);
      if (!dados.length) throw new Error('arquivo sem linhas');
      NOVOS[t] = {nome: f.name, dados, tam: f.size};
      msg.push(`<span class="vok">${esc(f.name)} → ${{descontos: 'Base de Descontos', funcionarios: 'Funcionários Ativos', regional: 'Regional'}[t]} (${nf(dados.length)} linhas)</span>`);
    } catch (e) { msg.push(`<span class="vbad">${esc(f.name)}: ${esc(e.message || e)}</span>`); }
  }
  desenhar(); $('upMsg').innerHTML = `<div class="df-aviso ${msg.some(m => m.includes('vbad')) ? 'warn' : 'ok'}">${msg.join('<br>')}</div>`;
  if (NOVOS.descontos) {
    const d = NOVOS.descontos.dados, mx = d.reduce((m, x) => x.data > m ? x.data : m, ''), mn = d.reduce((m, x) => x.data < m ? x.data : m, '9');
    const tot = soma(d, x => x.desc);
    $('upMsg').innerHTML += `<div class="df-aviso ok">Base de Descontos: vendas de <b>${dBR(mn)}</b> a <b>${dBR(mx)}</b> · desconto total <b>${brl(tot)}</b>${CARGA && iso2n(mx) < iso2n(CARGA.periodo_fim) ? ` · <span class="vbad">atenção: termina antes da base atual da nuvem (${dBR(CARGA.periodo_fim)})</span>` : ''}</div>`;
  }
}
function descDaBase(B) {
  const C = B.col, d = B.dic;
  return C.cod.map((cod, i) => ({loja: d.loja[C.loja[i]], cod, data: n2iso(C.data[i]), prod: d.prod[C.prod[i]], cli: d.cli[C.cli[i]], qtd: C.qtd[i], preco: C.preco[i], desc: C.desc[i], pct: C.pct[i], aut: d.aut[C.aut[i]], vend: d.vend[C.vend[i]], obs: d.obs[C.obs[i]]}));
}
async function enviar() {
  const bt = $('btEnviar'), bar = $('upBar'), sp = bar.querySelector('span');
  const atual = A ? A.B : null, arqAtual = CARGA ? CARGA.arquivos || {} : {};
  const desc = NOVOS.descontos ? NOVOS.descontos.dados : atual ? descDaBase(atual) : null;
  if (!desc) { toast('Carregue a Base de Descontos (a nuvem ainda não tem nenhuma).'); return; }
  const func = NOVOS.funcionarios ? NOVOS.funcionarios.dados : atual ? atual.func : [];
  const reg = NOVOS.regional ? NOVOS.regional.dados : atual ? atual.reg : [];
  if (!func.length && !confirm('Sem cadastro de Funcionários Ativos: todo desconto aparecerá como "não é funcionário". Enviar assim mesmo?')) return;
  const arquivos = {};
  for (const t of ['descontos', 'funcionarios', 'regional']) arquivos[t] = NOVOS[t] ? {nome: NOVOS[t].nome, linhas: NOVOS[t].dados.length, em: new Date().toISOString()} : arqAtual[t];
  for (const t in arquivos) if (!arquivos[t]) delete arquivos[t];
  bt.disabled = true; bar.classList.remove('hidden'); sp.style.width = '3%';
  let id = null;
  try {
    const B = DF.montarBase(desc.map(x => ({...x})), func, reg, arquivos);
    const An = DF.analisar(B);
    const b64 = bytesParaB64(await gzip(JSON.stringify(B)));
    const partes = []; for (let p = 0; p < b64.length; p += PARTE) partes.push(b64.slice(p, p + PARTE));
    const C = B.col; let tb = 0, td = 0; for (let i = 0; i < An.n; i++) { tb += C.preco[i]; td += C.desc[i]; }
    const ins = await sb.from('cmpaud_cargas').insert({partes: partes.length, bytes: b64.length, linhas: An.n, periodo_ini: n2iso(C.data[0]), periodo_fim: n2iso(C.data[An.n - 1]),
      total_desconto: DF.r2(td), total_venda: DF.r2(tb), funcionarios: func.length, arquivos, resumo: {formato: 'gzip-base64', versao: 1}}).select('id').single();
    if (ins.error) throw ins.error; id = ins.data.id;
    for (let k = 0; k < partes.length; k++) {
      let ok = false, erro;
      for (let t = 0; t < 4 && !ok; t++) { const r = await sb.from('cmpaud_cargas_partes').upsert({carga_id: id, parte: k, dados: partes[k]}); if (r.error) { erro = r.error; await new Promise(s => setTimeout(s, 1500 * (t + 1))); } else ok = true; }
      if (!ok) throw erro;
      sp.style.width = Math.round(5 + (k + 1) / partes.length * 85) + '%';
    }
    const at = await sb.rpc('cmpaud_ativar_carga', {p_id: id}); if (at.error) throw at.error;
    sp.style.width = '100%';
    NOVOS = {}; CARGA = null;
    await recarregarNuvem(false);
    toast('✅ Base enviada para a nuvem. Todos os usuários já veem a versão nova.', 7000);
    abrirAba('painel');
  } catch (e) {
    console.error(e);
    if (id) await sb.from('cmpaud_cargas').update({status: 'falhou'}).eq('id', id);
    $('upMsg').innerHTML = `<div class="df-aviso bad">Falha ao enviar para a nuvem: ${esc(e.message || e)}. Nada foi trocado — a base anterior continua valendo. Tente de novo.</div>`;
    bt.disabled = false;
  }
}

iniciar();
