'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findDeadline } = require('../src/shared/deadline-text');

const TODAY = '2026-10-27'; // a Tuesday
const date = (text, today = TODAY) => findDeadline(text, today)?.date ?? null;

test('day then month, in many spellings', () => {
  for (const t of ['Send report by 30 October', 'by 30 oct', '30th Oct', 'due 30 Oct.', 'before the 30 of October', 'Report 30 OCTOBER']) {
    assert.equal(date(t.replace('the ', '')), '2026-10-30', t);
  }
});

test('month then day', () => {
  for (const t of ['Oct 30', 'October 30th', 'by Oct. 30', 'due on October 30']) assert.equal(date(t), '2026-10-30', t);
});

test('a year is used when given', () => {
  assert.equal(date('Thesis by 30 October 2027'), '2027-10-30');
  assert.equal(date('Thesis by October 30, 2027'), '2027-10-30');
  assert.equal(date('Thesis by 30 Oct, 2028'), '2028-10-30');
});

test('without a year, a date that has passed means next year', () => {
  assert.equal(date('Taxes by 15 March'), '2027-03-15');
  assert.equal(date('Today is fine: 27 Oct'), '2026-10-27');
});

test('a year that has passed is reported, not used', () => {
  assert.deepEqual(findDeadline('Old thing by 1 Jan 2025', TODAY), { past: true, text: 'by 1 Jan 2025' });
});

test('the matched words are returned for the hint', () => {
  assert.equal(findDeadline('Send report by 30 October please', TODAY).text, 'by 30 October');
  assert.equal(findDeadline('Pay rent Nov 1st', TODAY).text, 'Nov 1st');
});

test('today, tomorrow and weekdays', () => {
  assert.equal(date('Finish it today'), '2026-10-27');
  assert.equal(date('Call the bank tomorrow'), '2026-10-28');
  assert.equal(date('Slides by Friday'), '2026-10-30');
  assert.equal(date('Slides by Tuesday'), '2026-10-27');
  assert.equal(date('Slides before next Tuesday'), '2026-11-03');
  assert.equal(date('Due Mon'), '2026-11-02');
});

test('impossible dates and ordinary words are ignored', () => {
  for (const t of ['Buy 31 November tickets', 'Read chapter 12', 'Monday meeting notes', 'I may 5 times', 'Mark the march route', 'Order 3 decorations', 'Version 30 octane']) {
    assert.equal(findDeadline(t, TODAY), null, t);
  }
});

test('29 February only exists in leap years', () => {
  assert.equal(date('Leap by 29 Feb', '2026-10-27'), null);
  assert.equal(date('Leap by 29 Feb 2028'), '2028-02-29');
});

test('the first date in the text wins', () => {
  assert.equal(date('Draft by 5 Nov, final by 20 Nov'), '2026-11-05');
});

test('May the month versus may the verb', () => {
  assert.equal(date('Exam May 5'), '2027-05-05');
  assert.equal(date('Exam by may 5'), '2027-05-05');
  assert.equal(date('Exam 5 may'), '2027-05-05');
  assert.equal(date('we may 5 times'), null);
});
