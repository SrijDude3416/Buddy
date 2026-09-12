// One-off setup: create indexes and seed the shared course catalog.
// Run once after pointing MONGODB_URI at a cluster:  npm run indexes
// Uses node's built-in --env-file (see package.json) rather than a dotenv dep.

const { ensureSeeded, ensureIndexes } = await import('../lib/seed.js');
const { getClient } = await import('../lib/mongo.js');

await ensureIndexes();
console.log('indexes created');
await ensureSeeded();
console.log('catalog seeded');
(await getClient()).close();
