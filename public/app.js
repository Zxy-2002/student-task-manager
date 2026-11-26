'use strict';
// Frontend only *reflects* flags. The real enforcement is on the server
// (hiding the priority controls here is UX, not access control).
let csrf = null;
let flags = {};

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (opts.method && opts.method !== 'GET') headers['X-CSRF-Token'] = csrf;
  const res = await fetch('/api' + path, { credentials: 'same-origin', ...opts, headers });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

const $ = (s) => document.querySelector(s);
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  kids.forEach((k) => n.append(k));
  return n;
}

async function loadFlags() {
  const res = await api('/flags');
  flags = res.flags;
  document.body.classList.toggle('theme-dark', !!flags.dark_mode);
  $('#priority-select').hidden = !flags.priority_labels;
  return res;
}

const PRIORITY_OPTIONS = [['', 'No priority'], ['High', 'High'], ['Medium', 'Medium'], ['Low', 'Low']];

// Shown only when the server says priority_labels is on for this user.
// Empty selection is stored as null. The PATCH goes through api(), which sends the CSRF token.
function priorityControl(task) {
  const sel = el('select', { className: 'priority', title: 'Change priority' });
  sel.setAttribute('aria-label', `Priority for ${task.title}`);
  for (const [value, label] of PRIORITY_OPTIONS) sel.append(el('option', { value, textContent: label }));
  sel.value = task.priority || '';
  const paint = () => {
    sel.classList.remove('none', 'High', 'Medium', 'Low');
    sel.classList.add(sel.value || 'none');
  };
  paint();
  sel.onchange = () => {
    paint();
    api(`/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ priority: sel.value ? sel.value : null }),
    })
      .then(loadTasks)
      .catch((err) => {
        console.error(err);
        return loadTasks();
      });
  };
  return sel;
}

async function loadTasks() {
  const { tasks } = await api('/tasks');
  const ul = $('#tasks');
  ul.replaceChildren();
  if (!tasks.length) ul.append(el('li', { className: 'muted', textContent: 'No tasks yet.' }));
  for (const t of tasks) {
    const cb = el('input', { type: 'checkbox', checked: t.done });
    cb.onchange = () => api(`/tasks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ done: cb.checked }) }).then(loadTasks);
    const li = el('li', { className: t.done ? 'done' : '' }, cb, el('span', { className: 'title grow', textContent: t.title }));
    if (flags.priority_labels) li.append(priorityControl(t));
    const del = el('button', { className: 'icon', title: 'Delete', textContent: '✕' });
    del.onclick = () => api(`/tasks/${t.id}`, { method: 'DELETE' }).then(loadTasks);
    li.append(del);
    ul.append(li);
  }
}

function renderAdmin(config) {
  const box = $('#flag-rows');
  box.replaceChildren();
  for (const [name, f] of Object.entries(config)) {
    const toggle = el('input', { type: 'checkbox', checked: f.enabled });
    const rollout = el('input', { type: 'number', min: 0, max: 100, value: f.rollout, className: 'pct' });
    const save = el('button', { className: 'btn secondary', textContent: 'Save' });
    save.onclick = async () => {
      await api(`/admin/flags/${name}`, { method: 'PUT', body: JSON.stringify({ enabled: toggle.checked, rollout: Number(rollout.value) }) });
      await refresh();
    };
    box.append(el('div', { className: 'flag' },
      el('div', {}, el('strong', { textContent: name }), el('div', { className: 'muted', textContent: f.description || '' })),
      el('div', {}, toggle, ' on · rollout ', rollout, '% ', save)));
  }
}

async function refresh() {
  const f = await loadFlags();
  if (f.config) { $('#admin').hidden = false; renderAdmin(f.config); }
  await loadTasks();
}

async function init() {
  csrf = (await api('/csrf-token')).csrfToken;
  const { user } = await api('/me');
  if (!user) {
    await loadFlags();
    $('#login-box').hidden = false;
    $('#dev-login').hidden = !new URLSearchParams(location.search).has('dev');
    return;
  }
  const out = el('button', { className: 'btn secondary', textContent: 'Log out' });
  out.onclick = () => api('/logout', { method: 'POST' }).then(() => location.reload());
  $('#who').replaceChildren(el('span', { className: 'muted', textContent: `${user.login} (${user.role}) ` }), out);
  $('#app').hidden = false;
  await refresh();
}

$('#new-task').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = { title: fd.get('title') };
  if (flags.priority_labels && fd.get('priority')) body.priority = fd.get('priority');
  await api('/tasks', { method: 'POST', body: JSON.stringify(body) });
  e.target.reset();
  loadTasks();
};

$('#dev-login').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const res = await fetch('/auth/dev-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(fd)) });
  if (res.ok) return location.reload();
  const body = await res.json().catch(() => ({}));
  alert(body.error || 'Dev login is disabled');
};

init().catch((err) => console.error(err));
