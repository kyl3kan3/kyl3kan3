import { NextResponse } from "next/server";
import { createUser, parseCreateUserInput } from "@/lib/operations";
import { managerRequestFailure } from "@/lib/manager-request";
import { parseDirectoryUserUpdate, updateDirectoryUser } from "@/lib/directory";

export const dynamic = "force-dynamic";

export async function PATCH(request:Request) {
  const denied=managerRequestFailure(request);if(denied)return denied;
  try {
    const payload=await request.json() as Record<string,unknown>;
    const user=await updateDirectoryUser(parseDirectoryUserUpdate(payload));
    return NextResponse.json({ok:true,user});
  } catch(error) {
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Unable to update user"},{status:400});
  }
}

export async function POST(request: Request) {
  const denied = managerRequestFailure(request);
  if (denied) return denied;
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const user = await createUser(parseCreateUserInput(payload));

    return NextResponse.json({ ok: true, user }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to create user",
      },
      { status: 400 },
    );
  }
}
