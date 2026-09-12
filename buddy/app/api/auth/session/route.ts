// This endpoint restores the selected experience; it does not authenticate.
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const cookies = request.headers.get('cookie')?.split(';').map(c => c.trim()) ?? [];
  const mode = cookies.includes('buddy_mode=live') ? 'live' : cookies.includes('buddy_mode=demo') || cookies.includes('buddy_demo=1') ? 'demo' : null;
  return NextResponse.json({ auth_mode: mode ?? 'live', user: mode ? { id: mode, name: mode === 'demo' ? 'Demo student' : 'Your planner', email: '', picture: null } : null });
}
