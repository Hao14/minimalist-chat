import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const plans = require('../functions/ai-winston-plans.js');
const indexSource = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');

test('plan markers are removed and bounded durable steps are created', () => {
  const source = `Here is the plan.\n${plans.WINSTON_PLAN_MARKER_START}
{"title":"Launch safely","steps":[{"title":"Review scope","details":"Confirm owners."},{"title":"Ship the change"}]}
${plans.WINSTON_PLAN_MARKER_END}`;
  const built = plans.createWinstonPlanRecord({
    uid: 'user-1',
    requestId: 'request-1',
    roomId: 'global',
    reply: source,
    actions: [{ id: 'action-1', type: 'create_task', status: 'proposed' }],
    now: 100,
  });
  assert.equal(built.reply, 'Here is the plan.');
  assert.equal(built.plan.steps.length, 2);
  assert.equal(built.plan.steps[0].requiresConfirmation, true);
  assert.equal(built.plan.steps[0].actionId, 'action-1');
  const visible = plans.publicWinstonPlan(built.plan);
  assert.equal(Object.hasOwn(visible.steps[0], 'actionId'), false);
  assert.equal(visible.steps[0].requiresConfirmation, true);
});

test('plan commands pause, resume, complete, undo, and fail closed on writes', () => {
  const built = plans.createWinstonPlanRecord({
    uid: 'user-1',
    requestId: 'request-2',
    reply: '1. Inspect\n2. Decide',
    now: 100,
  }).plan;
  const paused = plans.applyWinstonPlanCommand(built, { command: 'pause', expectedRevision: 1, now: 110 });
  assert.equal(paused.status, 'paused');
  const resumed = plans.applyWinstonPlanCommand(paused, { command: 'resume', expectedRevision: 2, now: 120 });
  const completed = plans.applyWinstonPlanCommand(resumed, {
    command: 'complete-step',
    stepId: resumed.steps[0].id,
    expectedRevision: 3,
    now: 130,
  });
  assert.equal(completed.steps[0].status, 'completed');
  const reopened = plans.applyWinstonPlanCommand(completed, {
    command: 'undo',
    stepId: completed.steps[0].id,
    expectedRevision: 4,
    now: 140,
  });
  assert.equal(reopened.steps[0].status, 'pending');

  const writePlan = plans.createWinstonPlanRecord({
    uid: 'user-1',
    requestId: 'request-3',
    reply: '1. Create it',
    actions: [{ id: 'action-2', type: 'create_task', status: 'proposed' }],
    now: 100,
  }).plan;
  assert.throws(
    () => plans.applyWinstonPlanCommand(writePlan, {
      command: 'complete-step',
      stepId: writePlan.steps[0].id,
      expectedRevision: 1,
    }),
    /Confirm the proposed action/,
  );
  assert.throws(
    () => plans.applyWinstonPlanCommand(writePlan, {
      command: 'undo',
      stepId: writePlan.steps[0].id,
      expectedRevision: 1,
    }),
    /cannot be safely undone/,
  );
});

test('server owns plan persistence and action confirmation', () => {
  assert.match(indexSource, /aiAgentPrivateRef\(uid, 'plans'\)/);
  assert.match(indexSource, /confirmAiAction\(uid, step\.actionId, decoded\)/);
  assert.match(indexSource, /planMode: req\.body\?\.planMode === true/);
  assert.match(plans.WINSTON_PLAN_SYSTEM_RULES, /never authorizes/i);
});
