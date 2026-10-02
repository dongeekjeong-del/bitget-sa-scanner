// Headless DOM contract test, not a graphical browser test.
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const elements=new Map();function element(){return {children:[],checked:false,disabled:false,value:'',textContent:'',style:{},append(...c){this.children.push(...c)},replaceChildren(){this.children=[]},addEventListener(){},click(){}};}
const document={hidden:false,getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)},createElement:element};
for(const [id,value]of Object.entries({account:1000,risk:1,lev:10,margin:35}))document.getElementById(id).value=String(value);
const stored=new Map(),calls=[];let price=116,fail=false;
const ctx=vm.createContext({document,window:{},navigator:{locks:{request:async(n,opts,cb)=>cb({name:n})}},localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},Date,JSON,Number,Array,Set,Map,Promise,Blob,AbortController,URL:{createObjectURL:()=>'',revokeObjectURL(){}},setInterval(){},setTimeout:()=>1,clearTimeout(){},fetch:async(url,opts)=>{calls.push({url,opts});if(fail)throw Error('network');return {ok:true,json:async()=>({code:'00000',data:[{symbol:'BTCUSDT',lastPr:String(price),ts:String(Date.now())}]})}}});
vm.runInContext(fs.readFileSync('paper-engine.js','utf8'),ctx);ctx.PaperEngine=ctx.window.PaperEngine;
vm.runInContext(fs.readFileSync('paper-ui.js','utf8'),ctx);
const signal={sym:'BTCUSDT',d:'LONG',g:'A+',st:'ENTRY WATCH',signalTime:1,observedAt:Date.now(),p:100,sc:4.5,a:3,l:{sl:95,t1:115}};
(async()=>{
 await Promise.resolve();assert.equal(document.getElementById('paperEnabled').disabled,false);
 ctx.signal=signal;document.getElementById('paperEnabled').checked=true;
 vm.runInContext('paperSignals([signal])',ctx);assert.equal(JSON.parse(stored.get('bitget-paper-journal-v1')).trades.length,1);
 await vm.runInContext('paperQuotes()',ctx);const t=JSON.parse(stored.get('bitget-paper-journal-v1')).trades[0];assert.equal(t.exit.reason,'TP1');assert(t.exit.net<t.exit.gross);assert.equal(document.getElementById('journal').children.length,1);
 ctx.signal={...signal,signalTime:2};vm.runInContext('paperSignals([signal])',ctx);fail=true;await vm.runInContext('paperQuotes()',ctx);assert.equal(document.getElementById('paperEnabled').checked,false);
 fail=false;price=102;document.getElementById('paperEnabled').checked=true;
 ctx.signal={...signal,signalTime:3};vm.runInContext('paperSignals([signal])',ctx);
 const open=JSON.parse(stored.get('bitget-paper-journal-v1')).trades.find(t=>!t.exit);
 ctx.closeId=open.id;await vm.runInContext('paperManualClose(closeId)',ctx);
 const closed=JSON.parse(stored.get('bitget-paper-journal-v1')).trades.find(t=>t.id===open.id);assert.equal(closed.exit.reason,'MANUAL');assert(closed.exit.roi>0);
 assert(calls.every(c=>!c.opts.method&&!c.opts.headers));assert(calls.every(c=>c.url.includes('/market/tickers')));
 vm.runInContext('document.getElementById("paperExport").onclick()',ctx);
 console.log('PASS: UI contract, paper entry/exit persistence, journal rendering, public API failures disable entries, export handler, no authenticated or order requests');
})().catch(e=>{console.error(e);process.exitCode=1});
