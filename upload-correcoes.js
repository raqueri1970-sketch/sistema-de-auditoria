/* Correções de carregamento de arquivos do Portal Esposende (2026-10-02).
   Um único arquivo, carregado no shell do Portal, em TODOS os módulos (injetado no HTML
   de cada módulo antes de abrir) e nas páginas avulsas (ex.: Base Mãe).

   Em qualquer tela:
   - Soltar um arquivo fora da área de upload fazia o navegador ABRIR/BAIXAR o arquivo.
     Agora o arquivo vai para o campo de upload mais próximo; se não houver um claro,
     só avisa (nunca baixa).
   - Handlers inline escritos com "ev.preventDefault()" (variável inexistente) quebravam
     o arrastar em todas as áreas do Portal → passam a usar "event".
   - Campos que aceitavam só .xlsx/.xls passam a aceitar .csv também.
   - Leitura de CSV (biblioteca XLSX): acentos de arquivos UTF-8 viravam "JoÃ£o" e números
     brasileiros "1.234,56" viravam 1,23456. Agora decodifica UTF-8/Windows-1252 e converte
     "1.234,56", "30,5" e "1.200" em arquivos separados por ";".

   Campanhas Meias e Grendene:
   - Os relatórios se chamam "_Obtenção_dos_quantitativos_VENDIDOS_..._GERENTES.csv" e a
     regra antiga ("vend") jogava todos em Vendedores. Ordem nova: Sub > Regional > Gerente
     > Vendedor. Cards de cada cargo aceitam clique e arrastar. Grendene ganhou o #toast
     que faltava e lê "1.200" pares como 1200. */
(function(){
  if(window.__uploadCorrecoes)return;window.__uploadCorrecoes=true;
  var SCRIPT_URL=(document.currentScript&&document.currentScript.src)||'';
  var ACCEPT_CAMPANHA='.xlsx,.xls,.csv,.txt';
  var SLOTS=['v','g','s','r'];
  var NOMES={v:'Vendedores',g:'Gerentes',s:'Subgerentes',r:'Regionais'};
  var CAMPANHAS=['mei','gren'];

  /* ============================ UTILITÁRIOS ============================ */
  function norm(s){
    return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  }
  // Ordem importa: "subgerentes" contém "gerente"; "vendidos" (nome do relatório) NÃO é vendedor.
  function slotPorNome(nome){
    var n=norm(nome);
    if(n.indexOf('subger')>=0)return 's';
    if(/regiona|regiao/.test(n))return 'r';
    if(n.indexOf('gerente')>=0)return 'g';
    if(/vendedor|caixa/.test(n))return 'v';
    return null;
  }
  function decodificar(buf){
    var b=buf instanceof Uint8Array?buf:new Uint8Array(buf);
    try{return new TextDecoder('utf-8',{fatal:true}).decode(b).replace(/^﻿/,'');}
    catch(e){return new TextDecoder('windows-1252').decode(b);}
  }
  function separador(txt){
    var linha1=(txt.split(/\r?\n/).find(function(l){return l.trim();})||'');
    var cont=function(c){return linha1.split(c).length-1;};
    return [';','\t',','].sort(function(a,b){return cont(b)-cont(a);})[0];
  }
  function parseCSV(txt,sep){
    sep=sep||separador(txt);
    var rows=[],row=[],cel='',q=false;
    for(var i=0;i<txt.length;i++){
      var ch=txt[i];
      if(q){
        if(ch==='"'){if(txt[i+1]==='"'){cel+='"';i++;}else q=false;}
        else cel+=ch;
      }else if(ch==='"')q=true;
      else if(ch===sep){row.push(cel);cel='';}
      else if(ch==='\n'||ch==='\r'){
        if(ch==='\r'&&txt[i+1]==='\n')i++;
        row.push(cel);cel='';
        if(row.some(function(c){return String(c).trim()!=='';}))rows.push(row);
        row=[];
      }else cel+=ch;
    }
    row.push(cel);
    if(row.some(function(c){return String(c).trim()!=='';}))rows.push(row);
    return rows.map(function(r){return r.map(function(c){return c.trim();});});
  }
  // Número no padrão brasileiro → padrão que a biblioteca entende. CPF/códigos ficam como estão.
  function numeroBR(c){
    var s=c.replace(/^R\$\s*/,'');
    if(/^-?\d{1,3}(\.\d{3})*,\d+$/.test(s)||/^-?\d+,\d+$/.test(s))return s.replace(/\./g,'').replace(',','.');
    if(/^-?[1-9]\d{0,2}\.\d{3}$/.test(s))return s.replace('.','');
    return c;
  }
  function ehTexto(b){
    if(!b||b.length<1)return false;
    if(b[0]===0x50&&b[1]===0x4B)return false;                       // xlsx (zip)
    if(b[0]===0xD0&&b[1]===0xCF&&b[2]===0x11&&b[3]===0xE0)return false; // xls antigo
    for(var i=0;i<Math.min(b.length,1024);i++)if(b[i]===0)return false;
    var ini=decodificar(b.subarray(0,Math.min(b.length,200))).trim().toLowerCase();
    if(ini.charAt(0)==='<')return false;                             // xls em HTML/XML
    return true;
  }
  function aviso(msg){
    try{
      var el=document.getElementById('__upload_aviso');
      if(!el){
        el=document.createElement('div');el.id='__upload_aviso';
        el.style.cssText='position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483647;background:#1E293B;color:#fff;padding:10px 16px;border-radius:9px;font:600 13px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3);max-width:90vw;transition:opacity .25s';
        document.body.appendChild(el);
      }
      el.textContent=msg;el.style.opacity='1';
      clearTimeout(el._t);el._t=setTimeout(function(){el.style.opacity='0';},3500);
    }catch(e){}
  }

  /* ============================ CORREÇÕES GERAIS ============================ */
  function corrigirHandlersInline(raiz){
    ['ondragover','ondragleave','ondrop','ondragenter'].forEach(function(at){
      raiz.querySelectorAll('['+at+']').forEach(function(el){
        var v=el.getAttribute(at);
        if(v&&/\bev\./.test(v))el.setAttribute(at,v.replace(/\bev\./g,'event.'));
      });
    });
  }
  function ampliarAccept(raiz){
    raiz.querySelectorAll('input[type=file][accept]').forEach(function(i){
      var a=i.getAttribute('accept');
      if(/\.xlsx?\b/i.test(a)&&!/\.csv\b/i.test(a))i.setAttribute('accept',a+',.csv');
    });
  }
  function corrigirDOM(raiz){corrigirHandlersInline(raiz);ampliarAccept(raiz);}

  // Envolve XLSX.read só para CSV/TXT; planilhas .xlsx/.xls seguem exatamente como antes.
  function corrigirLeituraCSV(){
    var X=window.XLSX;if(!X||typeof X.read!=='function'||X.__csvBR)return !!(X&&X.__csvBR);
    var original=X.read;
    X.read=function(data,opts){
      try{
        var tipo=opts&&opts.type,bytes=null;
        if(tipo==='array'||data instanceof ArrayBuffer||ArrayBuffer.isView(data)){
          bytes=data instanceof ArrayBuffer?new Uint8Array(data):(ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):null);
        }
        if(bytes&&ehTexto(bytes)){
          var txt=decodificar(bytes),sep=separador(txt),o={};
          for(var k in opts)o[k]=opts[k];
          o.type='string';
          if(sep===';'&&!o.raw){
            txt=parseCSV(txt,';').map(function(r){
              return r.map(function(c){c=numeroBR(c);return /[;"\r\n]/.test(c)?'"'+c.replace(/"/g,'""')+'"':c;}).join(';');
            }).join('\n');
          }
          return original.call(this,txt,o);
        }
      }catch(e){console.warn('[upload-correcoes] leitura CSV',e);}
      return original.apply(this,arguments);
    };
    X.__csvBR=true;return true;
  }
  function aguardarXLSX(){
    if(corrigirLeituraCSV())return;
    var n=0,t=setInterval(function(){if(corrigirLeituraCSV()||++n>150)clearInterval(t);},200);
  }

  // Escolhe o campo de upload que "contém" o ponto onde o arquivo foi solto.
  function visivel(el){return !!(el.getClientRects().length||(el.parentElement&&el.parentElement.getClientRects().length));}
  function campoMaisProximo(alvo){
    var el=alvo&&alvo.nodeType===1?alvo:document.body;
    while(el){
      var ins=Array.prototype.filter.call(el.querySelectorAll('input[type=file]'),function(i){return !i.disabled&&visivel(i);});
      if(ins.length===1)return ins[0];
      if(ins.length>1){
        var mult=ins.filter(function(i){return i.multiple;});
        return mult.length===1?mult[0]:null;
      }
      el=el.parentElement;
    }
    return null;
  }
  function aceita(inp,f){
    var a=(inp.getAttribute('accept')||'').toLowerCase().split(',').map(function(s){return s.trim();}).filter(Boolean);
    if(!a.length)return true;
    var nome=f.name.toLowerCase(),tipo=(f.type||'').toLowerCase();
    return a.some(function(x){
      if(x.charAt(0)==='.')return nome.slice(-x.length)===x;
      if(x.slice(-2)==='/*')return tipo.indexOf(x.slice(0,-1))===0;
      return tipo===x;
    });
  }
  function soltarSemDownload(aoSoltar){
    window.addEventListener('dragover',function(e){
      if(e.defaultPrevented)return;
      if(e.dataTransfer&&Array.prototype.indexOf.call(e.dataTransfer.types||[],'Files')>=0)e.preventDefault();
    });
    window.addEventListener('drop',function(e){
      if(e.defaultPrevented)return;
      var fs=e.dataTransfer&&e.dataTransfer.files;if(!fs||!fs.length)return;
      e.preventDefault();
      if(aoSoltar){aoSoltar(fs,e);return;}
      var inp=campoMaisProximo(e.target);
      var lista=Array.prototype.slice.call(fs).filter(function(f){return !inp||aceita(inp,f);});
      if(!inp||!lista.length){aviso('Solte o arquivo dentro da área de upload (ou clique nela para selecionar).');return;}
      var dt=new DataTransfer();
      (inp.multiple?lista:lista.slice(0,1)).forEach(function(f){dt.items.add(f);});
      inp.files=dt.files;
      inp.dispatchEvent(new Event('input',{bubbles:true}));
      inp.dispatchEvent(new Event('change',{bubbles:true}));
    });
  }

  function correcoesGerais(aoSoltar){
    corrigirDOM(document);
    aguardarXLSX();
    soltarSemDownload(aoSoltar);
    // Telas que montam campos depois (abas, modais) também recebem a correção.
    var pend=false;
    new MutationObserver(function(){
      if(pend)return;pend=true;
      setTimeout(function(){pend=false;corrigirDOM(document);},150);
    }).observe(document.body||document.documentElement,{childList:true,subtree:true});
  }

  /* ===================== CAMPANHAS MEIAS / GRENDENE (dentro do módulo) ===================== */
  function corrigirCampanha(){
    var ehGren=!!document.getElementById('dropzone');

    // O Grendene não tem o elemento #toast: qualquer aviso gerava erro e interrompia o fluxo.
    if(!document.getElementById('toast')){
      var tt=document.createElement('div');tt.id='toast';tt.className='toast';
      document.body.appendChild(tt);
    }
    if(typeof window.onDrop!=='function')document.querySelectorAll('[ondrop*="onDrop("]').forEach(function(el){el.removeAttribute('ondrop');});
    document.querySelectorAll('input[type=file]').forEach(function(i){i.setAttribute('accept',ACCEPT_CAMPANHA);});
    var sub=document.querySelector('.dz-sub');
    if(sub&&ehGren)sub.textContent='Selecione de 1 a 4 arquivos de uma vez (.xlsx / .xls / .csv)';

    // CSV lido como texto (o cálculo das campanhas já trata "1.234,56" no toN).
    var lerOriginal=window.lerXLSX;
    window.lerXLSX=function(file){
      if(!/\.(csv|txt)$/i.test(file&&file.name||''))return lerOriginal(file);
      return file.arrayBuffer().then(function(buf){return parseCSV(decodificar(buf));});
    };
    // Grendene lia "1.234,56" como 1.234 e "1.200" pares como 1,2.
    if(ehGren){
      window.toN=function(v){
        if(v===''||v==null)return 0;
        if(typeof v==='number')return isNaN(v)?0:v;
        var s=String(v).replace(/[R$\s]/g,'');
        if(s.indexOf(',')>=0||/^-?\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'').replace(',','.');
        var n=parseFloat(s);return isNaN(n)?0:n;
      };
    }

    async function slotPorConteudo(f){
      try{
        var rows=await window.lerXLSX(f);
        var hI=(typeof hdr==='function')?hdr(rows):0;
        var cols=norm((rows[hI]||[]).join('|'));
        if(cols.indexOf('subger')>=0)return 's';
        if(cols.indexOf('regional')>=0&&cols.indexOf('vendedor')<0)return 'r';
        if(cols.indexOf('gerente')>=0&&cols.indexOf('vendedor')<0)return 'g';
        if(/vendedor|caixa|qtd|pares|quantidade/.test(cols))return 'v';
      }catch(e){}
      return null;
    }
    function atualizar(){
      if(typeof atualizarBotao==='function'){atualizarBotao();return;}
      var falta=SLOTS.filter(function(k){return !ARQS[k];});
      document.getElementById('bproc').disabled=falta.length>0;
      if(!falta.length)toast('Todos os arquivos prontos! ✅','ok');
      else toast('Faltam: '+falta.map(function(k){return NOMES[k];}).join(', '));
    }
    async function carregar(files){
      var lista=Array.prototype.slice.call(files||[]);if(!lista.length)return;
      var semNome=[],ok=[];
      lista.forEach(function(f){var s=slotPorNome(f.name);if(s){atribuirArquivo(s,f);ok.push(s);}else semNome.push(f);});
      var erros=[];
      for(var i=0;i<semNome.length;i++){
        var f=semNome[i],s=await slotPorConteudo(f);
        // Relatório sem cargo no nome e Vendedores ainda vazio → é o de Vendedores.
        if(s&&ok.indexOf(s)>=0&&!ARQS.v)s='v';
        if(!s&&!ARQS.v)s='v';
        if(s){atribuirArquivo(s,f);ok.push(s);}else erros.push(f.name);
      }
      if(erros.length)toast('Não identificado: '+erros.join(', ')+' — solte no card certo','err');
      atualizar();
    }
    if(ehGren)window.onMultiFile=carregar;else window.onFiles=carregar;

    // Cards individuais: clicar ou soltar carrega direto naquele cargo.
    SLOTS.forEach(function(k){
      var card=document.getElementById('cu-'+k);if(!card)return;
      var inp=document.getElementById('fu-'+k);
      if(!inp){
        inp=document.createElement('input');inp.type='file';inp.id='fu-'+k;inp.accept=ACCEPT_CAMPANHA;inp.style.display='none';
        card.appendChild(inp);card.style.cursor='pointer';card.title='Clique ou solte o arquivo de '+NOMES[k];
        card.addEventListener('click',function(e){if(e.target!==inp)inp.click();});
      }
      inp.onchange=function(){var f=inp.files&&inp.files[0];if(f){atribuirArquivo(k,f);atualizar();}inp.value='';};
      card.addEventListener('dragover',function(e){e.preventDefault();e.stopPropagation();card.classList.add('drag');});
      card.addEventListener('dragleave',function(){card.classList.remove('drag');});
      card.addEventListener('drop',function(e){
        e.preventDefault();e.stopPropagation();card.classList.remove('drag');
        var fs=e.dataTransfer&&e.dataTransfer.files;if(!fs||!fs.length)return;
        if(fs.length>1)carregar(fs);else{atribuirArquivo(k,fs[0]);atualizar();}
      });
    });
    // No Meias o clique no card abria o seletor duas vezes (input + onclick do card).
    if(!ehGren)SLOTS.forEach(function(k){var c=document.getElementById('cu-'+k);if(c)c.removeAttribute('onclick');});

    var limparOriginal=window.limpar;
    if(typeof limparOriginal==='function')window.limpar=function(){
      limparOriginal.apply(this,arguments);
      SLOTS.forEach(function(k){var i=document.getElementById('fu-'+k);if(i)i.value='';});
    };
    return function(fs){carregar(fs);};
  }

  /* ============================ SHELL DO PORTAL ============================ */
  function corrigirShell(){
    // Painel de upload do Portal para as campanhas: mesma regra de nome.
    if(typeof hDA==='function'){
      var hDAOriginal=hDA;
      hDA=function(pid,fileList){
        if(CAMPANHAS.indexOf(pid)<0)return hDAOriginal.apply(this,arguments);
        var files=Array.prototype.slice.call(fileList||[]);if(!files.length)return;
        var cnt=0,semNome=[];
        files.forEach(function(f){var s=slotPorNome(f.name);if(s){hSF(pid,s,f);cnt++;}else semNome.push(f);});
        // Sem cargo no nome → Vendedores se ainda vazio; o módulo reconfere pelo conteúdo.
        semNome.forEach(function(f){if(!getF(pid).v){hSF(pid,'v',f);cnt++;}});
        if(cnt)toast('📂 '+cnt+' arquivo(s) identificado(s)!');
        if(cnt<files.length)toast('⚠ Arquivo sem cargo no nome — use o card certo');
      };
    }
    CAMPANHAS.forEach(function(pid){
      document.querySelectorAll('#up-'+pid+' input[type=file]').forEach(function(i){i.setAttribute('accept',ACCEPT_CAMPANHA);});
    });
    // Central de Upload Universal: nas campanhas, o cargo vem do nome do arquivo.
    if(typeof renderUniversalQueue==='function'&&typeof UNIVERSAL_QUEUE!=='undefined'){
      var renderOriginal=renderUniversalQueue;
      renderUniversalQueue=function(){
        try{UNIVERSAL_QUEUE.forEach(function(it){
          if(it&&it.file&&CAMPANHAS.indexOf(it.pid)>=0){var s=slotPorNome(it.file.name);if(s)it.sid=s;}
        });}catch(e){}
        return renderOriginal.apply(this,arguments);
      };
    }

    // Injeta esta correção dentro do HTML de cada módulo antes de virar blob.
    var tag='<script src="'+SCRIPT_URL+'"><\/script>';
    if(typeof getBlobUrl==='function'&&typeof MENC!=='undefined'&&typeof BLOBS!=='undefined'&&SCRIPT_URL){
      var getBlobOriginal=getBlobUrl;
      getBlobUrl=function(pid){
        if(!BLOBS[pid]&&MENC[pid]){
          try{
            var bin=atob(MENC[pid]),arr=new Uint8Array(bin.length);
            for(var i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
            var html=new TextDecoder('utf-8').decode(arr);
            var p=html.toLowerCase().lastIndexOf('</body>');
            html=p>=0?html.slice(0,p)+tag+html.slice(p):html+tag;
            BLOBS[pid]=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
          }catch(e){console.warn('[upload-correcoes] falha ao preparar '+pid,e);}
        }
        return getBlobOriginal.apply(this,arguments);
      };
    }
    // Garantia: módulo que abriu sem a injeção (ex.: já aberto) recebe pelo iframe.
    function aplicarNoIframe(ifr){
      if(ifr.__uploadCorrecoesLigado)return;ifr.__uploadCorrecoesLigado=true;
      function aplicar(){
        try{
          var d=ifr.contentDocument,w=ifr.contentWindow;
          if(!d||!w||!d.body||w.__uploadCorrecoes||d.querySelector('script[data-upload-correcoes]'))return;
          if(!d.querySelector('input[type=file]'))return;
          var s=d.createElement('script');s.src=SCRIPT_URL;s.setAttribute('data-upload-correcoes','1');
          d.body.appendChild(s);
        }catch(e){}
      }
      ifr.addEventListener('load',aplicar);aplicar();
    }
    if(SCRIPT_URL){
      document.querySelectorAll('iframe.mifr').forEach(aplicarNoIframe);
      new MutationObserver(function(){document.querySelectorAll('iframe.mifr').forEach(aplicarNoIframe);})
        .observe(document.body,{childList:true,subtree:true});
    }
  }

  /* ============================ INÍCIO ============================ */
  function iniciar(){
    var ehCampanha=typeof ARQS!=='undefined'&&document.getElementById('cu-v')&&document.getElementById('bproc');
    var aoSoltar=ehCampanha?corrigirCampanha():null;
    correcoesGerais(aoSoltar);
    if(typeof MENC!=='undefined'&&typeof getBlobUrl==='function')corrigirShell();
  }
  if(document.body)iniciar();else document.addEventListener('DOMContentLoaded',iniciar);
})();
