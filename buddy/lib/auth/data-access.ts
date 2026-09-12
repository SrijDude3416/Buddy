import { AsyncLocalStorage } from 'node:async_hooks';
import { headers } from 'next/headers';
export const requestContext = new AsyncLocalStorage<Request>();
export async function dataAccess(): Promise<{ demo: boolean; headers: Record<string, string> }> {
  const h = requestContext.getStore()?.headers ?? await headers();
  const cookies = h.get('cookie')?.split(';').map(c => c.trim()) ?? [];
  const demo = !cookies.includes('buddy_mode=live') && (cookies.includes('buddy_mode=demo') || cookies.includes('buddy_demo=1'));
  return { demo, headers: { 'X-Buddy-Mode': demo ? 'demo' : 'live' } };
}
