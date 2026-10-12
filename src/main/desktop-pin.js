'use strict';

// Keeps the note on the desktop, behind other apps, like a desktop widget.
//
// Windows: the note is made an "owned" window of the desktop (Progman), which keeps it visible
// when you press Win+D, and is pushed to the bottom of the window stack whenever it loses focus.
// macOS and Linux: there's no way to sit at desktop level and still receive clicks, so the note
// is an ordinary window that other apps cover.

const HWND_BOTTOM = 1;
const GWLP_HWNDPARENT = -8;
const SWP_NOSIZE = 0x1;
const SWP_NOMOVE = 0x2;
const SWP_NOACTIVATE = 0x10;

let win32 = null;
function user32() {
  if (win32 !== null) return win32;
  win32 = false;
  if (process.platform !== 'win32') return win32;
  try {
    const koffi = require('koffi');
    const lib = koffi.load('user32.dll');
    win32 = {
      FindWindowW: lib.func('intptr __stdcall FindWindowW(str16 cls, str16 name)'),
      SetWindowLongPtrW: lib.func('intptr __stdcall SetWindowLongPtrW(intptr hwnd, int index, intptr value)'),
      SetWindowPos: lib.func('bool __stdcall SetWindowPos(intptr hwnd, intptr after, int x, int y, int cx, int cy, uint flags)'),
    };
  } catch {
    // Without the native helper the note still works, it just won't survive Win+D.
  }
  return win32;
}

const hwndOf = (win) => {
  const buf = win.getNativeWindowHandle();
  return buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
};

function pinToDesktop(win) {
  const api = user32();
  if (!api) return;
  const progman = api.FindWindowW('Progman', null);
  if (progman) api.SetWindowLongPtrW(hwndOf(win), GWLP_HWNDPARENT, progman);
}

function sendToBack(win) {
  const api = user32();
  if (api) {
    api.SetWindowPos(hwndOf(win), HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
  }
}

// mode: true = float above other apps, false = stay on the desktop.
function applyMode(win, aboveApps) {
  win.setAlwaysOnTop(!!aboveApps);
  if (!aboveApps) sendToBack(win);
}

function setup(win, getAboveApps) {
  pinToDesktop(win);
  applyMode(win, getAboveApps());
  win.on('blur', () => { if (!getAboveApps()) sendToBack(win); });
}

module.exports = { setup, applyMode, sendToBack };
