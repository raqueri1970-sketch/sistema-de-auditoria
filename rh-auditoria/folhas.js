// ===================================================================
// FOLHAS MULTI-COMPETÊNCIA — importação de vários arquivos de folha,
// histórico, comparativo, anomalias e previsões.
// Fonte: planilhas "FOLHA MM-AAAA.xlsx" (aba Sheet1: uma linha por
// rubrica por funcionário). Totais: 2001 = Total Proventos (bruto),
// 2002 = Total Descontos, 2004 = Salário Contratual; líquido = 2001 − 2002
// (mesma regra usada na auditoria completa da competência 06/2026).
// Armazenamento: tabela rh_folhas_competencias no Supabase (RLS portal_pode('rh')),
// compartilhada entre todos os usuários com acesso de RH. CPF vai mascarado
// (•••.•••.XXX-YY#código, mesmo formato do módulo Faltas e Atrasos).
// Se a gravação na nuvem falhar (sem internet/sem acesso), a folha fica
// pendente neste navegador (IndexedDB) e é enviada na próxima abertura.
// ===================================================================
const FOLHAS_NUVEM = {}, FOLHAS_LOCAL = {};
let FOLHAS = {}, FOLHAS_RESUMO = {}, FOLHAS_READY = false, FOLHAS_ERRO = '', NUVEM_OK = false;
let FOLHA_SEL = null, FOLHA_BUSCA = '';
const FX = {nome:0,cpf:1,sit:2,cc:3,cct:4,cargo:5,adm:6,desl:7,b:8,ds:9,sal:10,rub:11};

function compKey(c){
  const m = String(c||'').match(/^(\d{1,2})\/(\d{2,4})(?:-(\d+))?/);
  if(!m) return 0;
  let a = +m[2]; if(a < 100) a += 2000;
  return a*1000 + (+m[1])*10 + (+(m[3]||1));
}
function compLabel(c){
  const m = String(c||'').match(/^(\d{1,2})\/(\d{2,4})(?:-(\d+))?/);
  if(!m) return String(c||'—');
  let a = +m[2]; if(a < 100) a += 2000;
  const seq = +(m[3]||1);
  return String(m[1]).padStart(2,'0') + '/' + a + (seq > 1 ? ' (compl. ' + seq + ')' : '');
}
function folhasOrdenadas(){ return Object.values(FOLHAS).sort((a,b)=>compKey(a.comp)-compKey(b.comp)); }
function folhaAnterior(comp){
  const L = folhasOrdenadas(); const i = L.findIndex(x=>x.comp===comp);
  return i > 0 ? L[i-1] : null;
}
function mesclarFolhas(){
  FOLHAS = Object.assign({}, FOLHAS_NUVEM, FOLHAS_LOCAL);
  FOLHAS_RESUMO = {};
  const L = folhasOrdenadas();
  if(!FOLHA_SEL || !FOLHAS[FOLHA_SEL]) FOLHA_SEL = L.length ? L[L.length-1].comp : null;
}

// ---------- gzip + base64 ----------
async function gzipB64(obj){
  if(typeof CompressionStream === 'undefined') throw new Error('Navegador sem suporte a CompressionStream — atualize o navegador.');
  const buf = new Uint8Array(await new Response(new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let s = ''; for(let i=0;i<buf.length;i+=0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i+0x8000));
  return btoa(s);
}
async function gunzipB64(b64){
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) u[i] = bin.charCodeAt(i);
  if(typeof DecompressionStream === 'undefined') throw new Error('Navegador sem suporte a DecompressionStream — atualize o navegador.');
  const txt = await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return JSON.parse(txt);
}

// ---------- IndexedDB (folhas pendentes de envio para a nuvem) ----------
const FDB_NAME = 'esposende_rh_folhas', FDB_STORE = 'competencias';
function fdbOpen(){
  return new Promise((res,rej)=>{
    try{
      if(!window.indexedDB) return rej(new Error('IndexedDB indisponível'));
      const r = indexedDB.open(FDB_NAME, 1);
      r.onupgradeneeded = ()=>{ if(!r.result.objectStoreNames.contains(FDB_STORE)) r.result.createObjectStore(FDB_STORE,{keyPath:'comp'}); };
      r.onsuccess = ()=>res(r.result);
      r.onerror = ()=>rej(r.error);
    }catch(e){ rej(e); }
  });
}
async function fdbTx(mode, fn){
  const db = await fdbOpen();
  return new Promise((res,rej)=>{
    const tx = db.transaction(FDB_STORE, mode), st = tx.objectStore(FDB_STORE);
    const r = fn(st);
    tx.oncomplete = ()=>{ db.close(); res(r && 'result' in r ? r.result : undefined); };
    tx.onerror = ()=>{ db.close(); rej(tx.error); };
    tx.onabort = ()=>{ db.close(); rej(tx.error || new Error('Gravação cancelada (espaço insuficiente?)')); };
  });
}
const fdbAll = ()=>fdbTx('readonly', st=>st.getAll());
const fdbPut = obj=>fdbTx('readwrite', st=>st.put(obj));
const fdbDel = comp=>fdbTx('readwrite', st=>st.delete(comp));

// ---------- nuvem (Supabase: rh_folhas_competencias) ----------
function faHash53(str){let h1=0xdeadbeef,h2=0x41c6ce57;for(let i=0;i<str.length;i++){const c=str.charCodeAt(i);h1=Math.imul(h1^c,2654435761);h2=Math.imul(h2^c,1597334677)}h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);return (4294967296*(2097151&h2)+(h1>>>0)).toString(36)}
function cpfMascarado(v){ const s=String(v||''); if(!s || s.includes('#')) return s; const d=s.replace(/\D/g,''); if(!d) return ''; const c=d.padStart(11,'0').slice(-11); return '•••.•••.'+c.slice(6,9)+'-'+c.slice(9)+'#'+faHash53('esp:'+c); }
function cpfTela(v){ return String(v||'').split('#')[0] || '—'; }
function msgErroNuvem(e){
  const m = String(e && (e.message||e.msg||e.code) || e || '');
  if(/42501|permission|JWT|401|403|row-level/i.test(m + ' ' + (e&&e.code||''))) return 'sem acesso de RH na nuvem — entre no Portal com um usuário que tenha acesso de RH';
  if(/Failed to fetch|NetworkError|network/i.test(m)) return 'sem conexão com a nuvem';
  return m || 'erro desconhecido';
}
async function nuvemListar(){
  if(typeof sb === 'undefined' || !sb) throw new Error('Supabase indisponível');
  const {data, error} = await sb.from('rh_folhas_competencias')
    .select('competencia,arquivo,linhas,enviado_em,enviado_por_email,dados_gz').order('ordem');
  if(error) throw error;
  const out = [];
  for(const r of data||[]){
    const d = await gunzipB64(r.dados_gz);
    out.push({comp:r.competencia, arquivo:r.arquivo, linhas:r.linhas, origem:'nuvem', importado_em:r.enviado_em, enviado_por:r.enviado_por_email||'', cat:d.cat||{}, f:d.f||{}});
  }
  return out;
}
async function nuvemGravar(C){
  if(typeof sb === 'undefined' || !sb) throw new Error('Supabase indisponível');
  const f = {}; let b = 0, ds = 0;
  for(const [m,e] of Object.entries(C.f)){ const x = e.slice(); x[FX.cpf] = cpfMascarado(x[FX.cpf]); f[m] = x; b += +x[FX.b]||0; ds += +x[FX.ds]||0; }
  const row = {tenant_id:'esposende', competencia:C.comp, ordem:compKey(C.comp), arquivo:C.arquivo, linhas:C.linhas,
    funcionarios:Object.keys(f).length, bruto:Math.round(b*100)/100, descontos:Math.round(ds*100)/100,
    dados_gz: await gzipB64({comp:C.comp, arquivo:C.arquivo, linhas:C.linhas, cat:C.cat, f})};
  const {data, error} = await sb.from('rh_folhas_competencias').upsert(row, {onConflict:'tenant_id,competencia'}).select('enviado_em,enviado_por_email').single();
  if(error) throw error;
  return {comp:C.comp, arquivo:C.arquivo, linhas:C.linhas, origem:'nuvem', importado_em:data&&data.enviado_em||new Date().toISOString(), enviado_por:data&&data.enviado_por_email||'', cat:C.cat, f};
}
async function nuvemApagar(comp){
  const {error} = await sb.from('rh_folhas_competencias').delete().eq('tenant_id','esposende').eq('competencia', comp);
  if(error) throw error;
}
async function enviarPendentes(silencioso){
  const pend = Object.values(FOLHAS_LOCAL); if(!pend.length) return 0;
  let ok = 0;
  for(const C of pend){
    try{
      const N = await nuvemGravar(C);
      FOLHAS_NUVEM[C.comp] = N; delete FOLHAS_LOCAL[C.comp]; ok++;
      try{ await fdbDel(C.comp); }catch(e){}
      logImport(`☁️ ${esc(compLabel(C.comp))} enviada para a nuvem (estava pendente neste navegador) — agora todos com acesso de RH veem.`, 'ok');
    }catch(e){ if(!silencioso) logImport(`⚠️ ${esc(compLabel(C.comp))} continua só neste navegador: ${esc(msgErroNuvem(e))}.`, 'warn'); }
  }
  if(ok){ mesclarFolhas(); renderFolhasTudo(); }
  return ok;
}
async function carregarFolhas(){
  FOLHAS_ERRO = '';
  try{ (await nuvemListar()).forEach(c=>{ FOLHAS_NUVEM[c.comp] = c; }); NUVEM_OK = true; }
  catch(e){ NUVEM_OK = false; FOLHAS_ERRO = 'Não foi possível ler as folhas da nuvem: ' + msgErroNuvem(e) + '.'; console.warn(e); }
  try{ (await fdbAll() || []).forEach(c=>{ c.origem = 'local'; FOLHAS_LOCAL[c.comp] = c; }); }
  catch(e){ console.warn('IndexedDB:', e); }
  mesclarFolhas();
  FOLHAS_READY = true;
  renderFolhasTudo();
  if(NUVEM_OK && Object.keys(FOLHAS_LOCAL).length) enviarPendentes(false);
}
async function recarregarDaNuvem(){
  for(const k of Object.keys(FOLHAS_NUVEM)) delete FOLHAS_NUVEM[k];
  FOLHAS_READY = false; renderFolhasTudo();
  await carregarFolhas();
  logImport(NUVEM_OK ? `↻ ${Object.keys(FOLHAS_NUVEM).length} competência(s) lidas da nuvem.` : '❌ ' + esc(FOLHAS_ERRO), NUVEM_OK ? 'ok' : 'err');
}

// ---------- resumo por competência (memoizado) ----------
function ehHoraExtra(titulo){ return /hora[s]?\s*extra|\bh\.?\s?e\.?\b|\bhe\s?\d|extra\s*\d{2,3}\s*%/i.test(titulo||''); }
function resumoFolha(comp){
  if(FOLHAS_RESUMO[comp]) return FOLHAS_RESUMO[comp];
  const c = FOLHAS[comp]; if(!c) return null;
  const r = {comp, arquivo:c.arquivo, linhas:c.linhas, origem:c.origem, importado_em:c.importado_em,
    n:0, ativos:0, desligados:0, afastados:0, bruto:0, desc:0, liq:0, he:0, lojas:{}, rub:{}};
  const cat = c.cat || {};
  for(const [mat, e] of Object.entries(c.f||{})){
    r.n++;
    const sit = e[FX.sit] || '';
    if(sit === 'Desligado') r.desligados++; else r.ativos++;
    if(sit && sit !== 'Ativo' && sit !== 'Desligado') r.afastados++;
    const b = +e[FX.b]||0, ds = +e[FX.ds]||0;
    r.bruto += b; r.desc += ds;
    const cc = e[FX.cc] || '—';
    const L = r.lojas[cc] || (r.lojas[cc] = {cc, titulo:e[FX.cct]||cc, hc:0, ativos:0, b:0, ds:0, liq:0, he:0});
    L.hc++; if(sit !== 'Desligado') L.ativos++;
    L.b += b; L.ds += ds; L.liq += b-ds;
    for(const [cod, v] of Object.entries(e[FX.rub]||{})){
      const meta = cat[cod] || ['Rubrica '+cod, ''];
      const R = r.rub[cod] || (r.rub[cod] = {cod, titulo:meta[0], tipo:meta[1], v:0, n:0});
      R.v += v; R.n++;
      if(meta[1] === 'Provento' && ehHoraExtra(meta[0])){ r.he += v; L.he += v; }
    }
  }
  r.liq = r.bruto - r.desc;
  r.custo_medio = r.ativos ? r.bruto / r.ativos : 0;
  return (FOLHAS_RESUMO[comp] = r);
}
function auditoriaDaComp(comp){
  return (D && D.historico_competencias || []).find(h=>h.competencia===comp) || null;
}

// ---------- leitura de arquivos XLSX no navegador ----------
function ensureXLSX(){
  if(window.XLSX) return Promise.resolve();
  return new Promise((res,rej)=>{
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = ()=>res(); s.onerror = ()=>rej(new Error('Não foi possível carregar o leitor de Excel (verifique a internet).'));
    document.head.appendChild(s);
  });
}
const nh = v=>norm(v).replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
function txt(v){ if(v===null||v===undefined) return ''; if(typeof v==='number' && Number.isInteger(v)) return String(v); return String(v).trim(); }
function num(v){ if(typeof v==='number') return v; const s=txt(v); if(!s) return 0; const x=Number(s.includes(',')?s.replace(/\./g,'').replace(',','.'):s); return isFinite(x)?x:0; }
function dataISO(v){
  if(v instanceof Date && !isNaN(v)) { const d=new Date(v.getTime()+12*3600e3); return d.toISOString().slice(0,10); }
  if(typeof v==='number' && v>20000 && v<80000){ const d=new Date(Date.UTC(1899,11,30)+v*864e5); return d.toISOString().slice(0,10); }
  const s = txt(v); if(!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); if(m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s.slice(0,10);
}
const COLS = {comp:'mes_ano_folha', mat:'codigo', nome:'nome', cpf:'cpf', sit:'situacao_usual', cc:'ccusto', cct:'ccusto_titulo',
  cargo:'cargo_titulo', adm:'data_de_admissao', desl:'data_desligament', vcod:'verba_codigo', vtit:'verba_titulo', vtipo:'verba_tipo', vval:'verba_valor'};
function escolherAba(wb){
  let melhor = null;
  for(const nome of wb.SheetNames){
    const ws = wb.Sheets[nome];
    const rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:null, blankrows:false, sheetRows:1});
    const h = (rows[0]||[]).map(nh);
    if(!(h.includes('verba_codigo') && h.includes('codigo') && h.includes('verba_valor'))) continue;
    if(nome.toLowerCase() === 'sheet1') return nome;
    const nn = nh(nome);
    if(nn.includes('liquido') || nn.includes('consig') || nn.includes('pix')) continue;
    const ref = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : {e:{r:0}};
    if(!melhor || ref.e.r > melhor.r) melhor = {nome, r:ref.e.r};
  }
  return melhor ? melhor.nome : null;
}
function compDoNomeArquivo(nome){
  const m = String(nome).match(/(\d{1,2})[-_. ](20\d{2})/);
  return m ? String(m[1]).padStart(2,'0') + '/' + m[2].slice(2) + '-1' : '';
}
async function lerArquivoFolha(file){
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, {type:'array', cellDates:true, dense:true});
  const aba = escolherAba(wb);
  if(!aba) throw new Error('Não encontrei a aba da folha (precisa ter as colunas Código, Verba_Código e Verba_Valor).');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[aba], {header:1, raw:true, defval:null, blankrows:false});
  const h = (rows[0]||[]).map(nh), ix = {};
  for(const [k,col] of Object.entries(COLS)) ix[k] = h.indexOf(col);
  const faltam = ['mat','vcod','vval'].filter(k=>ix[k]<0);
  if(faltam.length) throw new Error('Colunas obrigatórias ausentes: ' + faltam.map(k=>COLS[k]).join(', '));
  const compArq = compDoNomeArquivo(file.name);
  const out = {}, g = (r,k)=> ix[k]>=0 ? r[ix[k]] : null;
  for(let i=1;i<rows.length;i++){
    const r = rows[i]; if(!r) continue;
    const mat = txt(g(r,'mat')); if(!mat) continue;
    const comp = txt(g(r,'comp')) || compArq;
    if(!comp) throw new Error('Linha '+(i+1)+': competência vazia (coluna Mês_Ano Folha) e o nome do arquivo não tem MM-AAAA.');
    const C = out[comp] || (out[comp] = {comp, arquivo:file.name, linhas:0, origem:'local', importado_em:new Date().toISOString(), cat:{}, f:{}});
    C.linhas++;
    let e = C.f[mat];
    if(!e){
      const cpf = txt(g(r,'cpf')).replace(/\D/g,'');
      e = C.f[mat] = [txt(g(r,'nome')), cpf ? cpf.padStart(11,'0') : '', txt(g(r,'sit')), (txt(g(r,'cc'))||'—').padStart(4,'0'), txt(g(r,'cct')),
        txt(g(r,'cargo')), dataISO(g(r,'adm')), dataISO(g(r,'desl')), 0, 0, 0, {}];
    }
    const cod = txt(g(r,'vcod')).padStart(4,'0'), v = num(g(r,'vval')), tipo = txt(g(r,'vtipo'));
    if(cod === '2001') e[FX.b] += v;
    else if(cod === '2002') e[FX.ds] += v;
    else if(cod === '2004') e[FX.sal] = v;
    if(tipo === 'Provento' || tipo === 'Desconto'){
      if(v) e[FX.rub][cod] = Math.round(((e[FX.rub][cod]||0) + v)*100)/100;
      C.cat[cod] = [txt(g(r,'vtit')), tipo];
    }
  }
  for(const C of Object.values(out)) for(const e of Object.values(C.f)){ e[FX.b]=Math.round(e[FX.b]*100)/100; e[FX.ds]=Math.round(e[FX.ds]*100)/100; }
  return {aba, competencias:Object.values(out)};
}

let IMPORT_LOG = [];
function logImport(msg, tipo){ IMPORT_LOG.unshift({quando:new Date().toLocaleTimeString('pt-BR'), msg, tipo:tipo||'info'}); renderImportLog(); }
function renderImportLog(){
  const el = document.getElementById('imp-log'); if(!el) return;
  el.innerHTML = IMPORT_LOG.length ? IMPORT_LOG.map(l=>`<div class="imp-log-l ${l.tipo}"><span>${esc(l.quando)}</span> ${l.msg}</div>`).join('') : '';
}
async function importarArquivosFolha(fileList){
  const files = [...(fileList||[])].filter(f=>/\.(xlsx|xlsm|xls)$/i.test(f.name));
  const ignorados = [...(fileList||[])].length - files.length;
  if(ignorados) logImport(`${ignorados} arquivo(s) ignorado(s): apenas planilhas Excel (.xlsx/.xls) de folha.`, 'warn');
  if(!files.length) return;
  const btn = document.getElementById('imp-btn'); if(btn) btn.disabled = true;
  try{ await ensureXLSX(); }catch(e){ logImport('❌ ' + esc(e.message), 'err'); if(btn) btn.disabled=false; return; }
  let ok = 0;
  files.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR',{numeric:true}));
  for(const f of files){
    logImport(`⏳ Lendo <b>${esc(f.name)}</b> (${(f.size/1048576).toFixed(1)} MB)…`);
    await new Promise(r=>setTimeout(r,30));
    try{
      const t0 = performance.now();
      const res = await lerArquivoFolha(f);
      if(!res.competencias.length) throw new Error('Nenhuma linha de funcionário encontrada.');
      for(const C of res.competencias){
        const substitui = FOLHAS[C.comp] ? ' (substituiu a versão anterior)' : '';
        let onde;
        try{
          const N = await nuvemGravar(C);
          FOLHAS_NUVEM[C.comp] = N; delete FOLHAS_LOCAL[C.comp]; NUVEM_OK = true;
          try{ await fdbDel(C.comp); }catch(e){}
          onde = '☁️ gravada na nuvem — todos com acesso de RH já veem';
        }catch(e){
          console.warn(e);
          FOLHAS_LOCAL[C.comp] = C;
          try{ await fdbPut(C); onde = `⚠️ NÃO foi para a nuvem (${esc(msgErroNuvem(e))}) — ficou pendente neste navegador e será enviada na próxima abertura`; }
          catch(e2){ onde = `⚠️ NÃO foi para a nuvem (${esc(msgErroNuvem(e))}) nem pôde ser salva no navegador — vale só até fechar a página`; }
        }
        const nf = Object.keys(C.f).length;
        let b=0, ds=0; Object.values(C.f).forEach(e=>{b+=e[FX.b]; ds+=e[FX.ds];});
        const naNuvem = !!FOLHAS_NUVEM[C.comp] && !FOLHAS_LOCAL[C.comp];
        logImport(`${naNuvem?'✅':'⚠️'} <b>${esc(compLabel(C.comp))}</b> — ${esc(f.name)} · aba "${esc(res.aba)}" · ${fmtN(C.linhas)} linhas · ${fmtN(nf)} funcionários · bruto ${fmtR(b)} · líquido ${fmtR(b-ds)}${substitui} · ${((performance.now()-t0)/1000).toFixed(1)}s<br>${onde}`, naNuvem?'ok':'warn');
        try{ appendAuditLog('IMPORTAÇÃO DE FOLHA', `${compLabel(C.comp)} — ${f.name}: ${C.linhas} linhas, ${nf} funcionários, bruto ${fmtR(b)}`); }catch(e){}
        FOLHA_SEL = C.comp; ok++;
      }
    }catch(e){
      console.error(e);
      logImport(`❌ <b>${esc(f.name)}</b>: ${esc(e.message||e)}`, 'err');
    }
  }
  mesclarFolhas();
  const L = folhasOrdenadas(); if(L.length) FOLHA_SEL = L[L.length-1].comp;
  renderFolhasTudo();
  if(btn) btn.disabled = false;
  if(ok) logImport(`🎯 ${ok} competência(s) atualizada(s). Histórico, Comparativo, Anomalias e Previsões já foram recalculados.`, 'ok');
}
async function removerFolhaImportada(comp){
  const local = !!FOLHAS_LOCAL[comp];
  if(!confirm(local ? `Descartar a folha ${compLabel(comp)} que está pendente neste navegador (não foi para a nuvem)?`
                    : `Apagar a folha ${compLabel(comp)} da nuvem? Ela some para TODOS os usuários (dá para importar de novo depois).`)) return;
  try{
    if(local){ try{ await fdbDel(comp); }catch(e){} delete FOLHAS_LOCAL[comp]; }
    else { await nuvemApagar(comp); delete FOLHAS_NUVEM[comp]; }
    try{ appendAuditLog(local?'DESCARTE DE FOLHA PENDENTE':'EXCLUSÃO DE FOLHA DA NUVEM', compLabel(comp)); }catch(e){}
    logImport(`🗑 ${esc(compLabel(comp))} ${local?'descartada deste navegador':'apagada da nuvem'}.`, 'ok');
  }catch(e){ logImport(`❌ Não foi possível apagar ${esc(compLabel(comp))}: ${esc(msgErroNuvem(e))}.`, 'err'); }
  mesclarFolhas(); renderFolhasTudo();
}
function initImportDrop(){
  const dz = document.getElementById('imp-drop'), inp = document.getElementById('imp-file');
  if(!dz || dz.dataset.ok) return; dz.dataset.ok = '1';
  dz.addEventListener('click', ()=>inp.click());
  dz.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); inp.click(); } });
  ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e=>importarArquivosFolha(e.dataTransfer.files));
  inp.addEventListener('change', ()=>{ importarArquivosFolha(inp.files); inp.value=''; });
}

// ---------- helpers de UI ----------
function deltaCell(a, b, fmt, pior){ // pior: 'alta' (aumento é ruim), 'baixa' ou null
  if(a===null||a===undefined) return '<td class="num" style="color:var(--muted)">—</td><td class="num" style="color:var(--muted)">—</td>';
  const d = b - a, pct = a ? d/Math.abs(a)*100 : (b ? 100 : 0);
  const cor = !d || !pior ? 'var(--ink2)' : ((d>0) === (pior==='alta') ? 'var(--serious)' : 'var(--good)');
  return `<td class="num" style="color:${cor}">${d>0?'+':''}${fmt(d)}</td><td class="num" style="color:${cor}">${d>0?'+':''}${pct.toFixed(1)}%</td>`;
}
function selectComp(id, valor, onchange){
  return `<select id="${id}" class="dash-btn" onchange="${onchange}">${folhasOrdenadas().slice().reverse().map(c=>`<option value="${esc(c.comp)}" ${c.comp===valor?'selected':''}>${esc(compLabel(c.comp))}${c.origem==='local'?' · só neste navegador':''}</option>`).join('')}</select>`;
}
function semFolhas(el, msg){
  el.innerHTML = `<div class="muted-box"><b>${FOLHAS_READY ? 'Nenhuma folha carregada' : 'Lendo as folhas da nuvem…'}</b><br>${FOLHAS_ERRO?esc(FOLHAS_ERRO)+'<br>':''}${msg||''}
    <div style="margin-top:10px"><button class="dash-btn" onclick="gotoPage('pg-importar')">📥 Importar folhas</button></div></div>`;
}
function svgBarras(series, campos){ // series: [{label, valores:{campo:valor}}], campos: [{k, lbl, cor}]
  const W = 900, H = 230, pl = 64, pb = 26, pt = 10;
  const max = Math.max(1, ...series.flatMap(s=>campos.map(c=>s.valores[c.k]||0)));
  const gw = (W-pl-10)/Math.max(series.length,1), bw = Math.min(26, (gw-10)/campos.length);
  const y = v=>pt + (H-pt-pb)*(1 - v/max);
  let g = '';
  for(let i=0;i<=4;i++){ const v=max*i/4, yy=y(v); g += `<line x1="${pl}" x2="${W-10}" y1="${yy}" y2="${yy}" stroke="var(--grid)" stroke-width="1"/><text x="${pl-6}" y="${yy+4}" text-anchor="end" font-size="10" fill="var(--muted)">${v>=1e6?(v/1e6).toFixed(1)+' mi':v>=1e3?(v/1e3).toFixed(0)+' mil':Math.round(v)}</text>`; }
  series.forEach((s,i)=>{
    const x0 = pl + i*gw + (gw - bw*campos.length)/2;
    campos.forEach((c,j)=>{ const v=s.valores[c.k]||0, yy=y(v); g += `<rect x="${x0+j*bw}" y="${yy}" width="${bw-2}" height="${Math.max(0,H-pb-yy)}" rx="2" fill="${c.cor}"><title>${esc(s.label)} · ${esc(c.lbl)}: ${fmtR(v)}</title></rect>`; });
    g += `<text x="${pl+i*gw+gw/2}" y="${H-8}" text-anchor="middle" font-size="10.5" fill="var(--ink2)">${esc(s.label)}</text>`;
  });
  const leg = campos.map(c=>`<span style="display:inline-flex;align-items:center;gap:6px;margin-right:14px;font-size:12px;color:var(--ink2)"><span style="width:10px;height:10px;border-radius:2px;background:${c.cor}"></span>${esc(c.lbl)}</span>`).join('');
  return `<div style="margin-bottom:6px">${leg}</div><svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="Evolução por competência">${g}</svg>`;
}

function etiquetaOrigem(c){
  const quando = c.importado_em ? new Date(c.importado_em).toLocaleString('pt-BR') : '';
  return c.origem === 'local'
    ? `<span class="badge atencao">Só neste navegador · pendente de envio</span>`
    : `<span class="badge ok">☁️ Nuvem · ${esc(quando)}${c.enviado_por?' · '+esc(c.enviado_por):''}</span>`;
}
function renderStatusNuvem(){
  const el = document.getElementById('imp-nuvem'); if(!el) return;
  const pend = Object.keys(FOLHAS_LOCAL).length;
  el.innerHTML = !FOLHAS_READY ? '<div class="muted-box">☁️ Lendo as folhas da nuvem…</div>'
    : NUVEM_OK ? `<div class="resultado-banner ok" style="font-size:13.5px">☁️ Conectado à nuvem — ${Object.keys(FOLHAS_NUVEM).length} competência(s) compartilhadas com todos os usuários de RH. Folha importada aqui é gravada na nuvem (CPF mascarado).${pend?` · ${pend} pendente(s) neste navegador <button class="dash-btn" style="padding:4px 10px;margin-left:6px" onclick="enviarPendentes(false)">Enviar agora</button>`:''} <button class="dash-btn" style="padding:4px 10px;margin-left:6px" onclick="recarregarDaNuvem()">↻ Buscar atualização</button></div>`
    : `<div class="resultado-banner crit" style="font-size:13.5px">⚠️ ${esc(FOLHAS_ERRO||'Sem conexão com a nuvem.')} Folhas importadas agora ficam só neste navegador até a conexão voltar. <button class="dash-btn" style="padding:4px 10px;margin-left:6px" onclick="recarregarDaNuvem()">↻ Tentar de novo</button></div>`;
}

// ---------- página: Importar Folhas ----------
function renderImportar(){
  const el = document.getElementById('imp-lista'); if(!el) return;
  initImportDrop(); renderStatusNuvem();
  const L = folhasOrdenadas();
  if(!L.length){ semFolhas(el); return; }
  el.innerHTML = `<div class="tablewrap"><table>
    <thead><tr><th>Competência</th><th>Arquivo</th><th>Origem</th><th class="num">Linhas</th><th class="num">Funcionários</th><th class="num">Folha bruta</th><th class="num">Folha líquida</th><th></th></tr></thead>
    <tbody>${L.slice().reverse().map(c=>{ const r=resumoFolha(c.comp); return `<tr>
      <td class="mono"><b>${esc(compLabel(c.comp))}</b></td><td>${esc(c.arquivo)}</td>
      <td>${etiquetaOrigem(c)}</td>
      <td class="num">${fmtN(c.linhas)}</td><td class="num">${fmtN(r.n)}</td><td class="num">${fmtR(r.bruto)}</td><td class="num">${fmtR(r.liq)}</td>
      <td style="white-space:nowrap"><button class="dash-btn" style="padding:6px 10px" onclick="FOLHA_SEL='${esc(c.comp)}';renderFolhaComp();gotoPage('pg-folhas')">Abrir</button>
      <button class="dash-btn" style="padding:6px 10px" onclick="removerFolhaImportada('${esc(c.comp)}')" title="${c.origem==='local'?'Descartar deste navegador':'Apagar da nuvem (para todos)'}">🗑</button></td></tr>`; }).join('')}</tbody></table></div>`;
}

// ---------- página: Folhas por Competência ----------
function renderFolhaComp(){
  const el = document.getElementById('folhas-content'); if(!el) return;
  if(!FOLHA_SEL){ semFolhas(el); return; }
  const r = resumoFolha(FOLHA_SEL), ant = folhaAnterior(FOLHA_SEL), ra = ant ? resumoFolha(ant.comp) : null;
  const c = FOLHAS[FOLHA_SEL];
  const kp = (lbl, v, va, fmt, pior)=>{ let d=''; if(ra){ const dif=v-va, p=va?dif/Math.abs(va)*100:0; const cor=!dif||!pior?'var(--ink2)':((dif>0)===(pior==='alta')?'var(--serious)':'var(--good)'); d=`<div class="sub" style="color:${cor}">${dif>0?'▲':dif<0?'▼':'='} ${fmt(Math.abs(dif))} (${p>0?'+':''}${p.toFixed(1)}%) vs ${esc(compLabel(ant.comp))}</div>`; } return `<div class="gov-card"><div class="lbl">${lbl}</div><div class="val" style="font-size:22px">${fmt(v)}</div>${d}</div>`; };
  // movimentação e variações
  let mov = '', varRows = [], reaj = [], transf = [];
  if(ra){
    const fa = ant.f, fc = c.f;
    const entr = Object.keys(fc).filter(m=>!fa[m]), sai = Object.keys(fa).filter(m=>!fc[m]);
    const desl = Object.entries(fc).filter(([m,e])=>e[FX.sit]==='Desligado' && (!fa[m] || fa[m][FX.sit]!=='Desligado'));
    for(const [m,e] of Object.entries(fc)){
      const p = fa[m]; if(!p) continue;
      const lc = e[FX.b]-e[FX.ds], lp = p[FX.b]-p[FX.ds], dif = lc-lp;
      if(Math.abs(dif) >= 500 && Math.abs(dif) >= Math.abs(lp)*0.3 && e[FX.sit]!=='Desligado') varRows.push({m, e, lp, lc, dif});
      if(p[FX.sal] && e[FX.sal] && Math.abs(e[FX.sal]-p[FX.sal]) > 0.01) reaj.push({m, e, de:p[FX.sal], para:e[FX.sal]});
      if(p[FX.cc] !== e[FX.cc]) transf.push({m, e, de:p[FX.cct]||p[FX.cc], para:e[FX.cct]||e[FX.cc]});
    }
    varRows.sort((a,b)=>Math.abs(b.dif)-Math.abs(a.dif));
    const lista = (ms, src)=> ms.slice(0,300).map(m=>`<span class="imp-chip" onclick="abrirHistoricoFunc('${esc(m)}')">${esc(src[m][FX.nome])} · ${esc(src[m][FX.cct]||src[m][FX.cc])}</span>`).join(' ');
    mov = `<div class="card"><h2>Movimentação de pessoal × ${esc(compLabel(ant.comp))}</h2>
      <div class="gov-grid">
        <div class="gov-card"><div class="lbl">Entraram na folha</div><div class="val" style="font-size:22px">${fmtN(entr.length)}</div><div class="sub">matrículas que não estavam na folha anterior</div></div>
        <div class="gov-card"><div class="lbl">Saíram da folha</div><div class="val" style="font-size:22px">${fmtN(sai.length)}</div><div class="sub">estavam na anterior e não aparecem nesta</div></div>
        <div class="gov-card"><div class="lbl">Desligados nesta folha</div><div class="val" style="font-size:22px">${fmtN(desl.length)}</div><div class="sub">situação "Desligado" pela 1ª vez</div></div>
        <div class="gov-card"><div class="lbl">Alterações de salário</div><div class="val" style="font-size:22px">${fmtN(reaj.length)}</div><div class="sub">rubrica 2004 (salário contratual) mudou</div></div>
        <div class="gov-card"><div class="lbl">Transferências de loja</div><div class="val" style="font-size:22px">${fmtN(transf.length)}</div><div class="sub">centro de custo mudou</div></div>
      </div>
      ${entr.length?`<details><summary>Ver quem entrou (${entr.length})</summary><div class="imp-chips">${lista(entr, c.f)}</div></details>`:''}
      ${sai.length?`<details><summary>Ver quem saiu (${sai.length})</summary><div class="imp-chips">${lista(sai, ant.f)}</div></details>`:''}
      ${desl.length?`<details><summary>Ver desligados (${desl.length})</summary><div class="imp-chips">${lista(desl.map(x=>x[0]), c.f)}</div></details>`:''}
      ${reaj.length?`<details><summary>Ver alterações de salário (${reaj.length})</summary><div class="tablewrap"><table><thead><tr><th>Funcionário</th><th>Cargo</th><th>Loja</th><th class="num">Antes</th><th class="num">Agora</th><th class="num">Variação</th></tr></thead><tbody>${reaj.sort((a,b)=>Math.abs(b.para-b.de)-Math.abs(a.para-a.de)).slice(0,500).map(x=>`<tr class="clickable-row" onclick="abrirHistoricoFunc('${esc(x.m)}')"><td>${esc(x.e[FX.nome])}</td><td>${esc(x.e[FX.cargo])}</td><td>${esc(x.e[FX.cct])}</td><td class="num">${fmtR(x.de)}</td><td class="num">${fmtR(x.para)}</td><td class="num">${x.para>x.de?'+':''}${((x.para-x.de)/x.de*100).toFixed(1)}%</td></tr>`).join('')}</tbody></table></div></details>`:''}
      ${transf.length?`<details><summary>Ver transferências (${transf.length})</summary><div class="tablewrap"><table><thead><tr><th>Funcionário</th><th>De</th><th>Para</th></tr></thead><tbody>${transf.slice(0,500).map(x=>`<tr class="clickable-row" onclick="abrirHistoricoFunc('${esc(x.m)}')"><td>${esc(x.e[FX.nome])}</td><td>${esc(x.de)}</td><td>${esc(x.para)}</td></tr>`).join('')}</tbody></table></div></details>`:''}
    </div>`;
  }
  const lojas = Object.values(r.lojas).sort((a,b)=>b.b-a.b);
  const q = norm(FOLHA_BUSCA);
  const funcs = Object.entries(c.f).filter(([m,e])=>!q || norm(m+' '+e[FX.nome]+' '+e[FX.cpf]+' '+e[FX.cct]+' '+e[FX.cargo]+' '+e[FX.sit]).includes(q))
    .sort((a,b)=>b[1][FX.b]-a[1][FX.b]);
  const rubs = Object.values(r.rub).sort((a,b)=>b.v-a.v);
  const aud = auditoriaDaComp(FOLHA_SEL);
  el.innerHTML = `
    <div class="toolbar">${selectComp('folha-sel', FOLHA_SEL, "FOLHA_SEL=this.value;renderFolhaComp()")}
      <button class="dash-btn" onclick="exportarFolhaCSV()">⬇️ Exportar funcionários (CSV)</button>
      <button class="dash-btn" onclick="gotoPage('pg-importar')">📥 Importar mais folhas</button>
      <span class="count-pill">Arquivo: ${esc(c.arquivo)} · ${fmtN(c.linhas)} linhas · ${c.origem==='local'?'só neste navegador (pendente de envio)':'na nuvem'+(c.enviado_por?' · enviada por '+esc(c.enviado_por):'')}</span></div>
    ${aud?`<div class="resultado-banner ok" style="cursor:pointer" onclick="gotoPage('pg-dashboard')">🧾 Esta competência tem auditoria completa (comissões, CNAB, descontos): Confiança Global ${aud.score_confianca_global}/100 · ${fmtN(aud.casos_criticos)} caso(s) crítico(s) → ver Dashboard</div>`
         :`<div class="muted-box" style="margin-bottom:14px">Visão da <b>folha</b> desta competência (proventos, descontos, líquido, headcount, lojas e rubricas). As regras que dependem de outras bases — comissão × vendas, CNAB/banco, adiantamento, campanhas — só rodam quando essas bases da competência forem processadas.</div>`}
    <div class="gov-grid">
      ${kp('Folha bruta', r.bruto, ra&&ra.bruto, fmtR, 'alta')}
      ${kp('Descontos', r.desc, ra&&ra.desc, fmtR, null)}
      ${kp('Folha líquida', r.liq, ra&&ra.liq, fmtR, 'alta')}
      ${kp('Headcount ativo', r.ativos, ra&&ra.ativos, fmtN, null)}
      ${kp('Desligados na folha', r.desligados, ra&&ra.desligados, fmtN, 'alta')}
      ${kp('Afastados (doença, maternidade…)', r.afastados, ra&&ra.afastados, fmtN, null)}
      ${kp('Horas extras (proventos)', r.he, ra&&ra.he, fmtR, 'alta')}
      ${kp('Custo bruto médio / ativo', r.custo_medio, ra&&ra.custo_medio, fmtR, 'alta')}
    </div>
    ${mov}
    ${varRows.length?`<div class="card"><h2>Maiores variações de líquido por funcionário × ${esc(compLabel(ant.comp))} (${varRows.length})</h2>
      <p class="sub">Critério: variação ≥ R$ 500 e ≥ 30% do líquido anterior, funcionários não desligados. Variação não é erro — é ponto para conferir (férias, rescisão, HE, retorno de afastamento…).</p>
      <div class="tablewrap"><table><thead><tr><th>Funcionário</th><th>Loja</th><th>Situação</th><th class="num">Líquido anterior</th><th class="num">Líquido atual</th><th class="num">Diferença</th></tr></thead>
      <tbody>${varRows.slice(0,200).map(x=>`<tr class="clickable-row" onclick="abrirHistoricoFunc('${esc(x.m)}')"><td>${esc(x.e[FX.nome])}</td><td>${esc(x.e[FX.cct])}</td><td>${esc(x.e[FX.sit])}</td><td class="num">${fmtR(x.lp)}</td><td class="num">${fmtR(x.lc)}</td><td class="num" style="color:${x.dif>0?'var(--serious)':'var(--good)'}">${x.dif>0?'+':''}${fmtR(x.dif)}</td></tr>`).join('')}</tbody></table></div></div>`:''}
    <div class="card"><h2>Lojas / centros de custo (${lojas.length})</h2>
      <div class="tablewrap"><table><thead><tr><th>Loja / CCusto</th><th class="num">Headcount</th><th class="num">Folha bruta</th><th class="num">Descontos</th><th class="num">Líquido</th><th class="num">Horas extras</th>${ra?`<th class="num">Δ bruto vs ${esc(compLabel(ant.comp))}</th><th class="num">%</th>`:''}</tr></thead>
      <tbody>${lojas.map(l=>{ const la = ra && ra.lojas[l.cc]; return `<tr class="clickable-row" onclick="FOLHA_BUSCA='${esc(l.titulo).replace(/'/g,"\\'")}';renderFolhaComp();document.getElementById('folha-busca')?.scrollIntoView({behavior:'smooth'})"><td>${esc(l.titulo)} <span class="mono" style="color:var(--muted)">#${esc(l.cc)}</span></td><td class="num">${fmtN(l.hc)}</td><td class="num">${fmtR(l.b)}</td><td class="num">${fmtR(l.ds)}</td><td class="num">${fmtR(l.liq)}</td><td class="num">${fmtR(l.he)}</td>${ra?deltaCell(la?la.b:null, l.b, fmtR, 'alta'):''}</tr>`; }).join('')}</tbody></table></div></div>
    <div class="card"><h2>Rubricas de provento e desconto (${rubs.length})</h2>
      <div class="tablewrap"><table><thead><tr><th>Cód.</th><th>Rubrica</th><th>Tipo</th><th class="num">Funcionários</th><th class="num">Valor</th>${ra?`<th class="num">Δ vs ${esc(compLabel(ant.comp))}</th><th class="num">%</th>`:''}</tr></thead>
      <tbody>${rubs.map(x=>{ const xa = ra && ra.rub[x.cod]; return `<tr><td class="mono">${esc(x.cod)}</td><td>${esc(x.titulo)}${ehHoraExtra(x.titulo)&&x.tipo==='Provento'?' <span class="badge atencao">HE</span>':''}</td><td>${esc(x.tipo)}</td><td class="num">${fmtN(x.n)}</td><td class="num">${fmtR(x.v)}</td>${ra?deltaCell(xa?xa.v:null, x.v, fmtR, x.tipo==='Provento'?'alta':null):''}</tr>`; }).join('')}</tbody></table></div></div>
    <div class="card"><h2>Funcionários (${fmtN(funcs.length)}${q?' filtrados':''})</h2>
      <div class="toolbar"><input id="folha-busca" type="text" placeholder="Buscar nome, matrícula, CPF, loja, cargo, situação…" value="${esc(FOLHA_BUSCA)}" oninput="FOLHA_BUSCA=this.value;clearTimeout(window._fbT);window._fbT=setTimeout(()=>{renderFolhaComp();const i=document.getElementById('folha-busca');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length)}},250)">
      ${q?`<button class="dash-btn" onclick="FOLHA_BUSCA='';renderFolhaComp()">✕ Limpar</button>`:''}<span class="count-pill">Clique para ver o histórico mês a mês do funcionário${funcs.length>500?' · mostrando 500 maiores':''}</span></div>
      <div class="tablewrap"><table><thead><tr><th>Matrícula</th><th>Nome</th><th>Cargo</th><th>Loja</th><th>Situação</th><th class="num">Salário</th><th class="num">Bruto</th><th class="num">Descontos</th><th class="num">Líquido</th></tr></thead>
      <tbody>${funcs.slice(0,500).map(([m,e])=>`<tr class="clickable-row" onclick="abrirHistoricoFunc('${esc(m)}')"><td class="mono">${esc(m)}</td><td>${esc(e[FX.nome])}</td><td>${esc(e[FX.cargo])}</td><td>${esc(e[FX.cct])}</td><td>${esc(e[FX.sit])}</td><td class="num">${fmtR(e[FX.sal])}</td><td class="num">${fmtR(e[FX.b])}</td><td class="num">${fmtR(e[FX.ds])}</td><td class="num">${fmtR(e[FX.b]-e[FX.ds])}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function exportarFolhaCSV(){
  const c = FOLHAS[FOLHA_SEL]; if(!c) return;
  const sep = ';', q = v=>'"'+String(v??'').replace(/"/g,'""')+'"', n2 = v=>(+v||0).toFixed(2).replace('.',',');
  const linhas = [['Competencia','Matricula','Nome','CPF','Situacao','CCusto','Loja','Cargo','Admissao','Desligamento','Salario','Bruto','Descontos','Liquido'].join(sep)];
  for(const [m,e] of Object.entries(c.f)) linhas.push([q(compLabel(c.comp)),q(m),q(e[FX.nome]),q(cpfTela(cpfMascarado(e[FX.cpf]))),q(e[FX.sit]),q(e[FX.cc]),q(e[FX.cct]),q(e[FX.cargo]),q(e[FX.adm]||''),q(e[FX.desl]||''),n2(e[FX.sal]),n2(e[FX.b]),n2(e[FX.ds]),n2(e[FX.b]-e[FX.ds])].join(sep));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿'+linhas.join('\r\n')], {type:'text/csv;charset=utf-8'}));
  a.download = 'folha_' + compLabel(c.comp).replace(/\D+/g,'-') + '.csv';
  document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ---------- histórico de um funcionário (todas as competências) ----------
function historicoFuncHtml(mat){
  const L = folhasOrdenadas().filter(c=>c.f[mat]);
  if(!L.length) return '';
  return `<div class="tablewrap"><table class="drill-table"><thead><tr><th>Competência</th><th>Situação</th><th>Loja</th><th>Cargo</th><th class="num">Salário</th><th class="num">Bruto</th><th class="num">Descontos</th><th class="num">Líquido</th><th class="num">Horas extras</th></tr></thead><tbody>
    ${L.map(c=>{ const e=c.f[mat], cat=c.cat||{}; let he=0; for(const [cod,v] of Object.entries(e[FX.rub]||{})){ const m=cat[cod]; if(m && m[1]==='Provento' && ehHoraExtra(m[0])) he+=v; }
      return `<tr><td class="mono">${esc(compLabel(c.comp))}</td><td>${esc(e[FX.sit])}</td><td>${esc(e[FX.cct])}</td><td>${esc(e[FX.cargo])}</td><td class="num">${fmtR(e[FX.sal])}</td><td class="num">${fmtR(e[FX.b])}</td><td class="num">${fmtR(e[FX.ds])}</td><td class="num"><b>${fmtR(e[FX.b]-e[FX.ds])}</b></td><td class="num">${fmtR(he)}</td></tr>`; }).join('')}
  </tbody></table></div>`;
}
function abrirHistoricoFunc(mat){
  const L = folhasOrdenadas().filter(c=>c.f[mat]); if(!L.length) return;
  const e = L[L.length-1].f[mat];
  // rubricas da competência selecionada (ou a última em que aparece)
  const cs = FOLHAS[FOLHA_SEL] && FOLHAS[FOLHA_SEL].f[mat] ? FOLHAS[FOLHA_SEL] : L[L.length-1];
  const es = cs.f[mat], cat = cs.cat||{};
  const rubs = Object.entries(es[FX.rub]||{}).map(([cod,v])=>({cod, t:(cat[cod]||[])[0]||cod, tp:(cat[cod]||[])[1]||'', v})).sort((a,b)=>a.tp.localeCompare(b.tp)||b.v-a.v);
  document.getElementById('drill-title').textContent = e[FX.nome];
  document.getElementById('drill-summary').innerHTML = `Matrícula ${esc(mat)} · CPF ${esc(cpfTela(cpfMascarado(e[FX.cpf])))} · ${esc(e[FX.cargo])} · ${esc(e[FX.cct])} · admissão ${esc(e[FX.adm]||'—')}${e[FX.desl]?' · desligamento '+esc(e[FX.desl]):''} · presente em ${L.length} de ${folhasOrdenadas().length} folha(s)
    ${D && D.employees && D.employees[mat] ? ` · <a href="#" onclick="closeDrill();openDossie('${esc(mat)}');return false" style="color:var(--neon-blue)">abrir dossiê de auditoria ${esc(D.meta.competencia_folha)} →</a>`:''}`;
  document.getElementById('drill-content').innerHTML = `<h3 style="margin:6px 0">Histórico de folha</h3>${historicoFuncHtml(mat)}
    <h3 style="margin:16px 0 6px">Rubricas — ${esc(compLabel(cs.comp))}</h3>
    <div class="tablewrap"><table class="drill-table"><thead><tr><th>Cód.</th><th>Rubrica</th><th>Tipo</th><th class="num">Valor</th></tr></thead><tbody>
    ${rubs.map(x=>`<tr><td class="mono">${esc(x.cod)}</td><td>${esc(x.t)}</td><td>${esc(x.tp)}</td><td class="num">${fmtR(x.v)}</td></tr>`).join('')||'<tr><td colspan="4">Sem rubricas de provento/desconto.</td></tr>'}</tbody></table></div>`;
  document.getElementById('drill-modal').classList.add('open');
}

// ---------- Histórico (substitui o aviso de histórico insuficiente) ----------
function renderHistoricoFolhas(){
  const el = document.getElementById('historico-content'); if(!el) return;
  const L = folhasOrdenadas();
  if(L.length < 2){ semFolhas(el, `Há ${L.length} competência(s) de folha carregada(s). Importe pelo menos 2 para ver a evolução.`); return; }
  const R = L.map(c=>resumoFolha(c.comp));
  el.innerHTML = `
    <div class="resultado-banner ok">📈 ${L.length} competências de folha carregadas: ${esc(compLabel(L[0].comp))} a ${esc(compLabel(L[L.length-1].comp))}</div>
    <div class="card"><h2>Evolução da folha</h2>${svgBarras(R.map(r=>({label:compLabel(r.comp).replace(/\/20/,'/'), valores:{b:r.bruto, ds:r.desc, l:r.liq}})), [{k:'b',lbl:'Folha bruta',cor:'var(--blue)'},{k:'ds',lbl:'Descontos',cor:'var(--orange)'},{k:'l',lbl:'Folha líquida',cor:'var(--aqua)'}])}</div>
    <div class="card"><h2>Série mês a mês</h2><div class="tablewrap"><table>
      <thead><tr><th>Competência</th><th class="num">Funcionários</th><th class="num">Ativos</th><th class="num">Desligados</th><th class="num">Folha bruta</th><th class="num">Δ bruta</th><th class="num">Descontos</th><th class="num">Líquida</th><th class="num">Horas extras</th><th class="num">Custo médio/ativo</th><th>Auditoria</th></tr></thead>
      <tbody>${R.map((r,i)=>{ const p=R[i-1], a=auditoriaDaComp(r.comp); const d=p?(r.bruto-p.bruto)/p.bruto*100:null;
        return `<tr class="clickable-row" onclick="FOLHA_SEL='${esc(r.comp)}';renderFolhaComp();gotoPage('pg-folhas')"><td class="mono"><b>${esc(compLabel(r.comp))}</b></td><td class="num">${fmtN(r.n)}</td><td class="num">${fmtN(r.ativos)}</td><td class="num">${fmtN(r.desligados)}</td><td class="num">${fmtR(r.bruto)}</td><td class="num" style="color:${d===null?'var(--muted)':d>0?'var(--serious)':'var(--good)'}">${d===null?'—':(d>0?'+':'')+d.toFixed(1)+'%'}</td><td class="num">${fmtR(r.desc)}</td><td class="num">${fmtR(r.liq)}</td><td class="num">${fmtR(r.he)}</td><td class="num">${fmtR(r.custo_medio)}</td><td>${a?`<span class="badge ok">Completa · ${a.score_confianca_global}/100</span>`:'<span class="badge atencao">Só folha</span>'}</td></tr>`; }).join('')}
      </tbody></table></div>
      <p class="footnote">Clique numa competência para abrir a folha dela. Bruto = rubrica 2001, Descontos = 2002, Líquido = 2001 − 2002, Horas extras = proventos cujo título indica hora extra.</p></div>
    ${renderReincidenciaHE(L)}`;
}
function renderReincidenciaHE(L){
  // lojas com HE crescente nas 3 últimas competências
  if(L.length < 3) return '';
  const [a,b,c] = L.slice(-3).map(x=>resumoFolha(x.comp));
  const rows = Object.values(c.lojas).filter(l=>{ const la=a.lojas[l.cc], lb=b.lojas[l.cc]; return la && lb && l.he > lb.he && lb.he > la.he && l.he >= 1000; })
    .map(l=>({l, ha:a.lojas[l.cc].he, hb:b.lojas[l.cc].he})).sort((x,y)=>(y.l.he-y.ha)-(x.l.he-x.ha));
  if(!rows.length) return `<div class="card"><h2>Horas extras crescentes (3 meses seguidos)</h2><div class="muted-box">Nenhuma loja com hora extra subindo em ${esc(compLabel(a.comp))} → ${esc(compLabel(b.comp))} → ${esc(compLabel(c.comp))} (mínimo R$ 1.000 no último mês).</div></div>`;
  return `<div class="card"><h2>Horas extras crescentes — 3 meses seguidos (${rows.length} loja(s))</h2><div class="tablewrap"><table>
    <thead><tr><th>Loja</th><th class="num">${esc(compLabel(a.comp))}</th><th class="num">${esc(compLabel(b.comp))}</th><th class="num">${esc(compLabel(c.comp))}</th><th class="num">Crescimento</th></tr></thead>
    <tbody>${rows.map(x=>`<tr><td>${esc(x.l.titulo)}</td><td class="num">${fmtR(x.ha)}</td><td class="num">${fmtR(x.hb)}</td><td class="num">${fmtR(x.l.he)}</td><td class="num" style="color:var(--serious)">${x.ha?'+'+((x.l.he-x.ha)/x.ha*100).toFixed(0)+'%':'novo'}</td></tr>`).join('')}</tbody></table></div></div>`;
}

// ---------- Comparativo Mensal (escolhe 2 competências) ----------
let CMP_A = null, CMP_B = null;
function renderComparativoFolhas(){
  const el = document.getElementById('comparativo-card'); if(!el) return;
  const L = folhasOrdenadas();
  if(L.length < 2){ semFolhas(el, 'São necessárias pelo menos 2 competências de folha para comparar.'); return; }
  if(!CMP_B || !FOLHAS[CMP_B]) CMP_B = L[L.length-1].comp;
  if(!CMP_A || !FOLHAS[CMP_A] || CMP_A===CMP_B) CMP_A = (folhaAnterior(CMP_B)||L[0]).comp;
  const a = resumoFolha(CMP_A), b = resumoFolha(CMP_B), aa = auditoriaDaComp(CMP_A), ab = auditoriaDaComp(CMP_B);
  const linhas = [
    ['Funcionários na folha', 'n', fmtN, null], ['Headcount ativo', 'ativos', fmtN, null], ['Desligados', 'desligados', fmtN, 'alta'],
    ['Afastados', 'afastados', fmtN, null], ['Folha bruta', 'bruto', fmtR, 'alta'], ['Descontos', 'desc', fmtR, null],
    ['Folha líquida', 'liq', fmtR, 'alta'], ['Horas extras', 'he', fmtR, 'alta'], ['Custo bruto médio / ativo', 'custo_medio', fmtR, 'alta'],
  ];
  const audLinhas = (aa||ab) ? [['Comissão paga','total_comissao_paga',fmtR,'alta'],['Casos críticos','casos_criticos',fmtN,'alta'],['Valor sob análise','valor_sob_analise',fmtR,'alta'],['Confiança Global','score_confianca_global',v=>v+'/100',null]] : [];
  const lojas = [...new Set([...Object.keys(a.lojas), ...Object.keys(b.lojas)])].map(cc=>({cc, la:a.lojas[cc], lb:b.lojas[cc]}))
    .map(x=>({...x, titulo:(x.lb||x.la).titulo, d:(x.lb?x.lb.b:0)-(x.la?x.la.b:0)})).sort((x,y)=>Math.abs(y.d)-Math.abs(x.d));
  el.innerHTML = `
    <div class="toolbar">Comparar ${selectComp('cmp-a', CMP_A, "CMP_A=this.value;renderComparativoFolhas()")} com ${selectComp('cmp-b', CMP_B, "CMP_B=this.value;renderComparativoFolhas()")}</div>
    <h2>${esc(compLabel(CMP_B))} × ${esc(compLabel(CMP_A))}</h2>
    <div class="card" style="padding:0;"><div class="tablewrap"><table>
      <thead><tr><th>Indicador</th><th class="num">${esc(compLabel(CMP_A))}</th><th class="num">${esc(compLabel(CMP_B))}</th><th class="num">Variação</th><th class="num">%</th></tr></thead>
      <tbody>${linhas.map(([lbl,k,fmt,pior])=>`<tr><td>${esc(lbl)}</td><td class="num">${fmt(a[k])}</td><td class="num">${fmt(b[k])}</td>${deltaCell(a[k], b[k], fmt, pior)}</tr>`).join('')}
      ${audLinhas.map(([lbl,k,fmt,pior])=>`<tr><td>${esc(lbl)} <span class="badge atencao">auditoria completa</span></td><td class="num">${aa?fmt(aa[k]||0):'—'}</td><td class="num">${ab?fmt(ab[k]||0):'—'}</td>${aa&&ab?deltaCell(aa[k]||0, ab[k]||0, fmt, pior):'<td class="num">—</td><td class="num">—</td>'}</tr>`).join('')}
      </tbody></table></div></div>
    <div class="card"><h2>Lojas — maiores variações de folha bruta</h2><div class="tablewrap"><table>
      <thead><tr><th>Loja</th><th class="num">HC ${esc(compLabel(CMP_A))}</th><th class="num">HC ${esc(compLabel(CMP_B))}</th><th class="num">Bruto ${esc(compLabel(CMP_A))}</th><th class="num">Bruto ${esc(compLabel(CMP_B))}</th><th class="num">Variação</th><th class="num">%</th></tr></thead>
      <tbody>${lojas.map(x=>`<tr><td>${esc(x.titulo)}${!x.la?' <span class="badge atencao">nova</span>':!x.lb?' <span class="badge divergencia">sem folha</span>':''}</td><td class="num">${x.la?fmtN(x.la.hc):'—'}</td><td class="num">${x.lb?fmtN(x.lb.hc):'—'}</td><td class="num">${x.la?fmtR(x.la.b):'—'}</td><td class="num">${x.lb?fmtR(x.lb.b):'—'}</td>${deltaCell(x.la?x.la.b:0, x.lb?x.lb.b:0, fmtR, 'alta')}</tr>`).join('')}</tbody></table></div></div>`;
}

// ---------- Anomalias temporais ----------
function renderAnomaliasFolhas(){
  const el = document.getElementById('anomalias-content'); if(!el) return;
  const L = folhasOrdenadas();
  if(L.length < 3){ semFolhas(el, `Há ${L.length} competência(s). A detecção temporal precisa de pelo menos 3 (atual + 2 de referência).`); return; }
  const atual = L[L.length-1], refs = L.slice(-4,-1); // até 3 competências anteriores
  const ra = resumoFolha(atual.comp), RR = refs.map(c=>resumoFolha(c.comp));
  const media = arr=>arr.length?arr.reduce((s,x)=>s+x,0)/arr.length:0;
  // funcionários: bruto atual muito acima da própria média
  const funcs = [];
  for(const [m,e] of Object.entries(atual.f)){
    const hist = refs.map(c=>c.f[m]).filter(Boolean).map(x=>x[FX.b]); if(hist.length < 2) continue;
    const mu = media(hist), dif = e[FX.b]-mu;
    if(mu > 0 && dif >= 1500 && e[FX.b] >= mu*1.6 && e[FX.sit]!=='Desligado') funcs.push({m, e, mu, dif});
  }
  funcs.sort((x,y)=>y.dif-x.dif);
  // lojas
  const lojas = Object.values(ra.lojas).map(l=>{ const h=RR.map(r=>r.lojas[l.cc]).filter(Boolean); return {l, mu:media(h.map(x=>x.b)), muhc:media(h.map(x=>x.hc)), n:h.length}; })
    .filter(x=>x.n>=2 && x.mu>0 && x.l.b-x.mu >= 10000 && x.l.b >= x.mu*1.2).sort((x,y)=>(y.l.b-y.mu)-(x.l.b-x.mu));
  // rubricas
  const rubs = Object.values(ra.rub).map(x=>{ const h=RR.map(r=>r.rub[x.cod]).filter(Boolean); return {x, mu:media(h.map(z=>z.v)), n:h.length}; })
    .filter(z=>z.x.tipo==='Provento' && (z.n===0 ? z.x.v>=5000 : (z.x.v-z.mu>=5000 && z.x.v>=z.mu*1.5))).sort((p,q)=>(q.x.v-q.mu)-(p.x.v-p.mu));
  const refTxt = refs.map(c=>compLabel(c.comp)).join(', ');
  el.innerHTML = `
    <div class="resultado-banner warn">🧭 Competência analisada: ${esc(compLabel(atual.comp))} · referência: média de ${esc(refTxt)}</div>
    <div class="gov-grid">
      <div class="gov-card"><div class="lbl">Funcionários fora do padrão</div><div class="val">${funcs.length}</div><div class="sub">bruto ≥ 1,6× a própria média e +R$ 1.500</div></div>
      <div class="gov-card"><div class="lbl">Lojas fora do padrão</div><div class="val">${lojas.length}</div><div class="sub">folha bruta ≥ 1,2× a média e +R$ 10 mil</div></div>
      <div class="gov-card"><div class="lbl">Rubricas fora do padrão</div><div class="val">${rubs.length}</div><div class="sub">provento ≥ 1,5× a média e +R$ 5 mil, ou rubrica nova ≥ R$ 5 mil</div></div>
    </div>
    <div class="card"><h2>Funcionários</h2>${funcs.length?`<div class="tablewrap"><table><thead><tr><th>Funcionário</th><th>Loja</th><th>Situação</th><th class="num">Média anterior</th><th class="num">Bruto atual</th><th class="num">Acima da média</th></tr></thead><tbody>
      ${funcs.slice(0,200).map(x=>`<tr class="clickable-row" onclick="FOLHA_SEL='${esc(atual.comp)}';abrirHistoricoFunc('${esc(x.m)}')"><td>${esc(x.e[FX.nome])}</td><td>${esc(x.e[FX.cct])}</td><td>${esc(x.e[FX.sit])}</td><td class="num">${fmtR(x.mu)}</td><td class="num">${fmtR(x.e[FX.b])}</td><td class="num" style="color:var(--serious)">+${fmtR(x.dif)} (${(x.e[FX.b]/x.mu).toFixed(1)}×)</td></tr>`).join('')}</tbody></table></div>`:'<div class="muted-box">Nenhum funcionário fora do próprio padrão.</div>'}</div>
    <div class="card"><h2>Lojas</h2>${lojas.length?`<div class="tablewrap"><table><thead><tr><th>Loja</th><th class="num">HC médio</th><th class="num">HC atual</th><th class="num">Bruto médio</th><th class="num">Bruto atual</th><th class="num">Acima da média</th></tr></thead><tbody>
      ${lojas.map(x=>`<tr><td>${esc(x.l.titulo)}</td><td class="num">${x.muhc.toFixed(0)}</td><td class="num">${fmtN(x.l.hc)}</td><td class="num">${fmtR(x.mu)}</td><td class="num">${fmtR(x.l.b)}</td><td class="num" style="color:var(--serious)">+${fmtR(x.l.b-x.mu)} (+${((x.l.b/x.mu-1)*100).toFixed(0)}%)</td></tr>`).join('')}</tbody></table></div>`:'<div class="muted-box">Nenhuma loja fora do padrão.</div>'}</div>
    <div class="card"><h2>Rubricas de provento</h2>${rubs.length?`<div class="tablewrap"><table><thead><tr><th>Cód.</th><th>Rubrica</th><th class="num">Média anterior</th><th class="num">Atual</th><th class="num">Funcionários</th></tr></thead><tbody>
      ${rubs.map(z=>`<tr><td class="mono">${esc(z.x.cod)}</td><td>${esc(z.x.titulo)}${z.n===0?' <span class="badge atencao">nova</span>':''}</td><td class="num">${z.n?fmtR(z.mu):'—'}</td><td class="num">${fmtR(z.x.v)}</td><td class="num">${fmtN(z.x.n)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="muted-box">Nenhuma rubrica fora do padrão.</div>'}</div>
    <p class="footnote">Anomalia não é erro nem fraude — é comportamento fora do histórico do próprio funcionário/loja/rubrica, para conferência (férias, rescisão, retroativos, HE etc.).</p>`;
}

// ---------- Previsões (média móvel + tendência) ----------
function renderPrevisoesFolhas(){
  const el = document.getElementById('previsoes-card'); if(!el) return;
  const L = folhasOrdenadas();
  if(L.length < 3){ semFolhas(el, `Há ${L.length} competência(s). São necessárias pelo menos 3 para projetar a próxima.`); return; }
  const R = L.map(c=>resumoFolha(c.comp)), ult3 = R.slice(-3);
  const ind = [['Folha bruta','bruto',fmtR],['Descontos','desc',fmtR],['Folha líquida','liq',fmtR],['Headcount ativo','ativos',v=>fmtN(Math.round(v))],['Horas extras','he',fmtR],['Custo médio / ativo','custo_medio',fmtR]];
  const tend = k=>{ const n=R.length, xs=R.map((_,i)=>i), ys=R.map(r=>r[k]); const mx=(n-1)/2, my=ys.reduce((s,y)=>s+y,0)/n; let num=0, den=0; xs.forEach((x,i)=>{num+=(x-mx)*(ys[i]-my); den+=(x-mx)**2;}); const b=den?num/den:0; return {slope:b, prox:my+b*(n-mx)}; };
  const m = String(L[L.length-1].comp).match(/^(\d{1,2})\/(\d{2,4})/); let mm=+m[1]+1, aa=+m[2]; if(aa<100) aa+=2000; if(mm>12){mm=1;aa++;}
  const prox = String(mm).padStart(2,'0')+'/'+aa;
  el.innerHTML = `
    <div class="resultado-banner ok">🔮 Projeção para ${prox} · base: ${R.length} competências (${esc(compLabel(L[0].comp))} a ${esc(compLabel(L[L.length-1].comp))})</div>
    <div class="card"><div class="tablewrap"><table>
      <thead><tr><th>Indicador</th><th class="num">Último (${esc(compLabel(L[L.length-1].comp))})</th><th class="num">Média móvel 3 meses</th><th class="num">Tendência linear → ${prox}</th><th class="num">Variação mensal média</th></tr></thead>
      <tbody>${ind.map(([lbl,k,fmt])=>{ const mm3=ult3.reduce((s,r)=>s+r[k],0)/3, t=tend(k); return `<tr><td>${esc(lbl)}</td><td class="num">${fmt(R[R.length-1][k])}</td><td class="num"><b>${fmt(mm3)}</b></td><td class="num">${fmt(Math.max(0,t.prox))}</td><td class="num" style="color:${t.slope>0?'var(--serious)':'var(--good)'}">${t.slope>0?'+':''}${fmt(t.slope)}</td></tr>`; }).join('')}</tbody></table></div>
      <p class="footnote">Média móvel = média simples das 3 últimas folhas. Tendência = regressão linear sobre todas as competências carregadas. Projeções não consideram 13º, dissídio ou eventos sazonais futuros — servem como referência para o pré-fechamento, não como valor a pagar.</p></div>`;
}

// ---------- Dashboard + Central de Bases ----------
function renderFolhasBanner(){
  const el = document.getElementById('folhas-banner'); if(!el) return;
  const L = folhasOrdenadas();
  if(!L.length){ el.innerHTML = `<div class="folhas-banner"><div><b>📥 Nenhuma folha mensal carregada</b><div class="sub">Importe os arquivos FOLHA MM-AAAA.xlsx para ativar histórico, comparativo e previsões.</div></div><button class="dash-btn" onclick="gotoPage('pg-importar')">📥 Importar folhas</button></div>`; return; }
  const u = resumoFolha(L[L.length-1].comp), imp = L.filter(c=>c.origem==='local').length;
  el.innerHTML = `<div class="folhas-banner">
    <div><b>🗓️ Folhas carregadas: ${L.length} competência(s) — ${esc(compLabel(L[0].comp))} a ${esc(compLabel(L[L.length-1].comp))}</b>
    <div class="sub">Última folha (${esc(compLabel(u.comp))}): bruto ${fmtR(u.bruto)} · líquido ${fmtR(u.liq)} · ${fmtN(u.ativos)} ativos · ${fmtN(u.desligados)} desligados${imp?` · ⚠️ ${imp} só neste navegador (pendente de envio à nuvem)`:''}. O parecer abaixo é da auditoria completa ${esc(compLabel(D.meta.competencia_folha))}.</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="dash-btn" onclick="FOLHA_SEL='${esc(u.comp)}';renderFolhaComp();gotoPage('pg-folhas')">Ver folha ${esc(compLabel(u.comp))}</button><button class="dash-btn" onclick="gotoPage('pg-historico')">📈 Histórico</button><button class="dash-btn primary-imp" onclick="gotoPage('pg-importar')">📥 Importar folhas</button></div></div>`;
}
function renderBasesFolhas(){
  const el = document.getElementById('bases-folhas-card'); if(!el) return;
  const L = folhasOrdenadas();
  el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
    <div><b>Folhas mensais (FOLHA MM-AAAA.xlsx): ${L.length} competência(s)</b><div class="sub" style="margin:2px 0 0">${L.map(c=>esc(compLabel(c.comp))+(c.origem==='local'?'*':'')).join(' · ')||'nenhuma'}${L.some(c=>c.origem==='local')?' &nbsp;(* só neste navegador, pendente de envio)':''} · ${NUVEM_OK?'☁️ nuvem compartilhada':'⚠️ '+esc(FOLHAS_ERRO||'nuvem indisponível')}</div></div>
    <button class="dash-btn primary-imp" onclick="gotoPage('pg-importar')">📥 Importar folhas</button></div>`;
}
function renderFolhasTudo(){
  const fns = [renderStatusNuvem, renderFolhasBanner, renderBasesFolhas, renderImportar, renderFolhaComp, renderHistoricoFolhas, renderComparativoFolhas, renderAnomaliasFolhas, renderPrevisoesFolhas, renderImportLog];
  for(const f of fns){ try{ f(); }catch(e){ console.error(f.name, e); } }
  const nb = document.getElementById('nav-folhas-n'); if(nb) nb.textContent = folhasOrdenadas().length || '';
}

// Dossiê de auditoria: acrescenta o histórico mês a mês do funcionário
(function(){
  if(typeof openDossie !== 'function') return;
  const orig = openDossie;
  openDossie = function(mat){
    orig(mat);
    const html = FOLHAS_READY ? historicoFuncHtml(mat) : '';
    const dc = document.getElementById('drawer-content');
    if(html && dc){ const box = document.createElement('div'); box.innerHTML = `<h2>Histórico de folha (todas as competências carregadas)</h2>${html}`; const h2s = dc.querySelectorAll('h2'); const alvo = [...h2s].find(h=>/Auditoria —|Sem ocorrências/.test(h.textContent)); dc.insertBefore(box, alvo || null); }
  };
})();

// Botões do menu adicionados depois do carregamento (patch do Portal) não recebem o clique do menu original.
document.querySelectorAll('#nav button[data-page="pg-importar"],#nav button[data-page="pg-folhas"]').forEach(b=>{
  if(b.dataset.rhf) return; b.dataset.rhf = '1';
  b.addEventListener('click', ()=>{ if(!b.classList.contains('active')) gotoPage(b.dataset.page); });
});

if(D){ try{ initImportDrop(); }catch(e){} renderFolhasTudo(); carregarFolhas(); }
