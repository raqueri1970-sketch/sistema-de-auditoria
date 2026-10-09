// Comum às telas de Obras (Contas a Pagar, Presidente, Financeiro): login do Portal, formatação e utilidades.
const SB_URL = 'https://rdztzurfesnobfkazgpm.supabase.co';
const SB_KEY = 'sb_publishable_4LHSO4TrP7F4m4tpJyH44g_BGmfC92h';
const sb = supabase.createClient(SB_URL, SB_KEY, {auth: {persistSession: true, autoRefreshToken: true, storageKey: 'obras-fluxo-auth'}});
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const brl = v => Number(v || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
const dBR = d => d ? String(d).substring(0, 10).split('-').reverse().slice(0, 2).join('/') : '';
const dtBR = iso => iso ? new Date(iso).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : '—';
const CATS = {materiais_insumos: 'Materiais e insumos', alimentacao: 'Alimentação', transporte_combustivel: 'Transporte/combustível',
  estacionamento: 'Estacionamento', frete: 'Frete', mao_de_obra_prestador: 'Mão de obra/prestador', hospedagem: 'Hospedagem',
  equipamento_manutencao: 'Equipamentos/manutenção', taxas: 'Taxas', diversos: 'Diversos'};
const STATUS = {aberta: 'Em andamento', fechada: 'Fechada · aguarda Presidente', aprovada: 'Aprovada · com o Financeiro',
  paga: 'Paga · em auditoria', auditada: 'Paga e auditada', pendencia: 'Com pendência'};
const RISCO = {normal: ['NORMAL', 'r-normal'], atencao: ['ATENÇÃO', 'r-atencao'], critico: ['CRÍTICO', 'r-critico']};
const riscoChip = r => { const [t, c] = RISCO[r] || RISCO.normal; return `<span class="chip ${c}">${t}</span>`; };
const statusChip = s => `<span class="chip s-${esc(s)}">${esc(STATUS[s] || s)}</span>`;
const msgErro = e => String(e && e.message || e).replace(/^.*?ERROR:\s*/, '');

function toast(m, ms = 4000) { const t = $('toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(t._t); t._t = setTimeout(() => t.style.display = 'none', ms); }

// O Supabase devolve no máximo 1000 linhas por consulta: busca em páginas.
async function todos(montar) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const {data, error} = await montar().range(de, de + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function abrirArquivo(path) {
  if (/^https?:\/\//.test(path)) return window.open(path, '_blank', 'noopener');
  const {data, error} = await sb.storage.from('obras-comprovantes').createSignedUrl(path, 300);
  if (error) return toast('Arquivo indisponível: ' + error.message, 5000);
  window.open(data.signedUrl, '_blank', 'noopener');
}
const ARQ = [];
const linkArquivo = (path, txt = 'ver') => path ? `<a href="#" onclick="abrirArquivo(ARQ[${ARQ.push(path) - 1}]);return false">${txt}</a>` : '';

// Login com o mesmo usuário do Portal. onEntrar() roda quando há sessão.
function iniciarLogin(onEntrar) {
  const mostrarLogin = m => { $('vApp').classList.add('hidden'); $('vLogin').classList.remove('hidden'); $('lErr').textContent = m || ''; };
  window.sair = async () => { await sb.auth.signOut(); mostrarLogin(); };
  window.entrar = async () => {
    $('lErr').textContent = '';
    const r = await sb.auth.signInWithPassword({email: $('lEmail').value.trim(), password: $('lSenha').value});
    if (r.error) { $('lErr').textContent = 'Email ou senha incorretos.'; return; }
    $('vLogin').classList.add('hidden'); $('vApp').classList.remove('hidden'); onEntrar(r.data.user);
  };
  window.semPermissao = m => { mostrarLogin(m || 'Este usuário não tem acesso a esta tela.'); };
  (async () => {
    const s = await sb.auth.getSession();
    if (s.data && s.data.session) { $('vLogin').classList.add('hidden'); $('vApp').classList.remove('hidden'); onEntrar(s.data.session.user); }
    else mostrarLogin();
  })();
}

// Recibos (comprovantes) de um prestador numa semana — usado pelas três telas.
async function recibosDaSemana(responsavel, semana, contaId) {
  let q = sb.from('obras_comprovantes').select('id,data_despesa,hora_documento,fornecedor,descricao,categoria,valor,status,tipo_doc,arquivo_path,situacao_pagamento')
    .eq('responsavel', responsavel).eq('semana_ref', semana).order('data_despesa');
  if (!contaId) q = q.eq('situacao_pagamento', 'a_pagar');
  const {data, error} = await q;
  if (error) throw error;
  const ids = data.map(c => c.id);
  const ach = ids.length ? (await sb.from('obras_auditoria_achados').select('comprovante_id,nivel,mensagem').in('comprovante_id', ids).eq('resolvido', false)).data || [] : [];
  return data.map(c => ({...c, achados: ach.filter(a => a.comprovante_id === c.id)}));
}
function tabelaRecibos(lista) {
  if (!lista.length) return '<div class="small mut">Nenhum recibo.</div>';
  return `<div class="tw"><table><tr><th>Data</th><th>Fornecedor / descrição</th><th>Categoria</th><th class="r">Valor</th><th></th></tr>${lista.map(c => `
    <tr><td>${dBR(c.data_despesa)}${c.hora_documento ? `<div class="mut">${esc(c.hora_documento)}</div>` : ''}</td>
    <td>${esc(c.fornecedor || '—')}<div class="mut">${esc(c.descricao || '')}</div>
      ${c.status !== 'lancado' ? `<span class="chip s-fechada">${esc(c.status)}</span>` : ''}
      ${c.achados.map(a => `<div class="${a.nivel === 'critico' ? 'crit' : 'warn'}">⚠ ${esc(a.mensagem)}</div>`).join('')}</td>
    <td>${esc(CATS[c.categoria] || c.categoria)}</td>
    <td class="r">${c.status === 'lancado' ? brl(c.valor) : `<span class="mut">${brl(c.valor)}</span>`}</td>
    <td>${linkArquivo(c.arquivo_path)}</td></tr>`).join('')}</table></div>`;
}
