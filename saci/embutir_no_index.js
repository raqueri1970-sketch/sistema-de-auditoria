#!/usr/bin/env node
/* Embute saci-rede-patch.js no módulo "Casamento de Saci" do index.html deste repositório
 * (o módulo fica em base64 em MENC.saci). Substitui uma versão anterior do patch, se houver.
 *
 * Uso:  node saci/embutir_no_index.js
 */
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const indexPath = path.join(raiz, 'index.html');
const patch = fs.readFileSync(path.join(raiz, 'saci-rede-patch.js'), 'utf8');
if (/<\/script/i.test(patch)) throw new Error('patch contém </script>');

const index = fs.readFileSync(indexPath, 'utf8');
const re = /("saci":")([A-Za-z0-9+/=]+)(")/;
const m = index.match(re);
if (!m) throw new Error('MENC.saci não encontrado no index.html');
let html = Buffer.from(m[2], 'base64').toString('utf8');

const INI = '<script data-saci-rede-patch>', FIM = '</script><!-- /saci-rede-patch -->';
const a = html.indexOf(INI);
if (a >= 0) html = html.slice(0, a) + html.slice(html.indexOf(FIM, a) + FIM.length);
const fimBody = html.lastIndexOf('</body>');
if (fimBody < 0) throw new Error('módulo sem </body>');
html = html.slice(0, fimBody) + INI + '\n' + patch + '\n' + FIM + '\n' + html.slice(fimBody);

const b64 = Buffer.from(html, 'utf8').toString('base64');
fs.writeFileSync(indexPath, index.slice(0, m.index) + m[1] + b64 + m[3] + index.slice(m.index + m[0].length));
console.log('ok: módulo saci', m[2].length, '→', b64.length, 'bytes base64');
