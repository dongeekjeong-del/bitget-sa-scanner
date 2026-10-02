const PAPER_KEY='bitget-paper-journal-v1';
let paper,storageOK=true,quoteBusy=false,paperOwner=false,manualClosing=false;
try{paper=new PaperEngine(JSON.parse(localStorage.getItem(PAPER_KEY)||'{"trades":[],"seen":[]}'));if(!Array.isArray(paper.state.trades)||!Array.isArray(paper.state.seen))throw Error('Invalid journal');}
catch(e){storageOK=false;paper=new PaperEngine();document.getElementById('paperStatus').textContent='저장된 일지 읽기 실패. 자동 진입 중단.';}
function paperSave(){try{localStorage.setItem(PAPER_KEY,JSON.stringify(paper.state));}catch(e){storageOK=false;document.getElementById('paperEnabled').checked=false;document.getElementById('paperStatus').textContent='일지 저장 실패. 자동 진입 중단. JSON을 내보내세요.';}paperRender();}
function paperRender(engine=paper,target="journal",demo=false){
  const el=document.getElementById(target);el.replaceChildren();
  if(!engine.state.trades.length)el.textContent="현재 모의 포지션이 없습니다. 위의 데모 포지션 보기로 화면을 확인하세요.";
  for(const t of [...engine.state.trades].reverse()){
    const card=document.createElement('div');card.className='card';
    const title=document.createElement('b');title.textContent=`${demo?"DEMO · ":""}${t.sym} ${t.dir} · ${t.exit?'CLOSED':'OPEN'} · ${t.grade} / ${t.status}`;card.append(title);
    const body=document.createElement('div');body.style.whiteSpace='pre-wrap';
    body.textContent=`진입: ${new Date(t.opened).toLocaleString()} @ ${t.entry}\n근거: ${t.reason}\n손절 ${t.stop} / TP1 ${t.target} / 수량 ${t.qty}\n`+(t.exit?`청산: ${new Date(t.exit.time).toLocaleString()} @ ${t.exit.price} (${t.exit.reason})\n총손익 $${t.exit.gross.toFixed(2)} · 추정 수수료 $${t.exit.fees.toFixed(2)} · 순손익 $${t.exit.net.toFixed(2)} (펀딩 제외)`:'보유 중')+(t.observationGap?'\n가격 관측 공백 있음 — 청산 시점 및 성과 해석에 주의':'');
    card.append(body);
    const pnl=document.createElement('div');pnl.style.whiteSpace='pre-wrap';
    if(!t.exit){
      const p=engine.position(t),fresh=Date.now()-t.lastObserved<=15000;
      pnl.textContent=`증거금 $${t.margin.toFixed(2)} · 레버리지 ${t.config.lev}x\n현재가 ${p?p.price:'—'} · 가격 확인 ${new Date(t.lastObserved).toLocaleTimeString()}${fresh?'':' (갱신 지연)'}\n미실현 손익 ${p?'$'+p.gross.toFixed(2):'—'} · ROI ${p?p.roi.toFixed(2)+'%':'—'} (수수료 전)\n지금 청산 시 추정 순손익 ${p?'$'+p.estimatedNet.toFixed(2):'—'} · 순 ROI ${p?p.estimatedNetRoi.toFixed(2)+'%':'—'} (펀딩 제외)\nTP ${t.target} / SL ${t.stop}`;
      const button=document.createElement('button');button.textContent=p?(p.estimatedNet>=0?'모의 익절 · 전량 종료':'모의 손절 · 전량 종료'):'모의 포지션 전량 종료';button.disabled=demo?false:(!paperOwner||!storageOK||manualClosing);
      button.onclick=()=>{if(demo){engine.close(t.id,t.lastPrice,'MANUAL');paperRender(engine,target,true);document.getElementById('demoPrice').disabled=true;}else paperManualClose(t.id);};card.append(pnl,button);
    }else{pnl.textContent=`실현 순 ROI ${((t.exit.net/t.margin)*100).toFixed(2)}% · 증거금 기준`;card.append(pnl);}
    el.append(card);
  }
}
function paperSignals(results){
  if(!paperOwner||!storageOK||document.hidden||!document.getElementById('paperEnabled').checked)return;
  const cfg={account:+document.getElementById('account').value,risk:+document.getElementById('risk').value,lev:+document.getElementById('lev').value,margin:+document.getElementById('margin').value};
  // Each quote was retrieved during analysis; do not use a result aged by a slow full scan.
  for(const x of results){if(Date.now()-x.observedAt>15000)continue;paper.enter(x,cfg);}
  paperSave();
}
async function paperQuotes(){
  if(!paperOwner||quoteBusy||!storageOK||!paper.state.trades.some(t=>!t.exit))return;
  quoteBusy=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
    const r=await fetch('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES',{cache:'no-store',signal:controller.signal});
    if(!r.ok)throw Error('HTTP '+r.status);const j=await r.json();if(j.code!=='00000'||!Array.isArray(j.data))throw Error('Invalid tickers');
    const now=Date.now(),openSymbols=new Set(paper.state.trades.filter(t=>!t.exit).map(t=>t.sym)),fresh=new Set();
    for(const q of j.data){const ts=+q.ts;if(!Number.isFinite(ts)||now-ts>15000||ts>now+5000)continue;if(!Number.isFinite(+q.lastPr)||+q.lastPr<=0)continue;fresh.add(q.symbol);paper.mark(q.symbol,+q.lastPr,now);}
    paperSave();if([...openSymbols].some(sym=>!fresh.has(sym)))throw Error('Missing fresh quotes');document.getElementById('paperStatus').textContent='모의 가격 확인: '+new Date().toLocaleTimeString();return true;
  }catch(e){document.getElementById('paperStatus').textContent='가격 확인 실패 — 새 진입 중단';document.getElementById('paperEnabled').checked=false;paperRender();return false;}
  finally{clearTimeout(timer);quoteBusy=false;}
}
async function paperManualClose(id){
  if(!paperOwner||!storageOK||manualClosing)return;
  manualClosing=true;paperRender();
  try{
    const fresh=await paperQuotes(),t=paper.state.trades.find(t=>t.id===id);
    if(!t||t.exit)return;
    if(!fresh||Date.now()-t.lastObserved>15000||!storageOK){document.getElementById('paperStatus').textContent='최신 가격을 확인할 수 없어 모의 종료하지 않았습니다. 다시 시도하세요.';return;}
    paper.close(id,t.lastPrice,'MANUAL');paperSave();if(storageOK)document.getElementById('paperStatus').textContent='모의 포지션 종료 · 거래일지 저장 완료';
  }finally{manualClosing=false;paperRender();}
}
document.getElementById('paperExport').onclick=()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,mode:'paper',exported:new Date().toISOString(),...paper.state},null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='bitget-paper-journal.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
paperRender();
const enableBox=document.getElementById('paperEnabled');enableBox.disabled=true;
if(navigator.locks&&storageOK){
  navigator.locks.request('bitget-paper-journal-owner',{ifAvailable:true},async lock=>{
    if(!lock){document.getElementById('paperStatus').textContent='다른 탭이 모의매매를 실행 중입니다.';return;}
    try{paper=new PaperEngine(JSON.parse(localStorage.getItem(PAPER_KEY)||'{"trades":[],"seen":[]}'));if(!Array.isArray(paper.state.trades)||!Array.isArray(paper.state.seen))throw Error('Invalid journal');}
    catch(e){storageOK=false;document.getElementById('paperStatus').textContent='일지 읽기 실패. 자동 진입 중단.';return;}
    paperOwner=true;enableBox.disabled=false;paperRender();setInterval(paperQuotes,5000);paperQuotes();
    await new Promise(()=>{});
  }).catch(()=>{enableBox.disabled=true;document.getElementById('paperStatus').textContent='모의매매 잠금 실패. 자동 진입 중단.';});
}else if(storageOK){document.getElementById('paperStatus').textContent='이 브라우저는 중복 실행 방지 기능을 지원하지 않습니다.';}

// Isolated synthetic preview: never saved, exported or fed to the public-quote loop.
let demoEngine=null;
const demoHost=document.createElement('section');demoHost.className='card';
const demoButton=document.createElement('button');demoButton.textContent='데모 포지션 보기 / 다시 시작';demoButton.id='demoStart';
const demoLabel=document.createElement('p');demoLabel.className='hint';demoLabel.textContent='화면 확인용 가상 가격입니다. 데모는 거래일지에 저장되지 않습니다.';
const demoPrice=document.createElement('input');demoPrice.id='demoPrice';demoPrice.type='range';demoPrice.min='94';demoPrice.max='116';demoPrice.step='0.1';demoPrice.value='100';demoPrice.disabled=true;demoPrice.style.width='100%';demoPrice.setAttribute('aria-label','데모 현재가 조절: 94부터 116');
const demoPriceLabel=document.createElement('p');demoPriceLabel.textContent='가격 슬라이더: SL 95 / 진입 약 100 / TP 115';
const demoJournal=document.createElement('div');demoJournal.id='demoJournal';
const demoExamples=document.createElement('div');demoExamples.className='actions';
for(const [label,price]of [['손실 예시',98],['수익 예시',103],['TP 도달',115],['SL 도달',95]]){
 const b=document.createElement('button');b.textContent=label;b.onclick=()=>{if(!demoEngine||demoEngine.state.trades[0].exit)return;demoPrice.value=String(price);demoPrice.oninput();};demoExamples.append(b);
}
demoHost.append(demoButton,demoLabel,demoPriceLabel,demoPrice,demoExamples,demoJournal);document.getElementById('journal').before(demoHost);
demoButton.onclick=()=>{
 demoEngine=new PaperEngine();demoEngine.enter({sym:'DEMOUSDT',d:'LONG',g:'A+',st:'ENTRY WATCH',signalTime:Date.now(),p:100,sc:4.5,a:3,l:{sl:95,t1:115}}, {account:1000,risk:1,lev:10,margin:35});
 demoPrice.value='100';demoPrice.disabled=false;paperRender(demoEngine,'demoJournal',true);
};
demoPrice.oninput=()=>{if(!demoEngine)return;demoEngine.mark('DEMOUSDT',+demoPrice.value);paperRender(demoEngine,'demoJournal',true);if(demoEngine.state.trades[0].exit)demoPrice.disabled=true;};
