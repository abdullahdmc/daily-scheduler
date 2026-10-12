'use strict';

const THEMES = {
  Yellow: ['#FAEEDA', '#FAC775', '#EF9F27', '#633806', '#854F0B'],
  Pink: ['#FBEAF0', '#F4C0D1', '#ED93B1', '#72243E', '#993556'],
  Blue: ['#E6F1FB', '#B5D4F4', '#85B7EB', '#0C447C', '#185FA5'],
  Green: ['#EAF3DE', '#C0DD97', '#97C459', '#27500A', '#3B6D11'],
  Lavender: ['#EEEDFE', '#CECBF6', '#AFA9EC', '#3C3489', '#534AB7'],
};

window.api.getReminder().then((r) => {
  if (!r) return;
  const card = document.getElementById('card');
  const c = THEMES[r.theme] || THEMES.Yellow;
  ['--bg', '--hd', '--bd', '--tx', '--ic'].forEach((v, i) => card.style.setProperty(v, c[i]));
  const [h, m] = r.time.split(':').map(Number);
  const time = new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  document.getElementById('when').textContent = `${r.missed ? 'Missed reminder' : 'Daily scheduler'} · ${time}`;
  document.getElementById('title').textContent = r.title;
});

document.getElementById('done').onclick = () => window.api.reminderAction('done');
document.getElementById('snooze').onclick = () => window.api.reminderAction('snooze');
document.getElementById('x').onclick = () => window.api.reminderAction('dismiss');
document.getElementById('title').onclick = () => window.api.reminderAction('open');
