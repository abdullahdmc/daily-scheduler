'use strict';

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Windows and macOS have a built-in API; Linux desktops read ~/.config/autostart/*.desktop.
const linuxFile = () => path.join(os.homedir(), '.config', 'autostart', 'daily-scheduler.desktop');

function setLaunchAtLogin(enabled) {
  if (!app.isPackaged) return; // don't register the development copy of Electron
  if (process.platform === 'linux') {
    const file = linuxFile();
    if (!enabled) {
      try { fs.unlinkSync(file); } catch {}
      return;
    }
    const exec = process.env.APPIMAGE || process.execPath;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, [
      '[Desktop Entry]',
      'Type=Application',
      'Name=Daily scheduler',
      `Exec="${exec}"`,
      'X-GNOME-Autostart-enabled=true',
      '',
    ].join('\n'));
    return;
  }
  app.setLoginItemSettings({ openAtLogin: enabled });
}

module.exports = { setLaunchAtLogin };
