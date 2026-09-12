// ---------------------------------------------------------------------------
// One MongoClient per process, cached across hot reloads and warm serverless
// invocations. Creating a client per request exhausts the Atlas connection limit
// almost immediately on a free tier — this is the single most important thing to
// get right about Mongo on Vercel.
// ---------------------------------------------------------------------------

import { MongoClient } from 'mongodb';
import { env } from './env.js';

const globalForMongo = globalThis;

async function createClient() {
  const client = new MongoClient(env.mongoUri, {
    // Keep the pool small: many concurrent lambdas each holding a big pool is
    // how a free-tier cluster runs out of connections.
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 8000,
    retryWrites: true,
  });
  await client.connect();
  return client;
}

export function getClient() {
  if (!globalForMongo.__buddyMongoClientPromise) {
    globalForMongo.__buddyMongoClientPromise = createClient().catch((err) => {
      // Don't cache a failed connection — the next request should retry.
      globalForMongo.__buddyMongoClientPromise = undefined;
      throw err;
    });
  }
  return globalForMongo.__buddyMongoClientPromise;
}

export async function getDb() {
  const client = await getClient();
  return client.db(env.mongoDb);
}

/** The collection names from SCHEMA.md, in one place so nothing is misspelled. */
export const COLLECTIONS = {
  users: 'users',
  courses: 'courses',
  syllabusData: 'syllabus_data',
  enrollments: 'enrollments',
  tasks: 'tasks',
  preferences: 'preferences',
  sessions: 'sessions',
  chatMessages: 'chat_messages',
  optimizerRuns: 'optimizer_runs',
};

export async function collections() {
  const db = await getDb();
  return {
    db,
    users: db.collection(COLLECTIONS.users),
    courses: db.collection(COLLECTIONS.courses),
    syllabusData: db.collection(COLLECTIONS.syllabusData),
    enrollments: db.collection(COLLECTIONS.enrollments),
    tasks: db.collection(COLLECTIONS.tasks),
    preferences: db.collection(COLLECTIONS.preferences),
    sessions: db.collection(COLLECTIONS.sessions),
    chatMessages: db.collection(COLLECTIONS.chatMessages),
    optimizerRuns: db.collection(COLLECTIONS.optimizerRuns),
  };
}
