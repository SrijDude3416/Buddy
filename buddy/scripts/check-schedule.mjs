// Read-only connection check for the Atlas class catalog.
//
//   node --env-file=buddy/.env.local buddy/scripts/check-schedule.mjs
//
// Answers "is the connection working?" without a UI round trip. Note that an IP
// missing from Atlas's Network Access list surfaces as a TLS handshake error
// (TLSV1_ALERT_INTERNAL_ERROR), not a clean "unauthorized" — see the repo README.

import { MongoClient } from 'mongodb';

const uri = process.env.SCHEDULE_MONGODB_URI;
const dbName = process.env.SCHEDULE_MONGODB_DB;
const collectionName = process.env.SCHEDULE_MONGODB_COLLECTION || 'schedule';

if (!uri || !dbName) {
  console.error('SCHEDULE_MONGODB_URI and SCHEDULE_MONGODB_DB must both be set.');
  console.error('Copy buddy/.env.example to buddy/.env.local and fill them in, then pass --env-file=buddy/.env.local.');
  process.exit(1);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
try {
  await client.connect();
  const collection = client.db(dbName).collection(collectionName);
  const total = await collection.countDocuments();
  console.log(`Connected to ${dbName}.${collectionName}: ${total} document${total === 1 ? '' : 's'}.`);

  const sample = await collection.find({}, { limit: 5 }).toArray();
  for (const doc of sample) {
    const lectures = doc.lecture?.length ?? 0;
    const recitations = doc.recitation?.length ?? 0;
    console.log(`  ${doc.course_id ?? '(no course_id)'}  ${doc.course_title ?? '(no course_title)'}`);
    console.log(`      ${lectures} lecture${lectures === 1 ? '' : 's'}, ${recitations} recitation${recitations === 1 ? '' : 's'}`);
  }

  const needChoice = await collection.countDocuments({
    $or: [{ 'lecture.1': { $exists: true } }, { 'recitation.1': { $exists: true } }],
  });
  console.log(`${needChoice} course(s) offer more than one section, so the picker asks which is yours.`);

  const usable = await collection.countDocuments({
    course_id: { $exists: true, $ne: null },
    course_title: { $exists: true, $ne: null },
  });
  if (usable < total) {
    console.warn(`${total - usable} document(s) are missing course_id or course_title and will be skipped by the picker.`);
  }
  if (usable === 0) {
    console.error('No usable classes — the picker would fall back to the built-in list.');
    process.exit(1);
  }
} catch (error) {
  console.error(`Could not read ${dbName}.${collectionName}: ${error.message}`);
  process.exit(1);
} finally {
  await client.close();
}
