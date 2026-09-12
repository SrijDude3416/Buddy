import { NextResponse } from "next/server";
import { applyPreferenceOperations } from "@/lib/fastapi";
import type { PreferenceOperation } from "@/lib/types";
export async function POST(request: Request) { try { const body = await request.json() as { operations?: unknown }; if (!Array.isArray(body.operations)) return NextResponse.json({ error: "operations must be an array" }, { status: 400 }); return NextResponse.json(await applyPreferenceOperations(body.operations as PreferenceOperation[])); } catch (error) { console.error(error); return NextResponse.json({ error: "Unable to save preferences." }, { status: 502 }); } }
