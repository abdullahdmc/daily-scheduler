'use strict';

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, powerMonitor, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const T = require('./tasks');
const { createStore } = require('./store');
const { createAuth } = require('./google-auth');
const { sync } = require('./google-sync');
const { setLaunchAtLogin } = require('./autostart');
const desktopPin = require('./desktop-pin');

const REPO_URL = 'https://github.com/abdullahdmc/daily-scheduler';
const TWO_INCHES = 192; // Electron positions in device-independent pixels, 96 per inch
const RENDERER = path.join(__dirname, '..', 'renderer');
const ICON = path.join(__dirname, '..', '..', 'build', 'icon.png');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showNote());
  app.whenReady().then(start);
}

let store, auth, note, tray;
let syncing = false;
let syncError = null;
let syncTimer = null;
let lastUndoable = 0;
const reminderWins = [];

function start() {
  if (process.platform === 'darwin') app.dock?.hide();
  store = createStore(app.getPath('userData'));
  auth = createAuth(app.getPath('userData'));
  const s = store.state.settings;

  if (!s.firstRunDone) {
    s.firstRunDone = true;
    setLaunchAtLogin(s.launchAtLogin);
    store.save();
  }

  dayCheck();
  createNote();
  createTray();
  registerIpc();

  setInterval(tick, 20 * 1000);
  setInterval(() => scheduleSync(0), 5 * 60 * 1000);
  powerMonitor.on('resume', () => { tick(); scheduleSync(2000); });
  powerMonitor.on('unlock-screen', tick);
  setTimeout(tick, 3000);
  scheduleSync(3000);
}

// The app lives in the tray, so closing every window shouldn't quit it.
app.on('window-all-closed', () => {});
app.on('before-quit', () => store?.flush());

// ---------- state ----------

function today() { return T.ymd(new Date()); }

function dayCheck() {
  const st = store.state;
  const d = today();
  const rolled = T.rollover(st.tasks, d);
  if (st.lastDay !== d || rolled) {
    st.lastDay = d;
    store.save();
    return true;
  }
  return false;
}

function purgeTombstones() {
  if (auth.signedIn) return; // sync removes them once Google has been updated
  const cutoff = Date.now() - 60 * 1000;
  const before = store.state.tasks.length;
  store.state.tasks = store.state.tasks.filter((t) => !(t.deleted && t.updatedAt < cutoff));
  if (store.state.tasks.length !== before) store.save();
}

function view() {
  const st = store.state;
  const d = today();
  return {
    today: d,
    items: T.todayView(st.tasks, d),
    upcoming: T.upcomingView(st.tasks, d),
    settings: st.settings,
    google: {
      configured: auth.configured,
      signedIn: auth.signedIn,
      email: auth.email,
      lastSync: st.google.lastSync || null,
      syncing,
      error: syncError,
    },
    version: app.getVersion(),
    repoUrl: REPO_URL,
  };
}

function broadcast() {
  if (note && !note.isDestroyed()) note.webContents.send('state', view());
}

function changed({ syncSoon = true } = {}) {
  store.save();
  broadcast();
  if (syncSoon) scheduleSync(4000);
}

function tick() {
  if (dayCheck()) { broadcast(); scheduleSync(1000); }
  purgeTombstones();
  const fired = T.dueReminders(store.state.tasks);
  if (fired.length) {
    store.save();
    for (const f of fired) showReminder(f.task, f.missed);
  }
}

// ---------- note window ----------

function defaultPosition(width) {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - width - 16, y: wa.y + TWO_INCHES };
}

function positionIsVisible(x, y, width) {
  return screen.getAllDisplays().some(({ workArea: wa }) =>
    x + width - 20 >= wa.x && x + 20 <= wa.x + wa.width && y >= wa.y && y + 20 <= wa.y + wa.height);
}

function createNote() {
  const s = store.state.settings;
  const width = Math.max(280, Math.min(900, s.width || 380));
  let { x, y } = s;
  if (x == null || y == null || !positionIsVisible(x, y, width)) ({ x, y } = defaultPosition(width));

  note = new BrowserWindow({
    x, y, width, height: 120,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: !!s.aboveApps,
    show: false,
    title: 'Daily scheduler',
    icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  note.loadFile(path.join(RENDERER, 'index.html'));
  note.once('ready-to-show', () => {
    note.showInactive();
    desktopPin.setup(note, () => !!store.state.settings.aboveApps);
  });
  note.on('moved', () => {
    const b = note.getBounds();
    Object.assign(store.state.settings, { x: b.x, y: b.y });
    store.save();
  });
  note.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  note.webContents.on('will-navigate', (e) => e.preventDefault());
}

function showNote() {
  if (!note || note.isDestroyed()) createNote();
  note.show();
  note.focus();
}

function createTray() {
  let img = nativeImage.createFromPath(ICON);
  img = img.resize({ width: process.platform === 'darwin' ? 18 : 16 });
  tray = new Tray(img);
  tray.setToolTip('Daily scheduler');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show note', click: showNote },
    { label: 'Hide note', click: () => note.hide() },
    { label: 'Move back to default spot', click: resetPosition },
    { type: 'separator' },
    { label: 'Quit Daily scheduler', click: () => app.quit() },
  ]));
  // Brings the note in front of your apps until you click somewhere else.
  tray.on('click', showNote);
}

function resetPosition() {
  const b = note.getBounds();
  const { x, y } = defaultPosition(b.width);
  note.setBounds({ ...b, x, y });
  Object.assign(store.state.settings, { x, y });
  store.save();
  showNote();
}

// ---------- reminders ----------

function layoutReminders() {
  const wa = screen.getPrimaryDisplay().workArea;
  reminderWins.forEach((w, i) => {
    const [width, height] = w.getSize();
    w.setPosition(wa.x + wa.width - width - 16, wa.y + wa.height - (height + 12) * (i + 1));
  });
}

function showReminder(task, missed) {
  const existing = reminderWins.find((w) => w.taskId === task.id);
  if (existing) { existing.close(); }
  const w = new BrowserWindow({
    width: 320, height: 132,
    frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true,
    show: false, transparent: true, hasShadow: false,
    title: 'Reminder',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  w.taskId = task.id;
  w.reminder = { id: task.id, title: task.title, time: task.time, missed, theme: store.state.settings.theme };
  w.setAlwaysOnTop(true, 'screen-saver');
  w.loadFile(path.join(RENDERER, 'reminder.html'));
  w.once('ready-to-show', () => { w.showInactive(); shell.beep(); });
  w.on('closed', () => {
    reminderWins.splice(reminderWins.indexOf(w), 1);
    layoutReminders();
  });
  reminderWins.push(w);
  layoutReminders();
}

// ---------- Google sync ----------

async function googleApi(method, url, body) {
  const token = await auth.accessToken();
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {};
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error?.message || `Google returned ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

function scheduleSync(delay) {
  if (!auth?.signedIn) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, delay);
}

async function runSync() {
  if (!auth.signedIn) return;
  if (syncing) { scheduleSync(5000); return; }
  // Leave time to press Undo before a delete reaches Google.
  if (Date.now() - lastUndoable < 6000) { scheduleSync(6000); return; }
  syncing = true;
  broadcast();
  try {
    await sync(store.state, googleApi);
    syncError = null;
  } catch (err) {
    syncError = err instanceof TypeError
      ? 'Can\'t reach Google right now. It\'ll try again in a few minutes.'
      : err.message || 'Sync failed';
  } finally {
    syncing = false;
    store.save();
    broadcast();
  }
}

function forgetGoogleMappings() {
  for (const t of store.state.tasks) { delete t.g; delete t.gDays; }
  store.state.google = {};
}

// ---------- IPC ----------

function registerIpc() {
  ipcMain.handle('state:get', () => view());

  ipcMain.handle('task:save', (_e, input) => {
    T.upsert(store.state.tasks, input);
    changed();
  });
  ipcMain.handle('task:toggle', (_e, id) => {
    T.toggleDone(store.state.tasks, id);
    changed();
  });
  ipcMain.handle('task:delete', (_e, id) => {
    const snap = T.remove(store.state.tasks, id);
    lastUndoable = Date.now();
    changed();
    return snap;
  });
  ipcMain.handle('task:restore', (_e, snap) => {
    if (snap && snap.id) T.restore(store.state.tasks, snap);
    changed();
  });

  ipcMain.handle('settings:set', (_e, patch) => {
    const s = store.state.settings;
    const allowed = ['theme', 'collapsed', 'aboveApps', 'launchAtLogin'];
    for (const k of allowed) if (k in patch) s[k] = patch[k];
    if ('aboveApps' in patch) desktopPin.applyMode(note, !!s.aboveApps);
    if ('launchAtLogin' in patch) setLaunchAtLogin(!!s.launchAtLogin);
    changed({ syncSoon: false });
  });

  ipcMain.on('window:size', (_e, { width, height }) => {
    if (!note || note.isDestroyed()) return;
    const b = note.getBounds();
    const w = Math.round(Math.max(280, Math.min(900, width || b.width)));
    const h = Math.round(Math.max(40, Math.min(1400, height || b.height)));
    if (w === b.width && h === b.height) return;
    // Widening by the left edge keeps the right edge where it is.
    note.setBounds({ x: b.x + b.width - w, y: b.y, width: w, height: h });
    if (w !== b.width) {
      Object.assign(store.state.settings, { width: w, x: b.x + b.width - w });
      store.save();
    }
  });

  ipcMain.handle('google:signIn', async () => {
    try {
      await auth.signIn();
      forgetGoogleMappings();
      syncError = null;
      broadcast();
      scheduleSync(0);
    } catch (err) {
      syncError = err.message;
      broadcast();
    }
  });
  ipcMain.handle('google:signOut', async () => {
    await auth.signOut();
    forgetGoogleMappings();
    syncError = null;
    changed({ syncSoon: false });
    purgeTombstones();
  });
  ipcMain.handle('google:sync', () => scheduleSync(0));

  ipcMain.handle('backup:export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(note, {
      title: 'Export tasks',
      defaultPath: `daily-scheduler-backup-${today()}.json`,
      filters: [{ name: 'Backup file', extensions: ['json'] }],
    });
    if (canceled || !filePath) return null;
    const tasks = store.state.tasks.filter((t) => !t.deleted).map((t) => {
      const c = { ...t };
      delete c.g; delete c.gDays;
      return c;
    });
    fs.writeFileSync(filePath, JSON.stringify({ app: 'daily-scheduler', exportedAt: new Date().toISOString(), tasks }, null, 2));
    return { count: tasks.length };
  });
  ipcMain.handle('backup:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(note, {
      title: 'Import tasks',
      properties: ['openFile'],
      filters: [{ name: 'Backup file', extensions: ['json'] }],
    });
    if (canceled || !filePaths[0]) return null;
    try {
      const data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
      if (!Array.isArray(data.tasks)) throw new Error();
      const count = T.importTasks(store.state.tasks, data.tasks);
      T.rollover(store.state.tasks, today());
      changed();
      return { count };
    } catch {
      return { error: 'That file isn\'t a Daily scheduler backup' };
    }
  });

  ipcMain.handle('app:hide', () => note.hide());
  ipcMain.handle('app:quit', () => app.quit());
  ipcMain.handle('app:openRepo', () => shell.openExternal(REPO_URL));

  ipcMain.handle('reminder:get', (e) => BrowserWindow.fromWebContents(e.sender)?.reminder || null);
  ipcMain.handle('reminder:act', (e, action) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return;
    const id = w.taskId;
    const t = store.state.tasks.find((x) => x.id === id);
    if (t && action === 'done' && !T.isDoneOn(t, today())) { T.toggleDone(store.state.tasks, id); changed(); }
    if (t && action === 'snooze') { T.snooze(store.state.tasks, id, 10); changed({ syncSoon: false }); }
    if (action === 'open') showNote();
    w.close();
  });
}
