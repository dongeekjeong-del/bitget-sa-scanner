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
        snapshot:JSON.parse(JSON.stringify(x)),config:{...cfg},rr:reward/risk};
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
