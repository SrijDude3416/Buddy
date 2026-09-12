// GET /api/courses — the class catalog the onboarding "Customize" picker lists.
//
// Reads the `schedule` collection from Atlas (buddy/lib/mongo.ts). When that isn't
// configured or isn't reachable it serves the built-in list instead, and says so in
// `source` rather than pretending — same rule as the Python side's
// load_data_preferring_mongo(): a demo quietly running on static data when Mongo was
// intended is confusing, not a convenience.

import { NextResponse } from 'next/server';
import { fallbackCatalog } from '@/lib/demo-data';
import { isScheduleConfigured, listScheduleClasses, toCatalogEntry } from '@/lib/mongo';

export const runtime = 'nodejs'; // the mongodb driver is Node-only
export const dynamic = 'force-dynamic'; // the catalog is live data, never build-time

export async function GET() {
  if (isScheduleConfigured()) {
    try {
      const classes = await listScheduleClasses();
      return NextResponse.json({ courses: classes.map(toCatalogEntry), source: 'mongodb' });
    } catch (error) {
      console.error(
        `[courses] Atlas class catalog unavailable (${error instanceof Error ? error.message : error}); ` +
          'serving the built-in list.',
      );
    }
  } else {
    console.warn('[courses] SCHEDULE_MONGODB_URI/SCHEDULE_MONGODB_DB not set; serving the built-in list.');
  }
  return NextResponse.json({ courses: fallbackCatalog, source: 'fallback' });
}
