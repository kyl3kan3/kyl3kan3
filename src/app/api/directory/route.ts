import { NextResponse } from "next/server";
import { getDirectory } from "@/lib/directory";
import { managerRequestFailure } from "@/lib/manager-request";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
  const denied=managerRequestFailure(request);if(denied)return denied;
  try {return NextResponse.json({ok:true,...await getDirectory()},{headers:{"cache-control":"no-store"}});}
  catch {return NextResponse.json({ok:false,error:"Unable to load directory. Check the database connection."},{status:503});}
}
