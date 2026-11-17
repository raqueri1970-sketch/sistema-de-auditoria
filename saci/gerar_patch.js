#!/usr/bin/env node
/* Gera saci-rede-patch.js (raiz do repositório) — o patch "Saci na Rede" do módulo Casamento de Saci.
 *
 * Uso:  node saci/gerar_patch.js CAMINHO/D1.xlsx VERSAO [DATA_DO_ARQUIVO_ISO]
 *       (precisa do pacote "xlsx": npm i xlsx@0.18.5)
 *
 * Lê o D1.xlsx com a mesma função do navegador (saci/resumo-saci.js), embute o resumo como base inicial
 * e escreve ../saci-rede-patch.js. Depois:
 *  - copiar saci-rede-patch.js para o repositório portal-esposende-login e incluir no index.html do Portal
 *    (linha de inserirAntesDoFimDoBody que está no cabeçalho do arquivo);
 *  - rodar saci/embutir_no_index.js para atualizar o módulo embutido no index.html deste repositório.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { SaciRede } = require('./resumo-saci.js');

const [xlsxPath, ver, dataIso] = process.argv.slice(2);
if (!xlsxPath || !ver) { console.error('uso: node saci/gerar_patch.js D1.xlsx VERSAO [DATA_ISO]'); process.exit(1); }

const wb = XLSX.readFile(xlsxPath);
const R = SaciRede.resumirWorkbook(XLSX, wb, { arquivo: path.basename(xlsxPath), geradoEm: dataIso || new Date().toISOString() });
if (!R) { console.error('arquivo sem as abas Direito/Esquerdo/Enviados 2026 e Casados'); process.exit(1); }
const K = SaciRede.conta(R);

const resumo = fs.readFileSync(path.join(__dirname, 'resumo-saci.js'), 'utf8');
const fonte = fs.readFileSync(path.join(__dirname, 'saci-rede-patch.fonte.js'), 'utf8');
const js = fonte
  .split('__VER__').join(ver)
  .split('__DATA__').join(new Date(R.geradoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }))
  .replace('__RESUMO__', () => resumo)
  .replace('__BASE__', () => JSON.stringify(R));
const out = path.join(__dirname, '..', 'saci-rede-patch.js');
fs.writeFileSync(out, js);
console.log('ok:', out, js.length, 'bytes');
console.log(`Direito ${R.D.q} + Esquerdo ${R.E.q} + Enviados ${R.ENV.q} = Rede ${K.rede.q} − Casados ${R.C.q} = Saldo ${K.saldo.q} (${K.taxa.toFixed(1)}%)`);
