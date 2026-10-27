'use strict';

// Finds a deadline in task text, e.g. "Send report by 30 October" or "Oct 30, 2027".
// Shared by the note (loaded as a plain script) and the tests (required as a module).
(function (root) {
  const MONTHS = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
    jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
    oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
  };
  const DAYS = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };

  const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const DAY = '(\\d{1,2})(?:st|nd|rd|th)?';
  const YEAR = '(?:,?\\s+(\\d{4}))?';
  const LEAD = '(?:(?:by|before|due(?:\\s+(?:on|by))?|until|till|deadline:?|no\\s+later\\s+than)\\s+)?';
  const END = '(?![\\w])';

  const DAY_FIRST = new RegExp(`\\b${LEAD}${DAY}\\s+(?:of\\s+)?${MONTH}\\.?${YEAR}${END}`, 'i');
  const MONTH_FIRST = new RegExp(`\\b${LEAD}${MONTH}\\.?\\s+${DAY}${YEAR}${END}`, 'i');
  const RELATIVE = new RegExp(`\\b${LEAD}(today|tonight|tomorrow)${END}`, 'i');
  const WEEKDAY = /\b(?:by|before|due(?:\s+(?:on|by))?|until|till|on|deadline:?)\s+(?:(this|next)\s+)?(sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)(?:day|nesday|urday)?\b/i;

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const monthIndex = (word) => MONTHS[word.toLowerCase().replace(/\.$/, '')];

  // Returns { date: 'YYYY-MM-DD', text: matched words } or { past: true, text } or null.
  function findDeadline(text, today) {
    const base = parseYmd(today);
    const hits = [];

    const fromParts = (m, dayStr, monthStr, yearStr) => {
      const day = Number(dayStr);
      const month = monthIndex(monthStr);
      if (month == null || day < 1 || day > 31) return;
      let year = yearStr ? Number(yearStr) : base.getFullYear();
      if (yearStr && (year < 2000 || year > 2100)) return;
      let d = new Date(year, month, day);
      if (d.getMonth() !== month) return; // e.g. 31 November
      if (!yearStr && ymd(d) < today) d = new Date(year + 1, month, day);
      if (!yearStr && d.getMonth() !== month) return; // 29 February in a non-leap year
      hits.push({ index: m.index, text: m[0].trim(), date: ymd(d), past: ymd(d) < today });
    };

    let m = DAY_FIRST.exec(text);
    if (m) fromParts(m, m[1], m[2], m[3]);
    m = MONTH_FIRST.exec(text);
    // "may 5" is usually the verb ("I may 5 times"); want "May 5", "by may 5" or a year.
    const verbMay = m && m[1] === 'may' && !m[3] && !/^(by|before|due|until|till|deadline|no)\b/i.test(m[0]);
    if (m && !verbMay) fromParts(m, m[2], m[1], m[3]);
    m = RELATIVE.exec(text);
    if (m) {
      const add = m[1].toLowerCase() === 'tomorrow' ? 1 : 0;
      hits.push({ index: m.index, text: m[0].trim(), date: ymd(new Date(base.getFullYear(), base.getMonth(), base.getDate() + add)) });
    }
    m = WEEKDAY.exec(text);
    if (m) {
      const want = DAYS[m[2].toLowerCase()];
      let add = (want - base.getDay() + 7) % 7;
      if (m[1] && m[1].toLowerCase() === 'next' && add === 0) add = 7;
      hits.push({ index: m.index, text: m[0].trim(), date: ymd(new Date(base.getFullYear(), base.getMonth(), base.getDate() + add)) });
    }

    if (!hits.length) return null;
    hits.sort((a, b) => a.index - b.index);
    const first = hits[0];
    return first.past ? { past: true, text: first.text } : { date: first.date, text: first.text };
  }

  if (typeof module === 'object' && module.exports) module.exports = { findDeadline };
  else root.findDeadline = findDeadline;
})(typeof window !== 'undefined' ? window : globalThis);
