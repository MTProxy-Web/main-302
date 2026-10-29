import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {activePool,renderRedirect} from '../../scripts/build.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const mirrors=Array.from({length:5},(_,i)=>({repository:'MTProxy-Web/web-'+(i+1)}));
const names=['velora','tepam','koles','volar','dibug'];
const pages=names.map(name=>({public:true,cname:name+'.mtproxy.bar',https_enforced:true,https_certificate:{state:'approved',domains:[name+'.mtproxy.bar']}}));
test('pool includes exactly five distinct HTTPS mirrors and follows domain changes',()=>{
  const pool=activePool(mirrors,pages);
  assert.deepEqual(pool,{domain:'mtproxy.bar',labels:names});
  const changed=structuredClone(pages);changed[1].cname='replacement.mtproxy.bar';changed[1].https_certificate.domains=[changed[1].cname];
  assert.equal(activePool(mirrors,changed).labels[1],'replacement');
  assert.throws(()=>activePool(mirrors.slice(0,4),pages));
  assert.throws(()=>activePool(mirrors,[pages[0],pages[0],...pages.slice(2)]));
  assert.throws(()=>activePool(mirrors,pages.map((page,i)=>i===0?{...page,https_enforced:false}:page)));
});
test('rendered HTML contains an encoded pool and preserves query and hash for every mirror',()=>{
  const rendered=renderRedirect(html,activePool(mirrors,pages));
  for(const page of pages)assert(!rendered.includes(page.cname));
  const script=rendered.match(/<script>([\s\S]*?)<\/script>/)[1];
  for(let index=0;index<5;index++){
    let result;
    vm.runInNewContext(script,{atob:value=>Buffer.from(value,'base64').toString(),Uint32Array,URL,crypto:{getRandomValues:array=>{array[0]=index;return array;}},window:{location:{search:'?utm_source=a%2Bb&x=%23',hash:'#about',replace:value=>{result=value;}}}});
    assert.equal(result,'https://'+pages[index].cname+'/?utm_source=a%2Bb&x=%23#about');
  }
});
test('random selection rejects the biased upper boundary',()=>{
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];let result,calls=0;
  vm.runInNewContext(script,{atob:value=>Buffer.from(value,'base64').toString(),Uint32Array,URL,crypto:{getRandomValues:array=>{array[0]=calls++===0?0xffffffff:2;return array;}},window:{location:{search:'',hash:'',replace:value=>{result=value;}}}});
  assert.equal(calls,2);assert.equal(result,'https://koles.mtproxy.bar/');
});

test('a rotation excludes only the moving slot and keeps four ready mirrors',()=>{
  const pending=structuredClone(pages);pending[1].https_certificate=null;pending[1].https_enforced=false;
  const pool=activePool(mirrors,pending,{operation_id:'r1',excluded_repository:'MTProxy-Web/web-2'});
  assert.deepEqual(pool.labels,['velora','koles','volar','dibug']);
  assert.throws(()=>activePool(mirrors,pending));
  assert.throws(()=>activePool(mirrors,pages,{operation_id:'r1',excluded_repository:'Other/repository'}));
  assert.throws(()=>activePool(mirrors,pages,{operation_id:'invalid',excluded_repository:'MTProxy-Web/web-1'}));
});
