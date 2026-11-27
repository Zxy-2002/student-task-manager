'use strict';
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { Passport } = require('passport');
const { Strategy: GitHubStrategy } = require('passport-github2');

const { createFlagStore } = require('./flags');
const { createTaskStore, PRIORITIES } = require('./tasks');
const { parseAdminIds, roleFor, requireAuth, requirePermission } = require('./rbac');
const { issueToken, verifyCsrf } = require('./csrf');

// TRUST_PROXY: empty, "0" or "false" = off; a positive integer = number of proxy hops to trust;
// any other value (e.g. "1" or "true") = trust one hop. Previously "0" turned it ON (Number("0") || 1).
function parseTrustProxy(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === '' || v === '0' || v === 'false') return 0;
  return /^\d+$/.test(v) ? Number(v) : 1;
}

function createApp(options = {}) {
  const env = options.env || process.env;
  const isProd = env.NODE_ENV === 'production';
  const flags = options.flagStore || createFlagStore(options.flagsPath || path.join(__dirname, '..', 'flags.json'));
  const tasks = options.taskStore || createTaskStore();
  const adminIds = parseAdminIds(env.ADMIN_GITHUB_IDS);
  const passport = new Passport(); // one instance per app (no global state between tests)

  // ---- fail fast on missing secrets (never fall back to a default secret in prod)
  if (isProd) {
    for (const key of ['SESSION_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_CALLBACK_URL']) {
      if (!env[key]) throw new Error(`Missing required env var ${key}`);
    }
    if (env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  }

  const app = express();
  app.disable('x-powered-by');
  const trustProxy = parseTrustProxy(env.TRUST_PROXY);
  if (trustProxy) app.set('trust proxy', trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https://avatars.githubusercontent.com'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'", 'https://github.com'],
        },
      },
    })
  );
  app.use(express.json({ limit: '10kb' }));

  // ---- server-side session (cookie only carries a random session id)
  app.use(
    session({
      name: 'stm.sid',
      secret: env.SESSION_SECRET || 'dev-only-insecure-secret-change-me',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true, // JS cannot read the cookie (limits XSS token theft)
        secure: isProd, // HTTPS only in production
        sameSite: 'lax', // not sent on cross-site POST/fetch
        maxAge: 8 * 60 * 60 * 1000, // 8 hours
      },
      // NOTE: default MemoryStore is fine for class demo only; production plan = connect-pg-simple
    })
  );

  // ---- authentication: GitHub OAuth 2.0 (authorization code flow)
  passport.serializeUser((user, done) => done(null, { githubId: user.githubId, login: user.login, avatar: user.avatar }));
  // Role is recomputed on every request, so removing someone from ADMIN_GITHUB_IDS takes effect immediately.
  passport.deserializeUser((u, done) => done(null, { ...u, id: `gh:${u.githubId}`, role: roleFor(u.githubId, adminIds) }));

  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    passport.use(
      new GitHubStrategy(
        {
          clientID: env.GITHUB_CLIENT_ID,
          clientSecret: env.GITHUB_CLIENT_SECRET,
          callbackURL: env.GITHUB_CALLBACK_URL || 'http://localhost:3000/auth/github/callback',
          scope: [], // public profile only - least privilege
          state: true, // OAuth state parameter stored in session (CSRF on the login flow)
        },
        (accessToken, refreshToken, profile, done) => {
          // We do not keep the GitHub access token: we only need identity.
          done(null, { githubId: String(profile.id), login: profile.username, avatar: profile.photos?.[0]?.value || null });
        }
      )
    );
  }
  app.use(passport.initialize());
  app.use(passport.session());

  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
  const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false });

  function loginUser(req, res, next, user, redirect) {
    // regenerate session id on login to prevent session fixation
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.login(user, (err2) => {
        if (err2) return next(err2);
        if (redirect) return res.redirect('/');
        res.json({ ok: true });
      });
    });
  }

  // Both OAuth routes must answer 503 (not crash with 500) when no OAuth app is configured.
  function requireGithubStrategy(req, res, next) {
    if (!passport._strategy('github')) return res.status(503).send('GitHub OAuth is not configured (see .env.example)');
    next();
  }

  app.get('/auth/github', authLimiter, requireGithubStrategy, (req, res, next) => {
    passport.authenticate('github')(req, res, next);
  });
  app.get('/auth/github/callback', authLimiter, requireGithubStrategy, (req, res, next) => {
    passport.authenticate('github', (err, user) => {
      if (err || !user) return res.redirect('/?login=failed');
      loginUser(req, res, next, user, true);
    })(req, res, next);
  });

  // Dev/test-only login so tests and local demos work without a real OAuth app.
  // Hard-disabled in production no matter what DEV_LOGIN says.
  const devLoginAllowed = !isProd && (env.NODE_ENV === 'test' || env.DEV_LOGIN === '1');
  app.post('/auth/dev-login', authLimiter, (req, res, next) => {
    if (!devLoginAllowed) return res.status(404).json({ error: 'not found' });
    const githubId = String(req.body?.githubId || '');
    if (!/^\d+$/.test(githubId)) return res.status(400).json({ error: 'githubId must be numeric' });
    const login = String(req.body.login || `user${githubId}`);
    // Same shape as a real GitHub login, so a display name can never carry
    // newlines into the audit log or control characters into the UI.
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(login)) {
      return res.status(400).json({ error: 'login must look like a GitHub username' });
    }
    loginUser(req, res, next, { githubId, login, avatar: null }, false);
  });

  // ---- API
  const api = express.Router();
  api.use(apiLimiter);
  api.use(verifyCsrf);

  api.get('/me', (req, res) => {
    if (!req.user) return res.json({ user: null });
    res.json({ user: { login: req.user.login, role: req.user.role, avatar: req.user.avatar } });
  });

  api.get('/csrf-token', (req, res) => res.json({ csrfToken: issueToken(req) }));

  api.post('/logout', requireAuth, (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy(() => {
        res.clearCookie('stm.sid');
        res.json({ ok: true });
      });
    });
  });

  // Flags evaluated for the current user. Anonymous visitors get the 100%-rollout state only.
  api.get('/flags', (req, res) => {
    const body = { flags: flags.evaluateAll(req.user?.id) };
    if (req.user?.role === 'admin') body.config = flags.getConfig();
    res.json(body);
  });

  // Admin-only: change a flag (kill switch / rollout %). The login is JSON-stringified
  // in the audit line, so a crafted display name can never forge a second line.
  api.put('/admin/flags/:name', requirePermission('flags:write'), (req, res) => {
    const updated = flags.update(req.params.name, { enabled: req.body?.enabled, rollout: req.body?.rollout });
    console.log(`[audit] ${new Date().toISOString()} ${JSON.stringify(req.user.login)} set ${req.params.name} -> ${JSON.stringify(updated)}`);
    res.json({ name: req.params.name, ...updated });
  });

  // ---- tasks (every route: logged in + owner only)
  const priorityOn = (req) => flags.isOn('priority_labels', req.user.id);

  // Server-side enforcement: if the flag is OFF for this user the field never leaves the server.
  function serialize(task, showPriority) {
    const { ownerId, priority, ...rest } = task;
    return showPriority ? { ...rest, priority } : rest;
  }

  function rejectPriorityIfOff(req, res, next) {
    if (req.body && Object.hasOwn(req.body, 'priority') && !priorityOn(req)) {
      return res.status(403).json({ error: 'feature "priority_labels" is not enabled for this user' });
    }
    next();
  }

  function validateTaskBody(body, partial) {
    const out = {};
    if (!partial || body.title !== undefined) {
      // Length is checked on the trimmed value, which is what we store.
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title || title.length > 200) return { error: 'title must be 1-200 chars' };
      out.title = title;
    }
    if (body.done !== undefined) {
      if (typeof body.done !== 'boolean') return { error: 'done must be boolean' };
      out.done = body.done;
    }
    if (body.priority !== undefined) {
      if (body.priority !== null && !PRIORITIES.includes(body.priority)) return { error: `priority must be one of ${PRIORITIES.join(', ')} or null` };
      out.priority = body.priority;
    }
    return { value: out };
  }

  api.get('/tasks', requireAuth, (req, res) => {
    const show = priorityOn(req);
    res.json({ tasks: tasks.listByOwner(req.user.id).map((t) => serialize(t, show)) });
  });

  api.post('/tasks', requireAuth, rejectPriorityIfOff, (req, res) => {
    const { value, error } = validateTaskBody(req.body || {}, false);
    if (error) return res.status(400).json({ error });
    res.status(201).json(serialize(tasks.create(req.user.id, value), priorityOn(req)));
  });

  api.get('/tasks/:id', requireAuth, (req, res) => {
    const t = tasks.getOwned(req.params.id, req.user.id);
    if (!t) return res.status(404).json({ error: 'not found' }); // 404, not 403: don't reveal other users' ids
    res.json(serialize(t, priorityOn(req)));
  });

  api.patch('/tasks/:id', requireAuth, rejectPriorityIfOff, (req, res) => {
    const t = tasks.getOwned(req.params.id, req.user.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    const { value, error } = validateTaskBody(req.body || {}, true);
    if (error) return res.status(400).json({ error });
    res.json(serialize(tasks.update(t, value), priorityOn(req)));
  });

  api.delete('/tasks/:id', requireAuth, (req, res) => {
    const t = tasks.getOwned(req.params.id, req.user.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    tasks.remove(t.id);
    res.status(204).end();
  });

  app.use('/api', api);
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'internal error' : err.message });
  });

  app.locals.flags = flags;
  app.locals.tasks = tasks;
  return app;
}

module.exports = { createApp };
