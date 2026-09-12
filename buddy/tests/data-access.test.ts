import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataAccess, requestContext } from '../lib/auth/data-access';
test('live access needs no credentials, and Demo explicitly selects test data', async () => {
  delete process.env.SESSION_SECRET;
  for (const cookie of ['', 'buddy_mode=live', 'buddy_mode=demo', 'buddy_demo=1']) {
    await requestContext.run(new Request('http://buddy.test', { headers: { Cookie: cookie } }), async () => {
      const demo = cookie === 'buddy_mode=demo' || cookie === 'buddy_demo=1';
      assert.deepEqual(await dataAccess(), { demo, headers: { 'X-Buddy-Mode': demo ? 'demo' : 'live' } });
    });
  }
});
