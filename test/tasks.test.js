'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/main/tasks');

const at = (s) => new Date(s); // local time, e.g. '2026-10-12T10:00'

test('one-off task belongs to its own day only', () => {
  const tasks = [];
  T.upsert(tasks, { title: 'Pay bill', date: '2026-10-12' }, at('2026-10-12T10:00'));
  T.upsert(tasks, { title: 'Dentist', date: '2026-10-15' }, at('2026-10-12T10:00'));
  assert.deepEqual(T.todayView(tasks, '2026-10-12').map((t) => t.title), ['Pay bill']);
  assert.deepEqual(T.upcomingView(tasks, '2026-10-12').map((t) => t.title), ['Dentist']);
});

test('a date in the past is saved as today', () => {
  const tasks = [];
  const t = T.upsert(tasks, { title: 'x', date: '2026-10-01' }, at('2026-10-12T10:00'));
  assert.equal(t.date, '2026-10-12');
});

test('routine shows daily from its start date until its end date', () => {
  const tasks = [];
  T.upsert(tasks, { title: 'Yoga', routine: true, date: '2026-10-19', until: '2026-10-21' }, at('2026-10-12T10:00'));
  assert.equal(T.todayView(tasks, '2026-10-12').length, 0);
  assert.equal(T.upcomingView(tasks, '2026-10-12').length, 1);
  for (const d of ['2026-10-19', '2026-10-20', '2026-10-21']) assert.equal(T.todayView(tasks, d).length, 1, d);
  assert.equal(T.todayView(tasks, '2026-10-22').length, 0);
});

test('routine completion is per day', () => {
  const tasks = [];
  const r = T.upsert(tasks, { title: 'Walk', routine: true }, at('2026-10-12T08:00'));
  T.toggleDone(tasks, r.id, at('2026-10-12T09:00'));
  assert.equal(T.todayView(tasks, '2026-10-12')[0].done, true);
  assert.equal(T.todayView(tasks, '2026-10-13')[0].done, false);
});

test('unfinished one-off tasks roll over and remember the original day', () => {
  const tasks = [];
  const a = T.upsert(tasks, { title: 'Bill' }, at('2026-10-11T10:00'));
  const b = T.upsert(tasks, { title: 'Done one' }, at('2026-10-11T10:00'));
  T.toggleDone(tasks, b.id, at('2026-10-11T11:00'));
  T.rollover(tasks, '2026-10-12');
  T.rollover(tasks, '2026-10-13');
  assert.equal(a.date, '2026-10-13');
  assert.equal(a.rolledFrom, '2026-10-11');
  assert.equal(b.date, '2026-10-11');
  assert.deepEqual(T.todayView(tasks, '2026-10-13').map((t) => t.title), ['Bill']);
});

test('today list is sorted by reminder time, untimed last', () => {
  const tasks = [];
  const now = at('2026-10-12T05:00');
  T.upsert(tasks, { title: 'No time' }, now);
  T.upsert(tasks, { title: 'Late', time: '15:00' }, now);
  T.upsert(tasks, { title: 'Early', time: '06:30' }, now);
  assert.deepEqual(T.todayView(tasks, '2026-10-12').map((t) => t.title), ['Early', 'Late', 'No time']);
});

test('reminders fire once, can be snoozed, and catch up when missed', () => {
  const tasks = [];
  const t = T.upsert(tasks, { title: 'Call', time: '15:00' }, at('2026-10-12T09:00'));
  assert.equal(T.dueReminders(tasks, at('2026-10-12T14:59')).length, 0);
  const fired = T.dueReminders(tasks, at('2026-10-12T15:00'));
  assert.equal(fired.length, 1);
  assert.equal(fired[0].missed, false);
  assert.equal(T.dueReminders(tasks, at('2026-10-12T15:01')).length, 0);

  T.snooze(tasks, t.id, 10, at('2026-10-12T15:01').getTime());
  assert.equal(T.dueReminders(tasks, at('2026-10-12T15:05')).length, 0);
  assert.equal(T.dueReminders(tasks, at('2026-10-12T15:11')).length, 1);

  // Laptop was off at 15:00 the next day (task rolled over): shows as missed when it wakes.
  T.rollover(tasks, '2026-10-13');
  const late = T.dueReminders(tasks, at('2026-10-13T18:00'));
  assert.equal(late.length, 1);
  assert.equal(late[0].missed, true);
});

test('saving a reminder time that already passed does not pop up immediately', () => {
  const tasks = [];
  T.upsert(tasks, { title: 'x', time: '08:00' }, at('2026-10-12T10:00'));
  assert.equal(T.dueReminders(tasks, at('2026-10-12T10:00')).length, 0);
});

test('routine reminders repeat every day; done tasks are not reminded', () => {
  const tasks = [];
  const r = T.upsert(tasks, { title: 'Pills', routine: true, time: '09:00' }, at('2026-10-12T06:00'));
  assert.equal(T.dueReminders(tasks, at('2026-10-12T09:00')).length, 1);
  assert.equal(T.dueReminders(tasks, at('2026-10-13T09:00')).length, 1);
  T.toggleDone(tasks, r.id, at('2026-10-14T08:00'));
  assert.equal(T.dueReminders(tasks, at('2026-10-14T09:00')).length, 0);
});

test('delete leaves a tombstone that undo restores', () => {
  const tasks = [];
  const t = T.upsert(tasks, { title: 'x' }, at('2026-10-12T10:00'));
  const snap = T.remove(tasks, t.id);
  assert.equal(T.todayView(tasks, '2026-10-12').length, 0);
  T.restore(tasks, snap);
  assert.equal(T.todayView(tasks, '2026-10-12').length, 1);
  // Restoring after the tombstone was purged adds it back without Google links.
  tasks.length = 0;
  T.restore(tasks, { ...snap, g: { id: 'remote' } });
  assert.equal(tasks[0].g, undefined);
});

test('import keeps the newer copy and skips invalid rows', () => {
  const tasks = [];
  const t = T.upsert(tasks, { title: 'Old' }, at('2026-10-12T10:00'));
  const n = T.importTasks(tasks, [
    { ...t, title: 'Newer', updatedAt: t.updatedAt + 1 },
    { id: 'z', title: 'Bad date', date: 'soon' },
    { id: 'y', title: 'Fresh', date: '2026-10-12', updatedAt: 1 },
  ]);
  assert.equal(n, 2);
  assert.deepEqual(tasks.map((x) => x.title).sort(), ['Fresh', 'Newer']);
});
