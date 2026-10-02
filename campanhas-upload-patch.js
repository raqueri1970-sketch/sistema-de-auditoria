/* Correção do carregamento das Campanhas Meias e Grendene (2026-10-02).
   O mesmo arquivo roda em dois lugares:
   - No shell do Portal (tem MENC/getBlobUrl): injeta este script dentro dos módulos
     'mei' e 'gren' e corrige a identificação dos arquivos no painel de upload do Portal.
   - Dentro dos módulos 'mei'/'gren' (tem ARQS): corrige o carregamento lá dentro.
   Problemas corrigidos:
   1. Os relatórios do sistema se chamam "_Obtenção_dos_quantitativos_VENDIDOS_..._GERENTES.csv".
      A regra antiga procurava "vend" primeiro, então TODO arquivo caía em Vendedores
      (um sobrescrevia o outro) — por isso não dava para passar todos de uma vez.
   2. Os seletores só aceitavam .xlsx/.xls; os relatórios são .csv.
   3. Soltar um arquivo fora da área de upload (ou nos cards Gerente/Sub/Regional, que
      não tinham tratamento) fazia o navegador BAIXAR o arquivo em vez de carregar.
      Os handlers inline usavam "ev.preventDefault()" (ev não existe), o que também
      quebrava o arrastar nas áreas do Portal. */
(function(){
  var SCRIPT_URL=(document.currentScript&&document.currentScript.src)||window.__CAMPANHAS_FIX_URL||'';
  var ACCEPT='.xlsx,.xls,.csv,.txt';
  var SLOTS=['v','g','s','r'];
  var NOMES={v:'Vendedores',g:'Gerentes',s:'Subgerentes',r:'Regionais'};

  function norm(s){
    return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  }
  // Ordem importa: "subgerentes" contém "gerente"; "vendidos" (nome do relatório) NÃO é vendedor.
  function slotPorNome(nome){
    var n=norm(nome).replace(/\.(csv|txt|xlsx?|xls)$/,'');
    if(n.indexOf('subger')>=0)return 's';
    if(/regiona|regiao/.test(n))return 'r';
    if(n.indexOf('gerente')>=0)return 'g';
    if(/vendedor|caixa/.test(n))return 'v';
    return null;
  }

  // Arrastos inline escritos com "ev." (variável inexistente) → usa o "event" do handler.
  function corrigirHandlersInline(doc){
    ['ondragover','ondragleave','ondrop','ondragenter'].forEach(function(at){
      doc.querySelectorAll('['+at+']').forEach(function(el){
        var v=el.getAttribute(at);
        if(v&&/\bev\./.test(v))el.setAttribute(at,v.replace(/\bev\./g,'event.'));
      });
    });
  }
  // Nunca deixar o navegador abrir/baixar um arquivo solto fora de uma área de upload.
  function bloquearDownloadAoSoltar(win,aoSoltar){
    win.addEventListener('dragover',function(e){
      if(e.dataTransfer&&Array.prototype.indexOf.call(e.dataTransfer.types||[],'Files')>=0)e.preventDefault();
    });
    win.addEventListener('drop',function(e){
      if(e.defaultPrevented)return;
      if(!e.dataTransfer||!e.dataTransfer.files||!e.dataTransfer.files.length)return;
      e.preventDefault();
      if(aoSoltar)aoSoltar(e.dataTransfer.files);
    });
  }

  /* ===================== DENTRO DO MÓDULO MEIAS / GRENDENE ===================== */
  function corrigirModulo(){
    if(window.__campanhasUploadFix)return;window.__campanhasUploadFix=true;
    var ehGren=!!document.getElementById('dropzone');

    // O Grendene não tem o elemento #toast: qualquer aviso gerava erro e interrompia o fluxo.
    if(!document.getElementById('toast')){
      var tt=document.createElement('div');tt.id='toast';tt.className='toast';
      document.body.appendChild(tt);
    }
    corrigirHandlersInline(document);
    if(typeof window.onDrop!=='function')document.querySelectorAll('[ondrop*="onDrop("]').forEach(function(el){el.removeAttribute('ondrop');});
    document.querySelectorAll('input[type=file]').forEach(function(i){i.setAttribute('accept',ACCEPT);});
    var sub=document.querySelector('.dz-sub');
    if(sub&&ehGren)sub.textContent='Selecione de 1 a 4 arquivos de uma vez (.xlsx / .xls / .csv)';

    // ---- Leitura: CSV com acentos (UTF-8 ou Windows-1252) e separador ; , ou TAB ----
    function decodificar(buf){
      var b=new Uint8Array(buf);
      try{return new TextDecoder('utf-8',{fatal:true}).decode(b).replace(/^﻿/,'');}
      catch(e){return new TextDecoder('windows-1252').decode(b);}
    }
    function parseCSV(txt){
      var linha1=(txt.split(/\r?\n/).find(function(l){return l.trim();})||'');
      var cont=function(c){return linha1.split(c).length-1;};
      var sep=[';','\t',','].sort(function(a,b){return cont(b)-cont(a);})[0];
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
    var lerOriginal=window.lerXLSX;
    window.lerXLSX=function(file){
      if(!/\.(csv|txt)$/i.test(file&&file.name||''))return lerOriginal(file);
      return file.arrayBuffer().then(function(buf){return parseCSV(decodificar(buf));});
    };
    // Grendene lia "1.234,56" como 1.234 e "1.200" pares como 1,2 — aceita o formato brasileiro.
    if(ehGren){
      window.toN=function(v){
        if(v===''||v==null)return 0;
        if(typeof v==='number')return isNaN(v)?0:v;
        var s=String(v).replace(/[R$\s]/g,'');
        if(s.indexOf(',')>=0||/^-?\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'').replace(',','.');
        var n=parseFloat(s);return isNaN(n)?0:n;
      };
    }

    // ---- Identificação dos arquivos ----
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

    // ---- Cards individuais: clicar ou soltar carrega direto naquele cargo ----
    SLOTS.forEach(function(k){
      var card=document.getElementById('cu-'+k);if(!card)return;
      var inp=document.getElementById('fu-'+k);
      if(!inp){
        inp=document.createElement('input');inp.type='file';inp.id='fu-'+k;inp.accept=ACCEPT;inp.style.display='none';
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

    // Limpar também zera os seletores dos cards.
    var limparOriginal=window.limpar;
    if(typeof limparOriginal==='function')window.limpar=function(){
      limparOriginal.apply(this,arguments);
      SLOTS.forEach(function(k){var i=document.getElementById('fu-'+k);if(i)i.value='';});
    };

    bloquearDownloadAoSoltar(window,carregar);
  }

  /* ===================== NO SHELL DO PORTAL ===================== */
  function corrigirShell(){
    if(window.__campanhasUploadFixShell)return;window.__campanhasUploadFixShell=true;
    var MODS=['mei','gren'];

    corrigirHandlersInline(document);
    // Painel de upload do Portal: mesma regra de nome (o relatório "VENDIDOS" ia todo para Vendedores).
    if(typeof hDA==='function'){
      var hDAOriginal=hDA;
      hDA=function(pid,fileList){
        if(MODS.indexOf(pid)<0)return hDAOriginal.apply(this,arguments);
        var files=Array.prototype.slice.call(fileList||[]);if(!files.length)return;
        var cnt=0,semNome=[];
        files.forEach(function(f){var s=slotPorNome(f.name);if(s){hSF(pid,s,f);cnt++;}else semNome.push(f);});
        // Sem cargo no nome → vai para Vendedores se ainda estiver vazio; o módulo reconfere pelo conteúdo.
        semNome.forEach(function(f){if(!getF(pid).v){hSF(pid,'v',f);cnt++;}});
        if(cnt)toast('📂 '+cnt+' arquivo(s) identificado(s)!');
        if(semNome.length&&cnt<files.length)toast('⚠ Arquivo sem cargo no nome — use o card certo');
      };
    }
    MODS.forEach(function(pid){
      document.querySelectorAll('#up-'+pid+' input[type=file]').forEach(function(i){i.setAttribute('accept',ACCEPT);});
    });

    // Injeta esta correção dentro do HTML dos módulos antes de virar blob.
    if(typeof getBlobUrl==='function'&&typeof MENC!=='undefined'&&SCRIPT_URL){
      var getBlobOriginal=getBlobUrl;
      getBlobUrl=function(pid){
        if(MODS.indexOf(pid)>=0&&!BLOBS[pid]&&MENC[pid]){
          try{
            var bin=atob(MENC[pid]),arr=new Uint8Array(bin.length);
            for(var i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
            var html=new TextDecoder('utf-8').decode(arr);
            var tag='<script src="'+SCRIPT_URL+'"><\/script>';
            var p=html.toLowerCase().lastIndexOf('</body>');
            html=p>=0?html.slice(0,p)+tag+html.slice(p):html+tag;
            BLOBS[pid]=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
          }catch(e){console.warn('[campanhas-upload-patch] falha ao preparar '+pid,e);}
        }
        return getBlobOriginal.apply(this,arguments);
      };
    }
    // Garantia: se o módulo já estava aberto (ou abriu sem a injeção), aplica pelo iframe.
    MODS.forEach(function(pid){
      var ifr=document.getElementById('ifr-'+pid);if(!ifr||!SCRIPT_URL)return;
      function aplicar(){
        try{
          var d=ifr.contentDocument,w=ifr.contentWindow;
          if(!d||!w||w.__campanhasUploadFix||typeof w.ARQS==='undefined'&&!d.getElementById('cu-v'))return;
          if(d.querySelector('script[data-campanhas-fix]'))return;
          var s=d.createElement('script');s.src=SCRIPT_URL;s.setAttribute('data-campanhas-fix','1');
          (d.body||d.documentElement).appendChild(s);
        }catch(e){}
      }
      ifr.addEventListener('load',aplicar);aplicar();
    });

    bloquearDownloadAoSoltar(window,null);
  }

  var ehModulo=typeof ARQS!=='undefined'&&document.getElementById('cu-v')&&document.getElementById('bproc');
  if(ehModulo)corrigirModulo();
  else if(typeof MENC!=='undefined'&&typeof getBlobUrl==='function')corrigirShell();
})();
