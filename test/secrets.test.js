'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const script = path.join(__dirname, '..', 'scripts', 'check-production-secrets.sh');
const workflow = path.join(__dirname, '..', '.github', 'workflows', 'ci.yml');

const SECRET_VALUES = {
  SESSION_SECRET: 'session-value-do-not-print',
  OAUTH_GITHUB_CLIENT_ID: 'client-id-value-do-not-print',
  OAUTH_GITHUB_CLIENT_SECRET: 'client-secret-value-do-not-print',
  DEPLOY_TOKEN: 'deploy-token-value-do-not-print',
};

function runCheck(env) {
  try {
    const stdout = execFileSync('bash', [script], {
      env: { PATH: process.env.PATH, ...env },
      encoding: 'utf8',
    });
    return { status: 0, output: stdout };
  } catch (err) {
    return { status: err.status, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function assertValuesHidden(output) {
  for (const value of Object.values(SECRET_VALUES)) {
    assert.equal(output.includes(value), false, `secret value leaked: ${value}`);
  }
}

test('secret check lists every missing production GitHub Secret and hides values', () => {
  const { status, output } = runCheck({
    SESSION_SECRET: SECRET_VALUES.SESSION_SECRET,
    DEPLOY_TOKEN: SECRET_VALUES.DEPLOY_TOKEN,
  });
  assert.equal(status, 1);
  const lines = output.split('\n').filter((line) => line.startsWith('::error::Missing GitHub Secret in the production environment:'));
  assert.deepEqual(lines, [
    '::error::Missing GitHub Secret in the production environment: OAUTH_GITHUB_CLIENT_ID',
    '::error::Missing GitHub Secret in the production environment: OAUTH_GITHUB_CLIENT_SECRET',
  ]);
  assert.match(output, /Missing GitHub Secret\(s\) in the production environment: OAUTH_GITHUB_CLIENT_ID OAUTH_GITHUB_CLIENT_SECRET\./);
  assert.match(output, /production environment/);
  assert.doesNotMatch(output, /missing secret GITHUB_CLIENT_ID/);
  assert.doesNotMatch(output, /missing secret GITHUB_CLIENT_SECRET/);
  assertValuesHidden(output);
});

test('secret check succeeds without printing values when every production secret is set', () => {
  const { status, output } = runCheck(SECRET_VALUES);
  assert.equal(status, 0);
  assert.equal(output, 'all production secrets present\n');
  assertValuesHidden(output);
});

test('deploy job checks the GitHub Secret names, not the runtime GITHUB_CLIENT_* env names', () => {
  const yml = fs.readFileSync(workflow, 'utf8');
  assert.match(yml, /OAUTH_GITHUB_CLIENT_ID: \$\{\{ secrets\.OAUTH_GITHUB_CLIENT_ID \}\}/);
  assert.match(yml, /OAUTH_GITHUB_CLIENT_SECRET: \$\{\{ secrets\.OAUTH_GITHUB_CLIENT_SECRET \}\}/);
  assert.match(yml, /SESSION_SECRET: \$\{\{ secrets\.SESSION_SECRET \}\}/);
  assert.match(yml, /DEPLOY_TOKEN: \$\{\{ secrets\.DEPLOY_TOKEN \}\}/);
  assert.match(yml, /bash scripts\/check-production-secrets\.sh/);
  assert.doesNotMatch(yml, /missing secret \$v/);
  // The check must not map the OAuth secrets onto runtime env names.
  // A comment may still mention GITHUB_CLIENT_ID; only an env key counts.
  assert.doesNotMatch(yml, /^[ \t]*GITHUB_CLIENT_ID:/m);
  assert.doesNotMatch(yml, /^[ \t]*GITHUB_CLIENT_SECRET:/m);
});
