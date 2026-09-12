import { test, expect, type APIResponse, type Response } from '@playwright/test';

async function chatResult(response: Response | APIResponse) {
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  return events.find(e => e.type === 'result');
}

test('confirm defaults → chat → calendar changes → second chat → undo → reset', async ({ page }) => {
  const chatResults: any[] = [];
  // Capture the streamed HTTP body through Playwright's request client; Chromium
  // can discard the Network response body before response.text() reads it.
  await page.route('**/api/chat/messages', async route => {
    const response = await route.fetch();
    chatResults.push(await chatResult(response));
    await route.fulfill({ response });
  });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const loaded = page.waitForResponse(r => r.url().endsWith('/api/preferences') && r.request().method() === 'GET');
  await page.goto('/');
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  expect((await loaded).status()).toBe(200);
  await page.getByRole('button', { name: 'Confirm preferences & view calendar' }).click();
  await expect(page.getByText('Demo week: September')).toBeVisible();
  const blocks = page.locator('[data-event-id]');
  await expect(blocks.first()).toBeVisible();
  const before = await blocks.evaluateAll(nodes => nodes.map(n => ({ id: n.getAttribute('data-event-id'), start: n.getAttribute('data-start') })));
  await page.getByRole('button', { name: 'Open chat with Buddy' }).click();
  await page.getByRole('textbox', { name: 'Message Buddy' }).fill('I hate studying in the morning. Move important work later.');
  const chat = page.waitForResponse(r => r.url().endsWith('/api/chat/messages'));
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const response = await chat;
  expect(response.status()).toBe(200);
  const result = chatResults[0];
  expect(result.mode).toBe('openai');
  expect(result.plan.run.engine).toBe('CP-SAT');
  expect(result.preference_calls[0].endpoint).toBe('/tools/set_preferred_work_hours');
  expect(result.plan.preferences[0].arguments.start_time).toBe('17:00');
  assertSolverPlan(result.plan);
  await expect(page.getByRole('status')).toContainText('Calendar rebuilt by CP-SAT');
  const after = await blocks.evaluateAll(nodes => nodes.map(n => ({ id: n.getAttribute('data-event-id'), start: n.getAttribute('data-start') })));
  expect(after).not.toEqual(before);
  await page.getByRole('textbox', { name: 'Message Buddy' }).fill('Keep Friday 7 PM to midnight free');
  const second = page.waitForResponse(r => r.url().endsWith('/api/chat/messages'));
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await second;
  const protectedPlan = chatResults[1];
  expect(protectedPlan.preference_calls[0].endpoint).toBe('/tools/protect_time_block');
  assertSolverPlan(protectedPlan.plan);
  for (const session of protectedPlan.plan.sessions.filter((s: any) => s.type === 'flexible')) {
    const date = new Date(session.start);
    expect(date.getDay() === 5 && session.end.slice(11,16) > '19:00').toBe(false);
  }
  await expect(page.getByRole('status')).toContainText('Calendar rebuilt by CP-SAT');
  await page.getByRole('button', { name: 'Close chat' }).click();
  await page.getByRole('button', { name: 'Undo last schedule change' }).first().click();
  expect(await blocks.evaluateAll(nodes => nodes.map(n => ({ id: n.getAttribute('data-event-id'), start: n.getAttribute('data-start') })))).toEqual(after);
  await page.screenshot({ path: 'test-results/buddy-calendar.png', fullPage: true });
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm preferences & view calendar' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('custom onboarding retains selected courses and loads a plan', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await page.getByRole('button', { name: 'Evening', exact: true }).click();
  await page.getByRole('button', { name: 'None', exact: true }).click();
  await page.getByRole('button', { name: 'Short bursts (25-30 min)', exact: true }).click();
  await page.getByRole('button', { name: 'An upcoming exam', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open chat with Buddy' })).toBeVisible();
  await expect(page.locator('[data-event-id]').first()).toBeAttached();
});

test('chat failure preserves calendar and restores the draft for retry', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm preferences & view calendar' }).click();
  await expect(page.locator('[data-event-id]').first()).toBeAttached();
  const before = await page.locator('[data-event-id]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-start')));
  await page.route('**/api/chat/messages', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'AI service unavailable. Calendar unchanged.' }) }));
  await page.getByRole('button', { name: 'Open chat with Buddy' }).click();
  await page.getByRole('textbox', { name: 'Message Buddy' }).fill('Move morning study later');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('AI service unavailable. Calendar unchanged.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message Buddy' })).toHaveValue('Move morning study later');
  expect(await page.locator('[data-event-id]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-start')))).toEqual(before);
});


test('waiting remains interactive and Stop keeps the schedule and next draft intact', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm preferences & view calendar' }).click();
  await expect(page.locator('[data-event-id]').first()).toBeAttached();
  const before = await page.locator('[data-event-id]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-start')));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/chat/messages', async route => { await gate; await route.abort().catch(() => {}); });
  await page.getByRole('button', { name: 'Open chat with Buddy' }).click();
  await page.getByRole('textbox', { name: 'Message Buddy' }).fill('Move morning study later');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  try {
    await expect(page.getByRole('status')).toContainText('Sending your feedback');
    await expect(page.getByRole('button', { name: 'Stop request' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Message Buddy' }).fill('Actually, give me shorter study blocks');
    await page.getByRole('button', { name: 'Stop request' }).click();
    await expect(page.getByText('Stopped. Your calendar is unchanged.', { exact: false })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message Buddy' })).toHaveValue('Actually, give me shorter study blocks');
    expect(await page.locator('[data-event-id]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-start')))).toEqual(before);
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  } finally { release(); }
});

function assertSolverPlan(plan: any) {
  expect(['FEASIBLE', 'OPTIMAL']).toContain(plan.run.solverStatus);
  expect(plan.tasks.length).toBeGreaterThan(30);
  const tasks = new Map(plan.tasks.map((t: any) => [t._id, t]));
  const ordered = [...plan.sessions].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 0; i < ordered.length; i++) {
    const session = ordered[i];
    if (session.task_id) {
      expect(tasks.has(session.task_id)).toBe(true);
      expect(session.end <= (tasks.get(session.task_id) as any).due_at).toBe(true);
    }
    if (i && !(session.locked && ordered[i-1].locked)) expect(session.start >= ordered[i-1].end).toBe(true);
  }
}
