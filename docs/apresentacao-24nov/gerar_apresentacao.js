const pptxgen = require("pptxgenjs");
const { applyTheme } = require("/root/.claude/skills/synced/6a3e1f69-d971-4eeb-ac67-fc5595712890_ba5755bf-d92b-4689-b6f2-5d74aa5ce6d9/pptx/scripts/apply_theme.js");

const OUT = process.argv[2] || "Esposende_2026.pptx";

const HEX = { ink: "0F2E2C", ink2: "1F4D49", gold: "C9A227", sage: "6FA39A", paper: "FFFFFF", mist: "EEF4F2", grey: "5B6B69", warn: "B5562F", green: "2E7D6B" };
const THEME = {
  name: "Esposende 2026", headFontFace: "Cambria", bodyFontFace: "Calibri",
  colors: { dk1: HEX.ink, lt1: HEX.paper, dk2: HEX.ink2, lt2: HEX.mist, accent1: HEX.gold, accent2: HEX.sage, accent3: HEX.warn, accent4: HEX.green, accent5: "8FB8B0", accent6: "D9C27A", hlink: HEX.green, folHlink: HEX.grey },
};

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.title = "Esposende 2026 — Controle, eficiência e evolução da gestão";
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
const C = pres.SchemeColor;
const H = THEME.headFontFace;

// ---------- layouts ----------
pres.defineSlideMaster({
  title: "CAPA", background: { color: C.text1 },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.8, y: 2.0, w: 11.7, h: 1.4, fontSize: 54, bold: true, color: C.background1, fontFace: H, valign: "bottom", align: "left" }, text: "" } },
    { placeholder: { options: { name: "body", type: "body", x: 0.8, y: 3.55, w: 11.7, h: 0.8, fontSize: 24, color: C.accent1, valign: "top", align: "left" }, text: "" } },
  ],
});
pres.defineSlideMaster({
  title: "CONTEUDO", background: { color: C.background1 }, margin: [0.5, 0.6, 0.6, 0.6],
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.35, w: 12.1, h: 0.9, fontSize: 34, bold: true, color: C.text1, fontFace: H, valign: "middle", align: "left" }, text: "" } },
    { placeholder: { options: { name: "fonte", type: "body", x: 0.6, y: 7.0, w: 10.8, h: 0.3, fontSize: 10, color: C.text2, valign: "middle", align: "left" }, text: "" } },
  ],
  slideNumber: { x: 12.2, y: 7.0, w: 0.5, h: 0.3, fontSize: 10, color: C.text2, align: "right" },
});

// ---------- helpers ----------
let shapeN = 0;
const nm = (p) => `${p} ${++shapeN}`;
const card = (s, x, y, w, h, fill) => s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.12, objectName: nm("Cartão"), fill: { color: fill || C.background2 }, line: { color: fill || C.background2 } });
const txt = (s, text, o) => s.addText(text, Object.assign({ isTextBox: true, margin: 0, objectName: nm("Texto") }, o));
const dot = (s, x, y, label, fill, color) => {
  s.addShape(pres.shapes.OVAL, { x, y, w: 0.55, h: 0.55, fill: { color: fill }, line: { color: fill }, objectName: nm("Círculo") });
  txt(s, String(label), { x, y, w: 0.55, h: 0.55, fontSize: 16, bold: true, color, align: "center", valign: "middle" });
};
const pill = (s, x, y, w, label, fill) => {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h: 0.34, rectRadius: 0.17, fill: { color: fill }, line: { color: fill }, objectName: nm("Selo") });
  txt(s, label, { x, y, w, h: 0.34, fontSize: 11, bold: true, color: C.background1, align: "center", valign: "middle" });
};
const stat = (s, x, y, w, h, value, label, opt = {}) => {
  card(s, x, y, w, h, opt.fill);
  txt(s, value, { x: x + 0.3, y: y + 0.25, w: w - 0.6, h: h * 0.45, fontSize: opt.size || 30, bold: true, color: opt.color || C.text1, fontFace: H, valign: "bottom" });
  txt(s, label, { x: x + 0.3, y: y + 0.3 + h * 0.45, w: w - 0.6, h: h * 0.45 - 0.45, fontSize: 14, color: opt.labelColor || C.text2, valign: "top" });
};
const chartBase = () => ({
  dataLabelColor: HEX.ink, dataLabelFontSize: 12, dataLabelFontFace: "+mn-lt",
  catAxisLabelColor: HEX.grey, catAxisLabelFontSize: 12, catAxisLabelFontFace: "+mn-lt",
  valAxisHidden: true, valGridLine: { style: "none" }, catGridLine: { style: "none" }, showLegend: false,
  showTitle: true, titleFontSize: 14, titleColor: HEX.ink, titleFontFace: "+mn-lt",
});
const content = (title, section, fonte) => {
  const s = pres.addSlide({ masterName: "CONTEUDO", sectionTitle: section });
  s.addText(title, { placeholder: "title" });
  s.addText(fonte, { placeholder: "fonte" });
  return s;
};
const F_CMP = "Fonte: base de Compras do Portal (solicitações aprovadas e pedidos de compra) · corte 13/11/2026";
const F_INV = "Fonte: Portal Esposende · Sistema de Auditoria de Inventário · 10 inventários de ago a out/2026";
const F_AJ = "Fonte: Portal Esposende · Acerto de Estoque (SETA) · 18/09 a 13/11/2026";
const F_FIN = "Fonte: Portal Esposende · Auditoria Financeira e NF-e Canceladas · consulta de 13/11/2026";

// =========================================================
const F_ALM = "Fonte: Portal Esposende · Almoxarifado · custo atendido às lojas, toda a rede · consulta de 13/11/2026";
const F_IA = "Fonte: registros de execução do Portal Esposende (agentes, Sentinela, inventário e acerto de estoque) · ago a nov/2026";
const F_CUR = "Fonte: Portal Esposende · Universidade Esposende (aulas, avaliações e certificados) · 01/10 a 11/11/2026";

pres.addSection({ title: "Abertura" });
let s = pres.addSlide({ masterName: "CAPA", sectionTitle: "Abertura" });
s.addText("ESPOSENDE 2026", { placeholder: "title" });
s.addText("Auditoria inteligente: menos custo, mais controle, mais velocidade", { placeholder: "body" });
txt(s, "Compras  •  Consumo  •  Acerto de Estoque  •  Saci  •  Cursos  •  Inteligência Artificial", { x: 0.8, y: 4.5, w: 11.7, h: 0.5, fontSize: 18, color: C.background2 });
txt(s, "Apresentação de resultados · 24/11/2026 · dados do Portal Esposende com corte em 13/11/2026", { x: 0.8, y: 6.5, w: 11.7, h: 0.4, fontSize: 12, color: C.accent2 });
s.addNotes("Abertura (40 s). Todos os números saíram da base do Portal Esposende, com corte em 13/11. A mensagem: a auditoria deixou de só conferir depois e passou a cruzar dados na hora, com inteligência artificial.");

// 2. RESUMO
pres.addSection({ title: "Resumo" });
s = content("O ano em seis números", "Resumo", "Fonte: Portal Esposende · corte 13/11/2026 · detalhes nos próximos slides");
[
  ["R$ 60,1 mil", "economizados nas compras com cotação (23,3% abaixo da maior proposta)", C.accent4],
  ["−R$ 36,4 mil", "por mês em sacola, embalagem, bobina e café (−33,8% sobre o mês anterior)", C.accent4],
  ["−44%", "nos acertos de estoque por semana desde que cada pedido passou a ter dono", C.accent1],
  ["99,9%", "dos 11.827 acertos executados no sistema em menos de 10 minutos", C.text1],
  ["75 segundos", "para cruzar um inventário inteiro de 12 mil itens", C.text1],
  ["107 pessoas", "treinadas em 45 lojas, com nota média 9,4 e 74 certificados", C.text1],
].forEach(([v, l, c], i) => {
  const x = 0.6 + (i % 3) * 4.11, y = 1.5 + Math.floor(i / 3) * 2.7;
  stat(s, x, y, 3.91, 2.5, v, l, { color: c, size: 36 });
});
s.addNotes("Resumo (1,5 min). Economia em compras e consumo; acerto de estoque com dono, que caiu 44%; velocidade da IA; e as pessoas treinadas.");

// 3. CRITÉRIO
s = content("Como medimos: só conta o que tem prova", "Resumo", "Critério da Auditoria · aplicado a todos os números desta apresentação");
[["Economia em compras", "(maior cotação − valor contratado) ÷ maior cotação", "Quanto cada compra ficou abaixo do preço que seria pago sem disputa."],
 ["Redução de consumo", "custo do mês ÷ custo do mês anterior − 1", "Mesmo item, toda a rede, períodos de 30 dias seguidos."]].forEach(([t, f, d], i) => {
  const x = 0.6 + i * 6.23;
  card(s, x, 1.5, 5.9, 2.5);
  txt(s, t, { x: x + 0.35, y: 1.75, w: 5.2, h: 0.5, fontSize: 22, bold: true, color: C.text1, fontFace: H });
  txt(s, f, { x: x + 0.35, y: 2.35, w: 5.2, h: 0.8, fontSize: 18, italic: true, color: C.accent4 });
  txt(s, d, { x: x + 0.35, y: 3.2, w: 5.2, h: 0.6, fontSize: 14, color: C.text2 });
});
card(s, 0.6, 4.35, 12.13, 2.25, C.text1);
txt(s, [
  { text: "Comprovado: ", options: { bold: true, color: C.accent1 } },
  { text: "compra aprovada com cotações registradas, ou movimento lançado no sistema.", options: { color: C.background1, breakLine: true } },
  { text: "Fora da conta: ", options: { bold: true, color: C.accent1 } },
  { text: "corte de orçamento e achados ainda não validados.", options: { color: C.background1 } },
], { x: 1.0, y: 4.55, w: 11.3, h: 1.85, fontSize: 20, valign: "middle", paraSpaceAfter: 8 });
s.addNotes("Critério (1 min). Só entra o que tem registro. Achados ainda em validação ficaram fora desta apresentação.");

// 4. COMPRAS POR ÁREA
pres.addSection({ title: "Compras e consumo" });
s = content("Compras: R$ 60,1 mil economizados nas cotações", "Compras e consumo", F_CMP);
s.addChart(pres.charts.BAR, [{ name: "Economia (R$)", labels: ["Facilities", "Comercial", "T.I.C", "Logística"], values: [38487.67, 11901.60, 8351.21, 1375.00] }],
  Object.assign(chartBase(), { x: 0.6, y: 1.45, w: 6.4, h: 5.2, barDir: "bar", objectName: "Gráfico economia por área", chartColors: [HEX.ink2], showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: '"R$" #,##0', catAxisOrientation: "maxMin", title: "Economia em R$ por área" }));
const rows = [
  ["Área", "Pedidos", "Economia", "% econ.", "Partic."],
  ["Facilities", "12", "R$ 38.487,67", "24,2%", "64,0%"],
  ["Comercial", "2", "R$ 11.901,60", "37,9%", "19,8%"],
  ["T.I.C", "2", "R$ 8.351,21", "17,3%", "13,9%"],
  ["Logística", "2", "R$ 1.375,00", "7,3%", "2,3%"],
  ["Total", "18", "R$ 60.115,48", "23,3%", "100%"],
].map((r, i) => r.map((c, j) => ({ text: c, options: { bold: i === 0 || i === 5, color: i === 0 ? HEX.paper : HEX.ink, fill: { color: i === 0 ? HEX.ink : (i === 5 ? "E4EDEA" : HEX.paper) }, align: j === 0 ? "left" : "right", fontSize: 14 } })));
s.addTable(rows, { x: 7.3, y: 1.6, w: 5.43, colW: [1.35, 0.85, 1.43, 0.9, 0.9], rowH: 0.45, border: { type: "solid", pt: 0.5, color: "D5E0DD" }, margin: [0, 0.08, 0, 0.08], valign: "middle", objectName: "Tabela economia por área" });
txt(s, [
  { text: "R$ 257,6 mil ", options: { bold: true, color: C.text1 } },
  { text: "seria o valor pela maior cotação. Contratamos por R$ 197,5 mil, com média de 2,3 cotações por compra.", options: { color: C.text2 } },
], { x: 7.3, y: 4.6, w: 5.43, h: 1.2, fontSize: 14, valign: "top" });
s.addNotes("Compras por área (1,5 min). 18 compras aprovadas com cotação. Facilities tem 64% da economia; Comercial tem o maior percentual, 37,9%, puxado pela fita.");

// 5. MELHORES DESCONTOS
s = content("Os melhores descontos do ano", "Compras e consumo", F_CMP);
s.addChart(pres.charts.BAR, [{ name: "Desconto (%)", labels: ["Fita de empacotamento", "Difusores de ar", "20 cadeiras executivas", "Relógios de ponto", "Telhas e metalon (CD)", "Ar-condicionado 55 mil BTUs", "Cremalheiras e suportes", "Filme stretch"], values: [44.7, 42.1, 33.5, 29.6, 28.6, 28.2, 28.1, 21.6] }],
  Object.assign(chartBase(), { x: 0.6, y: 1.45, w: 7.6, h: 5.2, barDir: "bar", objectName: "Gráfico melhores descontos", chartColors: [HEX.ink2], showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: '0.0"%"', catAxisOrientation: "maxMin", title: "Desconto sobre a maior cotação (%)" }));
card(s, 8.6, 1.45, 4.13, 2.6, C.text1);
txt(s, "Fita de empacotamento", { x: 8.9, y: 1.65, w: 3.6, h: 0.4, fontSize: 16, bold: true, color: C.accent1 });
txt(s, "R$ 11.901,60", { x: 8.9, y: 2.1, w: 3.6, h: 0.7, fontSize: 30, bold: true, color: C.background1, fontFace: H, valign: "middle" });
txt(s, "3 propostas: R$ 26.640 · R$ 20.592 · R$ 14.738. Fechado na menor.", { x: 8.9, y: 2.9, w: 3.6, h: 0.9, fontSize: 14, color: C.background2, valign: "top" });
card(s, 8.6, 4.25, 4.13, 2.4);
txt(s, "Difusores de ar", { x: 8.9, y: 4.45, w: 3.6, h: 0.4, fontSize: 16, bold: true, color: C.text1 });
txt(s, "−45,5%", { x: 8.9, y: 4.9, w: 3.6, h: 0.7, fontSize: 30, bold: true, color: C.accent1, fontFace: H, valign: "middle" });
txt(s, "R$ 13.550 → R$ 7.852 na cotação, e mais 6,01% renegociados no pedido: R$ 7.380.", { x: 8.9, y: 5.65, w: 3.6, h: 0.9, fontSize: 14, color: C.text2, valign: "top" });
s.addNotes("Melhores descontos (1,5 min). A fita é o caso mais forte: três fornecedores, diferença de quase R$ 12 mil entre a maior e a menor proposta. Difusores: a cotação trouxe 42,1% e a auditoria do pedido mais 6,01%, total 45,5%.");

// 6. CONSUMO
s = content("Consumo: R$ 36,4 mil a menos no último mês", "Compras e consumo", F_ALM);
s.addChart(pres.charts.BAR, [
  { name: "Mês anterior", labels: ["Sacolas", "Embalagens p/ presente", "Café", "Bobinas"], values: [52468.00, 22716.22, 17048.40, 15297.86] },
  { name: "Último mês", labels: ["Sacolas", "Embalagens p/ presente", "Café", "Bobinas"], values: [37244.00, 9277.00, 14133.10, 10479.04] },
], Object.assign(chartBase(), { x: 0.6, y: 1.45, w: 7.8, h: 5.2, barDir: "col", barGrouping: "clustered", objectName: "Gráfico consumo antes e depois", chartColors: [HEX.sage, HEX.ink2], showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: '"R$" #,##0', dataLabelFontSize: 10, showLegend: true, legendPos: "b", legendFontSize: 12, legendColor: HEX.grey, legendFontFace: "+mn-lt", title: "Custo atendido às lojas (R$)" }));
[["Sacolas", "−R$ 15.224", "−29,0%"], ["Embalagens", "−R$ 13.439", "−59,2%"], ["Bobinas", "−R$ 4.819", "−31,5%"], ["Café", "−R$ 2.915", "−17,1%"]].forEach(([n, v, p], i) => {
  const y = 1.45 + i * 1.08;
  card(s, 8.8, y, 3.93, 0.95);
  txt(s, n, { x: 9.05, y, w: 1.5, h: 0.95, fontSize: 15, bold: true, color: C.text1, valign: "middle" });
  txt(s, v, { x: 10.5, y, w: 1.35, h: 0.95, fontSize: 15, bold: true, color: C.accent4, valign: "middle", align: "right" });
  txt(s, p, { x: 11.9, y, w: 0.7, h: 0.95, fontSize: 13, color: C.text2, valign: "middle", align: "right" });
});
card(s, 8.8, 5.85, 3.93, 0.8, C.text1);
txt(s, [{ text: "Total: ", options: { color: C.background1 } }, { text: "−R$ 36.397,34 (−33,8%)", options: { bold: true, color: C.accent1 } }], { x: 9.05, y: 5.85, w: 3.5, h: 0.8, fontSize: 16, valign: "middle" });
s.addNotes("Consumo (1,5 min). Sacolas, embalagens e bobinas: 07/10 a 06/11 contra 07/09 a 06/10. Café: outubro contra setembro. É redução de consumo mês a mês; parte pode ser sazonal, então vamos acompanhar a tendência nos próximos meses.");

// 7. FITA E ETIQUETA
s = content("Fita e etiqueta: mesma compra, resultados diferentes", "Compras e consumo", F_CMP);
card(s, 0.6, 1.5, 5.9, 5.1, C.text1);
txt(s, "Fita de empacotamento 45 mm × 100 m", { x: 0.95, y: 1.75, w: 5.2, h: 0.5, fontSize: 18, bold: true, color: C.accent1 });
txt(s, "3 cotações", { x: 0.95, y: 2.35, w: 5.2, h: 0.4, fontSize: 14, color: C.background2 });
[["Naga Soluções", 26640.00, "R$ 26.640,00"], ["Grupo Fortpel", 20592.00, "R$ 20.592,00"], ["Alltape Fitas", 14738.40, "R$ 14.738,40 ✔"]].forEach(([f, v, l], i) => {
  const y = 2.9 + i * 0.75;
  txt(s, f, { x: 0.95, y, w: 1.9, h: 0.5, fontSize: 14, color: C.background1, valign: "middle" });
  const w = 2.0 * v / 26640;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 2.9, y: y + 0.1, w, h: 0.3, rectRadius: 0.05, fill: { color: i === 2 ? HEX.gold : HEX.sage }, line: { color: i === 2 ? HEX.gold : HEX.sage }, objectName: nm("Barra cotação") });
  txt(s, l, { x: 2.9 + w + 0.1, y, w: 1.6, h: 0.5, fontSize: 13, bold: i === 2, color: C.background1, valign: "middle" });
});
txt(s, [{ text: "R$ 11.901,60 economizados", options: { bold: true, color: C.accent1, breakLine: true } }, { text: "44,7% abaixo da maior proposta", options: { color: C.background1 } }], { x: 0.95, y: 5.3, w: 5.2, h: 1.0, fontSize: 18, valign: "middle" });
card(s, 6.83, 1.5, 5.9, 5.1);
txt(s, "Etiquetas adesivas (165.300 un. + 100 rolos)", { x: 7.18, y: 1.75, w: 5.2, h: 0.5, fontSize: 18, bold: true, color: C.text1 });
txt(s, "1 cotação", { x: 7.18, y: 2.35, w: 5.2, h: 0.4, fontSize: 14, color: C.accent3, bold: true });
txt(s, "R$ 12.503,90", { x: 7.18, y: 2.9, w: 5.2, h: 0.9, fontSize: 36, bold: true, color: C.text1, fontFace: H, valign: "middle" });
txt(s, "Plus Etiquetas, sem concorrente. Sem disputa, não há como medir a economia.", { x: 7.18, y: 3.85, w: 5.2, h: 0.8, fontSize: 15, color: C.text2 });
card(s, 7.18, 4.85, 5.2, 1.5, C.background1);
txt(s, [{ text: "Oportunidade: ", options: { bold: true, color: C.accent4 } }, { text: "se a próxima compra de etiquetas tiver a mesma disputa da fita (−44,7%), a economia pode passar de R$ 5 mil.", options: { color: C.text1 } }], { x: 7.4, y: 4.95, w: 4.8, h: 1.3, fontSize: 14, valign: "middle" });
s.addNotes("Fita e etiqueta (1 min). Mostra por que a cotação importa: a fita teve três propostas e economizou 44,7%; a etiqueta teve uma só. A estimativa de R$ 5 mil é uma projeção, não economia realizada.");

// 8. ACERTO DE ESTOQUE
pres.addSection({ title: "Estoque" });
s = content("Acerto de estoque: cada ajuste agora tem dono", "Estoque", F_AJ);
s.addChart(pres.charts.BAR, [{ name: "Acertos por semana", labels: ["21/09", "28/09", "05/10", "12/10", "19/10", "26/10", "02/11"], values: [2069, 1904, 1662, 1387, 1299, 1241, 1162] }],
  Object.assign(chartBase(), { x: 0.6, y: 1.45, w: 7.4, h: 5.2, barDir: "col", objectName: "Gráfico acertos semanais", chartColors: [HEX.ink2], showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "#,##0", title: "Acertos concluídos por semana (semanas completas)" }));
stat(s, 8.4, 1.45, 4.33, 1.55, "−44%", "de acertos por semana entre 21/09 e 02/11", { size: 36, color: C.accent1 });
stat(s, 8.4, 3.15, 4.33, 1.55, "11.827 acertos", "13.213 peças em 65 lojas · R$ 487 mil a custo", { size: 26 });
card(s, 8.4, 4.85, 4.33, 1.8, C.text1);
txt(s, [
  { text: "Antes: ", options: { bold: true, color: C.accent1 } },
  { text: "pedido solto no WhatsApp, sem registro. ", options: { color: C.background1 } },
  { text: "Agora: ", options: { bold: true, color: C.accent1 } },
  { text: "100% com solicitante, loja e protocolo, e 99,9% lançados no SETA em menos de 10 min.", options: { color: C.background1 } },
], { x: 8.7, y: 5.0, w: 3.8, h: 1.5, fontSize: 14, valign: "middle" });
s.addNotes("Acerto de estoque (1,5 min). Quando o pedido passa a ter nome e protocolo, o volume cai: de 2.069 para 1.162 por semana. E a execução é automática: 11.813 dos 11.827 acertos foram lançados no SETA em menos de 10 minutos.");

// 9. INVENTÁRIO
s = content("Inventário: R$ 9,40 mi conferidos, perda de 1,38%", "Estoque", F_INV);
s.addChart(pres.charts.BAR, [{ name: "Perda (R$)", labels: ["L14 ago*", "L74 out", "L14 out", "L06 out", "L72 out", "L15 set*", "L50 ago", "L46 set"], values: [38699.03, 25793.53, 21109.19, 19649.50, 13121.56, 9627.27, 3668.12, 443.85] }],
  Object.assign(chartBase(), { x: 0.6, y: 1.45, w: 7.4, h: 5.2, barDir: "bar", objectName: "Gráfico perda por inventário", chartColors: [HEX.ink2], showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: '"R$" #,##0', catAxisOrientation: "maxMin", title: "Perda a custo por inventário" }));
stat(s, 8.4, 1.45, 4.33, 1.55, "R$ 129.484,90", "perda líquida a custo em 10 inventários (8 lojas)", { size: 28, color: C.accent3 });
stat(s, 8.4, 3.15, 4.33, 1.55, "64.380 itens", "cruzados com o sistema · 75 s para 12 mil itens", { size: 28 });
card(s, 8.4, 4.85, 4.33, 1.8, C.text1);
txt(s, [{ text: "Leitura: ", options: { bold: true, color: C.accent1 } }, { text: "perdas de 1,1% a 1,8% nos inventários gerais. L14 ago e L15 set (*) foram parciais. L28 e L14 em setembro tiveram sobra.", options: { color: C.background1 } }], { x: 8.7, y: 5.0, w: 3.8, h: 1.5, fontSize: 14, valign: "middle" });
s.addNotes("Inventário (1,5 min). Estoque a custo passou de R$ 9.397.031 para R$ 9.267.546 nos 10 inventários. O Portal cruza a contagem com o sistema em cerca de 75 segundos por loja inteira.");

// 10. SACI
s = content("Casamento de Saci: pé sem par volta para a venda", "Estoque", "Fonte: Portal Esposende · Casamento de Saci (última carga 21/09/2026) e Saldo de Pedidos de Transferência (06/10/2026)");
card(s, 0.6, 1.5, 5.9, 5.1, C.text1);
txt(s, "13.811", { x: 0.95, y: 1.8, w: 5.2, h: 1.2, fontSize: 66, bold: true, color: C.accent1, fontFace: H, valign: "middle" });
txt(s, "calçados avulsos (pé esquerdo ou direito sem o par) mapeados na rede", { x: 0.95, y: 3.05, w: 5.2, h: 0.9, fontSize: 18, color: C.background1 });
txt(s, "Cada pé parado é um par que não vende. O Portal encontra o par em outra loja e indica a transferência.", { x: 0.95, y: 4.3, w: 5.2, h: 1.2, fontSize: 15, color: C.background2 });
const passosS = [["Mapear", "o pé avulso em cada loja"], ["Cruzar", "com o saldo da rede (5.411 linhas de transferência)"], ["Transferir", "o pé que falta para a loja do par"], ["Vender", "o par completo de novo"]];
passosS.forEach(([t, d], i) => {
  const y = 1.5 + i * 1.3;
  card(s, 6.83, y, 5.9, 1.15);
  dot(s, 7.1, y + 0.3, i + 1, i === 3 ? HEX.gold : HEX.ink, i === 3 ? C.text1 : C.background1);
  txt(s, t, { x: 7.9, y: y + 0.1, w: 1.6, h: 0.95, fontSize: 18, bold: true, color: C.text1, valign: "middle" });
  txt(s, d, { x: 9.5, y: y + 0.1, w: 3.0, h: 0.95, fontSize: 14, color: C.text2, valign: "middle" });
});
s.addNotes("Saci (1,5 min). Exemplos por loja: loja 14 com 133 pés avulsos, loja 20 com 100, loja 13 com 93, loja 15 com 90. A última carga é de 21/09: recarregar antes do dia 24 para mostrar quantos pares já foram casados.");

// 11. IA
pres.addSection({ title: "Inteligência" });
s = content("Inteligência artificial: cruzar dados em segundos", "Inteligência", F_IA);
const ia = [["22.647", "perguntas respondidas pelo Portal", "resposta típica em 0,6 s"], ["30.210", "testes automáticos do Sentinela", "conferem se cada número bate com a fonte"], ["75 s", "para cruzar um inventário de 12 mil itens", "contagem × sistema, item a item"], ["99,9%", "dos acertos lançados no SETA em menos de 10 min", "11.813 de 11.827"]];
ia.forEach(([v, l, d], i) => {
  const x = 0.6 + (i % 2) * 3.2, y = 1.5 + Math.floor(i / 2) * 2.6;
  card(s, x, y, 3.0, 2.4);
  txt(s, v, { x: x + 0.25, y: y + 0.2, w: 2.5, h: 0.8, fontSize: 32, bold: true, color: i === 0 ? C.accent4 : C.text1, fontFace: H, valign: "middle" });
  txt(s, l, { x: x + 0.25, y: y + 1.0, w: 2.5, h: 0.75, fontSize: 14, bold: true, color: C.text1, valign: "top" });
  txt(s, d, { x: x + 0.25, y: y + 1.75, w: 2.5, h: 0.5, fontSize: 12, color: C.text2, valign: "top" });
});
card(s, 7.1, 1.5, 5.63, 5.1, C.text1);
txt(s, "Como a IA responde", { x: 7.4, y: 1.7, w: 5.0, h: 0.5, fontSize: 18, bold: true, color: C.accent1 });
[["Pergunta", "em linguagem natural: “custo de sacola na loja 50?”"], ["22 agentes", "cada módulo tem um especialista"], ["Fonte oficial", "só lê a base do Portal, nunca estima"], ["Auditor", "confere o número antes de responder"], ["Resposta", "ou bloqueio, se houver inconsistência"]].forEach(([t, d], i) => {
  const y = 2.35 + i * 0.83;
  dot(s, 7.4, y, i + 1, HEX.gold, C.text1);
  txt(s, [{ text: t + "  ", options: { bold: true, color: C.background1 } }, { text: d, options: { color: C.background2 } }], { x: 8.15, y: y - 0.1, w: 4.4, h: 0.75, fontSize: 14, valign: "middle" });
});
s.addNotes("IA (2 min). Exemplo vivo: quando perguntamos o custo de materiais de limpeza, o próprio Portal recusou a resposta porque a fonte tinha inconsistência. A IA não inventa número: isso é o fator de inteligência na auditoria.");

// 12. CURSOS
s = content("Cursos: 107 colaboradores treinados em 45 lojas", "Inteligência", F_CUR);
s.addChart(pres.charts.BAR, [{ name: "Aulas", labels: ["Recebimento de Mercadoria", "Notas Fiscais", "Emitir Etiquetas", "Remanejo", "Defeito", "Fechamento de Volume"], values: [216, 132, 106, 97, 97, 91] }],
  Object.assign(chartBase(), { x: 0.6, y: 1.45, w: 6.8, h: 5.2, barDir: "bar", objectName: "Gráfico aulas por módulo", chartColors: [HEX.ink2], showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "#,##0", catAxisOrientation: "maxMin", title: "Aulas assistidas por módulo (739 no total)" }));
stat(s, 7.8, 1.45, 2.37, 1.6, "74", "certificados em Operações de Estoque", { size: 32, color: C.accent1 });
stat(s, 10.36, 1.45, 2.37, 1.6, "95,7 h", "de aula assistidas", { size: 32 });
stat(s, 7.8, 3.2, 2.37, 1.6, "9,4", "nota média dada aos cursos", { size: 32, color: C.accent4 });
stat(s, 10.36, 3.2, 2.37, 1.6, "92%", "acharam o curso útil (44 de 48)", { size: 32 });
card(s, 7.8, 4.95, 4.93, 1.7, C.text1);
txt(s, [{ text: "Ligação direta com o estoque: ", options: { bold: true, color: C.accent1 } }, { text: "os módulos mais vistos são os que geram acerto e divergência (recebimento, notas e etiquetas).", options: { color: C.background1 } }], { x: 8.1, y: 5.05, w: 4.4, h: 1.5, fontSize: 14, valign: "middle" });
s.addNotes("Cursos (1,5 min). Universidade lançada em 01/10: 486 aulas concluídas e 488 avaliações aprovadas. Os 74 certificados são da trilha Operações de Estoque. Ponto para falar: treinamento + acerto com dono = queda de 44% nos acertos.");

// 13. OPORTUNIDADES
pres.addSection({ title: "Próximos passos" });
s = content("Oportunidades que a auditoria já enxergou", "Próximos passos", "Fonte: Portal Esposende · corte 13/11/2026");
[
  ["Etiquetas e papel A4", "Compradas com uma única cotação (R$ 12.503,90 e R$ 4.760,00). Exigir 3 propostas na próxima compra."],
  ["Pedidos de compra iguais", "PC-2026-000011 e PC-2026-000033: mesmo material, fornecedor e valor (R$ 5.817,34) no mesmo dia. Confirmar se não houve compra em dobro."],
  ["Sacola por venda", "Sacola ainda é o maior custo de consumo (R$ 37,2 mil no mês). Levar o curso e a meta de sacola por venda a todas as lojas."],
  ["Saci e limpeza", "Recarregar a base do Saci (última de 21/09) e corrigir a fonte de limpeza, que o Portal bloqueou."],
].forEach(([t, d], i) => {
  const y = 1.45 + i * 1.33;
  card(s, 0.6, y, 12.13, 1.18);
  dot(s, 0.9, y + 0.31, i + 1, i === 1 ? HEX.warn : HEX.ink, C.background1);
  txt(s, t, { x: 1.7, y: y + 0.12, w: 3.2, h: 0.94, fontSize: 17, bold: true, color: C.text1, valign: "middle" });
  txt(s, d, { x: 5.0, y: y + 0.12, w: 7.5, h: 0.94, fontSize: 14, color: C.text2, valign: "middle" });
});
s.addNotes("Oportunidades (1,5 min). Cada item tem dono e prazo para fechar.");

// 14. ENCERRAMENTO
s = pres.addSlide({ masterName: "CAPA", sectionTitle: "Próximos passos" });
s.addText("Próximos passos", { placeholder: "title" });
s.addText("Auditoria que cruza dados na hora e transforma controle em economia", { placeholder: "body" });
["Cotação obrigatória com 3 propostas para todo material de consumo",
  "Acerto de estoque com dono e curso em todas as lojas",
  "Saci e inventários gerais mensais, cruzados pela IA do Portal"].forEach((t, i) => {
  const y = 4.6 + i * 0.7;
  dot(s, 0.8, y, i + 1, HEX.gold, C.text1);
  txt(s, t, { x: 1.6, y, w: 10.9, h: 0.55, fontSize: 18, color: C.background1, valign: "middle" });
});
s.addNotes("Encerramento (40 s). Três compromissos. Abrir para perguntas.");

(async () => { await pres.writeFile({ fileName: OUT }); await applyTheme(OUT, THEME); console.log("ok"); })();
