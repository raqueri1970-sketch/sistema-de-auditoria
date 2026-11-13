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
pres.addSection({ title: "Abertura" });
let s = pres.addSlide({ masterName: "CAPA", sectionTitle: "Abertura" });
s.addText("ESPOSENDE 2026", { placeholder: "title" });
s.addText("Controle, eficiência e evolução da gestão", { placeholder: "body" });
txt(s, "Auditoria  •  Compras  •  Estoque  •  Consumo  •  Inteligência", { x: 0.8, y: 4.5, w: 11.7, h: 0.5, fontSize: 18, color: C.background2 });
txt(s, "Apresentação de resultados · 24/11/2026 · dados do Portal Esposende com corte em 13/11/2026", { x: 0.8, y: 6.5, w: 11.7, h: 0.4, fontSize: 12, color: C.accent2 });
s.addNotes("Abertura (40 s). Todos os números desta apresentação saíram da base do Portal Esposende, com corte em 13 de novembro. Onde o valor ainda depende de conferência, está escrito na tela.");

// 2. RESUMO EXECUTIVO
pres.addSection({ title: "Resumo" });
s = content("O ano em seis números", "Resumo", "Fonte: Portal Esposende · corte 13/11/2026 · detalhes nos próximos slides");
const kpis = [
  ["R$ 60,6 mil", "economizados em compras auditadas (23,3% abaixo da maior cotação)", C.accent4],
  ["R$ 9,40 mi", "de estoque conferido em 10 inventários, com perda líquida de 1,38%", C.text1],
  ["11.827", "acertos de estoque rastreados por solicitante em 65 lojas (R$ 487 mil a custo)", C.text1],
  ["−44%", "nos acertos semanais desde o controle (2.069 → 1.162 por semana)", C.accent1],
  ["R$ 584 mil", "possíveis pagamentos em duplicidade identificados, em conferência no extrato", C.accent3],
  ["977", "alertas em comprovantes de obras; 617 já resolvidos (63%)", C.text1],
];
kpis.forEach(([v, l, c], i) => {
  const x = 0.6 + (i % 3) * 4.11, y = 1.5 + Math.floor(i / 3) * 2.7;
  stat(s, x, y, 3.91, 2.5, v, l, { color: c, size: 36 });
});
s.addNotes("Resumo (1,5 min). Seis números para guardar. Economia comprovada em compras; inventário com perda controlada; acerto de estoque que passou a ter dono e caiu 44%; R$ 584 mil em possíveis duplicidades, ainda em conferência; e a auditoria de obras.");

// 3. METODOLOGIA
s = content("Como medimos: só conta o que tem prova", "Resumo", "Critério da Auditoria · aplicado a todos os números desta apresentação");
card(s, 0.6, 1.5, 5.9, 2.5);
txt(s, "Economia percentual", { x: 0.95, y: 1.75, w: 5.2, h: 0.5, fontSize: 22, bold: true, color: C.text1, fontFace: H });
txt(s, "(maior cotação − valor contratado) ÷ maior cotação", { x: 0.95, y: 2.35, w: 5.2, h: 0.8, fontSize: 18, italic: true, color: C.accent4 });
txt(s, "Quanto cada compra ficou abaixo do preço que seria pago sem disputa.", { x: 0.95, y: 3.2, w: 5.2, h: 0.6, fontSize: 14, color: C.text2 });
card(s, 6.83, 1.5, 5.9, 2.5);
txt(s, "Participação no resultado", { x: 7.18, y: 1.75, w: 5.2, h: 0.5, fontSize: 22, bold: true, color: C.text1, fontFace: H });
txt(s, "economia da área ÷ economia total", { x: 7.18, y: 2.35, w: 5.2, h: 0.8, fontSize: 18, italic: true, color: C.accent4 });
txt(s, "Onde a auditoria gerou mais resultado para a empresa.", { x: 7.18, y: 3.2, w: 5.2, h: 0.6, fontSize: 14, color: C.text2 });
card(s, 0.6, 4.35, 12.13, 2.25, C.text1);
txt(s, [
  { text: "Comprovado: ", options: { bold: true, color: C.accent1 } },
  { text: "compra aprovada com cotações registradas ou ajuste lançado no sistema.", options: { color: C.background1, breakLine: true } },
  { text: "Em apuração: ", options: { bold: true, color: C.accent1 } },
  { text: "achado da auditoria que ainda depende de extrato, nota ou resposta do fornecedor.", options: { color: C.background1, breakLine: true } },
  { text: "Fora da conta: ", options: { bold: true, color: C.accent1 } },
  { text: "corte de orçamento não é economia.", options: { color: C.background1 } },
], { x: 1.0, y: 4.55, w: 11.3, h: 1.85, fontSize: 18, valign: "middle", paraSpaceAfter: 6 });
s.addNotes("Critério (1 min). Separar sempre comprovado de em apuração. Isso dá credibilidade aos números.");

// 4. COMPRAS POR ÁREA
pres.addSection({ title: "Compras" });
s = content("Compras: R$ 60,1 mil economizados nas cotações", "Compras", F_CMP);
s.addChart(pres.charts.BAR, [{ name: "Economia (R$)", labels: ["Facilities", "Comercial", "T.I.C", "Logística"], values: [38487.67, 11901.60, 8351.21, 1375.00] }],
  Object.assign(chartBase(), { x: 0.6, y: 1.45, w: 6.4, h: 5.2, barDir: "bar", objectName: "Gráfico economia por área", chartColors: [HEX.ink2], showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: '"R$" #,##0', catAxisOrientation: "maxMin", title: "Economia em R$ por área" }));
const rows = [
  ["Área", "Pedidos", "Economia", "% econ.", "Partic."],
  ["Facilities", "12", "R$ 38.487,67", "24,2%", "64,0%"],
  ["Comercial", "2", "R$ 11.901,60", "37,9%", "19,8%"],
  ["T.I.C", "2", "R$ 8.351,21", "17,3%", "13,9%"],
  ["Logística", "2", "R$ 1.375,00", "7,3%", "2,3%"],
  ["Total", "18", "R$ 60.115,48", "23,3%", "100%"],
].map((r, i) => r.map((c, j) => ({ text: c, options: {
  bold: i === 0 || i === 5, color: i === 0 ? HEX.paper : HEX.ink, fill: { color: i === 0 ? HEX.ink : (i === 5 ? "E4EDEA" : HEX.paper) },
  align: j === 0 ? "left" : "right", fontSize: 14,
} })));
s.addTable(rows, { x: 7.3, y: 1.6, w: 5.43, colW: [1.35, 0.85, 1.43, 0.9, 0.9], rowH: 0.45, border: { type: "solid", pt: 0.5, color: "D5E0DD" }, margin: [0, 0.08, 0, 0.08], valign: "middle", objectName: "Tabela economia por área" });
txt(s, [
  { text: "R$ 257,6 mil ", options: { bold: true, color: C.text1 } },
  { text: "seria o valor pela maior cotação. Contratamos por R$ 197,5 mil. Média de 2,3 cotações por solicitação.", options: { color: C.text2 } },
], { x: 7.3, y: 4.6, w: 5.43, h: 1.2, fontSize: 14, valign: "top" });
s.addNotes("Compras por área (1,5 min). 18 compras aprovadas com cotação. Facilities responde por 64% da economia. Comercial tem o maior percentual: 37,9%. Além disso, há R$ 1.079,60 numa solicitação ainda pendente, que não entra no total.");

// 5. MAIORES ECONOMIAS
s = content("Onde a disputa entre fornecedores mais rendeu", "Compras", F_CMP);
s.addChart(pres.charts.BAR, [{ name: "Economia (R$)", labels: ["Fita de empacotamento", "Cremalheiras e suportes", "24 desktops (Maceió)", "Difusores de ar", "20 cadeiras executivas", "Telhas e metalon"], values: [11901.60, 8316.16, 6312.41, 5698.73, 4020.00, 3983.20] }],
  Object.assign(chartBase(), { x: 0.6, y: 1.45, w: 7.6, h: 5.2, barDir: "bar", objectName: "Gráfico maiores economias", chartColors: [HEX.ink2], showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: '"R$" #,##0', catAxisOrientation: "maxMin", title: "As seis maiores economias (R$)" }));
const tops = [["44,7%", "Fita de empacotamento", "R$ 26.640 → R$ 14.738"], ["42,1%", "Difusores de ar", "R$ 13.551 → R$ 7.852"], ["33,5%", "Cadeiras executivas", "R$ 12.000 → R$ 7.980"]];
txt(s, "Maiores reduções em %", { x: 8.6, y: 1.5, w: 4.1, h: 0.45, fontSize: 18, bold: true, color: C.text1 });
tops.forEach(([p, n, d], i) => {
  const y = 2.1 + i * 1.5;
  card(s, 8.6, y, 4.13, 1.3);
  txt(s, p, { x: 8.85, y: y + 0.2, w: 1.5, h: 0.9, fontSize: 28, bold: true, color: C.accent1, fontFace: H, valign: "middle" });
  txt(s, [{ text: n, options: { bold: true, color: C.text1, breakLine: true } }, { text: d, options: { color: C.text2 } }], { x: 10.4, y: y + 0.2, w: 2.2, h: 0.9, fontSize: 14, valign: "middle" });
});
s.addNotes("Maiores economias (1 min). A fita de empacotamento sozinha economizou quase R$ 12 mil, 44,7% abaixo da maior proposta.");

// 6. CASO DIFUSORES
s = content("Caso real: difusores de ar 45,5% mais baratos", "Compras", "Fonte: solicitação de compra e PC-2026-000002 · Difustec Ventilação · jun/2026");
const steps = [["R$ 13.550,69", "Maior cotação recebida", C.text2], ["R$ 7.851,96", "Melhor cotação: −42,1%", C.accent4], ["R$ 7.379,84", "Renegociado no pedido: −6,01%", C.accent1]];
steps.forEach(([v, l, c], i) => {
  const x = 0.6 + i * 4.11;
  card(s, x, 1.6, 3.91, 2.6, i === 2 ? C.text1 : null);
  txt(s, `Etapa ${i + 1}`, { x: x + 0.3, y: 1.85, w: 3.3, h: 0.4, fontSize: 14, bold: true, color: i === 2 ? C.accent1 : C.text2 });
  txt(s, v, { x: x + 0.3, y: 2.35, w: 3.3, h: 0.9, fontSize: 34, bold: true, color: i === 2 ? C.background1 : C.text1, fontFace: H, valign: "middle" });
  txt(s, l, { x: x + 0.3, y: 3.35, w: 3.3, h: 0.6, fontSize: 16, color: i === 2 ? C.background1 : c });
});
card(s, 0.6, 4.55, 12.13, 2.0);
txt(s, "R$ 6.170,85", { x: 0.95, y: 4.8, w: 4.0, h: 1.5, fontSize: 44, bold: true, color: C.accent1, fontFace: H, valign: "middle" });
txt(s, "a menos que a maior proposta, em um único pedido: 21 difusores de 15\", 5 de 12\" e 3 de alta indução. A cotação trouxe 42,1% e a auditoria do pedido conseguiu mais 6,01%.", { x: 5.1, y: 4.8, w: 7.3, h: 1.5, fontSize: 16, color: C.text2, valign: "middle" });
s.addNotes("Caso difusores (1 min). Mostra as duas camadas: a disputa na cotação (42,1%) e a revisão do pedido pela auditoria (6,01%). Juntas: 45,5%.");

// 7. INVENTÁRIO
pres.addSection({ title: "Estoque" });
s = content("Inventário: R$ 9,40 mi conferidos, perda de 1,38%", "Estoque", F_INV);
s.addChart(pres.charts.BAR, [{ name: "Perda (R$)", labels: ["L14 ago*", "L74 out", "L14 out", "L06 out", "L72 out", "L15 set*", "L50 ago", "L46 set"], values: [38699.03, 25793.53, 21109.19, 19649.50, 13121.56, 9627.27, 3668.12, 443.85] }],
  Object.assign(chartBase(), { x: 0.6, y: 1.45, w: 7.4, h: 5.2, barDir: "bar", objectName: "Gráfico perda por inventário", chartColors: [HEX.ink2], invertIfNegative: false, showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: '"R$" #,##0', catAxisOrientation: "maxMin", title: "Perda a custo por inventário" }));
stat(s, 8.4, 1.45, 4.33, 1.55, "R$ 129.484,90", "perda líquida a custo (R$ 183,6 mil a preço de venda)", { size: 28, color: C.accent3 });
stat(s, 8.4, 3.15, 4.33, 1.55, "64.380 SKUs", "contados em 8 lojas · 141.185 peças", { size: 28 });
card(s, 8.4, 4.85, 4.33, 1.8, C.text1);
txt(s, [
  { text: "Leitura: ", options: { bold: true, color: C.accent1 } },
  { text: "perdas de 1,1% a 1,8% nos inventários gerais. L14 ago e L15 set (*) foram parciais. L28 e L14 em setembro tiveram sobra.", options: { color: C.background1 } },
], { x: 8.7, y: 5.0, w: 3.8, h: 1.5, fontSize: 14, valign: "middle" });
s.addNotes("Inventário (1,5 min). * = inventário parcial (por departamento). Em 10 inventários, o estoque a custo passou de R$ 9.397.031 para R$ 9.267.546. Loja 14 foi inventariada três vezes. Duas lojas tiveram sobra (L28 e L14 em setembro).");

// 8. ACERTO DE ESTOQUE
s = content("Acerto de estoque: cada ajuste agora tem dono", "Estoque", F_AJ);
s.addChart(pres.charts.BAR, [{ name: "Acertos por semana", labels: ["21/09", "28/09", "05/10", "12/10", "19/10", "26/10", "02/11"], values: [2069, 1904, 1662, 1387, 1299, 1241, 1162] }],
  Object.assign(chartBase(), { x: 0.6, y: 1.45, w: 7.4, h: 5.2, barDir: "col", objectName: "Gráfico acertos semanais", chartColors: [HEX.ink2], showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "#,##0", title: "Acertos concluídos por semana (semanas completas)" }));
stat(s, 8.4, 1.45, 4.33, 1.55, "−44%", "de acertos por semana entre 21/09 e 02/11", { size: 36, color: C.accent1 });
stat(s, 8.4, 3.15, 4.33, 1.55, "11.827 acertos", "13.213 peças · R$ 487 mil a custo · R$ 720 mil a venda", { size: 26 });
card(s, 8.4, 4.85, 4.33, 1.8, C.text1);
txt(s, [
  { text: "Antes: ", options: { bold: true, color: C.accent1 } },
  { text: "acerto pedido por WhatsApp, sem registro. ", options: { color: C.background1 } },
  { text: "Agora: ", options: { bold: true, color: C.accent1 } },
  { text: "100% dos acertos lançados no SETA têm solicitante, loja e protocolo.", options: { color: C.background1 } },
], { x: 8.7, y: 5.0, w: 3.8, h: 1.5, fontSize: 14, valign: "middle" });
s.addNotes("Acerto de estoque (1,5 min). 11.108 de 11.108 acertos de entrada lançados no SETA estão ligados a uma solicitação identificada. Quando o pedido passa a ter nome e protocolo, o volume cai: de 2.069 para 1.162 por semana. A semana de 09/11 ainda está em andamento (665 até o dia 13).");

// 9. AUDITORIA FINANCEIRA
pres.addSection({ title: "Auditoria" });
s = content("Auditoria financeira: o que o cruzamento encontrou", "Auditoria", F_FIN);
stat(s, 0.6, 1.45, 3.91, 2.4, "R$ 584 mil", "pagos possivelmente em duplicidade · 38 casos", { size: 34, color: C.accent3 });
stat(s, 4.71, 1.45, 3.91, 2.4, "R$ 383 mil", "em 87 casos suspeitos, ainda sem confirmação", { size: 34 });
stat(s, 8.82, 1.45, 3.91, 2.4, "R$ 83,6 mil", "em juros e multas por atraso, comprovados (45 casos)", { size: 34, color: C.accent4 });
pill(s, 0.6, 4.1, 2.6, "EM CONFERÊNCIA", HEX.warn);
txt(s, "Duplicidades e suspeitas aguardam o extrato bancário. Só entram como recuperação depois de confirmadas.", { x: 3.4, y: 4.05, w: 9.3, h: 0.45, fontSize: 14, color: C.text2, valign: "middle" });
card(s, 0.6, 4.75, 12.13, 1.9, C.text1);
txt(s, "R$ 311.760,40", { x: 0.95, y: 4.95, w: 4.2, h: 1.5, fontSize: 38, bold: true, color: C.accent1, fontFace: H, valign: "middle" });
txt(s, "em 1.818 NF-e canceladas, monitoradas loja a loja. Cada cancelamento precisa de motivo e responsável.", { x: 5.3, y: 4.95, w: 7.1, h: 1.5, fontSize: 16, color: C.background1, valign: "middle" });
s.addNotes("Auditoria financeira (1,5 min). Maior caso de duplicidade: R$ 98,7 mil para um mesmo fornecedor, pago duas vezes. Ainda em conferência no extrato; não falar em recuperação antes da confirmação. Juros e multas: dinheiro perdido por atraso, comprovado.");

// 10. OBRAS
s = content("Obras: 1.932 comprovantes auditados um a um", "Auditoria", "Fonte: Portal Esposende · Auditoria de Obras (contas a pagar e comprovantes) · corte 13/11/2026");
stat(s, 0.6, 1.45, 3.91, 2.2, "R$ 505 mil", "em comprovantes de obras analisados", { size: 34 });
stat(s, 4.71, 1.45, 3.91, 2.2, "977 alertas", "570 críticos, gerados pelas regras da auditoria", { size: 34, color: C.accent3 });
stat(s, 8.82, 1.45, 3.91, 2.2, "63% resolvidos", "617 alertas tratados e documentados", { size: 34, color: C.accent4 });
const regras = [["Suspeita apontada pela IA", "557"], ["Mesmo fornecedor várias vezes no dia", "170"], ["Possível pagamento duplicado", "84"], ["Leitura de comprovante com baixa confiança", "55"], ["PIX a pessoa física para material", "21"]];
card(s, 0.6, 3.95, 12.13, 2.7);
txt(s, "O que as regras mais pegam", { x: 0.95, y: 4.1, w: 6, h: 0.45, fontSize: 18, bold: true, color: C.text1 });
regras.forEach(([r, n], i) => {
  const col = i < 3 ? 0 : 1, row = i < 3 ? i : i - 3;
  const x = 0.95 + col * 6.0, y = 4.7 + row * 0.6;
  txt(s, n, { x, y, w: 0.9, h: 0.5, fontSize: 20, bold: true, color: C.accent1, fontFace: H, valign: "middle" });
  txt(s, r, { x: x + 1.0, y, w: 4.8, h: 0.5, fontSize: 15, color: C.text1, valign: "middle" });
});
s.addNotes("Obras (1 min). A IA e as regras olham cada comprovante: duplicidade, PIX para pessoa física, compra de madrugada ou domingo, material sem nota. 360 alertas ainda abertos.");

// 11. CONSUMO
pres.addSection({ title: "Consumo" });
s = content("Os cinco materiais de consumo em destaque", "Consumo", "Fonte: Portal Esposende · Almoxarifado · custo atendido às lojas · consulta de 13/11/2026");
const mats = [["Sacolas", "R$ 37.244,00", "07/10 a 06/11", false], ["Café", "R$ 14.133,10", "outubro/2026 · 16.266 un. no ano", false], ["Bobinas", "R$ 10.479,04", "07/10 a 06/11", false], ["Embalagens para presente", "R$ 9.277,00", "07/10 a 06/11", false], ["Materiais de limpeza", "Em validação", "o Portal bloqueou o número por inconsistência na fonte", true]];
mats.forEach(([t, v, p, pend], i) => {
  const x = 0.6 + i * 2.46, y = 1.5;
  card(s, x, y, 2.26, 3.6, pend ? "F6E9E3" : null);
  dot(s, x + 0.25, y + 0.3, i + 1, pend ? HEX.warn : HEX.ink, C.background1);
  txt(s, t, { x: x + 0.25, y: y + 1.05, w: 1.85, h: 0.8, fontSize: 17, bold: true, color: C.text1, valign: "top" });
  txt(s, v, { x: x + 0.25, y: y + 1.9, w: 1.85, h: 0.6, fontSize: 20, bold: true, color: pend ? C.accent3 : C.accent4, fontFace: H, valign: "top" });
  txt(s, p, { x: x + 0.25, y: y + 2.55, w: 1.85, h: 0.95, fontSize: 12, color: C.text2, valign: "top" });
});
card(s, 0.6, 5.35, 12.13, 1.3, C.text1);
txt(s, [
  { text: "Sacolas são 65% ", options: { bold: true, color: C.accent1 } },
  { text: "do custo de sacolas, bobinas e embalagens no período (R$ 57.000,04). É onde o treinamento das lojas mais pesa.", options: { color: C.background1 } },
], { x: 0.95, y: 5.45, w: 11.4, h: 1.1, fontSize: 18, valign: "middle" });
s.addNotes("Consumo (1 min). Café: R$ 14.133,10 em outubro. Limpeza: o próprio Portal recusou o número por inconsistência; refazer na fonte do Almoxarifado antes do dia 24.");

// 12. OUTRAS FRENTES
s = content("Outras frentes de controle", "Consumo", "Fonte: Portal Esposende · Casamento de Saci (21/09), CFTV, Universidade, Vigilante · consulta de 13/11/2026");
const fr = [
  ["13.811", "Casamento de Saci", "calçados avulsos (pé sem par) mapeados para voltar a formar par e à venda"],
  ["R$ 308,8 mil", "Patrimônio de segurança", "equipamentos de CFTV inventariados em 69 lojas"],
  ["74", "Certificados emitidos", "739 aulas assistidas em 14 áreas de treinamento"],
  ["18", "Alertas críticos ativos", "o Vigilante do Portal aponta desvios fora do padrão da rede"],
];
fr.forEach(([v, t, d], i) => {
  const x = 0.6 + (i % 2) * 6.17, y = 1.5 + Math.floor(i / 2) * 2.6;
  card(s, x, y, 5.96, 2.4, i === 0 ? C.text1 : null);
  txt(s, v, { x: x + 0.35, y: y + 0.3, w: 5.3, h: 0.8, fontSize: 34, bold: true, color: i === 0 ? C.accent1 : C.text1, fontFace: H, valign: "middle" });
  txt(s, t, { x: x + 0.35, y: y + 1.15, w: 5.3, h: 0.4, fontSize: 18, bold: true, color: i === 0 ? C.background1 : C.text1 });
  txt(s, d, { x: x + 0.35, y: y + 1.6, w: 5.3, h: 0.6, fontSize: 14, color: i === 0 ? C.background2 : C.text2 });
});
s.addNotes("Outras frentes (1 min). Saci: número da última carga (21/09); atualizar a base para mostrar quantos pares já foram casados. CFTV: patrimônio de segurança conhecido loja a loja.");

// 13. PONTOS DE ATENÇÃO
pres.addSection({ title: "Próximos passos" });
s = content("Pontos de atenção encontrados pela auditoria", "Próximos passos", "Fonte: Portal Esposende · corte 13/11/2026");
const att = [
  ["Pedidos de compra iguais", "PC-2026-000011 e PC-2026-000033: mesmo material, fornecedor e valor (R$ 5.817,34) no mesmo dia. Confirmar se houve compra em dobro."],
  ["Duplicidades financeiras", "R$ 584 mil possivelmente pagos a mais: conferir no extrato e cobrar os fornecedores."],
  ["Orçamento 2026", "R$ 9,25 mi aprovados e só 0,22% executado pelo módulo. Toda compra do saldo precisa passar pela cotação."],
  ["Bases desatualizadas", "Limpeza (inconsistência) e Saci (última carga em 21/09) precisam ser recarregados."],
];
att.forEach(([t, d], i) => {
  const y = 1.45 + i * 1.33;
  card(s, 0.6, y, 12.13, 1.18);
  dot(s, 0.9, y + 0.31, i + 1, i < 2 ? HEX.warn : HEX.ink, C.background1);
  txt(s, t, { x: 1.7, y: y + 0.12, w: 3.2, h: 0.94, fontSize: 17, bold: true, color: C.text1, valign: "middle" });
  txt(s, d, { x: 5.0, y: y + 0.12, w: 7.5, h: 0.94, fontSize: 14, color: C.text2, valign: "middle" });
});
s.addNotes("Pontos de atenção (1,5 min). Item 1: dois pedidos de compra idênticos de serralharia em 22/07. Pode ser só duplicidade de cadastro, mas precisa ser confirmado antes do pagamento.");

// 14. ENCERRAMENTO
s = pres.addSlide({ masterName: "CAPA", sectionTitle: "Próximos passos" });
s.addText("Próximos passos", { placeholder: "title" });
s.addText("Transformar o que foi encontrado em dinheiro recuperado", { placeholder: "body" });
["Fechar a conferência das duplicidades no extrato e cobrar o que for confirmado",
  "Levar a cotação obrigatória a todo o saldo do orçamento 2026",
  "Manter inventários gerais mensais e o acerto de estoque com dono"].forEach((t, i) => {
  const y = 4.6 + i * 0.7;
  dot(s, 0.8, y, i + 1, HEX.gold, C.text1);
  txt(s, t, { x: 1.6, y, w: 10.9, h: 0.55, fontSize: 18, color: C.background1, valign: "middle" });
});
s.addNotes("Encerramento (40 s). Três compromissos. Abrir para perguntas.");

(async () => { await pres.writeFile({ fileName: OUT }); await applyTheme(OUT, THEME); console.log("ok"); })();
