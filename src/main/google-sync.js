'use strict';

// Two-way sync between local tasks and a "Daily scheduler" list in Google Tasks.
// `api(method, path, body)` performs an authenticated Tasks API call; injected so this file
// can be tested without the network.
//
// Google Tasks has no repeat setting and keeps only a due date (no time), so:
// - each routine gets one Google task per day, created on that day and marked with ROUTINE_TAG;
// - reminder times stay on the desktop.

const { ymd, isActiveRoutine, isDoneOn } = require('./tasks');

const LIST_TITLE = 'Daily scheduler';
const ROUTINE_TAG = '[routine] Added by Daily scheduler';
const BASE = 'https://tasks.googleapis.com/tasks/v1';

const dueOf = (date) => `${date}T00:00:00.000Z`;

async function ensureList(api, g) {
  if (g.listId) {
    try {
      await api('GET', `${BASE}/users/@me/lists/${g.listId}`);
      return false;
    } catch (err) {
      if (err.status !== 404) throw err;
    }
  }
  let pageToken;
  do {
    const res = await api('GET', `${BASE}/users/@me/lists?maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`);
    const found = (res.items || []).find((l) => l.title === LIST_TITLE);
    if (found) { g.listId = found.id; return true; }
    pageToken = res.nextPageToken;
  } while (pageToken);
  g.listId = (await api('POST', `${BASE}/users/@me/lists`, { title: LIST_TITLE })).id;
  return true;
}

async function fetchRemote(api, listId) {
  const out = new Map();
  let pageToken;
  do {
    const q = `maxResults=100&showCompleted=true&showHidden=true&showDeleted=true${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await api('GET', `${BASE}/lists/${listId}/tasks?${q}`);
    for (const r of res.items || []) out.set(r.id, r);
    pageToken = res.nextPageToken;
  } while (pageToken);
  return out;
}

async function sync(state, api, nowDate = new Date()) {
  const g = state.google;
  const today = ymd(nowDate);
  const now = nowDate.getTime();

  const listChanged = await ensureList(api, g);
  if (listChanged) {
    for (const t of state.tasks) { delete t.g; delete t.gDays; }
  }
  const L = `${BASE}/lists/${g.listId}/tasks`;
  const remote = await fetchRemote(api, g.listId);
  const purge = new Set();
  const del = async (id) => {
    try { await api('DELETE', `${L}/${id}`); } catch (err) { if (err.status !== 404) throw err; }
  };

  for (const t of [...state.tasks]) {
    if (t.routine) {
      t.gDays = t.gDays || {};
      for (const [day, inst] of Object.entries(t.gDays)) {
        const r = remote.get(inst.id);
        const old = day < today || t.deleted;
        if (old) {
          // Keep finished days as history on the phone; remove unfinished leftovers.
          if (r && !r.deleted && r.status !== 'completed') await del(inst.id);
          delete t.gDays[day];
        }
      }
      if (t.deleted) { purge.add(t.id); continue; }
      if (!isActiveRoutine(t, today)) continue;

      const inst = t.gDays[today];
      const r = inst && remote.get(inst.id);
      const body = { title: t.title, notes: ROUTINE_TAG, due: dueOf(today), status: isDoneOn(t, today) ? 'completed' : 'needsAction' };
      if (!inst || (!r && !inst.gone)) {
        const created = await api('POST', L, body);
        t.gDays[today] = { id: created.id, updated: Date.parse(created.updated), syncedAt: now };
      } else if (r && r.deleted) {
        inst.gone = true; // deleted on the phone for today; don't recreate it
      } else if (r) {
        const remoteUpdated = Date.parse(r.updated);
        if (remoteUpdated > (inst.updated || 0) && remoteUpdated > (t.updatedAt || 0)) {
          const s = new Set(t.doneDates || []);
          r.status === 'completed' ? s.add(today) : s.delete(today);
          t.doneDates = [...s].sort();
          inst.updated = remoteUpdated;
          inst.syncedAt = now;
        } else if ((t.updatedAt || 0) > (inst.syncedAt || 0)) {
          const upd = await api('PATCH', `${L}/${inst.id}`, body);
          inst.updated = Date.parse(upd.updated);
          inst.syncedAt = now;
        }
      }
      continue;
    }

    // One-off task
    if (t.deleted) {
      if (t.g?.id) await del(t.g.id);
      purge.add(t.id);
      continue;
    }
    // A task with a deadline uses it as Google's due date, so the phone shows when it's due.
    const body = { title: t.title, due: dueOf(t.deadline || t.date), status: t.done ? 'completed' : 'needsAction' };
    const r = t.g?.id && remote.get(t.g.id);
    if (r && r.deleted) {
      purge.add(t.id); // deleted on the phone
      continue;
    }
    if (!r) {
      if (t.done && t.date < today) continue; // old finished task: nothing to show on the phone
      const created = await api('POST', L, body);
      t.g = { id: created.id, updated: Date.parse(created.updated), syncedAt: now };
      continue;
    }
    const remoteUpdated = Date.parse(r.updated);
    if (remoteUpdated > (t.g.updated || 0) && remoteUpdated > (t.updatedAt || 0)) {
      t.title = r.title || t.title;
      t.done = r.status === 'completed';
      const due = r.due && r.due.slice(0, 10);
      if (due && t.deadline) {
        // Changing the due date on the phone moves the deadline, not the day the task starts.
        t.deadline = due < t.date ? t.date : due;
      } else if (due) {
        t.date = due < today && !t.done ? today : due;
      }
      t.updatedAt = remoteUpdated;
      t.g.updated = remoteUpdated;
      t.g.syncedAt = now;
    } else if ((t.updatedAt || 0) > (t.g.syncedAt || 0)) {
      const upd = await api('PATCH', `${L}/${t.g.id}`, body);
      t.g.updated = Date.parse(upd.updated);
      t.g.syncedAt = now;
    }
  }

  // Tasks added on the phone become one-off tasks here.
  const known = new Set();
  for (const t of state.tasks) {
    if (t.g?.id) known.add(t.g.id);
    for (const inst of Object.values(t.gDays || {})) known.add(inst.id);
  }
  for (const r of remote.values()) {
    if (known.has(r.id) || r.deleted || !r.title) continue;
    if ((r.notes || '').includes(ROUTINE_TAG)) continue;
    const due = r.due ? r.due.slice(0, 10) : today;
    const done = r.status === 'completed';
    if (done && due < today) continue;
    const updated = Date.parse(r.updated);
    state.tasks.push({
      id: require('crypto').randomUUID(),
      title: r.title,
      routine: false,
      date: !done && due < today ? today : due,
      until: null,
      time: null,
      done,
      doneDates: [],
      deleted: false,
      createdAt: updated,
      updatedAt: updated,
      g: { id: r.id, updated, syncedAt: now },
    });
  }

  state.tasks = state.tasks.filter((t) => !purge.has(t.id));
  g.lastSync = now;
}

module.exports = { sync, LIST_TITLE, ROUTINE_TAG, BASE };
