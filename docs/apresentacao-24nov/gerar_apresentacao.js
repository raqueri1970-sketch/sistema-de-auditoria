const pptxgen = require("pptxgenjs");
const { applyTheme } = require("/root/.claude/skills/synced/6a3e1f69-d971-4eeb-ac67-fc5595712890_ba5755bf-d92b-4689-b6f2-5d74aa5ce6d9/pptx/scripts/apply_theme.js");

const OUT = process.argv[2] || "Esposende_2026_Apresentacao.pptx";

const HEX = {
  ink: "0F2E2C",      // verde-petróleo profundo (dominante)
  ink2: "1F4D49",
  gold: "C9A227",     // destaque
  sage: "6FA39A",
  paper: "FFFFFF",
  mist: "EEF4F2",
  grey: "5B6B69",
  warn: "B5562F",
};

const THEME = {
  name: "Esposende 2026",
  headFontFace: "Cambria",
  bodyFontFace: "Calibri",
  colors: {
    dk1: HEX.ink, lt1: HEX.paper, dk2: HEX.ink2, lt2: HEX.mist,
    accent1: HEX.gold, accent2: HEX.sage, accent3: HEX.warn, accent4: "2E7D6B",
    accent5: "8FB8B0", accent6: "D9C27A", hlink: "2E7D6B", folHlink: HEX.grey,
  },
};

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5
pres.title = "Esposende 2026 — Controle, eficiência e evolução da gestão";
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
const C = pres.SchemeColor;
const W = 13.333;

const FOOT = "Fonte: Portal Esposende · consulta de 13/11/2026 · corte até 13/11/2026";

// ---------- Layouts ----------
pres.defineSlideMaster({
  title: "CAPA",
  background: { color: C.text1 },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.8, y: 2.2, w: 11.7, h: 1.4, fontSize: 54, bold: true, color: C.background1, fontFace: THEME.headFontFace, valign: "bottom", align: "left" }, text: "" } },
    { placeholder: { options: { name: "body", type: "body", x: 0.8, y: 3.75, w: 11.7, h: 0.8, fontSize: 24, color: C.accent1, valign: "top" }, text: "" } },
  ],
});

pres.defineSlideMaster({
  title: "CONTEUDO",
  background: { color: C.background1 },
  margin: [0.5, 0.6, 0.6, 0.6],
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.4, w: 12.1, h: 0.9, fontSize: 36, bold: true, color: C.text1, fontFace: THEME.headFontFace, valign: "middle", align: "left" }, text: "" } },
    { text: { text: FOOT, options: { x: 0.6, y: 7.0, w: 10.5, h: 0.3, fontSize: 10, color: C.text2, isTextBox: true, margin: 0 } } },
  ],
  slideNumber: { x: 12.2, y: 7.0, w: 0.5, h: 0.3, fontSize: 10, color: C.text2, align: "right" },
});

// ---------- helpers ----------
const card = (s, name, x, y, w, h, fill) =>
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: 0.12, objectName: name,
    fill: { color: fill || C.background2 }, line: { color: fill || C.background2 },
  });

const badge = (s, name, x, y, label, color) => {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: 2.3, h: 0.36, rectRadius: 0.18, objectName: name + " fundo", fill: { color }, line: { color } });
  s.addText(label, { x, y, w: 2.3, h: 0.36, fontSize: 11, bold: true, color: C.background1, align: "center", valign: "middle", isTextBox: true, margin: 0, objectName: name });
};

const circleNum = (s, name, x, y, n, fill, txt) => {
  s.addShape(pres.shapes.OVAL, { x, y, w: 0.6, h: 0.6, fill: { color: fill }, line: { color: fill }, objectName: name + " círculo" });
  s.addText(String(n), { x, y, w: 0.6, h: 0.6, fontSize: 18, bold: true, color: txt, align: "center", valign: "middle", isTextBox: true, margin: 0, objectName: name });
};

// =========================================================
// 1. CAPA
pres.addSection({ title: "Abertura" });
let s = pres.addSlide({ masterName: "CAPA", sectionTitle: "Abertura" });
s.addText("ESPOSENDE 2026", { placeholder: "title" });
s.addText("Controle, eficiência e evolução da gestão", { placeholder: "body" });
s.addText("Auditoria  •  Compras  •  Consumo  •  Treinamento  •  Inteligência", {
  x: 0.8, y: 4.7, w: 11.7, h: 0.5, fontSize: 18, color: C.background2, isTextBox: true, margin: 0, objectName: "Pilares",
});
s.addText("Apresentação de resultados · 24 de novembro de 2026 · dados com corte em 13/11/2026", {
  x: 0.8, y: 6.5, w: 11.7, h: 0.4, fontSize: 12, color: C.accent2, isTextBox: true, margin: 0, objectName: "Data",
});
s.addNotes("Abertura (1 min). Apresentar o objetivo: mostrar como a Auditoria passou a controlar compras e consumo com dados do Portal. Avisar que o corte dos números é 13 de novembro e que separamos o que é economia comprovada do que ainda está em validação.");

// 2. AGENDA — cinco pilares
pres.addSection({ title: "Contexto" });
s = pres.addSlide({ masterName: "CONTEUDO", sectionTitle: "Contexto" });
s.addText("Cinco frentes, um único painel de controle", { placeholder: "title" });
const pilares = [
  ["Auditoria", "Conferência de notas, pedidos e despesas com rastreabilidade"],
  ["Compras", "Preço de referência × preço pago em cada pedido auditado"],
  ["Consumo", "Café, sacolas, embalagens, bobinas e limpeza sob acompanhamento"],
  ["Treinamento", "Equipes das lojas orientadas no uso correto dos materiais"],
  ["Inteligência", "Portal Esposende responde em linguagem natural, com fonte oficial"],
];
pilares.forEach(([t, d], i) => {
  const x = 0.6 + i * 2.46, y = 1.7;
  card(s, "Cartão " + t, x, y, 2.26, 3.6);
  circleNum(s, "Número " + t, x + 0.25, y + 0.3, i + 1, i === 1 ? C.accent1 : C.text1, C.background1);
  s.addText(t, { x: x + 0.25, y: y + 1.1, w: 1.85, h: 0.5, fontSize: 20, bold: true, color: C.text1, fontFace: THEME.headFontFace, isTextBox: true, margin: 0, objectName: "Título " + t });
  s.addText(d, { x: x + 0.25, y: y + 1.7, w: 1.85, h: 1.7, fontSize: 14, color: C.text2, valign: "top", isTextBox: true, margin: 0, objectName: "Descrição " + t });
});
s.addNotes("Contexto (1,5 min). Passar rapidamente pelas cinco frentes. Destacar Compras (em dourado) porque é onde está o resultado financeiro principal.");

// 3. METODOLOGIA
s = pres.addSlide({ masterName: "CONTEUDO", sectionTitle: "Contexto" });
s.addText("Como medimos a economia", { placeholder: "title" });
card(s, "Medida 1", 0.6, 1.6, 5.9, 2.6);
s.addText("Economia percentual", { x: 0.95, y: 1.85, w: 5.2, h: 0.5, fontSize: 22, bold: true, color: C.text1, fontFace: THEME.headFontFace, isTextBox: true, margin: 0, objectName: "Medida 1 título" });
s.addText("(preço de referência − preço pago) ÷ preço de referência", { x: 0.95, y: 2.5, w: 5.2, h: 0.9, fontSize: 18, italic: true, color: C.accent4, isTextBox: true, margin: 0, objectName: "Medida 1 fórmula" });
s.addText("Mostra quanto cada compra ficou abaixo do preço de mercado.", { x: 0.95, y: 3.4, w: 5.2, h: 0.6, fontSize: 14, color: C.text2, isTextBox: true, margin: 0, objectName: "Medida 1 texto" });

card(s, "Medida 2", 6.83, 1.6, 5.9, 2.6);
s.addText("Participação no resultado", { x: 7.18, y: 1.85, w: 5.2, h: 0.5, fontSize: 22, bold: true, color: C.text1, fontFace: THEME.headFontFace, isTextBox: true, margin: 0, objectName: "Medida 2 título" });
s.addText("economia do segmento ÷ economia total", { x: 7.18, y: 2.5, w: 5.2, h: 0.9, fontSize: 18, italic: true, color: C.accent4, isTextBox: true, margin: 0, objectName: "Medida 2 fórmula" });
s.addText("Mostra onde a auditoria gerou mais resultado para a empresa.", { x: 7.18, y: 3.4, w: 5.2, h: 0.6, fontSize: 14, color: C.text2, isTextBox: true, margin: 0, objectName: "Medida 2 texto" });

s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.6, y: 4.6, w: 12.13, h: 1.9, rectRadius: 0.12, fill: { color: C.text1 }, line: { color: C.text1 }, objectName: "Regra" });
s.addText([
  { text: "Regra de ouro: ", options: { bold: true, color: C.accent1 } },
  { text: "economia comprovada fica separada da que ainda depende de validação. Redução de orçamento não é contada como economia.", options: { color: C.background1 } },
], { x: 1.0, y: 4.8, w: 11.3, h: 1.5, fontSize: 20, valign: "middle", isTextBox: true, margin: 0, objectName: "Regra texto" });
s.addNotes("Metodologia (1,5 min). Explicar as duas medidas. Reforçar que só entra como economia o que tem preço de referência e preço pago comprovados.");

// 4. EXEMPLO DIFUSORES
pres.addSection({ title: "Compras" });
s = pres.addSlide({ masterName: "CONTEUDO", sectionTitle: "Compras" });
s.addText("Exemplo real: pedido de difusores de ar", { placeholder: "title" });
s.addText("6,01%", { x: 0.6, y: 1.8, w: 6.0, h: 2.2, fontSize: 120, bold: true, color: C.accent1, fontFace: THEME.headFontFace, isTextBox: true, margin: 0, objectName: "Estatística 6,01%" });
s.addText("de redução no valor do pedido após a auditoria de preço", { x: 0.6, y: 4.0, w: 5.6, h: 0.9, fontSize: 20, color: C.text1, isTextBox: true, margin: 0, objectName: "Legenda estatística" });
card(s, "Passos", 7.0, 1.7, 5.73, 4.9);
const passos = [
  ["Pedido recebido", "Comprador envia a cotação para auditoria"],
  ["Referência de preço", "Auditoria compara com o preço de mercado"],
  ["Negociação", "Diferença devolvida ao comprador para ajuste"],
  ["Economia registrada", "Valor final entra no consolidado do segmento"],
];
passos.forEach(([t, d], i) => {
  const y = 2.0 + i * 1.1;
  circleNum(s, "Passo " + (i + 1), 7.3, y, i + 1, C.text1, C.background1);
  s.addText(t, { x: 8.1, y: y - 0.05, w: 4.4, h: 0.4, fontSize: 16, bold: true, color: C.text1, isTextBox: true, margin: 0, objectName: "Passo título " + (i + 1) });
  s.addText(d, { x: 8.1, y: y + 0.33, w: 4.4, h: 0.4, fontSize: 14, color: C.text2, isTextBox: true, margin: 0, objectName: "Passo texto " + (i + 1) });
});
s.addNotes("Exemplo (1,5 min). Usar o pedido de difusores de ar para mostrar o processo na prática: 6,01% de redução. Conferir o valor em reais do pedido no Portal antes da apresentação, se quiser citar.");

// 5. PAINEL ILUSTRATIVO
s = pres.addSlide({ masterName: "CONTEUDO", sectionTitle: "Compras" });
s.addText("Painel de economia por segmento", { placeholder: "title" });
badge(s, "Selo ilustrativo", 10.43, 0.62, "PRÉVIA ILUSTRATIVA", C.accent3);
s.addChart(pres.charts.BAR, [{ name: "Economia (%)", labels: ["Segmento A", "Segmento B", "Segmento C", "Segmento D", "Segmento E"], values: [7.2, 6.0, 4.8, 3.5, 2.1] }], {
  x: 0.6, y: 1.5, w: 7.6, h: 5.2, barDir: "bar", objectName: "Gráfico ilustrativo",
  chartColors: [HEX.ink2], showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: '0.0"%"',
  dataLabelColor: HEX.ink, dataLabelFontSize: 12, dataLabelFontFace: "+mn-lt",
  catAxisLabelColor: HEX.grey, catAxisLabelFontSize: 12, catAxisLabelFontFace: "+mn-lt", catAxisOrientation: "maxMin",
  valAxisHidden: true, valGridLine: { style: "none" }, catGridLine: { style: "none" }, showLegend: false,
  showTitle: true, title: "Economia percentual por segmento (simulação)", titleFontSize: 14, titleColor: HEX.ink, titleFontFace: "+mn-lt",
});
card(s, "Nota", 8.6, 1.5, 4.13, 5.2);
s.addText([
  { text: "Como ler este painel", options: { bold: true, fontSize: 18, color: C.text1, breakLine: true } },
  { text: " ", options: { fontSize: 8, breakLine: true } },
  { text: "Cada barra mostra o % economizado no segmento. No dia 24 entram os valores reais, com R$ economizado e participação no total.", options: { fontSize: 14, color: C.text2, breakLine: true } },
  { text: " ", options: { fontSize: 8, breakLine: true } },
  { text: "Os números desta tela são fictícios: o módulo de Auditoria de Compras ainda não sincronizou o consolidado no Portal.", options: { fontSize: 14, bold: true, color: C.accent3 } },
], { x: 8.9, y: 1.8, w: 3.55, h: 4.6, valign: "top", isTextBox: true, margin: 0, objectName: "Nota texto" });
s.addNotes("Painel (2 min). ATENÇÃO: valores ilustrativos. Substituir pelos números reais do consolidado (segmentos, R$ economizado, % e participação) assim que a Auditoria de Compras sincronizar no Portal.");

// 6. ORÇAMENTO & COMPRAS
s = pres.addSlide({ masterName: "CONTEUDO", sectionTitle: "Compras" });
s.addText("Orçamento & Compras 2026: execução sob controle", { placeholder: "title" });
const stats = [
  ["R$ 9.245.965,71", "verba aprovada (jan–dez/2026)", C.text1],
  ["R$ 20.458,00", "realizado / pago até o corte", C.accent4],
  ["0,22%", "da verba já executada", C.accent1],
];
stats.forEach(([v, l, col], i) => {
  const x = 0.6 + i * 4.11;
  card(s, "Indicador " + (i + 1), x, 1.8, 3.91, 2.9);
  s.addText(v, { x: x + 0.3, y: 2.2, w: 3.4, h: 1.2, fontSize: i === 2 ? 54 : 30, bold: true, color: col, fontFace: THEME.headFontFace, valign: "middle", isTextBox: true, margin: 0, objectName: "Indicador valor " + (i + 1) });
  s.addText(l, { x: x + 0.3, y: 3.6, w: 3.4, h: 0.8, fontSize: 16, color: C.text2, isTextBox: true, margin: 0, objectName: "Indicador legenda " + (i + 1) });
});
s.addText([
  { text: "Saldo disponível: R$ 9.225.507,71. ", options: { bold: true, color: C.text1 } },
  { text: "Nenhum item em cotação no momento do corte. Cada compra desse saldo passará pela auditoria de preço antes de ser paga.", options: { color: C.text2 } },
], { x: 0.6, y: 5.1, w: 12.1, h: 1.2, fontSize: 18, valign: "top", isTextBox: true, margin: 0, objectName: "Saldo" });
s.addNotes("Orçamento (1,5 min). Este não é número de economia: é controle de execução. Mostra que quase toda a verba ainda vai passar pelo filtro da auditoria, ou seja, o potencial de economia está à frente.");

// 7. CINCO MATERIAIS
pres.addSection({ title: "Consumo" });
s = pres.addSlide({ masterName: "CONTEUDO", sectionTitle: "Consumo" });
s.addText("Os cinco materiais de consumo em destaque", { placeholder: "title" });
const mats = [
  ["Sacolas", "R$ 37.244,00", "07/10 a 06/11/2026", false],
  ["Bobinas", "R$ 10.479,04", "07/10 a 06/11/2026", false],
  ["Embalagens para presente", "R$ 9.277,00", "07/10 a 06/11/2026", false],
  ["Café", "R$ 14.133,10", "acumulado 2026 · 16.266 unid.", false],
  ["Materiais de limpeza", "Em validação", "Portal sinalizou inconsistência na fonte", true],
];
mats.forEach(([t, v, p, pend], i) => {
  const x = 0.6 + i * 2.46, y = 1.7;
  card(s, "Material " + t, x, y, 2.26, 4.8, pend ? "F6E9E3" : null);
  circleNum(s, "Ícone " + t, x + 0.25, y + 0.3, i + 1, pend ? C.accent3 : C.text1, C.background1);
  s.addText(t, { x: x + 0.25, y: y + 1.1, w: 1.85, h: 0.9, fontSize: 18, bold: true, color: C.text1, valign: "top", isTextBox: true, margin: 0, objectName: "Material nome " + t });
  s.addText(v, { x: x + 0.25, y: y + 2.1, w: 1.85, h: 0.8, fontSize: pend ? 20 : 22, bold: true, color: pend ? C.accent3 : C.accent4, fontFace: THEME.headFontFace, valign: "top", isTextBox: true, margin: 0, objectName: "Material valor " + t });
  s.addText(p, { x: x + 0.25, y: y + 3.1, w: 1.85, h: 1.4, fontSize: 12, color: C.text2, valign: "top", isTextBox: true, margin: 0, objectName: "Material período " + t });
});
s.addNotes("Consumo (2 min). Sacolas, bobinas e embalagens no mesmo período (07/10 a 06/11). Café é o acumulado do ano. Limpeza: o Portal bloqueou o número por inconsistência na fonte; refazer a consulta no Almoxarifado antes do dia 24.");

// 8. GRÁFICO CONSUMO
s = pres.addSlide({ masterName: "CONTEUDO", sectionTitle: "Consumo" });
s.addText("Sacolas concentram 65% do custo de embalagem", { placeholder: "title" });
s.addChart(pres.charts.BAR, [{ name: "Custo (R$)", labels: ["Sacolas", "Bobinas", "Embalagens p/ presente"], values: [37244.0, 10479.04, 9277.0] }], {
  x: 0.6, y: 1.5, w: 7.8, h: 5.2, barDir: "col", objectName: "Gráfico consumo",
  chartColors: [HEX.ink2, HEX.sage, HEX.sage], showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: '"R$" #,##0',
  dataLabelColor: HEX.ink, dataLabelFontSize: 12, dataLabelFontFace: "+mn-lt",
  catAxisLabelColor: HEX.grey, catAxisLabelFontSize: 12, catAxisLabelFontFace: "+mn-lt",
  valAxisHidden: true, valGridLine: { style: "none" }, catGridLine: { style: "none" }, showLegend: false,
  showTitle: true, title: "Custo no período 07/10 a 06/11/2026", titleFontSize: 14, titleColor: HEX.ink, titleFontFace: "+mn-lt",
});
card(s, "Total período", 8.8, 1.5, 3.93, 2.4, C.text1);
s.addText("R$ 57.000,04", { x: 9.1, y: 1.8, w: 3.4, h: 0.9, fontSize: 32, bold: true, color: C.accent1, fontFace: THEME.headFontFace, isTextBox: true, margin: 0, objectName: "Total valor" });
s.addText("sacolas + bobinas + embalagens em 30 dias", { x: 9.1, y: 2.75, w: 3.4, h: 0.9, fontSize: 14, color: C.background1, isTextBox: true, margin: 0, objectName: "Total legenda" });
card(s, "Ação", 8.8, 4.2, 3.93, 2.5);
s.addText([
  { text: "Onde agir primeiro", options: { bold: true, fontSize: 16, color: C.text1, breakLine: true } },
  { text: "Sacolas: treinar as lojas no uso por venda e acompanhar o custo por loja no Portal.", options: { fontSize: 14, color: C.text2 } },
], { x: 9.1, y: 4.45, w: 3.4, h: 2.1, valign: "top", isTextBox: true, margin: 0, objectName: "Ação texto" });
s.addNotes("Consumo detalhado (1,5 min). 37.244 de 57.000 = 65%. Sacola é o maior item e é onde o treinamento das lojas mais pesa.");

// 9. TREINAMENTO + INTELIGÊNCIA
pres.addSection({ title: "Próximos passos" });
s = pres.addSlide({ masterName: "CONTEUDO", sectionTitle: "Próximos passos" });
s.addText("Treinamento e inteligência sustentam o resultado", { placeholder: "title" });
card(s, "Treinamento", 0.6, 1.6, 5.9, 4.0);
s.addText("Treinamento", { x: 0.95, y: 1.85, w: 5.2, h: 0.5, fontSize: 22, bold: true, color: C.text1, fontFace: THEME.headFontFace, isTextBox: true, margin: 0, objectName: "Treinamento título" });
s.addText([
  { text: "Uso correto de sacolas e bobinas por venda", options: { bullet: true, breakLine: true } },
  { text: "Pedido de material só com justificativa de consumo", options: { bullet: true, breakLine: true } },
  { text: "Compradores usando a referência de preço da auditoria", options: { bullet: true } },
], { x: 0.95, y: 2.55, w: 5.2, h: 2.9, fontSize: 16, color: C.text2, paraSpaceAfter: 10, valign: "top", isTextBox: true, margin: 0, objectName: "Treinamento lista" });
card(s, "Inteligência", 6.83, 1.6, 5.9, 4.0, C.text1);
s.addText("Inteligência (Portal)", { x: 7.18, y: 1.85, w: 5.2, h: 0.5, fontSize: 22, bold: true, color: C.accent1, fontFace: THEME.headFontFace, isTextBox: true, margin: 0, objectName: "Inteligência título" });
s.addText([
  { text: "Perguntas em linguagem natural: “qual o custo de sacola na loja 50?”", options: { bullet: true, breakLine: true } },
  { text: "Resposta só com fonte oficial; sem dado, não inventa número", options: { bullet: true, breakLine: true } },
  { text: "Validação automática bloqueia valores inconsistentes", options: { bullet: true } },
], { x: 7.18, y: 2.55, w: 5.2, h: 2.9, fontSize: 16, color: C.background1, paraSpaceAfter: 10, valign: "top", isTextBox: true, margin: 0, objectName: "Inteligência lista" });
s.addNotes("Treinamento e inteligência (1,5 min). Exemplo vivo: o próprio Portal recusou o número de limpeza por inconsistência — prova de que o sistema protege a qualidade da informação.");

// 10. ENCERRAMENTO
s = pres.addSlide({ masterName: "CAPA", sectionTitle: "Próximos passos" });
s.addText("Próximos passos", { placeholder: "title" });
s.addText("Fechar o consolidado e transformar controle em economia comprovada", { placeholder: "body" });
const prox = [
  "Sincronizar a Auditoria de Compras e fechar a economia por segmento (R$, % e participação)",
  "Refazer a consulta de materiais de limpeza na fonte do Almoxarifado",
  "Acompanhar mensalmente os cinco materiais por loja",
];
prox.forEach((t, i) => {
  const y = 4.75 + i * 0.7;
  circleNum(s, "Próximo " + (i + 1), 0.8, y, i + 1, C.accent1, C.text1);
  s.addText(t, { x: 1.6, y, w: 10.9, h: 0.6, fontSize: 18, color: C.background1, valign: "middle", isTextBox: true, margin: 0, objectName: "Próximo texto " + (i + 1) });
});
s.addNotes("Encerramento (1,5 min). Três compromissos. Abrir para perguntas.");

(async () => {
  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("written", OUT);
})();
