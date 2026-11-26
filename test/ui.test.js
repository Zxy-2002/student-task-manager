'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { makeApp } = require('./helpers');

test('served admin panel explains that on and rollout must both allow a feature', async () => {
  const res = await request(makeApp()).get('/').expect(200);
  const html = res.text;
  assert.match(html, /id="flag-help"/);
  assert.match(html, /both <strong>on<\/strong> is checked and <strong>rollout<\/strong> is greater than 0%/);
  assert.match(html, /<strong>100%<\/strong> enables it for all users/);
  assert.match(html, /<strong>0%<\/strong> enables it for nobody, even when <strong>on<\/strong> is checked/);
  assert.match(html, /regardless of the rollout percentage/);
  assert.match(html, /id="admin"/);
  // strict CSP: the page cannot carry inline handlers or style attributes
  assert.doesNotMatch(html, /onclick=/);
  assert.doesNotMatch(html, /\sstyle=/);
});

test('served task list can edit or clear priority through a CSRF-protected PATCH when the flag is on', async () => {
  const res = await request(makeApp()).get('/app.js').expect(200);
  const js = res.text;
  assert.match(js, /function priorityControl\(task\)/);
  assert.match(js, /No priority/);
  assert.match(js, /High/);
  assert.match(js, /Medium/);
  assert.match(js, /Low/);
  assert.match(js, /if \(flags\.priority_labels\) li\.append\(priorityControl\(t\)\)/);
  assert.match(js, /method:\s*'PATCH'/);
  assert.match(js, /priority:\s*sel\.value\s*\?\s*sel\.value\s*:\s*null/);
  assert.match(js, /X-CSRF-Token/);
  assert.doesNotMatch(js, /onclick="/);
  assert.doesNotMatch(js, /\.style\./);
});

test('priority control colours stay readable in the dark theme', async () => {
  const res = await request(makeApp()).get('/styles.css').expect(200);
  assert.match(res.text, /body\.theme-dark select\.priority\.High/);
  assert.match(res.text, /body\.theme-dark select\.priority\.Medium/);
  assert.match(res.text, /body\.theme-dark select\.priority\.Low/);
  assert.match(res.text, /\.flag-note/);
});
