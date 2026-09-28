import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "@neondatabase/serverless";
import { getDirectory, parseDirectoryUserUpdate, updateDirectoryUser } from "./directory";
import { PATCH } from "../app/api/users/route";
import { GET } from "../app/api/directory/route";

test("directory edits preserve identities and enforce workspace and manager boundaries",async(t)=>{
  const db=new PGlite();
  await db.exec((await readFile(new URL("../../db/schema.sql",import.meta.url),"utf8")).split("with org as (")[0].replace("create extension if not exists pgcrypto;",""));
  const keys=["DATABASE_URL","APP_ACCESS_PASSWORD","MANAGER_DASHBOARD_PASSWORD"];
  const before=keys.map(key=>process.env[key]);const previousFetch=neonConfig.fetchFunction;
  process.env.DATABASE_URL="postgresql://test:test@test.invalid/test";
  process.env.APP_ACCESS_PASSWORD="operator-test";process.env.MANAGER_DASHBOARD_PASSWORD="manager-test";
  t.after(async()=>{neonConfig.fetchFunction=previousFetch;keys.forEach((key,i)=>{if(before[i]===undefined)delete process.env[key];else process.env[key]=before[i];});await db.close();});
  neonConfig.fetchFunction=async(_url:Parameters<typeof fetch>[0],init?:RequestInit)=>{
    const query=JSON.parse(String(init?.body));
    try {
      const result=await db.query<Record<string,unknown>>(query.query,query.params);
      return Response.json({fields:result.fields,rows:result.rows.map(row=>result.fields.map(field=>{
        const value=row[field.name];return value===null?null:value instanceof Date?value.toISOString():field.dataTypeID===1009 && Array.isArray(value)
          ? "{"+value.join(",")+"}" : typeof value==="object"?JSON.stringify(value):String(value);
      })),rowCount:result.affectedRows??result.rows.length});
    } catch(error){return Response.json({message:error instanceof Error?error.message:"Query failed"},{status:400});}
  };
  const org=(await db.query<{id:string}>("insert into orgs(name) values('Default Operations') returning id")).rows[0].id;
  const otherOrg=(await db.query<{id:string}>("insert into orgs(name) values('Other workspace') returning id")).rows[0].id;
  const team=(await db.query<{id:string}>("insert into teams(org_id,name) values($1,'Helpdesk') returning id",[org])).rows[0].id;
  const foreignTeam=(await db.query<{id:string}>("insert into teams(org_id,name) values($1,'Foreign') returning id",[otherOrg])).rows[0].id;
  const user=(await db.query<{id:string}>("insert into users(org_id,email,full_name,role) values($1,'repairshopr-9@identity.invalid','Imported Technician','agent') returning id",[org])).rows[0].id;
  const foreignUser=(await db.query<{id:string}>("insert into users(org_id,email,role) values($1,'other@test.invalid','agent') returning id",[otherOrg])).rows[0].id;
  await db.query("insert into tickets(org_id,title,status,priority,assigned_user_id) values($1,'Retained history','resolved','P3',$2)",[org,user]);
  await updateDirectoryUser(parseDirectoryUserUpdate({id:user,teamId:team,isOnCall:true,isActive:false,fullName:"Updated name",role:"reporter"}));
  let directory=await getDirectory();
  assert.equal(directory.users.length,1,"other workspace users are never exposed");
  assert.equal(directory.users[0].isActive,false);
  assert.equal(directory.users[0].importedIdentity,true);
  assert.equal(directory.users[0].email,"repairshopr-9@identity.invalid");
  assert.deepEqual(directory.users[0].teamIds,[team]);
  assert.equal(directory.users[0].isOnCall,true);
  assert.equal((await db.query<{assigned_user_id:string}>("select assigned_user_id from tickets")).rows[0].assigned_user_id,user);
  await assert.rejects(updateDirectoryUser({id:user,teamId:foreignTeam,fullName:"Must not apply"}),/workspace/);
  await assert.rejects(updateDirectoryUser({id:foreignUser,isActive:false}),/workspace/);
  assert.throws(()=>parseDirectoryUserUpdate({id:user,email:"new@test.invalid"}),/Identity email/);
  await updateDirectoryUser({id:user,isActive:true,isOnCall:false});
  directory=await getDirectory();
  assert.equal(directory.users[0].isActive,true);assert.equal(directory.users[0].isOnCall,false);
  assert.equal(directory.users[0].fullName,"Updated name");
  assert.deepEqual(directory.users[0].teamIds,[team],"reactivation must not remove membership");
  await updateDirectoryUser({id:user,teamId:null});
  assert.deepEqual((await getDirectory()).users[0].teamIds,[]);
  assert.equal((await db.query<{count:number}>("select count(*)::int as count from audit_logs where action='directory.user.updated'")).rows[0].count,3);
  assert.equal((await PATCH(new Request("https://app.test/api/users",{method:"PATCH",headers:{authorization:"Bearer operator-test","content-type":"application/json"},body:JSON.stringify({id:user,isActive:false})}))).status,401);
  assert.equal((await GET(new Request("https://app.test/api/directory",{headers:{authorization:"Bearer operator-test"}}))).status,401);
});
