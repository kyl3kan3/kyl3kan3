import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const base='https://kyl3kan3.vercel.app';
const keys=JSON.parse(await readFile(path.join(homedir(),'.codex/private/kyl3kan3-production.json'),'utf8'));
const landing=await fetch(base,{redirect:'manual'});
assert.equal(landing.status,307);
assert.equal(new URL(landing.headers.get('location'),base).pathname,'/login');
const loginPage=await fetch(base+'/login');
assert.equal(loginPage.status,200);
assert.ok((await loginPage.text()).includes('Sign in to your workspace'));
for(const role of ['operator','manager']){
  const password=keys[role==='manager'?'MANAGER_DASHBOARD_PASSWORD':'APP_ACCESS_PASSWORD'];
  const username=keys[role==='manager'?'MANAGER_DASHBOARD_USERNAME':'APP_ACCESS_USERNAME'] || role;
  const login=await fetch(base+'/api/auth/login',{method:'POST',redirect:'manual',headers:{origin:base},body:new URLSearchParams({username,password,next:'/'})});
  assert.equal(login.status,303);
  const setCookie=login.headers.get('set-cookie');
  assert.ok(setCookie);assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/Secure/);
  const cookie=setCookie.split(';')[0];
  const home=await fetch(base+'/',{headers:{cookie}});
  assert.equal(home.status,200);
  assert.ok((await home.text()).includes('Command center'));
  assert.equal((await fetch(base+'/api/dashboard',{headers:{cookie}})).status,200);
  assert.equal((await fetch(base+'/api/quality',{headers:{cookie}})).status,role==='manager'?200:401);
  const logout=await fetch(base+'/api/auth/logout',{method:'POST',redirect:'manual',headers:{origin:base,cookie}});
  assert.equal(logout.status,303);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
}
console.log('Browser sign-in, workspace session, role isolation, and sign-out verified');
async function request(route,key,method='GET'){
  const response=await fetch(base+route,{method,headers:key?{authorization:`Bearer ${keys[key]}`}:{},signal:AbortSignal.timeout(60000)});
  return response;
}
assert.equal((await request('/api/dashboard')).status,401);
assert.equal((await request('/api/readiness')).status,401);
assert.equal((await request('/api/quality','APP_ACCESS_PASSWORD')).status,401);
console.log('Anonymous and non-manager access correctly denied');
const readiness=await request('/api/readiness','MANAGER_DASHBOARD_PASSWORD');
assert.equal(readiness.status,200);
const ready=await readiness.json();
console.log('Readiness:',JSON.stringify(ready));
for(const [name,value] of Object.entries(ready.checks))if(name!=='repairshopr')assert.equal(value,true,`${name} is not ready`);
const dashboard=await request('/api/dashboard','APP_ACCESS_PASSWORD');
assert.equal(dashboard.status,200);
const data=await dashboard.json();
assert.equal(data.source ?? data.data?.source,'database',`Dashboard is not reading the live database: ${data.dbError ?? data.error ?? 'unknown'}`);
console.log('Dashboard connected to production database');
const settings=await request('/settings','MANAGER_DASHBOARD_PASSWORD');
assert.equal(settings.status,200);assert.ok((await settings.text()).includes('Production readiness'));
const quality=await request('/api/quality','MANAGER_DASHBOARD_PASSWORD');
assert.equal(quality.status,200);
const qualityData=await quality.json();
assert.equal(qualityData.source ?? qualityData.data?.source,'database');
assert.ok(!qualityData.dbError);
console.log('Settings and manager quality dashboard healthy');
for(const source of ['repairshopr','syncro']){
  const response=await request(`/api/integrations/${source}/sync`,'CRON_SECRET');
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.ok,true);
  console.log(`${source} scheduled job: ${result.skipped ?? 'completed'}`);
}
const live=await request('/api/readiness','MANAGER_DASHBOARD_PASSWORD','POST');
assert.equal(live.status,200);const result=await live.json();
console.log('Live provider checks:',JSON.stringify(result));
assert.equal(result.jev.status,'succeeded','Live Jev Gateway evaluation failed');
assert.equal(result.jev.completionReview,'succeeded','Live Jev completion review failed');
const worker=await request('/api/jobs/jev-assessments','CRON_SECRET');
assert.equal(worker.status,200);const jobs=await worker.json();assert.equal(jobs.ok,true);
console.log('Scheduled Jev assessment worker healthy');
