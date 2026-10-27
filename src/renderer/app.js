'use strict';

const $ = (id) => document.getElementById(id);
const note = $('note');

const THEMES = {
  Yellow: ['#FAEEDA', '#FAC775', '#EF9F27', '#633806', '#854F0B'],
  Pink: ['#FBEAF0', '#F4C0D1', '#ED93B1', '#72243E', '#993556'],
  Blue: ['#E6F1FB', '#B5D4F4', '#85B7EB', '#0C447C', '#185FA5'],
  Green: ['#EAF3DE', '#C0DD97', '#97C459', '#27500A', '#3B6D11'],
  Lavender: ['#EEEDFE', '#CECBF6', '#AFA9EC', '#3C3489', '#534AB7'],
};

const ICON = {
  check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>',
  repeat: '<svg viewBox="0 0 24 24"><path d="M4 12V9a3 3 0 0 1 3-3h13l-3-3m3 3l-3 3M20 12v3a3 3 0 0 1-3 3H4l3 3m-3-3l3-3"/></svg>',
  pencil: '<svg viewBox="0 0 24 24"><path d="M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16v4M13.5 6.5l4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M10 5a2 2 0 1 1 4 0 7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6M9 17v1a3 3 0 0 0 6 0v-1"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M16 3v4M8 3v4M4 11h16"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
};

let S = null; // state from the main process
const ui = {
  editing: null, // task id, 'new', or null
  sel: {},
  calMode: null,
  calMonth: null, // [year, monthIndex]
  upOpen: false,
  settingsOpen: false,
  palOpen: false,
  lastDel: null,
  backupMsg: '',
};
let toastTimer;

// ---------- helpers ----------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const toYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function fmtDate(s) {
  const d = parseYmd(s);
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== parseYmd(S.today).getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function toast(html, ms = 2500) {
  clearTimeout(toastTimer);
  $('toast').innerHTML = html;
  toastTimer = setTimeout(() => { $('toast').innerHTML = ''; ui.lastDel = null; }, ms);
}

// ---------- rendering ----------

function applyTheme() {
  const c = THEMES[S.settings.theme] || THEMES.Yellow;
  ['--bg', '--hd', '--bd', '--tx', '--ic'].forEach((v, i) => note.style.setProperty(v, c[i]));
  $('pal').innerHTML = Object.keys(THEMES).map((n) =>
    `<button class="sw${n === S.settings.theme ? ' sel' : ''}" data-a="theme" data-n="${n}" aria-label="${n}" title="${n}"></button>`).join('');
  // Inline style attributes are blocked by the page's security policy, so set colours here.
  for (const b of $('pal').children) {
    const t = THEMES[b.dataset.n];
    b.style.background = t[1];
    b.style.border = `1px solid ${t[4]}`;
  }
}

function dueText(due, upcoming) {
  if (upcoming || due.daysLeft > 7) return `Due ${fmtDate(due.deadline)}`;
  if (due.daysLeft > 1) return `${due.daysLeft} days left`;
  if (due.daysLeft === 1) return 'Due tomorrow';
  if (due.daysLeft === 0) return 'Due today';
  return due.daysLeft === -1 ? '1 day overdue' : `${-due.daysLeft} days overdue`;
}

function dueBadge(k, upcoming) {
  if (!k.due) return '';
  const full = parseYmd(k.due.deadline).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  // Colours are set in paintDeadlines(): the page's security policy blocks inline styles.
  return `<span class="badge due" data-used="${k.done ? '' : k.due.used}" data-over="${k.due.daysLeft < 0 ? 1 : 0}" title="Deadline: ${esc(full)}">`
    + `${ICON.flag}${esc(dueText(k.due, upcoming))}</span>`;
}

// Green when the deadline is set, yellow halfway, red on the day (and when overdue).
function paintDeadlines() {
  for (const b of document.querySelectorAll('.badge.due')) {
    if (b.dataset.used === '') continue; // finished tasks keep the plain badge
    const hue = b.dataset.over === '1' ? 0 : Math.round(120 * (1 - Number(b.dataset.used)));
    b.style.background = `hsl(${hue}, 75%, ${b.dataset.over === '1' ? 80 : 86}%)`;
    b.style.borderColor = `hsl(${hue}, 60%, 40%)`;
    b.style.color = `hsl(${hue}, 80%, 22%)`;
  }
}

function rowHtml(k, upcoming) {
  const hidden = ui.editing === k.id ? ' hidden' : '';
  const badges = [
    dueBadge(k, upcoming),
    k.routine && !upcoming ? `<span class="mini" title="Routine">${ICON.repeat}</span>` : '',
    k.rolledFrom ? `<span class="badge" title="Not finished on ${esc(fmtDate(k.rolledFrom))}">from ${esc(fmtDate(k.rolledFrom))}</span>` : '',
    upcoming ? `<span class="badge">${k.routine ? 'Daily from ' : ''}${esc(fmtDate(k.date))}</span>` : '',
    k.time ? `<span class="badge">${ICON.bell}${esc(fmtTime(k.time))}</span>` : '',
  ].join('');
  const lead = upcoming
    ? `<span class="mini">${k.routine ? ICON.repeat : ICON.calendar}</span>`
    : `<button class="ck" data-a="ck" data-id="${k.id}" aria-label="${k.done ? 'Mark not done' : 'Mark complete'}">${ICON.check}</button>`;
  return `<div class="row${k.done && !upcoming ? ' done' : ''}" data-row="${k.id}"${hidden}>${lead}`
    + `<span class="txt" data-id="${k.id}" title="${esc(k.title)}">${esc(k.title)}</span>${badges}`
    + `<button class="act" data-a="edit" data-id="${k.id}" aria-label="Edit task" title="Edit">${ICON.pencil}</button>`
    + `<button class="act" data-a="del" data-id="${k.id}" aria-label="Delete task" title="Delete">${ICON.trash}</button></div>`;
}

function render() {
  if (!S) return;
  applyTheme();
  note.classList.toggle('collapsed', !!S.settings.collapsed);
  $('pal').hidden = !ui.palOpen;
  $('notice').hidden = !!S.settings.startupNoticeSeen;

  const d = parseYmd(S.today);
  $('title').textContent = `Today · ${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`;

  const done = S.items.filter((k) => k.done).length;
  const total = S.items.length;
  const p = total ? done / total : 0;
  $('count').textContent = `${done}/${total}`;
  $('prog').style.width = `${Math.max(p * 100, total ? 4 : 0)}%`;
  $('prog').style.background = `hsl(${Math.round(p * 120)}, ${p === 1 ? 55 : 70}%, ${p === 1 ? 38 : 46}%)`;

  $('home').appendChild($('form'));
  $('list').innerHTML = S.items.length
    ? S.items.map((k) => rowHtml(k, false)).join('')
    : '<div class="empty">Nothing planned for today. Add a task with the + button.</div>';
  $('upl').innerHTML = S.upcoming.length
    ? S.upcoming.map((k) => rowHtml(k, true)).join('')
    : '<div class="empty">No tasks scheduled for later dates.</div>';
  $('upl').hidden = !ui.upOpen;
  $('upn').textContent = `${ui.upOpen ? 'Hide upcoming' : 'Upcoming'} (${S.upcoming.length})`;

  if (ui.editing && ui.editing !== 'new') {
    const row = document.querySelector(`[data-row="${CSS.escape(ui.editing)}"]`);
    if (row) row.after($('form'));
  }
  paintDeadlines();
  renderSettings();
}

function renderSettings() {
  $('settings').hidden = !ui.settingsOpen;
  if (!ui.settingsOpen) return;
  const s = S.settings;
  const g = S.google;
  let google;
  if (!g.configured) {
    google = '<div class="muted">Google sync isn\'t set up in this build.</div>';
  } else if (!g.signedIn) {
    google = '<div class="set-row"><button class="chip" data-a="gin">Sign in with Google</button></div>'
      + '<div class="muted">Optional. Copies your tasks to a "Daily scheduler" list in Google Tasks, so you can see and tick them on your phone.</div>';
  } else {
    const last = g.syncing ? 'Syncing…' : g.lastSync ? `Last synced ${new Date(g.lastSync).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : 'Not synced yet';
    google = `<div class="muted">Signed in as ${esc(g.email || 'your Google account')}</div>`
      + `<div class="set-row"><span class="muted">${last}</span><span class="grow"></span><button class="chip" data-a="gsync">Sync now</button><button class="chip" data-a="gout">Sign out</button></div>`;
  }
  if (g.error) google += `<div class="err">${esc(g.error)}</div>`;

  $('settings').innerHTML = `
    <div><h3>Window</h3>
      <div class="set-row"><label><input type="checkbox" data-set="aboveApps"${s.aboveApps ? ' checked' : ''}>Show above other apps</label></div>
      <div class="set-row"><label><input type="checkbox" data-set="launchAtLogin"${s.launchAtLogin ? ' checked' : ''}>Open when the computer starts</label></div>
    </div>
    <div><h3>Google Tasks</h3>${google}</div>
    <div><h3>Backup</h3>
      <div class="set-row"><button class="chip" data-a="export">Export to file</button><button class="chip" data-a="import">Import from file</button></div>
      ${ui.backupMsg ? `<div class="muted">${esc(ui.backupMsg)}</div>` : ''}
    </div>
    <div class="about">Daily scheduler v${esc(S.version)}<br>Planned and designed by Md Abdullah Saeed Khan.<br>Built with Claude Code. MIT licence.<br>
      <button class="link" data-a="repo">Project page</button></div>
    <div class="set-row"><span class="grow"></span><button class="chip" data-a="hide">Hide note</button><button class="chip" data-a="quit">Quit</button></div>`;
}

// ---------- add / edit form ----------

function formChips() {
  const s = ui.sel;
  $('rt').classList.toggle('on', !!s.routine);
  $('dt').classList.toggle('on', !!s.date);
  $('ut').hidden = !s.routine;
  $('ut').classList.toggle('on', !!s.until);
  $('dl').hidden = !!s.routine; // deadlines are for one-off tasks
  $('dl').classList.toggle('on', !!s.deadline);
  $('dll').textContent = s.deadline ? `Due ${fmtDate(s.deadline)}` : 'Deadline';
  $('tm').classList.toggle('on', !!s.time);
  $('dtl').textContent = s.date ? `${s.routine ? 'From ' : ''}${fmtDate(s.date)}` : s.routine ? 'From today' : 'Today';
  $('utl').textContent = s.until ? `Until ${fmtDate(s.until)}` : 'No end';
  $('tml').textContent = s.time ? fmtTime(s.time) : 'Remind';
  let hint = '';
  if (s.routine) {
    hint = `Shows every day${s.date ? ` starting ${fmtDate(s.date)}` : ''}${s.until ? ` until ${fmtDate(s.until)}` : ''}`;
    if (s.time) hint += `, reminder at ${fmtTime(s.time)}`;
  } else if (s.deadline) {
    hint = `Shows every day${s.date ? ` from ${fmtDate(s.date)}` : ''} until it's done, due ${fmtDate(s.deadline)}`;
  } else if (s.date) {
    hint = `Hidden in Upcoming until ${fmtDate(s.date)}`;
  }
  $('hint').textContent = hint;
}

function openForm(id) {
  const k = id ? [...S.items, ...S.upcoming].find((x) => x.id === id) : null;
  ui.editing = k ? k.id : 'new';
  ui.sel = k
    ? { routine: k.routine, date: k.date > S.today ? k.date : null, until: k.until, time: k.time, deadline: k.due ? k.due.deadline : null }
    : { routine: false, date: null, until: null, time: null, deadline: null };
  ui.calMode = null;
  $('inp').value = k ? k.title : '';
  $('addl').textContent = k ? 'Save' : 'Add';
  $('cal').hidden = true;
  $('tbox').hidden = true;
  $('err').hidden = true;
  $('form').hidden = false;
  formChips();
  render();
  $('inp').focus();
}

function closeForm() {
  ui.editing = null;
  $('form').hidden = true;
  render();
}

async function submitForm() {
  const title = $('inp').value.trim();
  if (!title) { $('err').hidden = false; $('inp').focus(); return; }
  const s = ui.sel;
  const id = ui.editing !== 'new' ? ui.editing : undefined;
  await window.api.saveTask({ id, title, routine: !!s.routine, date: s.date || S.today, until: s.routine ? s.until : null, time: s.time, deadline: s.routine ? null : s.deadline });
  if (id) toast('Saved');
  else if (s.date) toast(`${s.routine ? 'Daily from' : 'Saved for'} ${fmtDate(s.date)}`);
  closeForm();
}

function renderCal() {
  const [y, m] = ui.calMonth;
  const first = new Date(y, m, 1);
  $('mlabel').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const later = ui.calMode === 'until' || ui.calMode === 'deadline';
  const min = later ? (ui.sel.date || S.today) : S.today;
  const selected = later ? ui.sel[ui.calMode] : (ui.sel.date || S.today);
  const lead = (first.getDay() + 6) % 7; // weeks start on Monday
  const days = new Date(y, m + 1, 0).getDate();
  let h = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span class="dow">${x}</span>`).join('');
  h += '<span></span>'.repeat(lead);
  for (let i = 1; i <= days; i++) {
    const ds = toYmd(new Date(y, m, i));
    const cls = [ds === selected ? 'sel' : '', ds === S.today ? 'today' : ''].join(' ').trim();
    h += `<button data-a="day" data-d="${ds}" class="${cls}"${ds < min ? ' disabled' : ''}>${i}</button>`;
  }
  $('grid').innerHTML = h;
  $('calfoot').hidden = !later;
  $('noend').textContent = ui.calMode === 'deadline' ? 'No deadline' : 'No end date';
}

function openCal(mode) {
  if (ui.calMode === mode && !$('cal').hidden) { $('cal').hidden = true; ui.calMode = null; return; }
  ui.calMode = mode;
  const base = parseYmd((mode === 'date' ? ui.sel.date : ui.sel[mode]) || ui.sel.date || S.today);
  ui.calMonth = [base.getFullYear(), base.getMonth()];
  $('tbox').hidden = true;
  $('cal').hidden = false;
  renderCal();
}

// ---------- events ----------

async function act(a, el) {
  const id = el.dataset.id;
  switch (a) {
    case 'pal': ui.palOpen = !ui.palOpen; render(); break;
    case 'theme': await window.api.setSettings({ theme: el.dataset.n }); break;
    case 'settings': ui.settingsOpen = !ui.settingsOpen; ui.backupMsg = ''; if (S.settings.collapsed) await window.api.setSettings({ collapsed: false }); render(); break;
    case 'ck': await window.api.toggleTask(id); break;
    case 'edit': openForm(id); break;
    case 'del': {
      if (ui.editing === id) closeForm();
      ui.lastDel = await window.api.deleteTask(id);
      toast('Task deleted <button class="chip" data-a="undo">Undo</button>', 5000);
      break;
    }
    case 'undo':
      if (ui.lastDel) { await window.api.restoreTask(ui.lastDel); ui.lastDel = null; }
      toast('Restored');
      break;
    case 'up': ui.upOpen = !ui.upOpen; render(); break;
    case 'plus': openForm(null); break;
    case 'cancel': closeForm(); break;
    case 'add': await submitForm(); break;
    case 'rt':
      ui.sel.routine = !ui.sel.routine;
      if (ui.sel.routine) ui.sel.deadline = null; else ui.sel.until = null;
      if (ui.calMode === 'deadline' || ui.calMode === 'until') { $('cal').hidden = true; ui.calMode = null; }
      formChips();
      break;
    case 'dl': openCal('deadline'); break;
    case 'dt': openCal('date'); break;
    case 'ut': openCal('until'); break;
    case 'tm':
      $('cal').hidden = true; ui.calMode = null;
      $('tbox').hidden = !$('tbox').hidden;
      if (ui.sel.time) $('tin').value = ui.sel.time;
      if (!$('tbox').hidden) $('tin').focus();
      break;
    case 'tset': ui.sel.time = $('tin').value || null; $('tbox').hidden = true; formChips(); break;
    case 'tclr': ui.sel.time = null; $('tbox').hidden = true; formChips(); break;
    case 'mprev': {
      const [y, m] = ui.calMonth;
      const t = parseYmd(S.today);
      if (y * 12 + m > t.getFullYear() * 12 + t.getMonth()) { ui.calMonth = m === 0 ? [y - 1, 11] : [y, m - 1]; renderCal(); }
      break;
    }
    case 'mnext': { const [y, m] = ui.calMonth; ui.calMonth = m === 11 ? [y + 1, 0] : [y, m + 1]; renderCal(); break; }
    case 'day': {
      const ds = el.dataset.d;
      if (ui.calMode === 'until' || ui.calMode === 'deadline') ui.sel[ui.calMode] = ds;
      else {
        ui.sel.date = ds === S.today ? null : ds;
        const start = ui.sel.date || S.today;
        if (ui.sel.until && ui.sel.until < start) ui.sel.until = null;
        if (ui.sel.deadline && ui.sel.deadline < start) ui.sel.deadline = null;
      }
      $('cal').hidden = true; ui.calMode = null; formChips();
      break;
    }
    case 'noend': ui.sel[ui.calMode === 'deadline' ? 'deadline' : 'until'] = null; $('cal').hidden = true; ui.calMode = null; formChips(); break;
    case 'gin': await window.api.googleSignIn(); break;
    case 'gout': await window.api.googleSignOut(); break;
    case 'gsync': await window.api.googleSync(); break;
    case 'export': {
      const r = await window.api.exportTasks();
      if (r) { ui.backupMsg = `Exported ${r.count} task${r.count === 1 ? '' : 's'}`; render(); }
      break;
    }
    case 'import': {
      const r = await window.api.importTasks();
      if (r) { ui.backupMsg = r.error || `Imported ${r.count} task${r.count === 1 ? '' : 's'}`; render(); }
      break;
    }
    case 'nkeep': await window.api.setSettings({ startupNoticeSeen: true }); break;
    case 'noff': await window.api.setSettings({ startupNoticeSeen: true, launchAtLogin: false }); break;
    case 'repo': window.api.openRepo(); break;
    case 'hide': window.api.hide(); break;
    case 'quit': window.api.quit(); break;
  }
}

note.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (el) { e.stopPropagation(); act(el.dataset.a, el); return; }
  if (e.target.closest('#hd') && !e.target.closest('#pal')) {
    window.api.setSettings({ collapsed: !S.settings.collapsed });
  }
});
note.addEventListener('dblclick', (e) => {
  const t = e.target.closest('.txt');
  if (t) openForm(t.dataset.id);
});
note.addEventListener('change', (e) => {
  const k = e.target.dataset.set;
  if (k) window.api.setSettings({ [k]: e.target.checked });
});
$('inp').addEventListener('input', () => { $('err').hidden = true; });
$('inp').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitForm();
  if (e.key === 'Escape') closeForm();
});
$('tin').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') act('tset', e.target);
});

// Drag the left edge to change the width; the window grows to the left.
let drag = null;
$('grab').addEventListener('pointerdown', (e) => {
  drag = { x: e.screenX, w: window.innerWidth };
  $('grab').setPointerCapture(e.pointerId);
});
$('grab').addEventListener('pointermove', (e) => {
  if (!drag) return;
  window.api.setSize(drag.w + (drag.x - e.screenX), window.innerHeight);
});
$('grab').addEventListener('pointerup', () => { drag = null; });

// The window is as tall as the note.
new ResizeObserver(() => {
  window.api.setSize(window.innerWidth, Math.ceil(note.getBoundingClientRect().height) + 2);
}).observe(note);

window.api.onState((s) => {
  const dayChanged = S && S.today !== s.today;
  S = s;
  if (dayChanged && ui.editing === 'new') closeForm();
  render();
});
window.api.getState().then((s) => { S = s; render(); });
