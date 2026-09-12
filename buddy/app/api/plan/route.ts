import { NextResponse } from "next/server";
import { getPlan } from "@/lib/fastapi";
export async function GET() { try { return NextResponse.json(await getPlan()); } catch (error) { console.error(error); return NextResponse.json({ error: "Unable to fetch plan." }, { status: 502 }); } }
