'use strict';
// 潤稿台 desktop app: a window around the same index.html the web app uses.
// The page is served from a private rungao:// origin (not file://) so it keeps its
// own storage for drafts, history and the API key, and can call the Claude API.

const { app, BrowserWindow, Menu, nativeTheme, net, protocol, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SCHEME = 'rungao';
const APP_DIR = path.join(__dirname, 'app');
const START_URL = `${SCHEME}://app/index.html`;

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function serveApp() {
  protocol.handle(SCHEME, (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(APP_DIR, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
    if (!file.startsWith(APP_DIR + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function openOutside(url) {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
}

// The window reopens where it was last closed, as long as that spot is still on a screen.
const boundsFile = () => path.join(app.getPath('userData'), 'window.json');
function savedBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(boundsFile(), 'utf8'));
    if (!(b.width >= 380 && b.height >= 560)) return null;
    const onScreen = screen.getAllDisplays().some(({ workArea: a }) =>
      b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y);
    return onScreen ? b : { width: b.width, height: b.height, maximized: b.maximized };
  } catch {
    return null;
  }
}
function rememberBounds(win) {
  try {
    if (win.isMinimized() || win.isFullScreen()) return;
    fs.writeFileSync(boundsFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch {}
}

function createWindow() {
  const saved = savedBounds();
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    ...(saved ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : {}),
    minWidth: 380,
    minHeight: 560,
    title: '潤稿台',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1412' : '#edf1ee',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${SCHEME}://`)) {
      event.preventDefault();
      openOutside(url);
    }
  });
  win.on('close', () => rememberBounds(win));
  if (saved && saved.maximized) win.maximize();
  win.loadURL(START_URL);
  return win;
}

// Without an Edit menu, copy and paste shortcuts do nothing on macOS.
const MENU = [
  ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
  { role: 'fileMenu' },
  { role: 'editMenu' },
  { role: 'viewMenu' },
  { role: 'windowMenu' },
];

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAboutPanelOptions({
      applicationName: '潤稿台',
      applicationVersion: app.getVersion(),
      copyright: '繁中潤飾・繁轉簡・中英互換・原語潤飾',
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate(MENU));
    serveApp();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
