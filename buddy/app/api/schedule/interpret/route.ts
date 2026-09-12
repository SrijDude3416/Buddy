import { NextResponse } from "next/server";
import { interpretScheduleInput } from "@/lib/chatgpt";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { input?: unknown };
    if (typeof body.input !== "string" || !body.input.trim()) {
      return NextResponse.json({ error: "input must be a non-empty string" }, { status: 400 });
    }
    return NextResponse.json(await interpretScheduleInput(body.input.trim()));
  } catch (error) {
    console.error("OpenAI interpretation failed", error);
    if (typeof error === "object" && error !== null && "status" in error && error.status === 429) {
      return NextResponse.json(
        { error: "OpenAI API quota is unavailable. Add credits to the project and retry." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Unable to interpret schedule input." }, { status: 500 });
  }
}
