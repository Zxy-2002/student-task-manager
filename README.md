# student-task-manager

DevSecOps final project — Student Task Management Website.

Course project for **DevSecOps – Assignment 10 (HDD + Feature Toggles)**.
A small task list for students, with two features behind server-side feature flags:

| Flag | OFF | ON |
|------|-----|----|
| `dark_mode` | light theme | dark theme |
| `priority_labels` | no priority field (API strips it, writes return **403**) | High / Medium / Low badges |

## Stack
Node.js 22+ · Express 5 · Passport + GitHub OAuth 2.0 · express-session (server-side sessions) · helmet · express-rate-limit · node:test + supertest.

## Quick start (local)

```bash
npm ci
cp .env.example .env          # then fill in the values (never commit .env)
npm run dev                   # http://localhost:3000
npm test                      # 29 tests: flags, RBAC, 403 for hidden feature, CSRF, ownership, validation
npm audit --audit-level=high
```

No OAuth app yet? Put `DEV_LOGIN=1` in `.env` and open `http://localhost:3000/?dev`.
That demo login is **hard-disabled when `NODE_ENV=production`**.
To try the admin panel, put the numeric id you type there into `ADMIN_GITHUB_IDS`.

### Register the GitHub OAuth app
1. GitHub → Settings → Developer settings → OAuth Apps → *New OAuth App*.
2. Homepage URL `http://localhost:3000`, callback URL `http://localhost:3000/auth/github/callback`.
3. Copy the Client ID and generate a Client Secret into `.env`.
4. Find your numeric GitHub id at `https://api.github.com/users/<username>` and add it to `ADMIN_GITHUB_IDS`.

## Security design (summary)

![Student Task Manager security architecture: trust boundaries and secret flow](docs/security-diagram.png)

The diagram shows the four zones (untrusted browser, trusted Express app, GitHub OAuth, and GitHub Actions / secrets), the request path through helmet, authentication, RBAC, the flag module, and the task API, and where `SESSION_SECRET`, OAuth credentials, and `DEPLOY_TOKEN` live.

* **Authentication** – GitHub OAuth 2.0 authorization-code flow with `state`; no scopes requested (public profile only); the GitHub access token is not stored.
* **Sessions** – server-side `express-session`; the cookie `stm.sid` only holds a random id and is `HttpOnly`, `SameSite=Lax`, `Secure` in production; session id is regenerated at login (session fixation).
* **Authorization (RBAC)** – `student` (own tasks) and `admin` (+ change flags). Admins = numeric GitHub ids in `ADMIN_GITHUB_IDS`; role is recomputed on every request.
* **Feature flags** – `flags.json` + `src/flags.js`: `enabled:false` = kill switch, `rollout` = % of users via `sha256(flag:userId) % 100`. Only `PUT /api/admin/flags/:name` (admin) can change them.
* **Server-side enforcement** – when `priority_labels` is OFF for the user, the API never returns `priority` and any write containing `priority` gets **403**. Hiding the dropdown in the UI is just UX.
* **CSRF** – SameSite=Lax plus a per-session synchronizer token (`X-CSRF-Token`) on every non-GET API call.
* **Other** – helmet (strict CSP), rate limits on `/auth` and `/api`, 10 kB JSON limit, input validation, ownership check returns 404 for other users' tasks.
* **SCA** – `.github/dependabot.yml` (npm + github-actions, weekly) and `npm audit --audit-level=high` in CI.
* **Secrets** – only in `.env` locally (git-ignored) and in GitHub Secrets / the `production` environment in CI; the app refuses to start in production without `SESSION_SECRET`.

## API

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/api/me` | anyone | current user + role |
| GET | `/api/csrf-token` | anyone | token for `X-CSRF-Token` |
| GET | `/api/flags` | anyone | flags evaluated for you; admins also get raw config |
| PUT | `/api/admin/flags/:name` | admin | `{ "enabled": true, "rollout": 20 }` |
| GET/POST | `/api/tasks` | logged in | own tasks only |
| GET/PATCH/DELETE | `/api/tasks/:id` | owner | 404 if not yours |
| POST | `/api/logout` | logged in | destroys the session |

## Repository settings to turn on (manual, needs repo admin)
* Settings → Code security → **Dependabot alerts** and **Dependabot security updates**: Enable
* Settings → Code security → **Secret scanning** and **Push protection**: Enable
* Settings → Environments → create **production**, add required reviewer, add secrets
  `SESSION_SECRET`, `OAUTH_GITHUB_CLIENT_ID`, `OAUTH_GITHUB_CLIENT_SECRET`, `DEPLOY_TOKEN`
  (secret names cannot start with `GITHUB_`, hence the `OAUTH_` prefix).

## Planned (not built yet)
PostgreSQL task storage + `connect-pg-simple` session store, persistent audit log for flag changes, OpenFeature/Unleash instead of the homemade flag file, CodeQL scanning, deployment to a real host.

## Team Pull Request and Review Workflow

To maintain code quality and support team collaboration,
all members follow this workflow:

1. Create and assign a GitHub issue.
2. Create a separate branch from main.
3. Implement changes and commit them.
4. Open a pull request using the PR template.
5. Link the related issue and provide test evidence.
6. Request a review from at least one teammate.
7. Respond to review comments and make necessary fixes.
8. Merge only after approval and passing CI checks.

### Review Requirements

- At least one teammate approval is required.
- All required CI status checks must pass.
- Review comments should be specific and constructive.
- The proposed review response time is one working day.
- Direct commits to main should be avoided.
