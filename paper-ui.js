const PAPER_KEY='bitget-paper-journal-v1';
let paper,storageOK=true,quoteBusy=false,paperOwner=false,manualClosing=false;
try{paper=new PaperEngine(JSON.parse(localStorage.getItem(PAPER_KEY)||'{"trades":[],"seen":[]}'));if(!Array.isArray(paper.state.trades)||!Array.isArray(paper.state.seen))throw Error('Invalid journal');}
catch(e){storageOK=false;paper=new PaperEngine();document.getElementById('paperStatus').textContent='저장된 일지 읽기 실패. 자동 진입 중단.';}
function paperSave(){try{localStorage.setItem(PAPER_KEY,JSON.stringify(paper.state));}catch(e){storageOK=false;document.getElementById('paperEnabled').checked=false;document.getElementById('paperStatus').textContent='일지 저장 실패. 자동 진입 중단. JSON을 내보내세요.';}paperRender();}
function paperRender(){
  const el=document.getElementById('journal');el.replaceChildren();
  for(const t of [...paper.state.trades].reverse()){
    const card=document.createElement('div');card.className='card';
    const title=document.createElement('b');title.textContent=`${t.sym} ${t.dir} · ${t.exit?'CLOSED':'OPEN'} · ${t.grade} / ${t.status}`;card.append(title);
    const body=document.createElement('div');body.style.whiteSpace='pre-wrap';
    body.textContent=`진입: ${new Date(t.opened).toLocaleString()} @ ${t.entry}\n근거: ${t.reason}\n손절 ${t.stop} / TP1 ${t.target} / 수량 ${t.qty}\n`+(t.exit?`청산: ${new Date(t.exit.time).toLocaleString()} @ ${t.exit.price} (${t.exit.reason})\n총손익 $${t.exit.gross.toFixed(2)} · 추정 수수료 $${t.exit.fees.toFixed(2)} · 순손익 $${t.exit.net.toFixed(2)} (펀딩 제외)`:'보유 중')+(t.observationGap?'\n가격 관측 공백 있음 — 청산 시점 및 성과 해석에 주의':'');
    card.append(body);
    const pnl=document.createElement('div');pnl.style.whiteSpace='pre-wrap';
    if(!t.exit){
      const p=paper.position(t),fresh=Date.now()-t.lastObserved<=15000;
      pnl.textContent=`증거금 $${t.margin.toFixed(2)} · 레버리지 ${t.config.lev}x\n현재가 ${p?p.price:'—'} · 가격 확인 ${new Date(t.lastObserved).toLocaleTimeString()}${fresh?'':' (갱신 지연)'}\n미실현 손익 ${p?'$'+p.gross.toFixed(2):'—'} · ROI ${p?p.roi.toFixed(2)+'%':'—'} (수수료 전)\n지금 청산 시 추정 순손익 ${p?'$'+p.estimatedNet.toFixed(2):'—'} · 순 ROI ${p?p.estimatedNetRoi.toFixed(2)+'%':'—'} (펀딩 제외)\nTP ${t.target} / SL ${t.stop}`;
      const button=document.createElement('button');button.textContent=p?(p.estimatedNet>=0?'모의 익절 · 전량 종료':'모의 손절 · 전량 종료'):'모의 포지션 전량 종료';button.disabled=!paperOwner||!storageOK||manualClosing;
      button.onclick=()=>paperManualClose(t.id);card.append(pnl,button);
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
    paper.close(id,t.lastPrice,'MANUAL');paperSave();document.getElementById('paperStatus').textContent='모의 포지션 종료 · 거래일지 저장 완료';
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
