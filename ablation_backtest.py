#!/usr/bin/env python3
"""Sequential filter ablation for public Bitget candles; research only.
Run: python ablation_backtest.py --days 180
Uses the same simplified baseline as backtest.py, NOT exact HTML scanner parity.
Each stage adds one condition; no future candles are used for signals.
"""
import argparse,bisect,csv,json,math,time
from pathlib import Path
from backtest import candles,rsi,stats

FEE=.001; LEV=10
STAGES=["BASELINE","TREND_4H","ZONE_15M","STRUCTURE_BREAK","VOLUME","COOLDOWN"]
def ema(values,n=20):
    if len(values)<n:return None
    v=sum(values[:n])/n
    k=2/(n+1)
    for x in values[n:]:v=x*k+v*(1-k)
    return v
def completed_before(bars,ends,ts,ms):
    # strictly completed before signal bar close; candle timestamps are opening timestamps
    return bisect.bisect_right(ends,ts)-1
def run(bars,trend,zone,mode,stage):
    rr=1.5 if mode=="SCALP" else 2.0
    tfms=300000 if mode=="SCALP" else 900000
    four_end=[x[0]+14400000 for x in trend]
    zone_end=[x[0]+900000 for x in zone]
    trades=[];i=45;last_exit=-10000
    while i<len(bars)-1:
        b=bars[i];old=bars[i-1];cl=[x[4] for x in bars[:i+1]]
        now=rsi(cl);prior=rsi(cl[:-1])
        if now is None or prior is None:i+=1;continue
        lowpivot=bars[i-2][3]<min(x[3] for x in bars[i-4:i-2]+bars[i-1:i+1])
        highpivot=bars[i-2][2]>max(x[2] for x in bars[i-4:i-2]+bars[i-1:i+1])
        direction=0
        if lowpivot and now>prior and now>45 and b[4]>b[1] and b[4]>old[4]:direction=1
        if highpivot and now<prior and now<55 and b[4]<b[1] and b[4]<old[4]:direction=-1
        if not direction:i+=1;continue
        close_time=b[0]+tfms
        if stage>=1:
            idx=bisect.bisect_right(four_end,close_time)-1
            if idx<30:i+=1;continue
            prev4=trend[max(0,idx-49):idx+1]
            avg=ema([x[4] for x in prev4],20)
            if avg is None or direction*(prev4[-1][4]-avg)<=0:i+=1;continue
        if stage>=2:
            idx=bisect.bisect_right(zone_end,close_time)-1
            if idx<20:i+=1;continue
            z=zone[max(0,idx-35):idx+1]
            # past confirmed 15m pivot (2 bars of right-side confirmation)
            pivots=[]
            for k in range(2,len(z)-2):
                if direction==1 and z[k][3]<min(z[k-2][3],z[k-1][3],z[k+1][3],z[k+2][3]):pivots.append(z[k][3])
                if direction==-1 and z[k][2]>max(z[k-2][2],z[k-1][2],z[k+1][2],z[k+2][2]):pivots.append(z[k][2])
            if not pivots or min(abs(b[4]-p)/b[4] for p in pivots[-6:])>.006:i+=1;continue
        if stage>=3:
            if direction==1 and b[4]<=max(x[2] for x in bars[i-4:i]):i+=1;continue
            if direction==-1 and b[4]>=min(x[3] for x in bars[i-4:i]):i+=1;continue
        if stage>=4:
            vol=[x[5] for x in bars[i-20:i]]
            if not vol or b[5]<1.2*sum(vol)/len(vol):i+=1;continue
        if stage>=5 and i-last_exit<12:i+=1;continue
        entry=bars[i+1][1]
        stop=min(x[3] for x in bars[i-4:i+1]) if direction==1 else max(x[2] for x in bars[i-4:i+1])
        risk=direction*(entry-stop)
        if risk<=0 or (risk/entry+FEE)*LEV*100>10:i+=1;continue
        target=entry+direction*rr*risk
        j=i+1;exit_price=None;reason="TIME"
        while j<len(bars):
            candle=bars[j]
            stop_hit=candle[3]<=stop if direction==1 else candle[2]>=stop
            target_hit=candle[2]>=target if direction==1 else candle[3]<=target
            if stop_hit:exit_price=stop;reason="STOP";break
            if target_hit:exit_price=target;reason="TARGET";break
            if j-i>=48:exit_price=candle[4];break
            j+=1
        if exit_price is None:break
        roe=direction*(exit_price-entry)/entry*LEV*100-FEE*LEV*100
        trades.append(dict(entry_time=bars[i+1][0],exit_time=bars[j][0],direction="LONG" if direction==1 else "SHORT",entry=entry,stop=stop,target=target,exit=exit_price,exit_reason=reason,roe_pct=round(roe,4)))
        last_exit=j;i=j+1
    return trades
def main():
    a=argparse.ArgumentParser()
    a.add_argument("--days",type=int,default=180)
    a.add_argument("--symbols",nargs="+",default=["BTCUSDT","ETHUSDT","SOLUSDT"])
    a.add_argument("--output",default="ablation_results")
    args=a.parse_args()
    out=Path(args.output);out.mkdir(exist_ok=True,parents=True)
    end=int(time.time()*1000);start=end-args.days*86400000
    summary=[];alltrades=[]
    for sym in args.symbols:
        print("Fetching",sym,"4H and 15m context",flush=True)
        trend=candles(sym,"4H",start-45*86400000,end)
        zone=candles(sym,"15m",start-4*86400000,end)
        for mode,tf in [("SCALP","5m"),("SWING","15m")]:
            print("Fetching",sym,mode,tf,flush=True)
            bars=candles(sym,tf,start,end)
            for step,name in enumerate(STAGES):
                trades=run(bars,trend,zone,mode,step)
                row=dict(symbol=sym,mode=mode,stage=name,stage_index=step,candles=len(bars),**stats(trades))
                summary.append(row)
                for t in trades:t.update(symbol=sym,mode=mode,stage=name)
                alltrades.extend(trades)
                print(row,flush=True)
    with (out/"summary.csv").open("w",newline="") as f:
        writer=csv.DictWriter(f,fieldnames=list(summary[0]));writer.writeheader();writer.writerows(summary)
    with (out/"trades.csv").open("w",newline="") as f:
        fields=["symbol","mode","stage","entry_time","exit_time","direction","entry","stop","target","exit","exit_reason","roe_pct"]
        writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader();writer.writerows(alltrades)
    print("Saved",out/"summary.csv",out/"trades.csv",flush=True)
if __name__=="__main__":main()
