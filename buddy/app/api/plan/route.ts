import { NextResponse } from 'next/server';
import { getDefaultPreferences } from '@/lib/fastapi';
export const maxDuration = 180;
export async function GET(request: Request) {
  try { return NextResponse.json((await getDefaultPreferences(request.signal)).plan); }
  catch { return NextResponse.json({ message: 'Could not load the optimizer calendar.' }, { status: 502 }); }
}
