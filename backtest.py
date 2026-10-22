#!/usr/bin/env python3
"""Public Bitget OHLCV backtest prototype. No keys, orders or live trading.
Run: python backtest.py --days 180
This is an independent reversal-proxy strategy, NOT a reproduction of the HTML scanners.
"""
import argparse, csv, json, math, time, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE="https://api.bitget.com/api/v2/mix/market/history-candles"
STEP={"5m":300000,"15m":900000,"1H":3600000,"4H":14400000,"1D":86400000}
def candles(symbol,tf,start,end):
    step=STEP[tf]; end=end//step*step; start=start//step*step
    result={}
    cursor=end
    while cursor>start:
        lo=max(start,cursor-step*190)
        q=urllib.parse.urlencode(dict(symbol=symbol,productType="USDT-FUTURES",granularity=tf,startTime=lo,endTime=cursor,limit=200))
        for attempt in range(4):
            try:
                with urllib.request.urlopen(BASE+"?"+q,timeout=25) as response: obj=json.load(response)
                if obj.get("code")!="00000":raise RuntimeError(str(obj.get("msg")))
                break
            except Exception:
                if attempt==3:raise
                time.sleep(1.5*(attempt+1))
        for a in obj.get("data") or []:
            t=int(a[0])
            if start<=t<end:result[t]=(t,*map(float,a[1:7]))
        cursor=lo
        time.sleep(.09)
    return sorted(result.values())

def rsi(close,period=14):
    if len(close)<period+2:return None
    changes=[close[i]-close[i-1] for i in range(1,len(close))]
    gain=sum(max(x,0) for x in changes[:period])/period
    loss=sum(max(-x,0) for x in changes[:period])/period
    for x in changes[period:]:
        gain=(gain*(period-1)+max(x,0))/period
        loss=(loss*(period-1)+max(-x,0))/period
    return 100 if loss==0 else 100-100/(1+gain/loss)

def backtest(bars,mode):
    # Completed bars only; detect a pivot 2 bars after the pivot occurs.
    # Signals use completed candle, enter at NEXT candle open.
    # Stop from last five bars; 10x and 0.1% round-trip friction buffer.
    # Targets: 1.5R scalp, 2R swing; pessimistic same-bar stop-first.
    rr=1.5 if mode=="SCALP" else 2.
    fee=.001
    trades=[]; i=45
    while i<len(bars)-1:
        window=bars[:i+1]
        closes=[x[4] for x in window]
        curr=rsi(closes); prev=rsi(closes[:-1])
        if curr is None or prev is None:i+=1;continue
        b=bars[i]; old=bars[i-1]
        lowpivot=bars[i-2][3]<min(x[3] for x in bars[i-4:i-2]+bars[i-1:i+1])
        highpivot=bars[i-2][2]>max(x[2] for x in bars[i-4:i-2]+bars[i-1:i+1])
        direction=0
        if lowpivot and curr>prev and curr>45 and b[4]>b[1] and b[4]>old[4]:direction=1
        if highpivot and curr<prev and curr<55 and b[4]<b[1] and b[4]<old[4]:direction=-1
        if not direction:i+=1;continue
        entry=bars[i+1][1]
        stop=min(x[3] for x in bars[i-4:i+1]) if direction==1 else max(x[2] for x in bars[i-4:i+1])
        risk=direction*(entry-stop)
        if risk<=0 or (risk/entry+fee)*10*100>10:i+=1;continue
        target=entry+direction*rr*risk
        j=i+1; exit_price=None; reason="TIME"
        while j<len(bars):
            candle=bars[j]
            stop_hit=candle[3]<=stop if direction==1 else candle[2]>=stop
            target_hit=candle[2]>=target if direction==1 else candle[3]<=target
            if stop_hit:exit_price=stop;reason="STOP";break
            if target_hit:exit_price=target;reason="TARGET";break
            if j-i>=48:exit_price=candle[4];break
            j+=1
        if exit_price is None:break
        pnl=direction*(exit_price-entry)/entry*10*100-fee*10*100
        trades.append(dict(entry_time=datetime.fromtimestamp(bars[i+1][0]/1000,timezone.utc).isoformat(),exit_time=datetime.fromtimestamp(bars[j][0]/1000,timezone.utc).isoformat(),direction="LONG" if direction==1 else "SHORT",entry=entry,stop=stop,target=target,exit=exit_price,exit_reason=reason,roe_pct=round(pnl,4)))
        i=j+1
    return trades

def stats(trades):
    if not trades:return dict(trades=0,win_rate_pct=None,mean_roe_pct=None,profit_factor=None,max_drawdown_roe_points=None)
    p=[x["roe_pct"] for x in trades]
    pos=sum(max(0,x) for x in p);neg=-sum(min(0,x) for x in p)
    eq=peak=dd=0
    for x in p:
        eq+=x;peak=max(peak,eq);dd=max(dd,peak-eq)
    return dict(trades=len(p),win_rate_pct=round(100*sum(x>0 for x in p)/len(p),2),mean_roe_pct=round(sum(p)/len(p),3),profit_factor=round(pos/neg,3) if neg else None,max_drawdown_roe_points=round(dd,3))

def main():
    a=argparse.ArgumentParser()
    a.add_argument("--days",type=int,default=180)
    a.add_argument("--symbols",nargs="+",default=["BTCUSDT","ETHUSDT","SOLUSDT"])
    a.add_argument("--output",default="backtest_results")
    args=a.parse_args()
    out=Path(args.output);out.mkdir(exist_ok=True,parents=True)
    now=int(time.time()*1000);start=now-args.days*86400000
    summary=[];all_trades=[]
    for symbol in args.symbols:
        for mode,tf in (("SCALP","5m"),("SWING","15m")):
            print("Downloading",symbol,tf,flush=True)
            bars=candles(symbol,tf,start,now)
            if len(bars)<60:print("Insufficient data",symbol,tf,len(bars));continue
            trades=backtest(bars,mode)
            for t in trades:t.update(symbol=symbol,mode=mode)
            all_trades.extend(trades)
            summary.append(dict(symbol=symbol,mode=mode,candles=len(bars),**stats(trades)))
            print(summary[-1],flush=True)
    with (out/"summary.json").open("w") as f:json.dump(summary,f,indent=2)
    with (out/"trades.csv").open("w",newline="") as f:
        cols=["symbol","mode","entry_time","exit_time","direction","entry","stop","target","exit","exit_reason","roe_pct"]
        writer=csv.DictWriter(f,fieldnames=cols);writer.writeheader();writer.writerows(all_trades)
    print("Saved",out/"summary.json",out/"trades.csv")
if __name__=="__main__":main()
