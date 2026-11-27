#!/usr/bin/env node
// Gera o Laudo Técnico de Análise de Imagens de CFTV (PDF A4) a partir de um JSON.
// Uso: node gerar_laudo.js <laudo.json> [saida.pdf]
// Caminhos de imagem no JSON são relativos à pasta do JSON. Veja ../exemplo-laudo.json.
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');

const jsonPath = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(jsonPath)) { console.error('Uso: node gerar_laudo.js <laudo.json> [saida.pdf]'); process.exit(1); }
const L = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const baseDir = path.dirname(jsonPath);
const assets = path.join(__dirname, '..', 'assets');
const outPdf = path.resolve(process.argv[3] || L.saida || path.join(baseDir, 'LAUDO_CFTV.pdf'));

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Texto com **negrito** permitido; todo o resto é escapado.
const rich = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const dataUri = f => {
  const p = path.isAbsolute(f) ? f : path.join(baseDir, f);
  if (!fs.existsSync(p)) throw new Error('Imagem não encontrada: ' + p);
  const ext = path.extname(p).toLowerCase().replace('.', '');
  return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,` + fs.readFileSync(p).toString('base64');
};
const logo = dataUri(L.logo || path.join(assets, 'logo.jpg'));
const assPadrao = path.join(assets, 'assinatura-auditoria.png');
if (L.auditor?.assinatura !== false && !L.auditor?.assinatura && !fs.existsSync(assPadrao)) {
  try { require('child_process').execFileSync('curl', ['-sSfL', '-o', assPadrao, 'https://raw.githubusercontent.com/raqueri1970-sketch/portal-esposende-login/main/curso/cert/assinatura-auditoria.png']); }
  catch (e) { console.error('Assinatura não encontrada. Copie curso/cert/assinatura-auditoria.png do repositório portal-esposende-login para ' + assPadrao); process.exit(1); }
}
const assinatura = L.auditor?.assinatura === false ? null : dataUri(L.auditor?.assinatura || assPadrao);
const empresa = L.empresa || 'Esposende Calçados';

const meta = (L.cabecalho || []).map(([k, v]) => `<div><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('');
const paras = a => (a || []).map(t => `<p>${rich(t)}</p>`).join('');
const rows = (a, n) => (a || []).map(r => `<tr>${r.slice(0, n).map((c, i) => `<td${i === n - 1 && n === 5 ? ' class="mono"' : ''}>${rich(c)}</td>`).join('')}</tr>`).join('');

const fotos = (L.fotos || []).map((f, i) => `
<div class="ev"><div class="evh"><b>Foto ${i + 1} — ${esc(f.titulo)}</b><span>${esc(f.referencia)}</span></div>
<div class="imgs"><div><img src="${dataUri(f.quadro)}"><div class="lbl">Quadro original</div></div>${f.zoom ? `<div><img src="${dataUri(f.zoom)}"><div class="lbl">Ampliação da área assinalada</div></div>` : ''}</div>
<div class="desc">${rich(f.descricao)}</div></div>`).join('');

let n = 0; const sec = t => `<h2>${++n}. ${esc(t)}</h2>`;
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
@page{size:A4;margin:30mm 14mm 16mm}
*{box-sizing:border-box}
body{font-family:"Helvetica Neue",Arial,sans-serif;color:#1b2230;font-size:10pt;line-height:1.5;margin:0}
.hd{display:flex;justify-content:space-between;align-items:center;border-bottom:2.5px solid #14304f;padding-bottom:8px}
.hd .t1{font-size:8pt;letter-spacing:2px;color:#5a6577;text-transform:uppercase}
.hd h1{font-size:18pt;margin:2px 0 0;color:#14304f;letter-spacing:.3px}
.conf{border:1.5px solid #9b1c1c;color:#9b1c1c;font-weight:bold;font-size:8pt;padding:5px 10px;letter-spacing:1.5px}
.meta{display:grid;grid-template-columns:1fr 1fr 1.25fr 1.25fr;border:1px solid #cdd4df;margin:12px 0 6px}
.meta div{padding:6px 9px;border-right:1px solid #cdd4df;border-bottom:1px solid #cdd4df}
.meta div:nth-child(4n){border-right:none}
.meta b{display:block;font-size:7.5pt;color:#5a6577;text-transform:uppercase;letter-spacing:.6px;font-weight:600}
.meta span{font-weight:bold;font-size:9.5pt}
h2{break-after:avoid;page-break-after:avoid;font-size:10.5pt;color:#14304f;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #14304f;padding-bottom:3px;margin:16px 0 7px}
p{margin:0 0 7px;text-align:justify}
table{width:100%;border-collapse:collapse;font-size:8.8pt}
th{background:#14304f;color:#fff;text-align:left;padding:5px 7px;font-weight:600}
td{padding:5px 7px;border-bottom:1px solid #dde2ea;vertical-align:top}
tr{page-break-inside:avoid} tr:nth-child(even) td{background:#f5f7fa}
.mono{font-family:"Courier New",monospace;font-size:7.6pt;word-break:break-all}
.ev{page-break-inside:avoid;border:1px solid #cdd4df;margin-bottom:10px}
.evh{background:#eef2f7;padding:5px 9px;display:flex;justify-content:space-between;font-size:8.8pt;border-bottom:1px solid #cdd4df}
.evh b{color:#14304f}
.imgs{display:flex;gap:6px;padding:6px;align-items:flex-start}
.imgs img{display:block;height:51mm;max-width:118mm;object-fit:contain;border:1px solid #b9c2cf}
.lbl{font-size:7pt;color:#5a6577;margin-top:2px;text-align:center}
.desc{padding:0 9px 7px;font-size:9.2pt;text-align:justify}
.concl{border-left:4px solid #14304f;background:#f2f5f9;padding:10px 13px}
.sigbox{margin:26px auto 0;width:75mm;text-align:center;page-break-inside:avoid}
.sigbox img{height:19mm;display:block;margin:0 auto -3mm}
.sig{border-top:1px solid #1b2230;text-align:center;padding-top:5px;font-size:9pt}
.sig small{display:block;color:#5a6577}
ol{margin:0 0 7px;padding-left:18px} li{margin-bottom:3px}
</style></head><body>
<div class="hd"><div><div class="t1">${esc(L.subtitulo || 'Prevenção de Perdas')}</div><h1>${esc(L.titulo || 'Laudo Técnico de Análise de Imagens de CFTV')}</h1></div><div class="conf">CONFIDENCIAL</div></div>
<div class="meta">${meta}</div>
${sec('Objeto do laudo')}${paras(L.objeto)}
${sec('Contexto')}${paras(L.contexto)}
${sec('Material examinado')}
<table><tr><th style="width:11%">Arquivo</th><th style="width:9%">Câmera</th><th style="width:24%">Horário (relógio do DVR)</th><th style="width:9%">Duração</th><th>Código de integridade SHA-256</th></tr>
${(L.material || []).map(m => `<tr><td>${esc(m.arquivo)}</td><td>${esc(m.camera)}</td><td>${esc(m.horario)}</td><td>${esc(m.duracao)}</td><td class="mono">${esc(m.sha256)}</td></tr>`).join('')}</table>
<p style="margin-top:7px">Os quadros reproduzidos neste laudo foram extraídos diretamente dos arquivos acima, sem edição de conteúdo. Em cada quadro, a data e a hora exibidas correspondem ao relógio do gravador (DVR). As ampliações foram obtidas por recorte da área assinalada em vermelho no quadro original.</p>
${sec('Síntese cronológica')}
<table><tr><th style="width:17%">Horário</th><th style="width:12%">Câmera</th><th>Fato registrado</th></tr>${rows(L.cronologia, 3)}</table>
${sec('Registro fotográfico e descrição dos fatos')}${fotos}
${sec('Análise')}<ol>${(L.analise || []).map(t => `<li>${rich(t)}</li>`).join('')}</ol>
<div style="page-break-inside:avoid">${sec('Conclusão')}<div class="concl">${rich(L.conclusao)}</div>
<p style="margin-top:14px">${rich(L.fechamento || '')}</p>
<div class="sigbox">${assinatura ? `<img src="${assinatura}">` : '<div style="height:16mm"></div>'}<div class="sig">${esc(L.auditor?.nome || 'Auditoria Interna')}<small>${esc(L.auditor?.rodape || '')}</small></div></div></div>
</body></html>`;

(async () => {
  const htmlPath = outPdf.replace(/\.pdf$/i, '') + '.html';
  fs.writeFileSync(htmlPath, html);
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + htmlPath, { waitUntil: 'load' });
  await p.pdf({
    path: outPdf, format: 'A4', printBackground: true, displayHeaderFooter: true,
    headerTemplate: `<div style="width:100%;margin:0 14mm;display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px solid #14304f;padding:7mm 0 2.5mm;font-family:Arial;-webkit-print-color-adjust:exact"><img src="${logo}" style="height:10mm"><span style="font-size:7.5pt;color:#14304f;letter-spacing:1px;text-transform:uppercase;font-weight:bold">${esc(L.cabecalho_pagina || 'Auditoria Interna · Laudo Técnico de CFTV')}</span></div>`,
    footerTemplate: `<div style="font-size:7pt;color:#5a6577;width:100%;text-align:center;font-family:Arial">${esc(empresa)} — Laudo Técnico de CFTV — Confidencial — Página <span class=pageNumber></span> de <span class=totalPages></span></div>`,
    margin: { top: '30mm', bottom: '16mm', left: '14mm', right: '14mm' }
  });
  await b.close();
  fs.unlinkSync(htmlPath);
  console.log('PDF gerado: ' + outPdf);
})().catch(e => { console.error(e); process.exit(1); });
