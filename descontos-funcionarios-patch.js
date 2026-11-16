/* Descontos de Funcionários — nova versão do módulo dentro do Portal (16/11/2026).
   A página "Descontos de Funcionários" (pg-cmpaud) passa a mostrar a tela descontos-funcionarios/ (mesmo login do Portal),
   que lê e grava a base em cmpaud_cargas (nuvem compartilhada: o que um usuário carrega, todos veem).
   O módulo antigo deixa de ser carregado: ele tentava trocar a base apagando todas as linhas de uma vez e o banco
   cancelava (limite de 8 s) — por isso a carga do Roberto não chegava para os outros usuários.
   Uso no index.html do Portal: inserirAntesDoFimDoBody(html,'<scr'+'ipt src="'+new URL('descontos-funcionarios-patch.js?v=20261116-2',location.href).href+'"></scr'+'ipt>'); */
(function(){
  if(window.__dfPatch)return;window.__dfPatch='20261116-2';
  var BASE=(function(){try{return new URL('./',document.currentScript.src).href}catch(e){return location.origin+'/portal-esposende-login/'}})();
  var URL_MOD=BASE+'descontos-funcionarios/index.html?v='+window.__dfPatch;
  function docs(w,a,p){if(p>4)return a;try{if(w.document)a.push(w.document)}catch(e){return a}for(var i=0;i<w.frames.length;i++)try{docs(w.frames[i],a,p+1)}catch(e){}return a}
  function pagina(d){
    var pg=d.getElementById('pg-cmpaud');if(pg)return pg;
    var t=[].filter.call(d.querySelectorAll('.phtitle'),function(e){return /Descontos de Funcion/i.test(e.textContent||'')})[0];
    return t?t.closest('.pg'):null;
  }
  function instalar(d){
    var w=d.defaultView,pg=pagina(d);if(!pg)return;
    // não carrega mais o módulo antigo
    if(w.execMod&&!w.execMod.__df){var orig=w.execMod;w.execMod=function(pid){if(pid==='cmpaud')return;return orig.apply(this,arguments)};w.execMod.__df=1}
    if(pg.querySelector('[data-df-frame]'))return;
    [].forEach.call(pg.children,function(c){if(!c.classList.contains('ph'))c.style.display='none'});
    var ph=pg.querySelector('.ph');
    if(ph)[].forEach.call(ph.querySelectorAll('button'),function(b){if(!/Voltar/i.test(b.textContent||''))b.style.display='none'});
    var f=d.createElement('iframe');f.setAttribute('data-df-frame','1');f.title='Descontos de Funcionários';
    f.setAttribute('allow','clipboard-write; downloads');
    f.style.cssText='display:block;width:100%;border:0;border-radius:12px;background:#070b16;height:calc(100vh - 150px);min-height:620px';
    pg.appendChild(f);
    var carregar=function(){if(!f.getAttribute('src'))f.setAttribute('src',URL_MOD)};
    // carrega quando a página é aberta (não pesa a Visão Geral)
    if(pg.classList.contains('on'))carregar();
    new w.MutationObserver(function(){if(pg.classList.contains('on'))carregar()}).observe(pg,{attributes:true,attributeFilter:['class','style']});
  }
  function varrer(){docs(window,[],0).forEach(function(d){try{instalar(d)}catch(e){console.warn('[Portal] Descontos de Funcionários:',e)}})}
  varrer();setInterval(varrer,1500);
})();
