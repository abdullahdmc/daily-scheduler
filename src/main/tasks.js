'use strict';

// Pure task logic: no Electron imports, so it can be unit tested with plain Node.

const crypto = require('crypto');

function ymd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return ymd(new Date(y, m - 1, d + n));
}

function newId() {
  return crypto.randomUUID();
}

function isActiveRoutine(t, today) {
  return t.routine && t.date <= today && (!t.until || t.until >= today);
}

function isDoneOn(t, today) {
  return t.routine ? (t.doneDates || []).includes(today) : !!t.done;
}

function belongsToToday(t, today) {
  if (t.deleted) return false;
  if (t.routine) return isActiveRoutine(t, today);
  return t.date === today;
}

function isUpcoming(t, today) {
  return !t.deleted && t.date > today;
}

// Unfinished one-off tasks from earlier days move to today and remember where they came from.
// Returns true if anything changed.
function rollover(tasks, today, now = Date.now()) {
  let changed = false;
  for (const t of tasks) {
    if (t.deleted || t.routine || t.done || t.date >= today) continue;
    t.rolledFrom = t.rolledFrom || t.date;
    t.date = today;
    t.updatedAt = now;
    changed = true;
  }
  for (const t of tasks) {
    if (t.routine && t.doneDates && t.doneDates.length > 60) {
      t.doneDates = t.doneDates.filter((d) => d >= addDays(today, -60));
    }
  }
  return changed;
}

function viewItem(t, today) {
  return {
    id: t.id,
    title: t.title,
    routine: !!t.routine,
    date: t.date,
    until: t.until || null,
    time: t.time || null,
    rolledFrom: t.rolledFrom || null,
    done: isDoneOn(t, today),
  };
}

function byTimeThenCreated(a, b) {
  const ta = a.time || '99:99';
  const tb = b.time || '99:99';
  if (ta !== tb) return ta < tb ? -1 : 1;
  return (a.createdAt || 0) - (b.createdAt || 0);
}

function todayView(tasks, today) {
  return tasks
    .filter((t) => belongsToToday(t, today))
    .sort(byTimeThenCreated)
    .map((t) => viewItem(t, today));
}

function upcomingView(tasks, today) {
  return tasks
    .filter((t) => isUpcoming(t, today))
    .sort((a, b) => (a.date === b.date ? byTimeThenCreated(a, b) : a.date < b.date ? -1 : 1))
    .map((t) => viewItem(t, today));
}

function minutesOf(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function timeHasPassed(time, nowDate) {
  return minutesOf(time) <= nowDate.getHours() * 60 + nowDate.getMinutes();
}

// Creates or updates a task from the add/edit form.
function upsert(tasks, input, nowDate = new Date()) {
  const now = nowDate.getTime();
  const today = ymd(nowDate);
  const title = String(input.title || '').trim().slice(0, 500);
  if (!title) throw new Error('Task title is empty');

  const routine = !!input.routine;
  const date = input.date && input.date > today ? input.date : today;
  const until = routine && input.until && input.until >= date ? input.until : null;
  const time = /^\d{2}:\d{2}$/.test(input.time || '') ? input.time : null;

  let t = input.id && tasks.find((x) => x.id === input.id);
  if (!t) {
    t = { id: newId(), createdAt: now, done: false, doneDates: [], deleted: false };
    tasks.push(t);
  }
  const timeChanged = t.time !== time;
  const dateChanged = t.date !== date;
  Object.assign(t, { title, routine, date, until, time, updatedAt: now });
  if (dateChanged && date > today) t.rolledFrom = null;
  if (timeChanged || dateChanged) {
    // A reminder time that already passed today shouldn't pop up the moment you save it.
    t.remindedOn = time && date === today && timeHasPassed(time, nowDate) ? today : null;
    t.snoozeUntil = null;
  }
  return t;
}

function toggleDone(tasks, id, nowDate = new Date()) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return null;
  const today = ymd(nowDate);
  if (t.routine) {
    const s = new Set(t.doneDates || []);
    s.has(today) ? s.delete(today) : s.add(today);
    t.doneDates = [...s].sort();
  } else {
    t.done = !t.done;
  }
  t.snoozeUntil = null;
  t.updatedAt = nowDate.getTime();
  return t;
}

// Deletion leaves a tombstone so Google sync can remove the remote copy; sync purges it later.
function remove(tasks, id, now = Date.now()) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return null;
  t.deleted = true;
  t.updatedAt = now;
  return JSON.parse(JSON.stringify(t));
}

function restore(tasks, snapshot, now = Date.now()) {
  const t = tasks.find((x) => x.id === snapshot.id);
  if (t) {
    t.deleted = false;
    t.updatedAt = now;
    return t;
  }
  const copy = { ...snapshot, deleted: false, updatedAt: now };
  delete copy.g;
  delete copy.gDays;
  tasks.push(copy);
  return copy;
}

// Returns tasks whose reminder should fire now, and marks them as reminded.
function dueReminders(tasks, nowDate = new Date()) {
  const today = ymd(nowDate);
  const now = nowDate.getTime();
  const fired = [];
  for (const t of tasks) {
    if (!t.time || !belongsToToday(t, today) || isDoneOn(t, today)) continue;
    if (t.remindedOn === today) {
      if (t.snoozeUntil && now >= t.snoozeUntil) {
        t.snoozeUntil = null;
        fired.push({ task: t, missed: false });
      }
      continue;
    }
    if (timeHasPassed(t.time, nowDate)) {
      const lateMinutes = nowDate.getHours() * 60 + nowDate.getMinutes() - minutesOf(t.time);
      t.remindedOn = today;
      t.snoozeUntil = null;
      fired.push({ task: t, missed: lateMinutes > 2 });
    }
  }
  return fired;
}

function snooze(tasks, id, minutes, now = Date.now()) {
  const t = tasks.find((x) => x.id === id);
  if (t) t.snoozeUntil = now + minutes * 60 * 1000;
  return t;
}

// Merges tasks from an exported backup; the newer copy of each task wins.
function importTasks(tasks, incoming) {
  let added = 0;
  for (const inc of incoming) {
    if (!inc || typeof inc.id !== 'string' || typeof inc.title !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(inc.date || '')) continue;
    const cur = tasks.find((x) => x.id === inc.id);
    if (!cur) {
      tasks.push({ doneDates: [], ...inc });
      added++;
    } else if ((inc.updatedAt || 0) > (cur.updatedAt || 0)) {
      Object.assign(cur, inc);
      added++;
    }
  }
  return added;
}

module.exports = {
  ymd, addDays, newId, isActiveRoutine, isDoneOn, belongsToToday, isUpcoming,
  rollover, todayView, upcomingView, upsert, toggleDone, remove, restore,
  dueReminders, snooze, importTasks,
};
