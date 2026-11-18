/* ===== Resumo de atrasos (atraso inclui falta) =====
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
(function(){const st=document.createElement('style');st.textContent='.fa-ra-ks{grid-template-columns:repeat(4,minmax(0,1fr))}.fa-ra-m{font-size:15px;font-weight:800;color:#e5edf8;margin:2px 0 6px;font-variant-numeric:tabular-nums}.fa-ra-m small{font-size:11.5px;font-weight:600;color:#8ea4bd;margin-left:4px}.fa-xk.ok .fa-xk-v{color:#4fd69c}.fa-xk.net .fa-xk-v{color:#7cb6ff}.fa-ra-reg tbody tr{cursor:pointer}.fa-ra-reg tbody tr:hover td{background:#132033}.fa-ra-p{color:#8ea4bd;font-size:11px;margin-left:4px}.fa-ra-v{color:#a3b5ca}.fa-rk{padding:16px 18px 14px;display:flex;flex-direction:column}.fa-rk-t{display:flex;justify-content:space-between;font-size:12px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;color:#9fb3ca}.fa-rk-t span{color:#5f7690}.fa-rk-n{font-size:34px;font-weight:800;margin:8px 0 12px;font-variant-numeric:tabular-nums;letter-spacing:-.5px;line-height:1}.fa-rk-n small{font-size:13px;font-weight:600;color:#8ea4bd;margin-left:6px;letter-spacing:0}.fa-xk.warn .fa-rk-n{color:#ffc35c}.fa-xk.ok .fa-rk-n{color:#4fd69c}.fa-xk.bad .fa-rk-n,.fa-xk.neg .fa-rk-n{color:#ff7d8f}.fa-xk.net .fa-rk-n{color:#7cb6ff}.fa-rk-m{display:grid;grid-template-columns:1.25fr 1fr 1fr;border-top:1px solid #1e2a3b;border-bottom:1px solid #1e2a3b;padding:9px 0}.fa-rk-m div+div{border-left:1px solid #1e2a3b;padding-left:10px}.fa-rk-m span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:#6f8399;margin-bottom:3px}.fa-rk-m b{font-size:15px;color:#e5edf8;font-variant-numeric:tabular-nums;white-space:nowrap}.fa-rk-x{font-size:12px;color:#b8c8dc;margin-top:10px;min-height:18px}.fa-rk-x .r,.fa-rk-recon .r{color:#ff899a}.fa-rk-na{color:#ffc35c}.fa-rk-b{font-size:10.5px;color:#5f7690;margin-top:auto;padding-top:8px}.fa-rk-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin:2px 0 12px}.fa-rk-head b{display:block;font-size:16px;color:#e5edf8}.fa-rk-head span{font-size:12px;color:#8ea4bd}.fa-rk-warn{font-size:12px;color:#ffc35c;background:rgba(243,173,56,.08);border:1px solid #5a4520;border-radius:8px;padding:6px 10px}.fa-rk-recon{display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px 18px;font-size:11.5px;color:#8ea4bd;margin:-2px 0 14px;padding:0 2px}@media(max-width:1100px){.fa-ra-ks{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:700px){.fa-ra-ks{grid-template-columns:1fr}}';document.head.appendChild(st)})();
const FA_RA_ST={integral:'Descontado',parcial:'Descontado em parte',semoc:'Descontado sem ocorrência no espelho',banco:'Compensado no banco de horas',nao:'Não descontado',tol:'Só atraso de até 15 min (não descontável)',dem:'Desligado (desconto na rescisão)',semfolha:'Folha não carregada'};
function faResumoData(m,reg){
  const tol=FA_TOL_H,hasF=!!m.sources.payrollAvailable,M=m.mirror,mm=M?new Map(M.rows.map(x=>[x.code,x])):new Map();
  const md=typeof faMirrorDays!=='undefined'&&faMirrorDays?faMirrorDays:null,rb=new Map(m.rows.map(r=>[r.code,r]));
  const vOf=(d,k)=>{const x=String(d[3]||'').match(new RegExp('(?:^|,)'+k+'=(-?\\d+)'));return x?+x[1]/60:0};
  /* Dia a dia do espelho: atraso = débito no banco em dia trabalhado sem observação (só batidas);
     ATRA INJ = atraso injustificado (vai para FALT = desconto em folha); FALT nos outros dias = falta;
     débito em dia com observação (COMP BCO, COMP, CURSO, ATESTADO, ACFAM...) não é atraso. */
  const esp=code=>{const dd=md&&md.get(code);if(!dd)return null;const o={atr:0,dias:0,inj:0,diasInj:0,falta:0,diasFalta:0,just:0};
    dd.forEach(d=>{const ob=String(d[2]||'').trim(),deb=vOf(d,'DEBT'),fal=vOf(d,'FALT');
      if(deb>0){if(!ob){o.atr+=deb;o.dias++}else if(!(/COMP/.test(ob)&&/BCO/.test(ob)))o.just+=deb}
      if(fal>0){if(/ATRA/.test(ob)){o.inj+=fal;o.diasInj++}else{o.falta+=fal;o.diasFalta++}}});return o};
  const E=new Map();if(M)M.rows.forEach(x=>{const e=esp(x.code);if(e)E.set(x.code,e)});
  const semDia=M?M.rows.filter(x=>!E.has(x.code)).length:0;
  const espOf=x=>E.get(x.code)||{atr:Math.max(0,(x.debDia||0)-(x.compBco||0)),dias:x.atrDias??null,inj:0,diasInj:0,falta:x.FALT||0,diasFalta:x.FALT>tol?Math.max(1,Math.round(x.FALT/(FA_DAY_MIN/60))):0,just:0,aprox:true};
  const codes=new Set(M?M.rows.filter(x=>{const e=espOf(x);return e.atr+e.inj+e.falta>tol}).map(x=>x.code):[]);
  m.rows.forEach(r=>{if(r.events.length&&!mm.has(r.code))codes.add(r.code);if(hasF&&r.hasPay&&(r.descH>tol||r.descV>0.01))codes.add(r.code)});
  let L=[...codes].map(code=>{
    const r=rb.get(code)||null,mr=mm.get(code)||null,e=mr?espOf(mr):null,temBanco=!!(mr&&(mr.SDBH!=null||(mr.DEBT||0)>0||(mr.CRED||0)>0));
    let atrBancoH=0,injH=0,faltaH=0,diasAtr=0,diasFalta=0,fonte;
    if(e){atrBancoH=e.atr;injH=e.inj;faltaH=e.falta;diasAtr=e.dias==null?null:e.dias+e.diasInj;diasFalta=e.diasFalta;fonte=e.aprox?'espelho (totais)':'espelho'}
    else if(r&&r.events.length){injH=Math.max(0,(r.atrasoMin-(r.tolMin||0))/60);faltaH=r.faltaMin/60;diasAtr=r.atrasoCount;diasFalta=r.faltaDays;fonte='cartão de ponto (fora do espelho)'}
    else fonte='só na folha (sem ponto no período)';
    const atrH=atrBancoH+injH,ocorrH=atrH+faltaH,bancoH=temBanco?atrBancoH:0,devFolhaH=faltaH+injH+(temBanco?0:atrBancoH);
    const descFAH=r&&r.hasPay?r.falta.qty+r.atraso.qty:(mr?mr.folhaFA||0:0);
    const descFaltaV=r&&r.hasPay?r.falta.value:(mr?Math.max(0,(mr.folhaDescV||0)):0),descAtrV=r&&r.hasPay?r.atraso.value:0,descDsrV=r&&r.hasPay?r.dsr.value:0;
    const descV=r&&r.hasPay?(r.descV||0):(mr?mr.folhaDescV||0:0),descDsrH=r&&r.hasPay?r.dsr.qty:0;
    const rate=mr&&mr.rate!=null?mr.rate:r?r.rate:null,R=rate!=null?rate:0;
    const descAtrH=Math.min(Math.max(0,descFAH-faltaH),injH+(temBanco?0:atrBancoH));
    const dem=!!((r&&r.demitido)||(mr&&mr.desligSaida)),temDesc=descFAH>tol||descV>0.01;
    const st=!hasF?'semfolha':dem?'dem':temDesc?(ocorrH<=tol?'semoc':descFAH+tol>=devFolhaH?'integral':'parcial'):devFolhaH<=tol?'banco':'nao';
    const faltouH=st==='parcial'||st==='nao'?Math.max(0,devFolhaH-descFAH):0,santH=mr&&mr.SANT!=null&&mr.SANT<-0.01?-mr.SANT:0;
    const aumH=mr&&mr.SANT!=null&&mr.SDBH!=null?Math.max(0,mr.SANT-mr.SDBH):0,minH=Math.min(atrH,aumH)+faltaH;
    const store=mr?mr.store:r.store,regional=(mr?mr.regional:(r.regional||faRegionalOf(r.store)))||'—';
    return {r,mr,code,aumH,minH,minV:minH*R,name:mr?mr.name:r.name,store,regional,role:mr?mr.cargo:r.role,fonte,ocorr:ocorrH>tol,
      atrN:diasAtr,diasFalta,atrH,injH,faltaH,ocorrH,devH:ocorrH,devV:ocorrH*R,atrV:atrH*R,faltaV:faltaH*R,bancoH,bancoV:bancoH*R,noBanco:bancoH>tol,temBanco,
      devFolhaH,devFolhaV:devFolhaH*R,descFAH,descH:descFAH,descDsrH,descV,descFaltaV,descAtrV,descDsrV,descAtrH,descAtrV2:descAtrH*R,rate,faltouH,faltouV:faltouH*R,
      semValor:rate==null&&ocorrH>tol,neg:santH>0.01,santH,santV:santH*R,sant:mr?mr.SANT:null,sdbh:mr?mr.SDBH:null,
      piorou:!!(mr&&mr.SANT!=null&&mr.SDBH!=null&&mr.SDBH<mr.SANT-0.01),adv:false,advD:[],faltas:diasFalta,folhaV:descV,semDescFolha:descV<0.01,st}});
  if(reg)L=L.filter(x=>x.regional===reg);
  const sum=(l,f)=>l.reduce((s,x)=>s+(+f(x)||0),0),isD=x=>x.st==='integral'||x.st==='parcial'||x.st==='semoc'||(x.st==='dem'&&x.descV>0.01);
  const O=L.filter(x=>x.ocorr),Dall=L.filter(isD),D=O.filter(isD),S=O.filter(x=>x.st==='banco'),N=L.filter(x=>x.st==='nao'||x.st==='parcial'),B=O.filter(x=>x.noBanco),G=O.filter(x=>x.neg),V=[];
  const GP=G.filter(x=>x.piorou),GPS=GP.filter(x=>x.semDescFolha),DEM=Dall.filter(x=>x.st==='dem'),DA=Dall.filter(x=>x.st!=='dem');
  const quadroPonto=M?M.rows.length:null,justTot=M?[...E.values()].reduce((s,e)=>s+e.just,0):0;
  return {L:O,Lall:L,D,Dall,DEM,DA,S,N,B,G,GP,GPS,V,hasF,hasM:!!M,advNaBase:false,sum,quadroPonto,semDia,
    t:{n:O.length,ev:sum(O,x=>x.atrN)+sum(O,x=>x.diasFalta),evSem:O.filter(x=>x.atrN==null).length,atrH:sum(O,x=>x.atrH),devH:sum(O,x=>x.ocorrH),devV:sum(O,x=>x.devV),
      soAtr:O.filter(x=>x.atrH>tol&&x.faltaH<=tol).length,soFalta:O.filter(x=>x.faltaH>tol&&x.atrH<=tol).length,ambos:O.filter(x=>x.faltaH>tol&&x.atrH>tol).length,
      atrN:O.filter(x=>x.atrH>tol).length,atrDias:sum(O,x=>x.atrN),atrHh:sum(O,x=>x.atrH),atrV:sum(O,x=>x.atrV),
      faltaN:O.filter(x=>x.faltaH>tol).length,faltaDias:sum(O,x=>x.diasFalta),faltaHh:sum(O,x=>x.faltaH),faltaV:sum(O,x=>x.faltaV),
      injN:O.filter(x=>x.injH>tol).length,injH:sum(O,x=>x.injH),justH:justTot,fEsp:O.filter(x=>x.mr).length,fPt:O.filter(x=>!x.mr).length,
      descN:Dall.length,descV:sum(Dall,x=>x.descV),descH:sum(Dall,x=>x.descFAH),descDsrH:sum(Dall,x=>x.descDsrH),descFaltaV:sum(Dall,x=>x.descFaltaV),descAtrV:sum(Dall,x=>x.descAtrV),descDsrV:sum(Dall,x=>x.descDsrV),
      descAtrIncl:sum(DA,x=>x.descAtrV2),descAtrN:DA.filter(x=>x.descAtrH>tol).length,
      demN:DEM.length,demV:sum(DEM,x=>x.descV),ativDescN:DA.length,ativDescV:sum(DA,x=>x.descV),semocN:Dall.filter(x=>x.st==='semoc').length,semocV:sum(Dall.filter(x=>x.st==='semoc'),x=>x.descV),
      integral:D.filter(x=>x.st==='integral').length,parcial:D.filter(x=>x.st==='parcial').length,
      soBanco:S.length,soBancoH:sum(S,x=>x.bancoH),soBancoV:sum(S,x=>x.bancoV),
      naoN:N.length,naoH:sum(N,x=>x.faltouH),naoV:sum(N,x=>x.faltouV),naoSemBanco:N.filter(x=>!x.temBanco&&x.mr).length,naoFalta:N.filter(x=>x.faltaH>tol).length,
      demO:O.filter(x=>x.st==='dem').length,semValor:O.filter(x=>x.semValor).length,semEsp:M?O.filter(x=>!x.mr).length:0,
      bancoH:sum(B,x=>x.bancoH),bancoV:sum(B,x=>x.bancoV),bancoDup:B.filter(x=>isD(x)&&x.devFolhaH<=FA_TOL_H).length,
      santH:sum(G,x=>x.santH),santV:sum(G,x=>x.santV),gPiorou:GP.length,gSemDesc:GPS.length,gSemDescV:sum(GPS,x=>x.santV),gpsMinH:sum(GPS,x=>x.minH),gpsMinV:sum(GPS,x=>x.minV),gpsNegH:sum(GPS,x=>x.sdbh!=null?-x.sdbh:0),gpsNegV:sum(GPS,x=>x.sdbh!=null?-x.sdbh*(x.rate||0):0),gpsAumH:sum(GPS,x=>x.aumH),dON:D.length,parcH:sum(D.filter(x=>x.st==='parcial'),x=>x.faltouH),parcV:sum(D.filter(x=>x.st==='parcial'),x=>x.faltouV),dOV:sum(D,x=>x.descV),dOH:sum(D,x=>x.descFAH+x.descDsrH),nadaN:O.filter(x=>x.st==='nao').length,nadaV:sum(O.filter(x=>x.st==='nao'),x=>x.faltouV),nadaH:sum(O.filter(x=>x.st==='nao'),x=>x.faltouH)}};
}
function faResumoRender(){const el=fa$('faResumoBody');if(!el)return;const m=faModel;if(!m)return;
  const X=faResumoData(m),t=X.t,ini=faBR(m.period.start).slice(0,5),fim=faBR(m.period.end).slice(0,5),qp=X.quadroPonto||m.ativos||0;
  const pc=(a,b)=>b?faDec(a/b*100,1)+'%':'—',fol='Folha '+faEsc(m.payrollPeriod||'—');
  /* Card: título · quantidade · valor | horas | % · um destaque curto · base. Explicação completa no clique. */
  const card=(cls,title,n,v,hh,p,pl,note,base,key)=>'<div class="fa-xk fa-rk '+cls+'"'+(key?' onclick="faShow(\''+key+'\')" title="Clique para ver a lista e a regra"':'')+'>'
    +'<div class="fa-rk-t">'+title+(key?'<span>›</span>':'')+'</div>'
    +'<div class="fa-rk-n">'+n+'<small>'+(n==='—'?'':'pessoas')+'</small></div>'
    +'<div class="fa-rk-m"><div><span>Valor</span><b>'+v+'</b></div><div><span>Horas</span><b>'+hh+'</b></div><div><span>'+pl+'</span><b>'+p+'</b></div></div>'
    +(note?'<div class="fa-rk-x">'+note+'</div>':'')+'<div class="fa-rk-b">'+base+'</div></div>';
  if(!t.n&&!t.descN){el.innerHTML='<div class="fa-panel"><div class="fa-empty">Nenhum atraso ou falta de '+ini+' a '+fim+'.</div></div>';return}
  const avisos=[];if(!X.hasF)avisos.push('Folha não carregada');if(!X.hasM)avisos.push('Espelho de ponto não carregado');if(t.semValor)avisos.push(t.semValor+' sem valor-hora');if(t.semEsp)avisos.push(t.semEsp+' do cartão de ponto fora do espelho');if(X.semDia)avisos.push('dia a dia do espelho indisponível para '+X.semDia+' (recarregue o espelho)');
  const cc=X.hasF?faCCTotals(m.rows):null,bate=cc&&Math.abs(cc.descV-t.descV)<0.05,b0=faBRL0,red=s=>'<b class="r">'+s+'</b>';
  const nao=X.L.filter(x=>x.st==='nao').length,soma=X.D.length+t.soBanco+nao+t.demO;
  const naF='<span class="fa-rk-na">carregue a folha</span>',naM='<span class="fa-rk-na">carregue o espelho</span>';
  const head='<div class="fa-rk-head"><div><b>Atrasos e faltas</b><span>Espelho + ponto '+ini+' a '+fim+' · '+fol+' · '+faInt(qp)+' com ponto</span></div>'
    +(avisos.length?'<div class="fa-rk-warn">⚠ '+faEsc(avisos.join(' · '))+'</div>':'')+'</div>';
  const cards='<section class="fa-xks fa-ra-ks">'
   +card('warn','Chegaram atrasados ou faltaram',faInt(t.n),b0(t.devV),faH(t.devH),pc(t.n,qp),'% do quadro','','Espelho '+ini+'–'+fim,'ra:all')
   +(X.hasF?card('ok','Descontados na folha',faInt(t.dON),b0(t.dOV),faH(t.dOH),pc(t.dON,t.n),'% atrasados',(t.demN?'+ '+t.demN+' desligados na rescisão '+b0(t.demV)+' (fora dos atrasados)':''),fol,'ra:desc'):card('ok','Descontados na folha','—','—','—','—','',naF,'',''))
   +(X.hasF?card(t.nadaN?'bad':'ok','Não descontamos nada',faInt(t.nadaN),b0(t.nadaV),faH(t.nadaH),pc(t.nadaN,t.n),'% atrasados',(t.parcial?red(t.parcial+' descontado só em parte · faltou '+b0(t.parcV)):'nem folha nem banco de horas'),fol+' × espelho','ra:nao'):card('bad','Não descontamos nada','—','—','—','—','',naF,'',''))
   +(X.hasM?card('net','Lançados no banco de horas',faInt(X.B.length),b0(t.bancoV),faH(t.bancoH),pc(X.B.length,t.n),'% atrasados','','Espelho até '+fim,'ra:banco'):card('net','Lançados no banco de horas','—','—','—','—','',naM,'',''))
   +(X.hasM?card(t.gSemDesc?'neg':'ok','Já tinham banco negativo',faInt(X.G.length),b0(t.santV),faH(t.santH),pc(X.G.length,t.n),'% atrasados','','Saldo em '+ini,'ra:neg'):card('neg','Já tinham banco negativo','—','—','—','—','',naM,'',''))
   +(X.hasM&&X.hasF?card(t.gSemDesc?'bad':'ok','Ficaram mais negativos sem desconto',faInt(t.gSemDesc),b0(t.gpsMinV),faH(t.gpsMinH),pc(t.gSemDesc,X.G.length),'% dos negativos','','Mínimo a descontar · banco '+ini+' → '+fim,'ra:pior'):card('bad','Ficaram mais negativos sem desconto','—','—','—','—','',naM,'',''))
   +card('warn','Advertidos','—','—','—','—','% atrasados','<span class="fa-rk-na">aguardando relatório do sistema de RH</span>','Sistema de RH','')
   +'</section>';
  const recon=X.hasF?'<div class="fa-rk-recon"><span>'+faInt(t.n)+' = '+X.D.length+' descontados + '+t.soBanco+' no banco + '+nao+' sem desconto'+(t.demO?' + '+t.demO+' desligados':'')+' '+(t.n===soma?'✓':'✗')+'</span><span>'+faBRL(t.descV)+' = falta '+faBRL(t.descFaltaV+t.descAtrV)+' + DSR '+faBRL(t.descDsrV)+(cc?' · conta corrente '+(bate?'✓':'✗'):'')+'</span></div>':'';
  const regs=new Map();X.L.forEach(x=>{const k=x.regional;let o=regs.get(k);if(!o){o={k,n:0,f:0,d:0,dV:0,nn:0,nV:0,b:0,bV:0,g:0,gs:0,gsV:0};regs.set(k,o)}o.n++;if(x.faltaH>FA_TOL_H)o.f++;if(x.st==='integral'||x.st==='parcial'){o.d++;o.dV+=x.descV}if(x.st==='nao'||x.st==='parcial'){o.nn++;o.nV+=x.faltouV}if(x.noBanco){o.b++;o.bV+=x.bancoV}if(x.neg){o.g++;if(x.piorou&&x.semDescFolha){o.gs++;o.gsV+=x.minV}}});
  const hc=new Map((m.byRegional||[]).map(r=>[r.regional,r.headcount]));
  const RL=[...regs.values()].sort((a,b)=>b.gs-a.gs||b.nV-a.nV||b.n-a.n);
  const c=(n,base,v)=>'<td class="fa-num">'+faInt(n)+(base?'<span class="fa-ra-p">'+pc(n,base)+'</span>':'')+(v!=null?'<span class="fa-subline">'+b0(v)+'</span>':'')+'</td>';
  const tot=RL.reduce((a,o)=>{for(const k in a)a[k]+=o[k];return a},{n:0,f:0,d:0,dV:0,nn:0,nV:0,b:0,bV:0,g:0,gs:0,gsV:0});
  const n_=v=>'<td class="fa-num">'+faInt(v)+'</td>',v_=v=>'<td class="fa-num fa-ra-v">'+b0(v)+'</td>',dash='<td class="fa-num">—</td>';
  const line=(o,lab,click)=>'<tr'+(click?' onclick="faShow(\'ra:all|'+encodeURIComponent(o.k).replace(/'/g,'%27')+'\')"':' class="fa-total"')+'><td class="fa-person">'+lab+'</td>'+n_(o.n)+n_(o.f)+(X.hasM?n_(o.b):dash)+(X.hasF?n_(o.d)+v_(o.dV)+n_(o.nn)+v_(o.nV):dash+dash+dash+dash)+(X.hasM?n_(o.g)+'<td class="fa-num">'+(o.gs?'<b style="color:#ff899a">'+faInt(o.gs)+'</b>':'0')+'</td>'+v_(o.gsV):dash+dash+dash)+'</tr>';
  const tab='<div class="fa-panel"><div class="fa-panel-head"><div><div class="fa-panel-title">Por regional</div><div class="fa-panel-sub">Clique na regional para ver as pessoas</div></div></div><div class="fa-table-wrap"><table class="fa-ra-reg"><thead><tr><th>Regional</th><th>Atrasos e faltas</th><th>Faltas</th><th>No banco</th><th>Descontados</th><th>R$ descontado</th><th>Faltou descontar</th><th>R$ faltou descontar</th><th>Já negativos</th><th>Pioraram sem desconto</th><th>R$ mínimo a descontar</th></tr></thead><tbody>'+RL.map(o=>line(o,faEsc(o.k),true)).join('')+line(tot,'Total',false)+'</tbody></table></div></div>';
  el.innerHTML=head+cards+recon+tab}
function faResumoComp(k,m){
  const [tipo,regE]=String(k).slice(3).split('|'),reg=regE?decodeURIComponent(regE):null,X=faResumoData(m,reg),t=X.t,ini=faBR(m.period.start),fim=faBR(m.period.end);
  const who=x=>'<b>'+faEsc(x.name)+'</b><span class="fa-subline">'+faEsc(x.code||'—')+' · '+faEsc(x.role||'')+'</span>',loj=x=>faEsc(x.store)+'<span class="fa-subline">'+faEsc(x.regional||'—')+'</span>';
  const hv=(hh,v)=>faH(hh)+' · '+faBRL(v),oc=x=>(x.atrH>FA_TOL_H?'atraso '+(x.atrN!=null?x.atrN+'d · ':'')+faH(x.atrH):'')+(x.atrH>FA_TOL_H&&x.faltaH>FA_TOL_H?'<br>':'')+(x.faltaH>FA_TOL_H?'falta '+x.diasFalta+'d · '+faH(x.faltaH):'')+(x.ocorrH<=FA_TOL_H?'—':'')+'<span class="fa-subline">'+faEsc(x.fonte)+'</span>';
  const sort=(l,f)=>l.slice().sort((a,b)=>f(b)-f(a)),sfx=reg?' · '+reg:'';
  const base=(X.hasM?'Espelho AbsisRH ('+(m.mirror.file||'')+') + ':'')+'cartão de ponto '+ini+' a '+fim+(X.hasF?' · folha '+(m.payrollPeriod||'')+' ('+(m.sources.payroll||'')+')':'');
  const stx=x=>{const c=x.st==='integral'||x.st==='banco'||x.st==='semoc'?'ok':x.st==='parcial'?'warn':x.st==='nao'?'bad':'ok';return '<span class="fa-badge '+c+'">'+FA_RA_ST[x.st]+'</span>'};
  const desc=x=>x.descV>0.01?faH(x.descFAH)+(x.descDsrH>FA_TOL_H?' + DSR '+faH(x.descDsrH):'')+'<span class="fa-subline">'+faBRL(x.descV)+'</span>':'—';
  if(tipo==='all'){const l=sort(X.L,x=>x.devV||x.devH);return {title:'Atrasaram ou faltaram = '+t.n+' pessoas'+sfx,base,formula:'<b>Atraso</b> = débito no banco (DEBT) em dia trabalhado sem observação no espelho + atraso injustificado (ATRA INJ). <b>Falta</b> = FALT no espelho (inclui FALT ADV). Débito em dia com observação (COMP BCO, COMP, CURSO, ATESTADO, ACFAM) não conta. O AbsisRH já aplica a tolerância de 15 min. Em R$ pelo valor-hora (salário contratual ÷ carga horária). '+t.n+' pessoas = '+faPct(t.n,X.quadroPonto||m.ativos,1)+' de quem tem ponto no espelho.',
    sections:[{cols:['Colaborador','Lotação','Atraso e falta','Total h · R$','No banco h · R$','Descontado na folha','Situação'],rows:l.map(x=>[who(x),loj(x),oc(x),hv(x.devH,x.devV),x.noBanco?hv(x.bancoH,x.bancoV):'—',desc(x),stx(x)]),total:['Total ('+l.length+')','','atraso '+faH(t.atrHh)+' · falta '+faH(t.faltaHh),hv(t.devH,t.devV),hv(t.bancoH,t.bancoV),faBRL(X.sum(l,x=>x.descV)),'']}]}}
  if(tipo==='desc'){const l=sort(X.D,x=>x.descV),l2=sort(X.Dall.filter(x=>!x.ocorr||x.st==='dem'),x=>x.descV),s=(a,f)=>X.sum(a,f);const sec=(ti,a)=>({title:ti,cols:['Colaborador','Lotação','Atraso e falta no ponto','Falta/atraso h','DSR h','Descontado R$','Situação'],rows:a.map(x=>[who(x),loj(x),oc(x),faH(x.descFAH),x.descDsrH>FA_TOL_H?faH(x.descDsrH):'—','<b>'+faBRL(x.descV)+'</b><span class="fa-subline">falta '+faBRL(x.descFaltaV)+' · DSR '+faBRL(x.descDsrV)+'</span>',stx(x)]),total:['Total ('+a.length+')','','',faH(s(a,x=>x.descFAH)),faH(s(a,x=>x.descDsrH)),'<b>'+faBRL(s(a,x=>x.descV))+'</b>','']});return {title:'Descontados na folha = '+l.length+' pessoas · '+faBRL0(t.dOV)+sfx,base,formula:'Dos que chegaram atrasados ou faltaram, quem teve desconto na folha '+(m.payrollPeriod||'')+': rubricas de falta (1356), atraso (1354) e DSR (1357). A folha não tem rubrica própria de atraso: o atraso injustificado é descontado junto da falta. Abaixo, à parte, os desligados descontados na rescisão, que não estão no espelho do período. Os dois somados = '+faBRL(t.descV)+', igual ao "Descontado na folha" da Conta corrente.',sections:[sec('Atrasados descontados (este card)',l)].concat(l2.length?[sec('Fora dos atrasados · desligados e descontos sem ocorrência no espelho',l2)]:[])}}
  if(tipo==='nao'){const l=sort(X.N,x=>x.faltouV);return {title:'Atraso ou falta não descontados = '+l.length+' pessoas · '+faBRL0(t.naoV)+sfx,base,formula:'O que devia ir para a folha e não foi descontado: <b>falta</b> (não vai para o banco), atraso injustificado e atraso de quem não tem banco de horas. Valor = horas não descontadas × valor-hora. Quem compensou atraso no banco ('+t.soBanco+') não entra aqui.',
    sections:[{cols:['Colaborador','Lotação','Atraso e falta','Devia descontar','Descontado','Faltou descontar h · R$','Situação'],rows:l.map(x=>[who(x),loj(x),oc(x),faH(x.devFolhaH),desc(x),'<b style="color:#ff899a">'+hv(x.faltouH,x.faltouV)+'</b>',stx(x)]),total:['Total ('+l.length+')','','',faH(X.sum(l,x=>x.devFolhaH)),'','<b>'+hv(t.naoH,t.naoV)+'</b>','']}]}}
  if(tipo==='banco'){const l=sort(X.B,x=>x.bancoV);return {title:'Atrasos lançados no banco de horas = '+l.length+' pessoas · '+faBRL0(t.bancoV)+sfx,base,formula:'Débito no banco de horas (DEBT) em dia trabalhado sem observação no espelho do AbsisRH, sem as folgas pagas pelo banco (COMP BCO). Atraso compensado no banco não é descontado na folha. Falta não vai para o banco.',
    sections:[{cols:['Colaborador','Lotação','Atraso e falta','Débito no banco h · R$','Banco '+ini.slice(0,5),'Banco '+fim.slice(0,5),'Descontado na folha'],rows:l.map(x=>[who(x),loj(x),oc(x),'<b>'+hv(x.bancoH,x.bancoV)+'</b>',x.sant!=null?faSgnH(x.sant):'—',x.sdbh!=null?faSgnH(x.sdbh):'—',desc(x)]),total:['Total ('+l.length+')','','','<b>'+hv(t.bancoH,t.bancoV)+'</b>','','','']}]}}
  if(tipo==='pior'){const l=sort(X.GPS,x=>x.minV);return {title:'Ficaram mais negativos sem desconto = '+l.length+' pessoas · '+faBRL0(t.gpsMinV)+sfx,base,formula:'Já tinham banco negativo em '+ini+', atrasaram ou faltaram no mês, o negativo <b>aumentou</b> até '+fim+' e a folha não descontou nada (falta, atraso ou DSR). <b>Mínimo a descontar</b> = menor valor entre as horas de atraso do mês e o quanto o negativo aumentou, mais as faltas, × valor-hora.',
    sections:[{cols:['Colaborador','Lotação','Banco '+ini.slice(0,5),'Atraso e falta','Banco '+fim.slice(0,5),'Aumentou','Mínimo a descontar h · R$'],rows:l.map(x=>[who(x),loj(x),faSgnH(x.sant),oc(x),faSgnH(x.sdbh),'−'+faH(x.aumH),'<b style="color:#ff899a">'+hv(x.minH,x.minV)+'</b>']),total:['Total ('+l.length+')','','','',faSgnH(-t.gpsNegH),'−'+faH(t.gpsAumH),'<b>'+hv(t.gpsMinH,t.gpsMinV)+'</b>']}]}}
  if(tipo==='neg'){const l=sort(X.G,x=>x.santV);return {title:'Já tinham banco negativo = '+l.length+' pessoas · '+faBRL0(t.santV)+sfx,base,formula:'Quem atrasou ou faltou no período e já tinha saldo do banco <b>negativo em '+ini+'</b> (saldo anterior do espelho AbsisRH). Valor = saldo negativo inicial × valor-hora. '+t.gPiorou+' ficaram mais negativos em '+fim+'; '+t.gSemDesc+' deles sem nenhum desconto na folha (falta, atraso ou DSR).',
    sections:[{cols:['Colaborador','Lotação','Banco '+ini.slice(0,5)+' h · R$','Atraso e falta','Banco '+fim.slice(0,5),'Descontado na folha'],rows:l.map(x=>[who(x),loj(x),'<b style="color:#ff899a">−'+hv(x.santH,x.santV)+'</b>',oc(x),x.sdbh!=null?faSgnH(x.sdbh):'—',x.descV>0.01?faBRL(x.descV):X.hasF?(x.piorou?'<b style="color:#ff899a">R$ 0 · piorou</b>':'R$ 0'):'—']),total:['Total ('+l.length+')','','<b>−'+hv(t.santH,t.santV)+'</b>','','',t.gSemDesc+' pioraram sem desconto']}]}}
  return null}
/* ===== Ponto e absenteísmo pelo espelho do AbsisRH =====
   Quando o espelho (dia a dia) está carregado, faltas, atrasos e absenteísmo saem dele, e não do relatório
   "Faltas e Atrasos" (que só traz o que é descontado em folha). A conta corrente da folha continua no cartão.
   Falta = FALT no dia (exceto atraso injustificado) · Atraso = débito no banco em dia sem observação + ATRA INJ.
   Horas previstas = HRPV dos dias de trabalho (sem observação ou com falta/atraso), por pessoa. */
function faEspPonto(m){
  const M=m&&m.mirror;if(!M||typeof faMirrorDays==='undefined'||!faMirrorDays||!m.period||!m.period.start)return null;
  const y0=+m.period.start.slice(0,4),m0=+m.period.start.slice(5,7);
  const iso=dm=>{const [d,mo]=String(dm).split('/').map(Number);return (mo<m0?y0+1:y0)+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0')};
  const vOf=(d,k)=>{const x=String(d[3]||'').match(new RegExp('(?:^|,)'+k+'=(-?\\d+)'));return x?+x[1]:0};
  const ros=new Map(((faInputs.roster&&faInputs.roster.people)||[]).map(x=>[faCode(x.code),x]));
  const rows=[];
  M.rows.forEach(x=>{const dd=faMirrorDays.get(x.code);if(!dd)return;const ro=ros.get(x.code),store=(ro&&ro.store)||x.store||x.lot;
    const ev=[];let prev=0,cred=0,ates=0;
    dd.forEach(d=>{const ob=String(d[2]||'').trim(),deb=vOf(d,'DEBT'),fal=vOf(d,'FALT'),pv=vOf(d,'HRPV'),date=iso(String(d[0]).slice(0,5)),dt=faFromISO(date);
      if(!ob||/FALT|ATRA/.test(ob))prev+=pv;cred+=vOf(d,'CRED');ates+=vOf(d,'ATES')+vOf(d,'ATEH');
      const add=(min,kind)=>ev.push({date,wd:dt.getDay(),holiday:faHoliday(dt),minutes:min,time:faClock(min),kind});
      if(fal>0)add(fal,/ATRA/.test(ob)?'atraso':'falta');
      if(deb>0&&!ob)add(deb,'atraso')});
    const fa=ev.filter(e=>e.kind==='falta'),at=ev.filter(e=>e.kind==='atraso'),sm=l=>l.reduce((s,e)=>s+e.minutes,0);
    rows.push({key:x.code,code:x.code,name:x.name,store,role:x.cargo||'—',regional:faRegionalOf(store),events:ev,prevMin:prev,credMin:cred,atesMin:ates,
      faltaDays:new Set(fa.map(e=>e.date)).size,faltaMin:sm(fa),atrasoCount:new Set(at.map(e=>e.date)).size,atrasoMin:sm(at),minutes:sm(ev)})});
  if(!rows.length)return null;
  const pr=rows.filter(r=>r.events.length),evs=pr.flatMap(r=>r.events);
  const T={events:evs.length,people:pr.length,faltaEvents:pr.reduce((s,r)=>s+r.faltaDays,0),faltaPeople:pr.filter(r=>r.faltaDays).length,
    atrasoEvents:pr.reduce((s,r)=>s+r.atrasoCount,0),atrasoPeople:pr.filter(r=>r.atrasoCount).length,minutes:evs.reduce((s,e)=>s+e.minutes,0),
    faltaMin:pr.reduce((s,r)=>s+r.faltaMin,0),expectedMin:rows.reduce((s,r)=>s+r.prevMin,0),credMin:rows.reduce((s,r)=>s+r.credMin,0),atesMin:rows.reduce((s,r)=>s+r.atesMin,0)};
  T.rate=T.expectedMin?T.minutes/T.expectedMin*100:null;
  const grp=(key,init)=>{const g=new Map();rows.forEach(r=>{const k=key(r);let o=g.get(k);if(!o){o=init(r);g.set(k,o)}o.headcount++;o.prev+=r.prevMin;o.lojas&&o.lojas.add(faNorm(r.store));
    if(r.events.length){o.people++;o.faltas+=r.faltaDays;o.atrasos+=r.atrasoCount;o.minutes+=r.minutes}});return [...g.values()]};
  const byStore=grp(r=>faNorm(r.store),r=>({store:r.store,headcount:0,prev:0,people:0,faltas:0,atrasos:0,minutes:0})).filter(s=>s.people)
    .map(s=>({store:s.store,people:s.people,faltas:s.faltas,atrasos:s.atrasos,minutes:s.minutes,headcount:s.headcount,pctPeople:s.people/s.headcount*100,rate:s.prev?s.minutes/s.prev*100:null})).sort((a,b)=>b.minutes-a.minutes);
  const byRegional=grp(r=>r.regional||'Sem regional',r=>({regional:r.regional||'Sem regional',headcount:0,prev:0,lojas:new Set(),people:0,faltas:0,atrasos:0,minutes:0}))
    .map(x=>({regional:x.regional,headcount:x.headcount,lojas:x.lojas.size,people:x.people,faltas:x.faltas,atrasos:x.atrasos,minutes:x.minutes,pctPeople:x.headcount?x.people/x.headcount*100:null,rate:x.prev?x.minutes/x.prev*100:null}))
    .sort((a,b)=>(b.rate??-1)-(a.rate??-1)||b.minutes-a.minutes);
  const rl=new Map();pr.forEach(r=>{const k=r.role||'—';let s=rl.get(k);if(!s){s={role:k,people:0,events:0,minutes:0};rl.set(k,s)}s.people++;s.events+=r.events.length;s.minutes+=r.minutes});
  const byWeekday=[0,1,2,3,4,5,6].map(d=>({wd:d,faltas:evs.filter(e=>e.wd===d&&e.kind==='falta').length,atrasos:evs.filter(e=>e.wd===d&&e.kind==='atraso').length}));
  return {rows,pr,T,byStore,byRegional,byRole:[...rl.values()].sort((a,b)=>b.minutes-a.minutes),byWeekday,quadro:rows.length,file:M.file};
}
function faEspAplicar(m){const P=faEspPonto(m);if(!P)return m;
  m.cartao={totals:{...m.totals},byStore:m.byStore,byRegional:m.byRegional,byRole:m.byRole,byWeekday:m.byWeekday};
  Object.assign(m.totals,P.T);m.byStore=P.byStore;m.byRegional=P.byRegional;m.byRole=P.byRole;m.byWeekday=P.byWeekday;
  m.pontoRows=P.pr;m.quadroPonto=P.quadro;m.pontoFonte='Espelho AbsisRH ('+P.file+')';return m}
if(typeof faCompute==='function'&&!faCompute._esp){const _fc=faCompute;faCompute=function(inp){const m=_fc(inp);try{faEspAplicar(m)}catch(e){console.warn('[Faltas] ponto pelo espelho:',e)}return m};faCompute._esp=1}
function faEspComp(k,m){
  const T=m.totals,pr=m.pontoRows,per='Espelho '+faPeriodLabel(m)+' · '+m.pontoFonte,q=m.quadroPonto;
  const who=r=>'<b>'+faEsc(r.name)+'</b><span class="fa-subline">'+faEsc(r.code||'—')+' · '+faEsc(r.store)+'</span>';
  const evTable=kind=>{const l=pr.flatMap(r=>r.events.filter(e=>e.kind===kind).map(e=>({r,e}))).sort((a,b)=>a.e.date<b.e.date?-1:1);
    return {cols:['Colaborador','Data','Dia','Horas'],rows:l.map(({r,e})=>[who(r),faBR(e.date),FA_WD[e.wd]+(e.holiday?' · feriado':''),faClock(e.minutes)]),total:['Total: '+l.length+' lançamento(s) · '+new Set(l.map(x=>x.r.key)).size+' pessoa(s)','','',faClock(l.reduce((s,x)=>s+x.e.minutes,0))]}};
  const nota=' Fonte: dia a dia do espelho do AbsisRH, de todos que batem ponto ('+faInt(q)+' pessoas). O relatório "Faltas e Atrasos" só traz o que é descontado em folha e continua sendo usado na Conta corrente.';
  switch(k){
  case 'people':return {title:'Colaboradores com ocorrência = '+T.people,base:per,formula:'Pessoas com pelo menos uma falta ou atraso no espelho. '+T.people+' ÷ '+faInt(q)+' com ponto = <b>'+faPct(T.people,q,1)+'</b>.'+nota,sections:[{cols:['Colaborador','Faltas (dias)','Atrasos (dias)','Horas'],rows:pr.slice().sort((a,b)=>b.minutes-a.minutes).map(r=>[who(r),r.faltaDays||'—',r.atrasoCount||'—',faClock(r.minutes)]),total:['Total: '+pr.length,faInt(T.faltaEvents),faInt(T.atrasoEvents),faClock(T.minutes)]}]};
  case 'abs':return {title:'Faltas = '+T.faltaEvents+' dias',base:per,formula:'Cada dia com FALT no espelho (inclui FALT ADV; o atraso injustificado ATRA INJ conta como atraso). '+T.faltaPeople+' pessoa(s) · '+faPct(T.faltaPeople,q,2)+' de quem tem ponto.'+nota,sections:[evTable('falta')]};
  case 'late':return {title:'Atrasos e saídas antecipadas = '+T.atrasoEvents+' dias',base:per,formula:'Cada dia com débito no banco (DEBT) sem observação ou com atraso injustificado (ATRA INJ). Débito em dia de curso, atestado, acompanhamento e folga compensada (COMP BCO) não conta. '+T.atrasoPeople+' pessoa(s) · '+faPct(T.atrasoPeople,q,2)+' de quem tem ponto.'+nota,sections:[evTable('atraso')]};
  case 'rate':{const pp=x=>faDec(x/T.expectedMin*100,2)+'%';return {title:'Taxa de absenteísmo = '+(T.rate!=null?faDec(T.rate,2)+'%':'—'),base:per,formula:'Horas perdidas (faltas + atrasos e saídas antes) ÷ horas previstas no espelho (HRPV dos dias de trabalho)<br><b>'+faClock(T.minutes)+'</b> ÷ <b>'+faInt(Math.round(T.expectedMin/60))+'h</b> = <b>'+(T.rate!=null?faDec(T.rate,2)+'%':'—')+'</b> = faltas <b>'+pp(T.faltaMin)+'</b> + atrasos <b>'+pp(T.minutes-T.faltaMin)+'</b>.<br>Atestados não entram (com atestados: '+faDec((T.minutes+(T.atesMin||0))/(T.expectedMin+(T.atesMin||0))*100,2)+'%). Os atrasos são quase todos compensados no banco de horas, que recebeu '+faInt(Math.round((T.credMin||0)/60))+'h de crédito no mês. Antes, a tela via só o relatório Faltas e Atrasos (o que é descontado em folha), por isso mostrava '+(m.cartao?faDec(m.cartao.totals.rate||0,2)+'%':'menos')+'.'+nota,
    sections:[{title:'Por loja',cols:['Loja','Com ponto','Horas perdidas','Absenteísmo'],rows:m.byStore.map(s=>[faEsc(s.store),s.headcount,faClock(s.minutes),s.rate!=null?faDec(s.rate,2)+'%':'—']),total:['Lojas com ocorrência: '+m.byStore.length,'',faClock(m.byStore.reduce((s,x)=>s+x.minutes,0)),'']}]}}
  case 'hours':return {title:'Horas perdidas = '+faClock(T.minutes),base:per,formula:'Faltas '+faClock(T.faltaMin)+' + atrasos e saídas antes '+faClock(T.minutes-T.faltaMin)+'. Os atrasos de quem tem banco de horas são compensados no banco (crédito de '+faInt(Math.round((T.credMin||0)/60))+'h no mês) e não são descontados; faltas e atraso injustificado vão para a folha. Antes a tela mostrava '+(m.cartao?faClock(m.cartao.totals.minutes):'menos')+' porque só via o que é descontado em folha.'+nota,sections:[{cols:['Colaborador','Faltas','Atrasos','Total'],rows:pr.slice().sort((a,b)=>b.minutes-a.minutes).map(r=>[who(r),faClock(r.faltaMin),faClock(r.atrasoMin),'<b>'+faClock(r.minutes)+'</b>']),total:['Total: '+pr.length,faClock(T.faltaMin),faClock(T.minutes-T.faltaMin),'<b>'+faClock(T.minutes)+'</b>']}]};
  }return null}
