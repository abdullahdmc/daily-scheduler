'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  theme: 'Yellow',
  width: 380,
  x: null,
  y: null,
  collapsed: false,
  aboveApps: false,
  launchAtLogin: true,
  firstRunDone: false,
};

function createStore(dir) {
  const file = path.join(dir, 'data.json');
  let state = { version: 1, tasks: [], settings: { ...DEFAULT_SETTINGS }, lastDay: null, google: {} };

  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    state = {
      ...state,
      ...raw,
      settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
      tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
      google: raw.google || {},
    };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Keep the unreadable file instead of overwriting it, so nothing is lost.
      try { fs.copyFileSync(file, `${file}.broken-${Date.now()}`); } catch {}
    }
  }

  let timer = null;
  function writeNow() {
    clearTimeout(timer);
    timer = null;
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
  }
  function save() {
    clearTimeout(timer);
    timer = setTimeout(writeNow, 300);
  }

  return { get state() { return state; }, save, flush: () => timer && writeNow(), file };
}

module.exports = { createStore, DEFAULT_SETTINGS };
