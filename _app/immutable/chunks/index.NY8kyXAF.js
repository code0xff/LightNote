import{n as f,s as w,r as m,a as q,i as x}from"./scheduler.wibOmgHn.js";const a=[];function z(e,o){return{subscribe:A(e,o).subscribe}}function A(e,o=f){let n;const r=new Set;function u(t){if(q(e,t)&&(e=t,n)){const i=!a.length;for(const s of r)s[1](),a.push(s,e);if(i){for(let s=0;s<a.length;s+=2)a[s][0](a[s+1]);a.length=0}}}function l(t){u(t(e))}function b(t,i=f){const s=[t,i];return r.add(s),r.size===1&&(n=o(u,l)||f),t(e),()=>{r.delete(s),r.size===0&&n&&(n(),n=null)}}return{set:u,update:l,subscribe:b}}function E(e,o,n){const r=!Array.isArray(e),u=r?[e]:e;if(!u.every(Boolean))throw new Error("derived() expects stores as input, got a falsy value");const l=o.length<2;return z(n,(b,t)=>{let i=!1;const s=[];let d=0,p=f;const h=()=>{if(d)return;p();const c=o(r?s[0]:s,b,t);l?b(c):p=x(c)?c:f},y=u.map((c,g)=>w(c,_=>{s[g]=_,d&=~(1<<g),i&&h()},()=>{d|=1<<g}));return i=!0,h(),function(){m(y),p(),i=!1}})}export{E as d,z as r,A as w};