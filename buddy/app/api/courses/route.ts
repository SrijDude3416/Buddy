import { NextResponse } from 'next/server';
import { catalog } from '@/lib/demo-data';
export async function GET() { return NextResponse.json({ courses: catalog }); }
