import json, sys

def rep(src, a, b, n=1):
    c = src.count(a)
    if c != n:
        sys.exit(f"ERRO: esperado {n}x, achei {c}x: {a[:90]!r}")
    return src.replace(a, b)

# ───────────────────────── REMANEJO ─────────────────────────
r = open('rem.html', encoding='utf-8').read()
R = []  # pares (antes, depois) aplicados — reaproveitados no deploy

def rr(a, b, n=1):
    global r
    r = rep(r, a, b, n)
    R.append([a, b, n])

# 1) Regional da Base Mãe (prioridade sobre o arquivo FILIAIS_REGIONAL)
rr("let sb = null;",
   "let sb = null;\n"
   "// Base Mãe: regional oficial de cada loja (portal_base_mae_lojas). Prevalece sobre o FILIAIS_REGIONAL.xlsx.\n"
   "let BM_REG = {};\n"
   "async function carregarRegionaisBaseMae(){\n"
   "  if(!sb) return;\n"
   "  try{\n"
   "    const {data,error}=await sb.from('portal_base_mae_lojas').select('codigo,regional');\n"
   "    if(error||!data) return;\n"
   "    const m={};\n"
   "    data.forEach(x=>{\n"
   "      if(!x.regional) return;\n"
   "      let rg=String(x.regional).trim().toUpperCase();\n"
   "      if(rg==='JULIO')rg='JÚLIO';\n"
   "      const n=(x.codigo>=900&&x.codigo<1000)?x.codigo-900:x.codigo;\n"
   "      m[n]=rg;\n"
   "    });\n"
   "    BM_REG=m;\n"
   "  }catch(e){ console.warn('Base Mãe indisponível, usando só o arquivo de regionais:', e); }\n"
   "}")
rr("    D=calcular(rI,rP,rR,rC);",
   "    await carregarRegionaisBaseMae();\n    D=calcular(rI,rP,rR,rC);")
rr("  // ─── MAPA CUSTO ──",
   "  Object.keys(BM_REG).forEach(n=>{l2reg[n]=BM_REG[n];});\n\n  // ─── MAPA CUSTO ──")
rr("④ <strong>FILIAIS_REGIONAL.xlsx</strong> <em>(opcional)</em> — vincula loja ao regional (colunas: FILIAL, REGIONAL)",
   "④ <strong>FILIAIS_REGIONAL.xlsx</strong> <em>(opcional)</em> — vincula loja ao regional (colunas: FILIAL, REGIONAL). Sem ele, usa a Base Mãe do portal")

# 2) Regional FRAN (existe na Base Mãe, faltava no módulo)
rr("'ALEX','JÚLIO','LILIAN','RICARDO','SIDICLEI']", "'ALEX','JÚLIO','LILIAN','RICARDO','SIDICLEI','FRAN']", 6)
rr("'SIDICLEI':'ms-chip-reg-sidiclei'}", "'SIDICLEI':'ms-chip-reg-sidiclei','FRAN':'ms-chip-reg-fran'}")
rr("'SIDICLEI':'sidiclei'}", "'SIDICLEI':'sidiclei','FRAN':'fran'}")
rr("'RICARDO':'#4ade80','SIDICLEI':'#fbbf24'}", "'RICARDO':'#4ade80','SIDICLEI':'#fbbf24','FRAN':'#f472b6'}", 2)
rr("'RICARDO':'166534','SIDICLEI':'92400E'}", "'RICARDO':'166534','SIDICLEI':'92400E','FRAN':'9D174D'}", 3)
rr(".regkpi{display:grid;grid-template-columns:repeat(5,1fr);",
   ".regkpi{display:grid;grid-template-columns:repeat(6,1fr);")
rr("    grid-template-columns:repeat(5,1fr)!important;", "    grid-template-columns:repeat(6,1fr)!important;")
rr(".rc-sidiclei::after{background:linear-gradient(90deg,#f59e0b,#fbbf24)}",
   ".rc-sidiclei::after{background:linear-gradient(90deg,#f59e0b,#fbbf24)}\n"
   ".rc-fran{background:linear-gradient(145deg,#5a0c2e,#4a0826)}\n"
   ".rc-fran::after{background:linear-gradient(90deg,#ec4899,#f472b6)}")
rr(".ms-chip-reg-sidiclei{background:rgba(245,158,11,.2);color:#fbbf24;border-color:rgba(245,158,11,.3)}",
   ".ms-chip-reg-sidiclei{background:rgba(245,158,11,.2);color:#fbbf24;border-color:rgba(245,158,11,.3)}\n"
   ".ms-chip-reg-fran{background:rgba(236,72,153,.2);color:#f472b6;border-color:rgba(236,72,153,.3)}")
i = r.index('<div class="regcard rc-sidiclei" id="rk-sidiclei">')
j = r.index('<div class="pctbar"><div class="pctfill" id="pb-sidiclei" style="width:0%"></div></div>', i)
j = r.index('</div>', j + len('<div class="pctbar"><div class="pctfill" id="pb-sidiclei" style="width:0%"></div></div>')) + len('</div>')
card = r[i:j]
fran = card.replace('sidiclei', 'fran').replace('SIDICLEI', 'FRAN')
assert fran.count('fran') == 9 and '>FRAN<' in fran, fran
rr(card, card + '\n    ' + fran)

open('rem_new.html', 'w', encoding='utf-8').write(r)

# ───────────────────────── SACI ─────────────────────────
s = open('saci.html', encoding='utf-8').read()
S = []

def ss(a, b, n=1):
    global s
    s = rep(s, a, b, n)
    S.append([a, b, n])

ss("var REGIONAL_FILES = []; // [{name, count}]",
   "var REGIONAL_FILES = []; // [{name, count}]\n"
   "// Base Mãe: regional oficial de cada loja (portal_base_mae_lojas). Prevalece sobre o REGIONAL.xlsx enviado.\n"
   "var BM_REGIONAL_MAP = {};\n"
   "function aplicarBaseMaeRegional(){\n"
   "  Object.keys(BM_REGIONAL_MAP).forEach(function(k){ REGIONAL_MAP[k] = BM_REGIONAL_MAP[k]; });\n"
   "}\n"
   "function carregarRegionaisBaseMae(){\n"
   "  if(!sb) return;\n"
   "  sb.from('portal_base_mae_lojas').select('codigo,regional').then(function(res){\n"
   "    if(res.error || !res.data) return;\n"
   "    var m = {};\n"
   "    res.data.forEach(function(x){\n"
   "      if(!x.regional) return;\n"
   "      var n = (x.codigo>=900 && x.codigo<1000) ? x.codigo-900 : x.codigo;\n"
   "      m[normCode(String(n))] = String(x.regional).trim().toUpperCase();\n"
   "    });\n"
   "    if(!Object.keys(m).length) return;\n"
   "    BM_REGIONAL_MAP = m;\n"
   "    aplicarBaseMaeRegional(); renderRegional(); renderTop5Charts();\n"
   "  }, function(e){ console.warn('Base Mãe indisponível, usando só o arquivo de regionais:', e); });\n"
   "}")
ss("  if(count>0) REGIONAL_FILES.push({name:fileName, count:count});\n  saveRegionalState();",
   "  if(count>0) REGIONAL_FILES.push({name:fileName, count:count});\n  aplicarBaseMaeRegional();\n  saveRegionalState();")
ss("  REGIONAL_FILES.splice(idx,1);\n  REGIONAL_MAP = {};\n  saveRegionalState();",
   "  REGIONAL_FILES.splice(idx,1);\n  REGIONAL_MAP = {};\n  aplicarBaseMaeRegional();\n  saveRegionalState();")
ss("    if(data && data.map){ REGIONAL_MAP = data.map; REGIONAL_FILES = data.files||[]; }",
   "    if(data && data.map){ REGIONAL_MAP = data.map; REGIONAL_FILES = data.files||[]; aplicarBaseMaeRegional(); }")
ss("      REGIONAL_FILES = regPayload.files || [];\n",
   "      REGIONAL_FILES = regPayload.files || [];\n      aplicarBaseMaeRegional();\n")
ss("if (typeof sincronizarSaciSupabase === 'function') sincronizarSaciSupabase();\n\n/* ===================== INJEÇÃO",
   "if (typeof sincronizarSaciSupabase === 'function') sincronizarSaciSupabase();\ncarregarRegionaisBaseMae();\n\n/* ===================== INJEÇÃO")

open('saci_new.html', 'w', encoding='utf-8').write(s)
json.dump({'rem': R, 'saci': S}, open('patches.json', 'w', encoding='utf-8'), ensure_ascii=False)
print('ok', len(R), len(S))
