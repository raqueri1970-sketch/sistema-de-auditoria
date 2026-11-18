/* ===== Resumo de atrasos =====
   Base: espelho de ponto do AbsisRH (dia a dia de todos os colaboradores) + cartão de ponto + folha da competência.
   Atraso no mês = débito no banco (DEBT) em dia trabalhado sem observação no espelho + atraso injustificado (ATRA INJ, vai para FALT);
                   débito em dia com observação (COMP BCO, COMP, CURSO, ATESTADO, ACFAM...) não é atraso. O AbsisRH já aplica a tolerância de 15 min.
                   Quem não está no espelho entra pelo cartão de ponto.
   Lançado no banco = DEBT do período para quem tem banco de horas (saldo no espelho) · o resto do atraso deve ser descontado na folha.
   Descontado de atraso = rubrica de atraso (1354); sem ela, o que falta/atraso da folha descontou acima das faltas do mês.
   Já negativo = saldo do banco negativo no início do período (SANT do espelho).
   Advertido = advertência registrada no sistema de RH (relatório ainda não está na base). FALT ADV no espelho é falta, não advertência.
   Conferência: atrasados = descontados + só no banco + não descontados + até 15 min + demitidos. */
var FA_ADV_RE=/advert|\bADV\b/i;
(function(){const st=document.createElement('style');st.textContent='.fa-ra-ks{grid-template-columns:repeat(3,minmax(0,1fr))}.fa-ra-m{font-size:15px;font-weight:800;color:#e5edf8;margin:2px 0 6px;font-variant-numeric:tabular-nums}.fa-ra-m small{font-size:11.5px;font-weight:600;color:#8ea4bd;margin-left:4px}.fa-xk.ok .fa-xk-v{color:#4fd69c}.fa-xk.net .fa-xk-v{color:#7cb6ff}.fa-ra-reg tbody tr{cursor:pointer}.fa-ra-reg tbody tr:hover td{background:#132033}.fa-ra-p{color:#8ea4bd;font-size:11px;margin-left:4px}@media(max-width:1100px){.fa-ra-ks{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:700px){.fa-ra-ks{grid-template-columns:1fr}}';document.head.appendChild(st)})();
const FA_RA_ST={integral:'Descontado',parcial:'Descontado em parte',banco:'Compensado no banco de horas',nao:'Não descontado nem lançado no banco',tol:'Só atraso de até 15 min (não descontável)',dem:'Desligado (acerto na rescisão)',semfolha:'Folha não carregada'};
function faResumoData(m,reg){
  const tol=FA_TOL_H,hasF=!!m.sources.payrollAvailable,M=m.mirror,mm=M?new Map(M.rows.map(x=>[x.code,x])):new Map();
  const md=typeof faMirrorDays!=='undefined'&&faMirrorDays?faMirrorDays:null,rb=new Map(m.rows.map(r=>[r.code,r]));
  const vOf=(d,k)=>{const x=String(d[3]||'').match(new RegExp('(?:^|,)'+k+'=(-?\\d+)'));return x?+x[1]/60:0};
  /* Dia a dia do espelho: atraso = débito no banco em dia trabalhado sem observação (só batidas);
     ATRA INJ = atraso injustificado, vai para FALT (desconto em folha); FALT nos outros dias = falta de dia;
     débito em dia com observação (COMP BCO, COMP, CURSO, ATESTADO, ACFAM...) não é atraso. */
  const esp=code=>{const dd=md&&md.get(code);if(!dd)return null;const o={atr:0,dias:0,inj:0,diasInj:0,falta:0,just:0};
    dd.forEach(d=>{const ob=String(d[2]||'').trim(),deb=vOf(d,'DEBT'),fal=vOf(d,'FALT');
      if(deb>0){if(!ob){o.atr+=deb;o.dias++}else if(!(/COMP/.test(ob)&&/BCO/.test(ob)))o.just+=deb}
      if(fal>0){if(/ATRA/.test(ob)){o.inj+=fal;o.diasInj++}else o.falta+=fal}});return o};
  const E=new Map();if(M)M.rows.forEach(x=>{const e=esp(x.code);if(e)E.set(x.code,e)});
  const semDia=M?M.rows.filter(x=>!E.has(x.code)).length:0;
  const espOf=x=>E.get(x.code)||{atr:Math.max(0,(x.debDia||0)-(x.compBco||0)),dias:x.atrDias??null,inj:0,diasInj:0,falta:x.FALT||0,just:0,aprox:true};
  const codes=new Set(M?M.rows.filter(x=>{const e=espOf(x);return e.atr+e.inj>tol}).map(x=>x.code):[]);
  m.rows.forEach(r=>{if(r.atrasoCount>0&&!mm.has(r.code))codes.add(r.code)});
  let L=[...codes].map(code=>{
    const r=rb.get(code)||null,mr=mm.get(code)||null,e=mr?espOf(mr):null;
    const temBanco=!!(mr&&mr.SDBH!=null);
    let atrBancoH,injH,atrN,faltaDiaH,fonte;
    if(e){atrBancoH=e.atr;injH=e.inj;atrN=e.dias==null?null:e.dias+e.diasInj;faltaDiaH=e.falta;fonte=e.aprox?'espelho (totais)':'espelho'}
    else{atrBancoH=0;injH=Math.max(0,(r.atrasoMin-(r.tolMin||0))/60);atrN=r.atrasoCount;faltaDiaH=r.faltaMin/60;fonte='cartão de ponto (fora do espelho)'}
    const atrH=atrBancoH+injH,bancoH=temBanco?atrBancoH:0,devFolhaH=injH+(temBanco?0:atrBancoH);
    const rubA=!!(r&&r.atraso.qty>tol),faTot=r&&r.hasPay?r.falta.qty+r.atraso.qty:(mr?mr.folhaFA||0:0);
    let descH=rubA?r.atraso.qty:Math.min(Math.max(0,faTot-faltaDiaH),Math.max(devFolhaH,0)+tol);if(descH<=tol)descH=0;
    const rate=rubA&&r.atraso.value>0?r.atraso.value/r.atraso.qty:(mr&&mr.rate!=null?mr.rate:r?r.rate:null),R=rate!=null?rate:0;
    const descV=rubA?r.atraso.value:descH*R,dem=!!((r&&r.demitido)||(mr&&mr.desligSaida));
    const st=!hasF?'semfolha':dem?'dem':descH>tol?(descH+tol>=devFolhaH?'integral':'parcial'):devFolhaH<=tol?'banco':'nao';
    const faltouH=st==='parcial'||st==='nao'?Math.max(0,devFolhaH-descH):0,santH=mr&&mr.SANT!=null&&mr.SANT<-0.01?-mr.SANT:0;
    const folhaV=r&&r.hasPay?(r.descV||0):(mr?mr.folhaDescV||0:0);
    const store=mr?mr.store:r.store,regional=(mr?mr.regional:(r.regional||faRegionalOf(r.store)))||'—';
    return {r,mr,code,name:mr?mr.name:r.name,store,regional,role:mr?mr.cargo:r.role,fonte,atrN,atrH,injH,devH:atrH,devV:atrH*R,bancoH,bancoV:bancoH*R,noBanco:bancoH>tol,temBanco,
      devFolhaH,devFolhaV:devFolhaH*R,descH,descV,rubA,rate,faltouH,faltouV:faltouH*R,semValor:rate==null&&atrH>tol,justH:e?e.just:0,
      neg:santH>0.01,santH,santV:santH*R,sant:mr?mr.SANT:null,sdbh:mr?mr.SDBH:null,piorou:!!(mr&&mr.SANT!=null&&mr.SDBH!=null&&mr.SDBH<mr.SANT-0.01),
      adv:false,advD:[],faltas:Math.round(faltaDiaH/(FA_DAY_MIN/60)),folhaV,semDescFolha:folhaV<0.01,st}});
  if(reg)L=L.filter(x=>x.regional===reg);
  const sum=(l,f)=>l.reduce((s,x)=>s+(+f(x)||0),0),isD=x=>x.st==='integral'||x.st==='parcial';
  const D=L.filter(isD),S=L.filter(x=>x.st==='banco'),N=L.filter(x=>x.st==='nao'),B=L.filter(x=>x.noBanco),G=L.filter(x=>x.neg),V=[];
  const GP=G.filter(x=>x.piorou),GPS=GP.filter(x=>x.semDescFolha);
  const quadroPonto=M?M.rows.length:null,justTot=M?[...E.values()].reduce((s,e)=>s+e.just,0):0;
  return {L,D,S,N,B,G,GP,GPS,V,hasF,hasM:!!M,advNaBase:false,sum,quadroPonto,semDia,
    t:{n:L.length,ev:sum(L,x=>x.atrN),evSem:L.filter(x=>x.atrN==null).length,atrH:sum(L,x=>x.atrH),devH:sum(L,x=>x.devH),devV:sum(L,x=>x.devV),
      injN:L.filter(x=>x.injH>tol).length,injH:sum(L,x=>x.injH),justH:justTot,
      fEsp:L.filter(x=>x.mr).length,fPt:L.filter(x=>!x.mr).length,
      descH:sum(D,x=>x.descH),descV:sum(D,x=>x.descV),integral:D.filter(x=>x.st==='integral').length,parcial:D.filter(x=>x.st==='parcial').length,parcH:sum(D,x=>x.faltouH),parcV:sum(D,x=>x.faltouV),
      soBanco:S.length,soBancoH:sum(S,x=>x.bancoH),soBancoV:sum(S,x=>x.bancoV),
      naoH:sum(N,x=>x.faltouH),naoV:sum(N,x=>x.faltouV),naoSemBanco:N.filter(x=>!x.temBanco).length,naoParteBanco:N.filter(x=>x.noBanco).length,
      tol:0,dem:L.filter(x=>x.st==='dem').length,semValor:L.filter(x=>x.semValor).length,semEsp:M?L.filter(x=>!x.mr).length:0,
      bancoH:sum(B,x=>x.bancoH),bancoV:sum(B,x=>x.bancoV),bancoDup:B.filter(x=>isD(x)&&x.injH<=FA_TOL_H).length,bancoDupV:0,
      santH:sum(G,x=>x.santH),santV:sum(G,x=>x.santV),gPiorou:GP.length,gSemDesc:GPS.length,gSemDescV:sum(GPS,x=>x.santV),
      advDias:0,advFolhaV:0,advFaltas:0,advAtr:0,advDescV:0,advSemDesc:0}};
}
function faResumoRender(){const el=fa$('faResumoBody');if(!el)return;const m=faModel;if(!m)return;
  const X=faResumoData(m),t=X.t,ini=faBR(m.period.start),fim=faBR(m.period.end),per=(X.hasM?'espelho + ponto ':'ponto ')+ini.slice(0,5)+' a '+fim.slice(0,5),fol='folha '+faEsc(m.payrollPeriod||'—'),esp='espelho AbsisRH até '+fim.slice(0,5);
  const pc=(a,b)=>b?faDec(a/b*100,1)+'%':'—',h=v=>'<small>'+faH(v)+'</small>';
  const card=(cls,title,n,pct,money,sub,meta,key)=>'<div class="fa-xk '+cls+'" onclick="faShow(\''+key+'\')" title="Clique para ver de onde vem o número"><div class="fa-xk-t">'+title+' ›</div><div class="fa-xk-v">'+n+(pct?'<span class="fa-xk-p">'+pct+'</span>':'')+'</div><div class="fa-ra-m">'+money+'</div><div class="fa-xk-s">'+sub+'</div><div class="fa-xk-m">'+meta+'</div></div>';
  const na=(cls,title,msg)=>'<div class="fa-xk '+cls+'"><div class="fa-xk-t">'+title+'</div><div class="fa-xk-v">—</div><div class="fa-xk-na">'+msg+'</div></div>';
  if(!t.n){el.innerHTML='<div class="fa-panel"><div class="fa-empty">Nenhum atraso ou saída antecipada no espelho nem no cartão de ponto de '+ini+' a '+fim+'.</div></div>';return}
  const pes=n=>faInt(n)+' <small style="font-size:14px;font-weight:700;color:#a3b5ca">pessoa'+(n===1?'':'s')+'</small>';
  const avisos=[];if(!X.hasF)avisos.push('Folha não carregada: os cards de desconto não foram calculados.');if(!X.hasM)avisos.push('Espelho de ponto não carregado: só os atrasos do cartão de ponto entram, e os cards de banco de horas não foram calculados.');if(t.semValor)avisos.push(t.semValor+' pessoa(s) sem valor-hora: entram em horas e com R$ 0.');if(t.semEsp)avisos.push(t.semEsp+' atrasado(s) do cartão de ponto não estão no espelho (contados como sem banco).');if(X.semDia)avisos.push('Dia a dia do espelho indisponível para '+X.semDia+' pessoa(s): atraso calculado pelo total do período (pode incluir débito em dia justificado). Recarregue o espelho.');
  const qp=X.quadroPonto||m.ativos||0,advTxt='<b style="color:#ffc35c">As advertências ficam no sistema de RH e ainda não estão nesta base: falta carregar o relatório de advertências (matrícula ou CPF, data e motivo).</b> FALT ADV do espelho é falta, não advertência.';
  const cards='<div class="fa-xrow-t">Resumo de atrasos · '+per+' · '+fol+' · '+faInt(qp)+' com ponto no espelho'+(X.quadroPonto&&m.ativos?' (de '+faInt(m.ativos)+' ativos na base ATIVOS: gerentes não batem ponto e admitidos depois de '+fim.slice(0,5)+' não estão no período)':'')+'</div>'
   +(avisos.length?'<div class="fa-cmp" style="border-color:#5a4520"><div class="fa-cmp-t" style="color:#ffc35c">Atenção à base</div>'+avisos.map(a=>'<div class="fa-cmp-sub">⚠ '+faEsc(a)+'</div>').join('')+'</div>':'')
   +'<section class="fa-xks fa-ra-ks">'
   +card('warn','Chegaram atrasados',pes(t.n),pc(t.n,qp)+' de quem bate ponto',faBRL0(t.devV)+h(t.devH)+'<small>de atraso no mês</small>',(t.evSem?'':faInt(t.ev)+' dias com atraso/saída antes · ')+t.injN+' com atraso injustificado ('+faH(t.injH)+', vai para a folha)'+(t.justH>0.05?' · '+faH(t.justH)+' debitados em dias justificados (curso, atestado, acompanhamento) não contam':'')+(t.fPt?' · '+t.fPt+' só pelo cartão':''),per,'ra:all')
   +(X.hasF?card(t.parcial?'warn':'ok','Atrasados descontados',pes(X.D.length),pc(X.D.length,t.n)+' dos atrasados',faBRL0(t.descV)+h(t.descH)+'<small>descontados na folha</small>','atraso injustificado (ATRA INJ) descontado na rubrica de falta · '+t.integral+' integral · '+t.parcial+' em parte'+(t.parcial?' (faltou '+faBRL0(t.parcV)+' · '+faH(t.parcH)+')':''),fol+' × '+per,'ra:desc'):na('ok','Atrasados descontados','Carregue a folha detalhada no quadro de arquivos'))
   +(X.hasF?card(X.N.length?'bad':'ok','Atrasados não descontados',pes(X.N.length),pc(X.N.length,t.n)+' dos atrasados',faBRL0(t.naoV)+h(t.naoH)+'<small>deixou de descontar</small>','atraso que não foi para o banco e não foi descontado'+(t.naoSemBanco?' · '+t.naoSemBanco+' sem banco de horas':'')+(X.hasM?' · '+t.soBanco+' compensados no banco estão no card ao lado':''),fol+' × '+per,'ra:nao'):na('bad','Atrasados não descontados','Carregue a folha detalhada no quadro de arquivos'))
   +(X.hasM?card('net','Atrasos lançados no banco de horas',pes(X.B.length),pc(X.B.length,t.n)+' dos atrasados',faBRL0(t.bancoV)+h(t.bancoH)+'<small>debitados no banco</small>',t.soBanco+' compensados só no banco ('+faBRL0(t.soBancoV)+')'+(t.bancoDup?' · <b style="color:#ffc35c">'+t.bancoDup+' também descontados na folha (conferir duplicidade)</b>':''),esp,'ra:banco'):na('net','Atrasos lançados no banco de horas','Carregue o espelho de ponto (.pdf ou .rar) no quadro de arquivos'))
   +(X.hasM?card(X.G.length?'neg':'ok','Atrasados que já tinham banco negativo',pes(X.G.length),pc(X.G.length,t.n)+' dos atrasados',faBRL0(t.santV)+h(t.santH)+'<small>negativo em '+ini.slice(0,5)+'</small>',t.gPiorou+' ficaram mais negativos no mês'+(X.hasF?' · <b style="color:#ff899a">'+t.gSemDesc+' pioraram e a folha não descontou nada ('+faBRL0(t.gSemDescV)+' de negativo)</b>':''),'saldo em '+ini+' · '+esp,'ra:neg'):na('neg','Atrasados que já tinham banco negativo','Carregue o espelho de ponto (.pdf ou .rar) no quadro de arquivos'))
   +na('warn','Atrasados advertidos',advTxt)
   +'</section>';
  const soma=X.D.length+t.soBanco+X.N.length+t.tol+t.dem,ok=t.n===soma;
  const recon=X.hasF?'<div class="fa-recon" style="margin:0 0 14px">Conferência: atrasados <b>'+t.n+'</b> = descontados '+X.D.length+' + só no banco '+t.soBanco+' + não descontados '+X.N.length+' + desligados '+t.dem+' = <b>'+soma+'</b> '+(ok?'✓':'✗')+' &nbsp;·&nbsp; Em R$: atraso no mês '+faBRL(t.devV)+' · no banco '+faBRL(t.bancoV)+' · descontado na folha '+faBRL(t.descV)+' · faltou descontar '+faBRL(t.naoV+t.parcV)+(t.bancoDup?' · '+t.bancoDup+' no banco e na folha ao mesmo tempo':'')+'</div>':'';
  const regs=new Map();X.L.forEach(x=>{const k=x.regional;let o=regs.get(k);if(!o){o={k,n:0,d:0,dV:0,nn:0,nV:0,b:0,bV:0,g:0,gV:0,v:0};regs.set(k,o)}o.n++;if(x.st==='integral'||x.st==='parcial'){o.d++;o.dV+=x.descV}if(x.st==='nao'){o.nn++;o.nV+=x.faltouV}if(x.noBanco){o.b++;o.bV+=x.bancoV}if(x.neg){o.g++;o.gV+=x.santV}if(x.adv)o.v++});
  const hc=new Map((m.byRegional||[]).map(r=>[r.regional,r.headcount]));
  const RL=[...regs.values()].sort((a,b)=>b.nV-a.nV||b.n-a.n),cel=(n,base,v)=>'<td class="fa-num">'+faInt(n)+'<span class="fa-ra-p">'+pc(n,base)+'</span>'+(v!=null?'<span class="fa-subline">'+faBRL0(v)+'</span>':'')+'</td>';
  const tot={n:t.n,d:X.D.length,dV:t.descV,nn:X.N.length,nV:t.naoV,b:X.B.length,bV:t.bancoV,g:X.G.length,gV:t.santV,v:X.V.length};
  const line=(o,lab,click)=>'<tr'+(click?' onclick="faShow(\'ra:all|'+encodeURIComponent(o.k).replace(/'/g,'%27')+'\')"':' class="fa-total"')+'><td class="fa-person">'+lab+'</td><td class="fa-num">'+faInt(o.n)+(hc.get(o.k)?'<span class="fa-ra-p">'+pc(o.n,hc.get(o.k))+' do quadro</span>':'')+'</td>'+(X.hasF?cel(o.d,o.n,o.dV)+cel(o.nn,o.n,o.nV):'<td>—</td><td>—</td>')+(X.hasM?cel(o.b,o.n,o.bV)+cel(o.g,o.n,o.gV):'<td>—</td><td>—</td>')+cel(o.v,o.n,null)+'</tr>';
  const tab='<div class="fa-panel"><div class="fa-panel-head"><div><div class="fa-panel-title">Atrasados por regional</div><div class="fa-panel-sub">Mesma base dos cards · % sobre os atrasados da regional · ordenado pelo valor não descontado · clique na regional para ver as pessoas</div></div></div><div class="fa-table-wrap"><table class="fa-ra-reg"><thead><tr><th>Regional</th><th>Atrasados</th><th>Descontados<br>R$ descontado</th><th>Não descontados<br>R$ não descontado</th><th>No banco de horas<br>R$ debitado</th><th>Já negativos<br>R$ negativo início</th><th>Advertidos</th></tr></thead><tbody>'+RL.map(o=>line(o,faEsc(o.k),true)).join('')+line(tot,'Total ('+RL.length+' regionais)',false)+'</tbody></table></div></div>';
  el.innerHTML=cards+recon+tab}
function faResumoComp(k,m){
  const [tipo,regE]=String(k).slice(3).split('|'),reg=regE?decodeURIComponent(regE):null,X=faResumoData(m,reg),t=X.t,ini=faBR(m.period.start),fim=faBR(m.period.end);
  const who=x=>'<b>'+faEsc(x.name)+'</b><span class="fa-subline">'+faEsc(x.code||'—')+' · '+faEsc(x.role||'')+'</span>',loj=x=>faEsc(x.store)+'<span class="fa-subline">'+faEsc(x.regional||'—')+'</span>';
  const hv=(hh,v)=>faH(hh)+' · '+faBRL(v),atr=x=>(x.atrN!=null?x.atrN+' dia(s) · ':'')+faH(x.atrH)+'<span class="fa-subline">'+faEsc(x.fonte)+'</span>';
  const sort=(l,f)=>l.slice().sort((a,b)=>f(b)-f(a)),sfx=reg?' · '+reg:'',isD=x=>x.st==='integral'||x.st==='parcial';
  const base=(X.hasM?'Espelho AbsisRH ('+(m.mirror.file||'')+') + ':'')+'cartão de ponto '+ini+' a '+fim+(X.hasF?' · folha '+(m.payrollPeriod||'')+' ('+(m.sources.payroll||'')+')':'');
  const stx=x=>{const c=x.st==='integral'||x.st==='banco'?'ok':x.st==='parcial'?'warn':x.st==='nao'?'bad':'ok';return '<span class="fa-badge '+c+'">'+FA_RA_ST[x.st]+'</span>'};
  if(tipo==='all'){const l=sort(X.L,x=>x.devV||x.devH);return {title:'Chegaram atrasados = '+t.n+' pessoas'+sfx,base,formula:'Atraso no mês = débito no banco (DEBT) em dia trabalhado <b>sem observação</b> no espelho do AbsisRH + atraso injustificado (ATRA INJ, que vai para desconto). Débito em dia com observação (COMP BCO, COMP, CURSO, ATESTADO, ACFAM) não é atraso. O AbsisRH já aplica a tolerância de 15 min. Em R$ pelo valor-hora da folha. '+t.n+' pessoas = '+faPct(t.n,X.quadroPonto||m.ativos,1)+' de quem tem ponto no espelho ('+faInt(X.quadroPonto||m.ativos||0)+').',
    sections:[{cols:['Colaborador','Lotação','Atraso no mês','Atraso h · R$','No banco h · R$','Descontado h · R$','Situação'],rows:l.map(x=>[who(x),loj(x),atr(x),hv(x.devH,x.devV),x.noBanco?hv(x.bancoH,x.bancoV):'—',isD(x)?hv(x.descH,x.descV):'—',stx(x)]),total:['Total ('+l.length+')','',faH(t.atrH),hv(t.devH,t.devV),hv(t.bancoH,t.bancoV),hv(t.descH,t.descV),'']}]}}
  if(tipo==='desc'){const l=sort(X.D,x=>x.descV);return {title:'Atrasados descontados = '+l.length+' pessoas · '+faBRL0(t.descV)+sfx,base,formula:'Atraso que vai para a folha = atraso injustificado (ATRA INJ) + atraso de quem não tem banco de horas. A folha não tem rubrica própria de atraso: o desconto é o que a rubrica de falta (1356) descontou acima das faltas de dia do espelho. Integral = descontou tudo; em parte = descontou menos.',
    sections:[{cols:['Colaborador','Lotação','Atraso no mês','Fora do banco h · R$','Descontado h · R$','Origem','Faltou descontar'],rows:l.map(x=>[who(x),loj(x),atr(x),hv(x.devFolhaH,x.devFolhaV),'<b>'+hv(x.descH,x.descV)+'</b>'+(x.noBanco?'<span class="fa-subline" style="color:#ffc35c">também '+faH(x.bancoH)+' no banco</span>':''),x.rubA?'Rubrica de atraso':'Falta/atraso acima das faltas',x.faltouH>FA_TOL_H?'<b style="color:#ff899a">'+hv(x.faltouH,x.faltouV)+'</b>':'—']),total:['Total ('+l.length+')','','',hv(X.sum(l,x=>x.devFolhaH),X.sum(l,x=>x.devFolhaV)),'<b>'+hv(t.descH,t.descV)+'</b>','',hv(t.parcH,t.parcV)]}]}}
  if(tipo==='nao'){const l=sort(X.N,x=>x.faltouV);return {title:'Atrasados não descontados = '+l.length+' pessoas · '+faBRL0(t.naoV)+sfx,base,formula:'Atraso que <b>não</b> foi para o banco de horas <b>nem</b> foi descontado na folha: atraso injustificado sem desconto ou atraso de quem não tem banco. Valor = atraso fora do banco × valor-hora. Quem compensou tudo no banco ('+t.soBanco+') está no card do banco de horas.',
    sections:[{cols:['Colaborador','Lotação','Atraso no mês','No banco','Não descontado h · R$','Banco de horas','Situação'],rows:l.map(x=>[who(x),loj(x),atr(x),x.noBanco?faH(x.bancoH):'—','<b style="color:#ff899a">'+hv(x.faltouH,x.faltouV)+'</b>',x.mr?(x.sdbh!=null?'saldo '+faSgnH(x.sdbh):'<b>não tem banco</b>'):'não está no espelho',faEsc(x.mr&&x.mr.naoAtivo?faSituTxt(x.mr):'Ativo')]),total:['Total ('+l.length+')','','',faH(X.sum(l,x=>x.bancoH)),'<b>'+hv(t.naoH,t.naoV)+'</b>','','']}]}}
  if(tipo==='banco'){const l=sort(X.B,x=>x.bancoV);return {title:'Atrasos lançados no banco de horas = '+l.length+' pessoas · '+faBRL0(t.bancoV)+sfx,base,formula:'Atrasados com débito no banco de horas no espelho do AbsisRH (DEBT do período), sem as folgas pagas pelo banco (COMP BCO). R$ pelo valor-hora da folha. Se a folha também descontou o atraso, conferir duplicidade ('+t.bancoDup+' pessoa(s), até '+faBRL(t.bancoDupV)+').',
    sections:[{cols:['Colaborador','Lotação','Atraso no mês','Débito no banco h · R$','Banco '+ini.slice(0,5),'Banco '+fim.slice(0,5),'Descontado na folha'],rows:l.map(x=>[who(x),loj(x),atr(x),'<b>'+hv(x.bancoH,x.bancoV)+'</b>',x.sant!=null?faSgnH(x.sant):'—',x.sdbh!=null?faSgnH(x.sdbh):'—',isD(x)?'<b style="color:#ffc35c">'+faBRL(x.descV)+' · conferir duplicidade</b>':'R$ 0']),total:['Total ('+l.length+')','',faH(X.sum(l,x=>x.atrH)),'<b>'+hv(t.bancoH,t.bancoV)+'</b>','','',t.bancoDup+' com desconto']}]}}
  if(tipo==='neg'){const l=sort(X.G,x=>x.santV);return {title:'Atrasados que já tinham banco negativo = '+l.length+' pessoas · '+faBRL0(t.santV)+sfx,base,formula:'Atrasados no período cujo saldo do banco de horas já era <b>negativo em '+ini+'</b> (saldo anterior do espelho AbsisRH). Valor = saldo negativo inicial × valor-hora. '+t.gPiorou+' ficaram mais negativos em '+fim+'; '+t.gSemDesc+' deles sem nenhum desconto na folha (falta, atraso ou DSR).',
    sections:[{cols:['Colaborador','Lotação','Banco '+ini.slice(0,5)+' h · R$','Atraso no mês','Banco '+fim.slice(0,5),'Descontado na folha (total)'],rows:l.map(x=>[who(x),loj(x),'<b style="color:#ff899a">−'+hv(x.santH,x.santV)+'</b>',atr(x),x.sdbh!=null?faSgnH(x.sdbh):'—',x.folhaV>0.01?faBRL(x.folhaV):X.hasF?(x.piorou?'<b style="color:#ff899a">R$ 0 · piorou</b>':'R$ 0'):'—']),total:['Total ('+l.length+')','','<b>−'+hv(t.santH,t.santV)+'</b>',faH(X.sum(l,x=>x.atrH)),'',t.gSemDesc+' pioraram sem desconto']}]}}
  if(tipo==='adv'){const l=sort(X.V,x=>x.folhaV);return {title:'Atrasados advertidos = '+l.length+' pessoas'+(l.length?' · '+faBRL0(t.advFolhaV):'')+sfx,base,formula:'A advertência é registrada no <b>sistema de RH</b> e o relatório ainda não está na base (matrícula ou CPF, data e motivo). FALT ADV no espelho é falta, não advertência.',
    sections:[{cols:['Colaborador','Lotação','Advertências','Atraso no mês','Faltas','Atraso descontado','Descontado na folha (total)'],rows:l.map(x=>[who(x),loj(x),x.advD.join(', '),atr(x),x.faltas||'—',isD(x)?faBRL(x.descV):'R$ 0','<b>'+faBRL(x.folhaV)+'</b>']),total:['Total ('+l.length+')','',t.advDias+' advertência(s)','',faInt(t.advFaltas),faBRL(t.advDescV),'<b>'+faBRL(t.advFolhaV)+'</b>']}]}}
  return null}
