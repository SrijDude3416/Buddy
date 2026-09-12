const { chromium } = require('@playwright/test');
(async () => {
 const browser = await chromium.launch({ headless: true, channel: process.env.BUDDY_BROWSER_CHANNEL || 'msedge' });
 try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let preferences = 0;
  await page.route('**/api/preferences', async route => {
   preferences++;
   await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Smoke test: optimizer unavailable' }) });
  });
  await page.goto(process.env.BUDDY_SMOKE_URL || 'http://localhost:3103');
  await page.getByRole('button', { name: 'Get started', exact: true }).waitFor();
  if (preferences !== 0) throw Error('Preferences loaded before choosing a mode');
  if (!(await page.getByRole('button', { name: 'Get started', exact: true }).isEnabled())) throw Error('Get started disabled');
  await page.screenshot({ path: 'test-results/sign-in.png' });
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Exit demo', exact: true }).click();
  await page.getByRole('button', { name: 'Get started', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  if (!(await page.context().cookies()).some(c => c.name === 'buddy_mode' && c.value === 'live')) throw Error('Live mode missing');
  await page.getByRole('button', { name: 'Back to start', exact: true }).click();
  await page.getByRole('button', { name: 'Get started', exact: true }).waitFor();
  if (preferences < 2 || errors.length) throw Error(JSON.stringify({ preferences, errors }));
  console.log('Browser passed: Get started, Demo, load-error recovery, return to start.');
 } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

