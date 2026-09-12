import { NextResponse } from "next/server";
import { createOptimizerRun } from "@/lib/fastapi";
export async function POST() { try { return NextResponse.json(await createOptimizerRun(), { status: 202 }); } catch (error) { console.error(error); return NextResponse.json({ error: "Unable to start optimizer." }, { status: 502 }); } }
