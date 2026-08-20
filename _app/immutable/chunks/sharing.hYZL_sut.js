function __vite__mapDeps(indexes) {
  if (!__vite__mapDeps.viteFileDeps) {
    __vite__mapDeps.viteFileDeps = ["./tiptap.CStSmvSC.js","./prosemirror.8SPImwIw.js","./editor-ui.DND081e3.js","./collaboration.uIiQn7L1.js"]
  }
  return indexes.map((i) => __vite__mapDeps.viteFileDeps[i])
}
import{_ as i}from"./preload-helper.D6kgxu3v.js";import{S as n}from"./tiptap.CStSmvSC.js";import{g as a}from"./2.BQmKsqjs.js";async function f(t,o){const{default:r}=await i(()=>import("./tiptap.CStSmvSC.js").then(e=>e.e),__vite__mapDeps([0,1,2,3]),import.meta.url);return a(o,{starterKit:n.configure({history:!1}),extraExtensions:[r.configure({document:t.document})]})}export{f as getExtensionsOnSharing};
