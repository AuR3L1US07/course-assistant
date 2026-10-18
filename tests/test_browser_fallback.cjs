const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const file=path.resolve(__dirname,'../browser_worker.cjs'),realRequire=createRequire(file);
const env={PROGRAMFILES:'C:/fixture/system','PROGRAMFILES(X86)':'C:/fixture/x86',LOCALAPPDATA:'C:/fixture/user'};
const chrome=path.join(env.LOCALAPPDATA,'Google/Chrome/Application/chrome.exe');
const edge=path.join(env.PROGRAMFILES,'Microsoft/Edge/Application/msedge.exe');
const installed=new Set([chrome,edge]);
const context=vm.createContext({require:n=>n==='node:fs'?{...fs,statSync:p=>({isFile:()=>installed.has(p)})}:realRequire(n),
module:{exports:{}},__filename:file,__dirname:path.dirname(file),Buffer,console,process:{env},setTimeout,clearTimeout,setInterval,clearInterval});
vm.runInContext(fs.readFileSync(file,'utf8'),context);
assert.equal(vm.runInContext('browserExecutable()',context),chrome);
installed.delete(chrome);
assert.equal(vm.runInContext('browserExecutable()',context),edge);
installed.clear();
assert.throws(()=>vm.runInContext('browserExecutable()',context),/Chrome.*Edge/);
console.log('Background worker: Chrome preference, Edge fallback and missing browser passed');
