if(!self.define){let e,i={};const s=(s,n)=>(s=new URL(s+".js",n).href,i[s]||new Promise((i=>{if("document"in self){const e=document.createElement("script");e.src=s,e.onload=i,document.head.appendChild(e)}else e=s,importScripts(s),i()})).then((()=>{let e=i[s];if(!e)throw new Error(`Module ${s} didn’t register its module`);return e})));self.define=(n,l)=>{const r=e||("document"in self?document.currentScript.src:"")||location.href;if(i[r])return;let a={};const u=e=>s(e,r),o={module:{uri:r},exports:a,require:u};i[r]=Promise.all(n.map((e=>o[e]||u(e)))).then((e=>(l(...e),a)))}}define(["./workbox-7cfec069"],(function(e){"use strict";self.addEventListener("message",(e=>{e.data&&"SKIP_WAITING"===e.data.type&&self.skipWaiting()})),e.precacheAndRoute([{url:"_app/immutable/assets/_layout.D8FRstQi.css",revision:null},{url:"_app/immutable/assets/_page.26kbxIwP.css",revision:null},{url:"_app/immutable/assets/0.D8FRstQi.css",revision:null},{url:"_app/immutable/assets/2.26kbxIwP.css",revision:null},{url:"_app/immutable/chunks/entry.ql9MiMBP.js",revision:null},{url:"_app/immutable/chunks/index.mQQZ-7su.js",revision:null},{url:"_app/immutable/chunks/index.NY8kyXAF.js",revision:null},{url:"_app/immutable/chunks/mode.GmPMGUR4.js",revision:null},{url:"_app/immutable/chunks/scheduler.wibOmgHn.js",revision:null},{url:"_app/immutable/entry/app.HGN1nEdb.js",revision:null},{url:"_app/immutable/entry/start.0o6xfy49.js",revision:null},{url:"_app/immutable/nodes/0.rF-iwD_z.js",revision:null},{url:"_app/immutable/nodes/1.94RZGc79.js",revision:null},{url:"_app/immutable/nodes/2.xwPGcPOr.js",revision:null},{url:"android-chrome-192x192.png",revision:"173c740fb904f28b1fa05c86b263b048"},{url:"android-chrome-512x512.png",revision:"72df082ed6541b1c98aab353ce90b9f8"},{url:"apple-touch-icon.png",revision:"7a91e2a7061da4aab2761a2f0e87fca6"},{url:"favicon-16x16.png",revision:"87dc8372b16cac8e9fad557c2404aef0"},{url:"favicon-32x32.png",revision:"30be12faeeff15ae08037f105f3aa2e2"},{url:"favicon.ico",revision:"1a309ee375f0059d10f864bd94980aea"},{url:"registerSW.js",revision:"402b66900e731ca748771b6fc5e7a068"},{url:"/note2/",revision:"c0235e03202059704aca78c321467576"},{url:"manifest.webmanifest",revision:"612d2517cbd98a68c8e21291aacab92d"}],{}),e.cleanupOutdatedCaches(),e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("/note2/")))}));