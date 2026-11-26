'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { makeApp, login, tempFlags, ADMIN_ID, STUDENT_ID, STUDENT2_ID } = require('./helpers');

test('anonymous users cannot read tasks (401)', async () => {
  await request(makeApp()).get('/api/tasks').expect(401);
});

test('priority_labels OFF: API strips priority and rejects writes with 403', async () => {
  const app = makeApp();
  const { agent, csrf } = await login(app, STUDENT_ID);

  // creating a task WITH priority is refused, even if someone un-hides the button in DevTools
  const denied = await agent.post('/api/tasks').set('X-CSRF-Token', csrf).send({ title: 'Essay', priority: 'High' }).expect(403);
  assert.match(denied.body.error, /priority_labels/);

  const created = await agent.post('/api/tasks').set('X-CSRF-Token', csrf).send({ title: 'Essay' }).expect(201);
  assert.equal(Object.hasOwn(created.body, 'priority'), false);

  await agent.patch(`/api/tasks/${created.body.id}`).set('X-CSRF-Token', csrf).send({ priority: 'Low' }).expect(403);
  await agent.patch(`/api/tasks/${created.body.id}`).set('X-CSRF-Token', csrf).send({ priority: null }).expect(403);

  const list = await agent.get('/api/tasks').expect(200);
  assert.equal(list.body.tasks.length, 1);
  assert.equal(Object.hasOwn(list.body.tasks[0], 'priority'), false);
});

test('priority_labels ON: PATCH sets, changes, and clears priority without dropping other fields', async () => {
  const app = makeApp({ dark_mode: { enabled: true, rollout: 100 }, priority_labels: { enabled: true, rollout: 100 } });
  const { agent, csrf } = await login(app, STUDENT_ID);
  const created = await agent.post('/api/tasks').set('X-CSRF-Token', csrf).send({ title: 'Essay' }).expect(201);
  assert.equal(created.body.priority, null);

  const high = await agent.patch(`/api/tasks/${created.body.id}`).set('X-CSRF-Token', csrf).send({ priority: 'High' }).expect(200);
  assert.equal(high.body.priority, 'High');
  assert.equal(high.body.title, 'Essay');

  const low = await agent.patch(`/api/tasks/${created.body.id}`).set('X-CSRF-Token', csrf).send({ priority: 'Low' }).expect(200);
  assert.equal(low.body.priority, 'Low');

  // a done-only update must keep the priority that was just saved
  const done = await agent.patch(`/api/tasks/${created.body.id}`).set('X-CSRF-Token', csrf).send({ done: true }).expect(200);
  assert.equal(done.body.done, true);
  assert.equal(done.body.priority, 'Low');

  const cleared = await agent.patch(`/api/tasks/${created.body.id}`).set('X-CSRF-Token', csrf).send({ priority: null }).expect(200);
  assert.equal(cleared.body.priority, null);
  assert.equal(cleared.body.done, true);

  const list = await agent.get('/api/tasks').expect(200);
  assert.equal(list.body.tasks[0].priority, null);
  assert.equal(list.body.tasks[0].done, true);

  await agent.patch(`/api/tasks/${created.body.id}`).set('X-CSRF-Token', csrf).send({ priority: 'Urgent' }).expect(400);
  const still = await agent.get(`/api/tasks/${created.body.id}`).expect(200);
  assert.equal(still.body.priority, null);
});

test('non-admin cannot toggle a flag (403); admin can (200)', async () => {
  const app = makeApp();
  const student = await login(app, STUDENT_ID);
  await student.agent.put('/api/admin/flags/priority_labels').set('X-CSRF-Token', student.csrf).send({ enabled: true, rollout: 100 }).expect(403);

  const admin = await login(app, ADMIN_ID, 'cheng');
  const res = await admin.agent.put('/api/admin/flags/priority_labels').set('X-CSRF-Token', admin.csrf).send({ enabled: true, rollout: 100 }).expect(200);
  assert.equal(res.body.enabled, true);

  // after the admin turns it on, the student can use priority
  const t = await student.agent.post('/api/tasks').set('X-CSRF-Token', student.csrf).send({ title: 'Lab report', priority: 'High' }).expect(201);
  assert.equal(t.body.priority, 'High');
});

test('admin kill switch turns a live feature OFF immediately', async () => {
  const app = makeApp({ dark_mode: { enabled: true, rollout: 100 }, priority_labels: { enabled: true, rollout: 100 } });
  const student = await login(app, STUDENT_ID);
  await student.agent.post('/api/tasks').set('X-CSRF-Token', student.csrf).send({ title: 'Quiz', priority: 'Medium' }).expect(201);

  const admin = await login(app, ADMIN_ID);
  await admin.agent.put('/api/admin/flags/priority_labels').set('X-CSRF-Token', admin.csrf).send({ enabled: false }).expect(200);

  const list = await student.agent.get('/api/tasks').expect(200);
  assert.equal(Object.hasOwn(list.body.tasks[0], 'priority'), false);
  const flags = await student.agent.get('/api/flags').expect(200);
  assert.deepEqual(flags.body.flags, { dark_mode: true, priority_labels: false });
});

test('only admins see raw flag config', async () => {
  const app = makeApp();
  const student = await login(app, STUDENT_ID);
  const s = await student.agent.get('/api/flags').expect(200);
  assert.equal(s.body.config, undefined);
  const admin = await login(app, ADMIN_ID);
  const a = await admin.agent.get('/api/flags').expect(200);
  assert.ok(a.body.config.priority_labels);
});

test('users cannot read or edit another student\'s task (404)', async () => {
  const app = makeApp();
  const a = await login(app, STUDENT_ID);
  const b = await login(app, STUDENT2_ID);
  const t = await a.agent.post('/api/tasks').set('X-CSRF-Token', a.csrf).send({ title: 'Mine' }).expect(201);
  await b.agent.get(`/api/tasks/${t.body.id}`).expect(404);
  await b.agent.patch(`/api/tasks/${t.body.id}`).set('X-CSRF-Token', b.csrf).send({ title: 'hacked' }).expect(404);
  await b.agent.delete(`/api/tasks/${t.body.id}`).set('X-CSRF-Token', b.csrf).expect(404);
  const list = await b.agent.get('/api/tasks').expect(200);
  assert.equal(list.body.tasks.length, 0);
});

test('state-changing request without CSRF token is rejected (403)', async () => {
  const app = makeApp();
  const { agent, csrf } = await login(app, STUDENT_ID);
  await agent.post('/api/tasks').send({ title: 'no token' }).expect(403);
  await agent.post('/api/tasks').set('X-CSRF-Token', 'x'.repeat(64)).send({ title: 'bad token' }).expect(403);
  // a token from one session must not work in another
  const other = await login(app, STUDENT2_ID);
  await agent.post('/api/tasks').set('X-CSRF-Token', other.csrf).send({ title: 'borrowed token' }).expect(403);
  // and the real token still works, so the checks above are not false positives
  await agent.post('/api/tasks').set('X-CSRF-Token', csrf).send({ title: 'good token' }).expect(201);
});

test('a non-ASCII CSRF token is rejected with 403, not a 500 crash', async () => {
  // 'Ã' is one character but two UTF-8 bytes: comparing character lengths used
  // to let it reach timingSafeEqual, which throws on a byte-length mismatch.
  const app = makeApp();
  const { agent, csrf } = await login(app, STUDENT_ID);
  await agent.post('/api/tasks').set('X-CSRF-Token', 'Ã'.repeat(csrf.length)).send({ title: 'crash?' }).expect(403);
  await agent.post('/api/tasks').set('X-CSRF-Token', 'é'.repeat(csrf.length / 2)).send({ title: 'crash?' }).expect(403);
});

test('a valid CSRF token is not a login: anonymous flag write is 401', async () => {
  const app = makeApp();
  const anon = request.agent(app);
  const { body } = await anon.get('/api/csrf-token').expect(200);
  await anon.put('/api/admin/flags/dark_mode').set('X-CSRF-Token', body.csrfToken).send({ enabled: false }).expect(401);
  await anon.post('/api/tasks').set('X-CSRF-Token', body.csrfToken).send({ title: 'anon' }).expect(401);
  const me = await anon.get('/api/me').expect(200);
  assert.equal(me.body.user, null);
});

test('admin is not a superuser: admins cannot read other users\' tasks (404)', async () => {
  const app = makeApp();
  const student = await login(app, STUDENT_ID);
  const t = await student.agent.post('/api/tasks').set('X-CSRF-Token', student.csrf).send({ title: 'private' }).expect(201);
  const admin = await login(app, ADMIN_ID, 'cheng');
  await admin.agent.get(`/api/tasks/${t.body.id}`).expect(404);
  await admin.agent.delete(`/api/tasks/${t.body.id}`).set('X-CSRF-Token', admin.csrf).expect(404);
  const list = await admin.agent.get('/api/tasks').expect(200);
  assert.equal(list.body.tasks.length, 0);
});

test('an unknown flag name cannot be created (404)', async () => {
  const app = makeApp();
  const admin = await login(app, ADMIN_ID);
  const res = await admin.agent.put('/api/admin/flags/is_admin').set('X-CSRF-Token', admin.csrf).send({ enabled: true }).expect(404);
  assert.match(res.body.error, /unknown flag/);
  const flags = await admin.agent.get('/api/flags').expect(200);
  assert.equal(flags.body.config.is_admin, undefined);
});

test('task input is validated and the owner id cannot be spoofed', async () => {
  const app = makeApp({ priority_labels: { enabled: true, rollout: 100 } });
  const { agent, csrf } = await login(app, STUDENT_ID);
  const post = (body) => agent.post('/api/tasks').set('X-CSRF-Token', csrf).send(body);

  await post({}).expect(400);
  await post({ title: '   ' }).expect(400);
  await post({ title: 'a'.repeat(201) }).expect(400);
  await post({ title: 'ok', done: 'yes' }).expect(400);
  await post({ title: 'ok', priority: 'Urgent' }).expect(400);

  // the title is trimmed, and 200 characters plus padding is still valid
  const created = await post({ title: `  ${'a'.repeat(200)}  `, ownerId: 'gh:9999', id: 'chosen-by-client' }).expect(201);
  assert.equal(created.body.title, 'a'.repeat(200));
  assert.notEqual(created.body.id, 'chosen-by-client');
  assert.equal(created.body.ownerId, undefined);

  // the spoofed owner id was ignored, so the task still belongs to the caller
  const list = await agent.get('/api/tasks').expect(200);
  assert.equal(list.body.tasks.length, 1);
});

test('logout destroys the session', async () => {
  const app = makeApp();
  const { agent, csrf } = await login(app, STUDENT_ID);
  await agent.post('/api/logout').set('X-CSRF-Token', csrf).expect(200);
  const me = await agent.get('/api/me').expect(200);
  assert.equal(me.body.user, null);
  await agent.get('/api/tasks').expect(401);
  // the old CSRF token died with the session
  await agent.post('/api/tasks').set('X-CSRF-Token', csrf).send({ title: 'after logout' }).expect(403);
});

test('session id is regenerated at login (session fixation)', async () => {
  const app = makeApp();
  const agent = request.agent(app);
  const sidOf = (res) => /stm\.sid=([^;]+)/.exec((res.headers['set-cookie'] || []).join(';'))?.[1];
  const before = sidOf(await agent.get('/api/csrf-token').expect(200));
  const after = sidOf(await agent.post('/auth/dev-login').send({ githubId: STUDENT_ID }).expect(200));
  assert.ok(before, 'anonymous visit should set a session cookie');
  assert.ok(after, 'login should set a new session cookie');
  assert.notEqual(after, before);
});

test('dev login rejects a login name that could forge an audit log line', async () => {
  const app = makeApp();
  await request(app).post('/auth/dev-login').send({ githubId: ADMIN_ID, login: 'evil\n[audit] forged' }).expect(400);
  await request(app).post('/auth/dev-login').send({ githubId: 'not-a-number' }).expect(400);
});

test('hardening headers are set and the server does not advertise itself', async () => {
  const res = await request(makeApp()).get('/healthz').expect(200);
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.match(res.headers['content-security-policy'], /default-src 'self'/);
  assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('oversized JSON bodies are refused (413)', async () => {
  const app = makeApp();
  const { agent, csrf } = await login(app, STUDENT_ID);
  await agent.post('/api/tasks').set('X-CSRF-Token', csrf).send({ title: 'x'.repeat(20000) }).expect(413);
});

test('OAuth routes answer 503 when no OAuth app is configured', async () => {
  const app = makeApp();
  await request(app).get('/auth/github').expect(503);
  await request(app).get('/auth/github/callback?code=abc&state=xyz').expect(503);
});

test('session cookie is HttpOnly and SameSite=Lax', async () => {
  const res = await request(makeApp()).post('/auth/dev-login').send({ githubId: STUDENT_ID }).expect(200);
  const cookie = res.headers['set-cookie'].join(';');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
});

test('dev login is disabled in production', async () => {
  const app = createApp({
    flagsPath: tempFlags({}),
    env: {
      NODE_ENV: 'production', DEV_LOGIN: '1', SESSION_SECRET: 'p'.repeat(40),
      GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret', GITHUB_CALLBACK_URL: 'https://example.com/auth/github/callback',
    },
  });
  await request(app).post('/auth/dev-login').send({ githubId: '1' }).expect(404);
});

test('production refuses to start without SESSION_SECRET', () => {
  assert.throws(() => createApp({ flagsPath: tempFlags({}), env: { NODE_ENV: 'production' } }), /SESSION_SECRET/);
});
