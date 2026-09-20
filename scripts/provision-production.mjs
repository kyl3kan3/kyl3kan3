import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const project = JSON.parse(await readFile('.vercel/project.json','utf8'));
if(project.projectId !== 'prj_1IFlF2igmA0NoG1s4f4BkYX2xnD4') throw new Error('Unexpected Vercel project');
function cli(args, input) {
  return new Promise((resolve,reject)=>{
    // Only fixed command arguments are supplied; secret values travel over stdin.
    const child=spawn(process.platform==='win32'?'cmd.exe':'npx', process.platform==='win32'?['/d','/s','/c',`npx --yes vercel ${args.join(' ')}`]:['--yes','vercel',...args], {windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',()=>{});
    child.on('error',reject);child.on('close',code=>code===0?resolve(output):reject(new Error(`Vercel command failed (${code}); secret output suppressed`)));
    child.stdin.end(input ?? '');
  });
}
const directory=path.join(homedir(),'.codex','private');
await mkdir(directory,{recursive:true,mode:0o700});
const location=path.join(directory,'kyl3kan3-production.json');
let saved;
try {saved=JSON.parse(await readFile(location,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;saved={};}
const listing=JSON.parse(await cli(['api',`/v9/projects/${project.projectId}/env?teamId=${project.orgId}`,'--raw']));
const existing=new Set((listing.envs ?? []).filter(item=>item.target?.includes('production')).map(item=>item.key));
for(const key of ['APP_ACCESS_PASSWORD','MANAGER_DASHBOARD_PASSWORD','CRON_SECRET','REPAIRSHOPR_SYNC_SECRET','SYNCRO_SYNC_SECRET','JEV_JOB_SECRET']){
  if(existing.has(key)){console.log(`${key}: already configured`);continue;}
  saved[key] ??= randomBytes(32).toString('base64url');
  // Persist before remote creation so an interrupted run does not lose access.
  await writeFile(location,JSON.stringify({...saved,APP_ACCESS_USERNAME:'operator',MANAGER_DASHBOARD_USERNAME:'manager'},null,2),{mode:0o600});
  await cli(['env','add',key,'production','--sensitive','--yes'],saved[key]);
  console.log(`${key}: configured`);
}
console.log(`Private credential file: ${location}`);
