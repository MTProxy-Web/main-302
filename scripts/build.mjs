import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const manifestUrl='https://raw.githubusercontent.com/MTProxy-Web/main-mtptg/simple-html/.github/mirrors.json';

async function readJson(url){
  const response=await fetch(url,{headers:{Accept:'application/vnd.github+json','User-Agent':'MTProxy-Web-Pages',...(process.env.GITHUB_TOKEN?{Authorization:'Bearer '+process.env.GITHUB_TOKEN}:{})},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('Configuration request failed: '+response.status);
  return response.json();
}

export function activePool(mirrors,pages,rotation=null){
  if(!Array.isArray(mirrors)||mirrors.length!==5||pages.length!==5)throw new Error('Exactly five mirrors are required');
  if(rotation&&(!/^r[1-9][0-9]*$/.test(rotation.operation_id||'')||!/^MTProxy-Web\/web-[1-5]$/.test(rotation.excluded_repository||'')))throw new Error('Invalid rotation state');
  const repositories=new Set(),labels=new Set();
  for(let i=0;i<mirrors.length;i++){
    const mirror=mirrors[i],page=pages[i];
    if(!/^MTProxy-Web\/web-[1-5]$/.test(mirror.repository)||repositories.has(mirror.repository))throw new Error('Invalid mirror repository');
    repositories.add(mirror.repository);
    if(rotation?.excluded_repository===mirror.repository)continue;
    if(page.public!==true||page.https_enforced!==true||page.https_certificate?.state!=='approved'||!page.https_certificate.domains.includes(page.cname))throw new Error('Mirror HTTPS is not ready: '+mirror.repository);
    const match=/^([a-z0-9-]+)\.mtproxy\.bar$/.exec(page.cname||'');
    if(!match||labels.has(match[1]))throw new Error('Invalid or duplicate mirror domain');
    labels.add(match[1]);
  }
  if(labels.size!==(rotation?4:5))throw new Error('Invalid active pool size');
  return {domain:'mtproxy.bar',labels:[...labels]};
}

export function renderRedirect(html,pool){
  const encoded=Buffer.from(JSON.stringify(pool),'utf8').toString('base64');
  const pattern=/const pool = JSON\.parse\(atob\('[A-Za-z0-9+/=]+'\)\);/g;
  if([...html.matchAll(pattern)].length!==1)throw new Error('Redirect template pool is missing or ambiguous');
  return html.replace(pattern,"const pool = JSON.parse(atob('"+encoded+"'));" );
}

export async function build(root,options={}){
  const manifest=options.manifest||await readJson(manifestUrl);
  if(!Array.isArray(manifest.mirrors)||manifest.mirrors.length!==5)throw new Error('Invalid mirror manifest');
  const mirrors=manifest.mirrors;
  for(const mirror of mirrors)if(!/^MTProxy-Web\/web-[1-5]$/.test(mirror.repository))throw new Error('Invalid mirror repository');
  const pages=options.pages||await Promise.all(mirrors.map(mirror=>readJson('https://api.github.com/repos/'+mirror.repository+'/pages')));
  const rotation=options.rotation??(process.env.ROTATION_STATE?JSON.parse(process.env.ROTATION_STATE):null);
  const pool=activePool(mirrors,pages,rotation);
  const html=renderRedirect(await fs.readFile(path.join(root,'index.html'),'utf8'),pool);
  const output=path.join(root,'_site');
  await fs.mkdir(output,{recursive:true});
  await fs.writeFile(path.join(output,'index.html'),html);
  await fs.writeFile(path.join(output,'CNAME'),'mtproxy.tg\n');
  await fs.writeFile(path.join(output,'robots.txt'),'User-agent: *\nDisallow: /\n');
  console.log('Built redirect with '+pool.labels.length+' HTTPS mirror domains.');
  return pool;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await build(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
