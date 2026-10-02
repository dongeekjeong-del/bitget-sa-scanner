const PAPER_KEY='bitget-paper-journal-v1';
let paper,storageOK=true,quoteBusy=false,paperOwner=false,manualClosing=false;
try{paper=new PaperEngine(JSON.parse(localStorage.getItem(PAPER_KEY)||'{"trades":[],"seen":[]}'));if(!Array.isArray(paper.state.trades)||!Array.isArray(paper.state.seen))throw Error('Invalid journal');}
catch(e){storageOK=false;paper=new PaperEngine();document.getElementById('paperStatus').textContent='저장된 일지 읽기 실패. 자동 진입 중단.';}
function paperSave(){try{localStorage.setItem(PAPER_KEY,JSON.stringify(paper.state));}catch(e){storageOK=false;document.getElementById('paperEnabled').checked=false;document.getElementById('paperStatus').textContent='일지 저장 실패. 자동 진입 중단. JSON을 내보내세요.';}paperRender();}
function paperNumber(n){return Number.isFinite(n)?n.toLocaleString('en-US',{maximumFractionDigits:Math.abs(n)<1?8:4}):'—';}
function paperSigned(n,suffix){return Number.isFinite(n)?(n>0?'+':n<0?'-':'')+suffix+Math.abs(n).toFixed(2):'—';}
function paperRender(engine=paper,target="journal",demo=false){
  const el=document.getElementById(target);el.replaceChildren();
  if(!engine.state.trades.length)el.textContent="현재 모의 포지션이 없습니다. 위의 데모 포지션 보기로 화면을 확인하세요.";
  for(const t of [...engine.state.trades].sort((a,b)=>Number(!!a.exit)-Number(!!b.exit)||b.opened-a.opened)){
    const card=document.createElement('div');card.className='card';
    const title=document.createElement('b');title.textContent=`${demo?'DEMO · ':''}${t.exit?'거래일지':'Position'} · ${t.sym.replace('USDT','')} · ${t.dir}`;card.append(title);
    const table=document.createElement('table');table.className='position-table';
    const p=engine.position(t);
    const row=(label,value,sign)=>{const tr=document.createElement('tr'),th=document.createElement('th'),td=document.createElement('td');th.textContent=label;th.setAttribute('scope','row');td.textContent=value;if(Number.isFinite(sign))td.className=sign>0?'pnl-positive':sign<0?'pnl-negative':'pnl-zero';tr.append(th,td);table.append(tr);};
    row('종목',t.sym.replace('USDT','')+' / '+t.dir);
    if(!t.exit){row('Unrealized PnL',p?paperSigned(p.gross,'$'):'—',p?.gross);row('ROE',p?paperSigned(p.roi,'')+'%':'—',p?.roi);}
    else{row('Realized PnL',paperSigned(t.exit.net,'$'),t.exit.net);row('ROE (순손익)',paperSigned(t.exit.net/t.margin*100,'')+'%',t.exit.net);}
    row('Entry price','$'+paperNumber(t.entry));row(t.exit?'Exit price':'Market price','$'+paperNumber(t.exit?t.exit.price:p?.price));
    row('Take Profit / Stop Loss','$'+paperNumber(t.target)+' / $'+paperNumber(t.stop));
    row('수량 / 레버리지',paperNumber(t.qty)+' / '+t.config.lev+'x');row('증거금','$'+t.margin.toFixed(2));
    card.append(table);
    const note=document.createElement('p');note.className='hint';
    if(!t.exit){
      note.textContent=`가격 확인 ${new Date(t.lastObserved).toLocaleTimeString()}${Date.now()-t.lastObserved>15000?' · 갱신 지연':''} · ROE = 미실현 손익 ÷ 증거금 (수수료 전)`;
      card.append(note);
      const button=document.createElement('button');button.textContent=p?(p.estimatedNet>=0?'모의 익절 · 전량 종료':'모의 손절 · 전량 종료'):'모의 포지션 전량 종료';button.disabled=demo?false:(!paperOwner||!storageOK||manualClosing);
      button.onclick=()=>{if(demo){engine.close(t.id,t.lastPrice,'MANUAL');paperRender(engine,target,true);document.getElementById('demoPrice').disabled=true;}else paperManualClose(t.id);};card.append(button);
    }else{
      note.textContent=`진입 ${new Date(t.opened).toLocaleString()} · 종료 ${new Date(t.exit.time).toLocaleString()} · ${t.exit.reason} · 추정 수수료 $${t.exit.fees.toFixed(2)} · 펀딩 제외${t.observationGap?' · 가격 관측 공백 있음':''}`;card.append(note);
      const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('div');summary.textContent='진입 근거 · 지표 분석';body.style.whiteSpace='pre-wrap';body.textContent=demo?'화면 확인용 예시 거래입니다. 실제 시장 지표 분석에 따른 진입이 아닙니다.':(t.entryAnalysis||engine.explain(t.snapshot));details.append(summary,body);card.append(details);
    }
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
