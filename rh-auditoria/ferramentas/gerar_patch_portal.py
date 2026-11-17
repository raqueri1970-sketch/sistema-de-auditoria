"""Gera os arquivos do Portal (repositório portal-esposende-login) para as folhas multi-competência.

Uso:  python3 gerar_patch_portal.py PASTA_DO_PORTAL rh-auditoria/folhas.js VERSAO

No Portal, o módulo "Central de Auditoria RH" vem do arquivo guardado no Supabase Storage. Como os
outros módulos, a mudança entra por patch: rh-folhas-patch.js encontra o iframe do módulo RH e injeta
as telas novas (mesmo CSS, menu e páginas do embutir_no_portal.py) e o código rh-folhas/folhas.js.
As folhas vêm do Supabase (rh_folhas_competencias). Se o módulo já tiver as telas, não faz nada.
"""
import json, os, shutil, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from embutir_no_portal import CSS, NAV, PAGES  # noqa: E402

PATCH = r"""/* Central de Auditoria RH — importar várias folhas de uma vez + histórico multi-competência (__VER__).
   O módulo RH (iframe ifr-rh, arquivo do Portal no Supabase Storage) ganha: Dados → Importar Folhas,
   Folhas por Competência, Histórico/Comparativo/Anomalias/Previsões com a série de folhas e o histórico
   mês a mês no dossiê do funcionário. Folhas gravadas no Supabase (rh_folhas_competencias, RLS portal_pode('rh'),
   CPF mascarado) e compartilhadas entre todos os usuários de RH.
   Fonte: repositório sistema-de-auditoria, pasta rh-auditoria/ (gerado por ferramentas/gerar_patch_portal.py).
   Uso no index.html do Portal: inserirAntesDoFimDoBody(html,'<scr'+'ipt src="'+new URL('rh-folhas-patch.js?v=__VER__',location.href).href+'"></scr'+'ipt>'); */
(function(){
  if(window.__rhfPatch)return;window.__rhfPatch='__VER__';
  var VER=window.__rhfPatch;
  var BASE=(function(){try{return new URL('./',document.currentScript.src).href}catch(e){return location.origin+'/portal-esposende-login/'}})();
  var CSS=__CSS__, NAV=__NAV__, PAGES=__PAGES__;
  var pedido=null;
  function texto(url){return fetch(url,{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error(url.split('?')[0].split('/').pop()+': HTTP '+r.status);return r.text()})}
  function codigo(){
    if(!pedido)pedido=texto(BASE+'rh-folhas/folhas.js?v='+VER).catch(function(e){pedido=null;throw e});
    return pedido;
  }
  function docs(w,a,p){if(p>4)return a;try{if(w.document)a.push(w.document)}catch(e){return a}for(var i=0;i<w.frames.length;i++)try{docs(w.frames[i],a,p+1)}catch(e){}return a}
  function ehModuloRH(d){
    var w=d.defaultView;
    return d.readyState!=='loading'&&w&&typeof w.renderBases==='function'&&typeof w.openDossie==='function'&&
      d.getElementById('pg-bases')&&d.getElementById('qualidade-bases-card')&&d.getElementById('parecer-card');
  }
  function instalar(d){
    // subtítulo do módulo no Portal
    var sub=d.querySelector('#pg-rh .phsub');
    if(sub&&/Competência 06\/2026$/.test(sub.textContent||''))sub.textContent=sub.textContent.replace(/Competência 06\/2026$/,'Auditoria completa 06/2026 · Folhas 01 a 10/2026');
    if(d.__rhf||!ehModuloRH(d))return;
    d.__rhf=1;
    if(d.getElementById('pg-importar'))return; // arquivo do Portal já traz as telas
    var st=d.createElement('style');st.setAttribute('data-rhf','1');st.textContent=CSS;d.head.appendChild(st);
    var dados=[].filter.call(d.querySelectorAll('#nav .group-label'),function(e){return /^\s*Dados\s*$/i.test(e.textContent||'')})[0];
    if(dados)dados.insertAdjacentHTML('afterend',NAV);
    d.getElementById('pg-bases').insertAdjacentHTML('beforebegin',PAGES);
    d.getElementById('qualidade-bases-card').insertAdjacentHTML('beforebegin','<div class="card" id="bases-folhas-card"></div>');
    d.getElementById('parecer-card').insertAdjacentHTML('beforebegin','<div id="folhas-banner"><div class="folhas-banner"><div><b>🗓️ Carregando folhas mensais…</b></div></div></div>');
    var cs=d.querySelector('#pg-comparativo .sub');
    if(cs)cs.innerHTML='Compara a competência atual com competências anteriores. Escolha quaisquer duas competências de folha carregadas — nenhuma competência sobrescreve outra.';
    codigo().then(function(js){
      var s=d.createElement('script');s.setAttribute('data-rhf','1');s.textContent=js;d.body.appendChild(s);
    }).catch(function(e){
      console.warn('[Portal] RH folhas:',e);
      var b=d.getElementById('folhas-banner');
      if(b)b.innerHTML='<div class="folhas-banner"><div><b>⚠️ Não foi possível carregar as folhas mensais</b><div class="sub">'+String(e&&e.message||e).replace(/[<>&]/g,'')+' — recarregue o Portal; se continuar, avise a Controladoria.</div></div></div>';
      d.__rhf=0;
      [].forEach.call(d.querySelectorAll('#nav button[data-page="pg-importar"],#nav button[data-page="pg-folhas"],#pg-importar,#pg-folhas,#bases-folhas-card,style[data-rhf]'),function(x){x.remove()});
    });
  }
  function varrer(){docs(window,[],0).forEach(function(d){try{instalar(d)}catch(e){console.warn('[Portal] RH folhas:',e)}})}
  varrer();setInterval(varrer,1500);
})();
"""


def main(pasta, js_path, ver):
    os.makedirs(os.path.join(pasta, 'rh-folhas'), exist_ok=True)
    shutil.copyfile(js_path, os.path.join(pasta, 'rh-folhas', 'folhas.js'))
    velho = os.path.join(pasta, 'rh-folhas', 'base-folhas.b64')
    if os.path.exists(velho): os.remove(velho)  # base com dados pessoais não fica mais em arquivo público
    js = (PATCH.replace('__VER__', ver).replace('__CSS__', json.dumps(CSS, ensure_ascii=False))
          .replace('__NAV__', json.dumps(NAV, ensure_ascii=False)).replace('__PAGES__', json.dumps(PAGES, ensure_ascii=False)))
    open(os.path.join(pasta, 'rh-folhas-patch.js'), 'w', encoding='utf-8').write(js)
    print('ok:', os.path.join(pasta, 'rh-folhas-patch.js'), len(js), 'bytes')


if __name__ == '__main__':
    if len(sys.argv) != 4: sys.exit(__doc__)
    main(*sys.argv[1:])
