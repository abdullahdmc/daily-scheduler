'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/main/tasks');
const { sync, BASE, ROUTINE_TAG } = require('../src/main/google-sync');

// In-memory stand-in for the Google Tasks API.
function fakeGoogle() {
  let clock = Date.parse('2026-10-12T00:00:00Z');
  let n = 0;
  const lists = new Map();
  const tasks = new Map(); // id -> task (with listId)
  const stamp = () => new Date((clock += 1000)).toISOString();
  const api = async (method, url, body) => {
    const path = url.slice(BASE.length).split('?')[0];
    let m;
    if (path === '/users/@me/lists' && method === 'GET') return { items: [...lists.values()] };
    if (path === '/users/@me/lists' && method === 'POST') { const l = { id: `L${++n}`, title: body.title }; lists.set(l.id, l); return l; }
    if ((m = path.match(/^\/users\/@me\/lists\/(\w+)$/))) {
      if (!lists.has(m[1])) { const e = new Error('nf'); e.status = 404; throw e; }
      return lists.get(m[1]);
    }
    if ((m = path.match(/^\/lists\/(\w+)\/tasks$/))) {
      if (method === 'GET') return { items: [...tasks.values()].filter((t) => t.listId === m[1]) };
      const t = { id: `t${++n}`, listId: m[1], ...body, updated: stamp() };
      tasks.set(t.id, t);
      return t;
    }
    if ((m = path.match(/^\/lists\/(\w+)\/tasks\/(\w+)$/))) {
      const t = tasks.get(m[2]);
      if (!t) { const e = new Error('nf'); e.status = 404; throw e; }
      if (method === 'DELETE') { t.deleted = true; t.updated = stamp(); return {}; }
      Object.assign(t, body, { updated: stamp() });
      return t;
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return {
    api, tasks, lists,
    phoneEdit(id, patch) { Object.assign(tasks.get(id), patch, { updated: stamp() }); },
    phoneAdd(listId, body) { const t = { id: `t${++n}`, listId, ...body, updated: stamp() }; tasks.set(t.id, t); return t; },
    advance(ms) { clock += ms; },
  };
}

const live = (g) => [...g.tasks.values()].filter((t) => !t.deleted);

test('pushes local tasks, pulls phone changes, and imports phone tasks', async () => {
  const g = fakeGoogle();
  const state = { tasks: [], google: {} };
  const now = new Date('2026-10-12T10:00');
  const a = T.upsert(state.tasks, { title: 'Pay bill' }, now);
  T.upsert(state.tasks, { title: 'Dentist', date: '2026-10-15' }, now);
  T.upsert(state.tasks, { title: 'Walk', routine: true }, now);

  await sync(state, g.api, now);
  assert.equal(g.lists.size, 1);
  assert.equal([...g.lists.values()][0].title, 'Daily scheduler');
  assert.deepEqual(live(g).map((t) => t.title).sort(), ['Dentist', 'Pay bill', 'Walk']);
  const walk = live(g).find((t) => t.title === 'Walk');
  assert.equal(walk.notes, ROUTINE_TAG);
  assert.equal(walk.due, '2026-10-12T00:00:00.000Z');

  // Ticked on the phone (Google's clock is ahead of local edits here)
  g.advance(1e12);
  g.phoneEdit(a.g.id, { status: 'completed' });
  g.phoneEdit(walk.id, { status: 'completed' });
  g.phoneAdd(state.google.listId, { title: 'Buy milk', status: 'needsAction', due: '2026-10-12T00:00:00.000Z' });
  await sync(state, g.api, now);
  assert.equal(a.done, true);
  const today = T.todayView(state.tasks, '2026-10-12');
  assert.equal(today.find((t) => t.title === 'Walk').done, true);
  assert.ok(today.find((t) => t.title === 'Buy milk'));

  // A second sync makes no duplicates
  await sync(state, g.api, now);
  assert.equal(live(g).length, 4);
  assert.equal(state.tasks.length, 4);
});

test('local edits and deletes reach Google; phone deletes remove the local task', async () => {
  const g = fakeGoogle();
  const state = { tasks: [], google: {} };
  const now = new Date('2026-10-12T10:00');
  const a = T.upsert(state.tasks, { title: 'One' }, now);
  const b = T.upsert(state.tasks, { title: 'Two' }, now);
  await sync(state, g.api, now);

  const later = new Date(Date.now() + 1e13); // local edit newer than anything Google has
  T.upsert(state.tasks, { id: a.id, title: 'One, renamed' }, later);
  T.remove(state.tasks, b.id, later.getTime());
  await sync(state, g.api, now);
  assert.deepEqual(live(g).map((t) => t.title), ['One, renamed']);
  assert.equal(state.tasks.length, 1);

  g.phoneEdit(a.g.id, { deleted: true });
  await sync(state, g.api, now);
  assert.equal(state.tasks.length, 0);
});

test('routine gets a fresh Google task each day; unfinished old copies are removed', async () => {
  const g = fakeGoogle();
  const state = { tasks: [], google: {} };
  T.upsert(state.tasks, { title: 'Walk', routine: true }, new Date('2026-10-12T08:00'));
  await sync(state, g.api, new Date('2026-10-12T08:00'));
  await sync(state, g.api, new Date('2026-10-13T08:00'));
  const alive = live(g);
  assert.equal(alive.length, 1);
  assert.equal(alive[0].due, '2026-10-13T00:00:00.000Z');
});

test('recreates the list if it was deleted on Google', async () => {
  const g = fakeGoogle();
  const state = { tasks: [], google: {} };
  const now = new Date('2026-10-12T10:00');
  T.upsert(state.tasks, { title: 'One' }, now);
  await sync(state, g.api, now);
  g.lists.clear();
  await sync(state, g.api, now);
  assert.equal(g.lists.size, 1);
  assert.equal(live(g).filter((t) => t.listId === state.google.listId).length, 1);
});
