/* Paper trading only. No authenticated exchange calls. */
(function(root){
  class PaperEngine {
    constructor(state={trades:[],seen:[]},fee=0.0006,slip=0.0005){
      this.state=JSON.parse(JSON.stringify(state));this.fee=fee;this.slip=slip;
    }
    enter(x,cfg,now=Date.now()){
      if(!['A+','S'].includes(x.g)||!['ENTRY WATCH','TRIGGERED'].includes(x.st)||!x.l)return null;
      const key=[x.sym,x.d,x.signalTime].join(':');
      if(this.state.seen.includes(key)||this.state.trades.some(t=>t.sym===x.sym&&!t.exit))return null;
      const sign=x.d==='LONG'?1:-1,entry=x.p*(1+sign*this.slip),stop=x.l.sl,target=x.l.t1;
      const risk=sign*(entry-stop),reward=sign*(target-entry);
      if(![entry,stop,target,cfg.account,cfg.risk,cfg.lev,cfg.margin].every(v=>Number.isFinite(v)&&v>0)||risk<=0||reward/risk<(x.g==='S'?2.4:2.1))return null;
      const reserved=this.state.trades.filter(t=>!t.exit).reduce((s,t)=>s+t.margin,0);
      const budget=Math.max(0,cfg.account*cfg.margin/100-reserved);
      const qty=Math.min(cfg.account*cfg.risk/100/(risk+(entry+stop)*this.fee+stop*this.slip),budget*cfg.lev/entry);
      if(!(qty>0))return null;
      const trade={id:key,sym:x.sym,dir:x.d,grade:x.g,status:x.st,opened:now,entry,stop,target,qty,margin:qty*entry/cfg.lev,feeRate:this.fee,slippage:this.slip,lastObserved:now,lastPrice:x.p,
        reason:`${x.g} / ${x.st}; Score ${x.sc}; timeframe alignment ${x.a}/4; TP1 R:R ${(reward/risk).toFixed(2)}`,
        entryAnalysis:this.explain(x),snapshot:JSON.parse(JSON.stringify(x)),config:{...cfg},rr:reward/risk};
      this.state.trades.push(trade);this.state.seen.push(key);return trade;
    }
    mark(sym,price,now=Date.now()){
      if(!Number.isFinite(price)||price<=0)return [];
      const closed=[];
      for(const t of this.state.trades.filter(t=>t.sym===sym&&!t.exit)){
        const sign=t.dir==='LONG'?1:-1;
        if(now-t.lastObserved>15000)t.observationGap=true;
        t.lastObserved=now;t.lastPrice=price;
        const why=sign*(price-t.stop)<=0?'STOP':sign*(price-t.target)>=0?'TP1':null;
        if(!why)continue;
        this.close(t.id,price,why,now);
        closed.push(t);
      }
      return closed;
    }
    explain(x){
      if(!x)return '진입 당시 지표 기록이 없습니다.';
      const lines=[`${x.g} / ${x.st} · ${x.d} · Score ${x.sc} · 방향 일치 ${x.a}/4`, '등급: 마감봉 기반 추세·모멘텀 점수와 시간대 정렬, 첫 구조적 목표가까지의 손익비로 판정.', `15분 진입 신호: ${x.tr===true?'확인':x.tr===false?'미확인 (ENTRY WATCH)':'기록 없음'}`];
      if(x.l)lines.push(`계획 평균 진입가 기준 TP1 R:R ${x.l.rr??'기록 없음'} · 목표가는 1H/4H/1D의 확인된 고점·저점에서 탐색.`);
      if(!x.indicators)lines.push('세부 지표 값은 저장되지 않은 이전 거래입니다.');
      for(const [tf,s]of Object.entries(x.indicators||{})){
        lines.push(`\n${tf}: 방향 ${x.ds?.[tf]||'중립/기록 없음'}`);
        if([s.p,s.e20,s.e50,s.e200].every(Number.isFinite)){
          lines.push(`종가 ${s.p}; EMA20 ${s.e20}; EMA50 ${s.e50}; EMA200 ${s.e200}.`);
          lines.push(s.p>s.e20&&s.e20>s.e50?'종가 > EMA20 > EMA50: 단기 상승 정렬.':s.p<s.e20&&s.e20<s.e50?'종가 < EMA20 < EMA50: 단기 하락 정렬.':'단기 EMA 상승/하락 정렬 조건 미충족.');
          lines.push(s.e50>s.e200?'EMA50 > EMA200: 장기 추세 점수는 롱 방향.':s.e50<s.e200?'EMA50 < EMA200: 장기 추세 점수는 숏 방향.':'EMA50과 EMA200 동일: 장기 방향 점수 없음.');
          if(s.A>0)lines.push(`EMA20/50 최근접 거리 ${(Math.min(Math.abs(s.p-s.e20),Math.abs(s.p-s.e50))/s.A).toFixed(2)} ATR (눌림/반등 점수 기준 0.7 ATR 이내).`);
        }
        if(Number.isFinite(s.R))lines.push(`RSI ${s.R.toFixed(2)}: ${s.R>=52&&s.R<=68?'롱 모멘텀 점수 구간':s.R>=32&&s.R<=48?'숏 모멘텀 점수 구간':'방향 점수 구간 밖'}.`);
        if(Number.isFinite(s.H))lines.push(`MACD histogram ${s.H}: ${s.H>0?'양수, 롱 모멘텀 점수':s.H<0?'음수, 숏 모멘텀 점수':'0, 방향 점수 없음'}.`);
        if(Number.isFinite(s.V))lines.push(`거래량 / 이전 20봉 평균 ${s.V.toFixed(2)}배 (거래량 점수 기준 1.15배 이상).`);
      }
      lines.push('\n다이버전시: 현재 스캐너는 분석하지 않으며 진입 근거로 사용하지 않습니다.');return lines.join('\n');
    }
    position(t){
      const price=t.lastPrice;
      if(!Number.isFinite(price)||price<=0)return null;
      const sign=t.dir==='LONG'?1:-1,gross=sign*(price-t.entry)*t.qty;
      const estimatedExit=price*(1-sign*t.slippage),fees=(t.entry+estimatedExit)*t.qty*t.feeRate;
      const estimatedNet=sign*(estimatedExit-t.entry)*t.qty-fees;
      return{price,gross,roi:t.margin>0?gross/t.margin*100:null,estimatedNet,estimatedNetRoi:t.margin>0?estimatedNet/t.margin*100:null};
    }
    close(id,price,reason='MANUAL',now=Date.now()){
      const t=this.state.trades.find(t=>t.id===id);
      if(!t||t.exit||!Number.isFinite(price)||price<=0)return null;
      const sign=t.dir==='LONG'?1:-1,exit=price*(1-sign*t.slippage),gross=sign*(exit-t.entry)*t.qty,fees=(t.entry+exit)*t.qty*t.feeRate;
      t.exit={time:now,price:exit,reason,gross,fees,net:gross-fees,roi:t.margin>0?(gross-fees)/t.margin*100:null,funding:null,model:'Observed quote + assumed slippage; funding excluded'};
      return t;
    }
  }
  if(typeof module!=='undefined')module.exports=PaperEngine;else root.PaperEngine=PaperEngine;
})(typeof window!=='undefined'?window:globalThis);
