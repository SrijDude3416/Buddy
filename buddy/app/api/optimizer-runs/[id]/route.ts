import { NextResponse } from "next/server";
import { getOptimizerRun } from "@/lib/fastapi";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) { try { return NextResponse.json(await getOptimizerRun((await params).id)); } catch (error) { console.error(error); return NextResponse.json({ error: "Unable to fetch optimizer run." }, { status: 502 }); } }
