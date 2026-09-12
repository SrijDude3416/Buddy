import source from '../../test-data/schedule_test_data.json';
export const defaultAnswers = {
  classes: source.courses.map(c => c.id), focus: 'Early morning', commitment: 'None',
  style: 'Standard blocks (~1 hr)', pressure: 'Staying caught up day-to-day',
};
// Served by GET /api/courses only when the Atlas class catalog isn't configured or
// isn't reachable — see buddy/lib/mongo.ts and app/api/courses/route.ts.
export const fallbackCatalog = source.courses.map(c => ({ ...c, _id: c.id, code: c.name.slice(0, 5), department: null, units: null }));
export const preferenceEnvelope = () => ({
  user: { name: 'Demo student' }, answers: defaultAnswers,
  source: 'test-data/schedule_test_data.json', mode: process.env.OPENAI_API_KEY ? 'openai' : 'unconfigured',
});
