import { getSql, hasDatabaseUrl } from "./db";
import type { UserRole } from "./types";

export type DirectoryUser = { id:string; email:string; fullName:string|null; role:UserRole; isActive:boolean; teamIds:string[]; isOnCall:boolean; importedIdentity:boolean };
export type DirectoryData = { users:DirectoryUser[]; teams:Array<{id:string;name:string}> };
export type DirectoryUserUpdate = { id:string; fullName?:string|null; role?:UserRole; isActive?:boolean; teamId?:string|null; isOnCall?:boolean };
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseDirectoryUserUpdate(input: Record<string,unknown>): DirectoryUserUpdate {
  if(typeof input.id!=="string" || !uuid.test(input.id))throw new Error("A valid user ID is required");
  if(input.email!==undefined)throw new Error("Identity email cannot be changed; create a separate user instead");
  if(input.role!==undefined && !["reporter","agent","manager","admin"].includes(String(input.role)))throw new Error("Invalid role");
  for(const key of ["isActive","isOnCall"] as const)if(input[key]!==undefined && typeof input[key]!=="boolean")throw new Error(key+" must be a boolean");
  if(input.teamId!==undefined && input.teamId!==null && (typeof input.teamId!=="string" || !uuid.test(input.teamId)))throw new Error("Invalid team ID");
  if(input.fullName!==undefined && input.fullName!==null && (typeof input.fullName!=="string" || input.fullName.trim().length>160))throw new Error("Name must be at most 160 characters");
  return {id:input.id,fullName:input.fullName===undefined?undefined:typeof input.fullName==="string"?input.fullName.trim()||null:null,
    role:input.role as UserRole|undefined,isActive:input.isActive as boolean|undefined,teamId:input.teamId as string|null|undefined,isOnCall:input.isOnCall as boolean|undefined};
}
async function defaultOrg() {
  if(!hasDatabaseUrl())throw new Error("A database connection is required to manage the directory");
  const sql=getSql();const rows=await sql`select id::text from orgs where name='Default Operations' limit 1`;
  return rows[0]?.id as string|undefined;
}
export async function getDirectory():Promise<DirectoryData> {
  const orgId=await defaultOrg();if(!orgId)return {users:[],teams:[]};const sql=getSql();
  const [users,teams]=await Promise.all([
    sql`select u.id::text,u.email,u.full_name,u.role,u.is_active,coalesce(array_remove(array_agg(m.team_id::text),null),'{}') as team_ids,
      coalesce(bool_or(m.is_on_call),false) as is_on_call from users u left join team_members m on m.user_id=u.id
      where u.org_id=${orgId} group by u.id order by u.is_active desc,lower(coalesce(u.full_name,u.email))`,
    sql`select id::text,name from teams where org_id=${orgId} order by lower(name)`]);
  return {users:users.map(row=>({id:String(row.id),email:String(row.email),fullName:row.full_name as string|null,role:row.role as UserRole,
    isActive:Boolean(row.is_active),teamIds:row.team_ids as string[],isOnCall:Boolean(row.is_on_call),
    importedIdentity:/^(repairshopr|syncro)-.+@identity\.invalid$/.test(String(row.email))})),teams:teams.map(row=>({id:String(row.id),name:String(row.name)}))};
}
export async function updateDirectoryUser(input:DirectoryUserUpdate) {
  const orgId=await defaultOrg();if(!orgId)throw new Error("User not found in this workspace");const sql=getSql();
  const rows=await sql`
    with changed as (
      update users u set full_name=case when ${input.fullName!==undefined} then ${input.fullName??null} else u.full_name end,
        role=coalesce(${input.role??null}::text,u.role),is_active=coalesce(${input.isActive??null}::boolean,u.is_active)
      where u.id=${input.id}::uuid and u.org_id=${orgId}
        and (${input.teamId??null}::uuid is null or exists(select 1 from teams where id=${input.teamId??null}::uuid and org_id=${orgId}))
      returning u.id,u.org_id
    ), removed_memberships as (
      delete from team_members m using changed u where m.user_id=u.id and ${input.teamId!==undefined}
        and (${input.teamId??null}::uuid is null or m.team_id<>${input.teamId??null}::uuid)
    ), new_membership as (
      insert into team_members(team_id,user_id,is_on_call) select ${input.teamId??null}::uuid,id,${input.isOnCall??false} from changed
      where ${input.teamId!==undefined && input.teamId!==null}
      on conflict(team_id,user_id) do update set is_on_call=excluded.is_on_call
    ), on_call_update as (
      update team_members m set is_on_call=${input.isOnCall??false} from changed u
      where m.user_id=u.id and ${input.teamId===undefined && input.isOnCall!==undefined}
    ), audit as (
      insert into audit_logs(org_id,actor_type,entity_type,entity_id,action,metadata)
      select org_id,'user','user',id,'directory.user.updated',${JSON.stringify({...input,actor:"shared_manager_session",preservedIdentity:true})}::jsonb from changed
    ) select id::text from changed`;
  if(!rows[0])throw new Error("User or team not found in this workspace");return {id:String(rows[0].id)};
}
