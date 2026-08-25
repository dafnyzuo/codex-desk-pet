'use strict';

const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, shell } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const WINDOW_SIZE = { width: 368, height: 492 };
const STATE_FILENAME = 'window-state.json';

let mainWindow = null;
let tray = null;
let isQuitting = false;
let dragState = null;

function statePath() {
  return path.join(app.getPath('userData'), STATE_FILENAME);
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeState(patch) {
  try {
    const next = { ...readState(), ...patch };
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(next, null, 2));
  } catch (error) {
    console.warn('Could not save desktop-pet state:', error.message);
  }
}

function defaultPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: Math.round(workArea.x + workArea.width - WINDOW_SIZE.width - 28),
    y: Math.round(workArea.y + workArea.height - WINDOW_SIZE.height - 18)
  };
}

function isVisibleOnAnyDisplay(bounds) {
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapWidth = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
    const overlapHeight = Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y);
    return overlapWidth >= 80 && overlapHeight >= 80;
  });
}

function savedPosition() {
  const saved = readState();
  const candidate = {
    x: Number.isFinite(saved.x) ? Math.round(saved.x) : 0,
    y: Number.isFinite(saved.y) ? Math.round(saved.y) : 0,
    ...WINDOW_SIZE
  };
  return isVisibleOnAnyDisplay(candidate) ? { x: candidate.x, y: candidate.y } : defaultPosition();
}

function sendMessage(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pet:message', message);
  }
}

function openCodex() {
  return new Promise((resolve) => {
    execFile('/usr/bin/open', ['-a', 'Codex'], { timeout: 5000 }, async (error) => {
      if (!error) {
        sendMessage('Codex 已打开 ✨');
        resolve({ opened: true, fallback: false });
        return;
      }

      sendMessage('没有找到 Codex，已打开网页版');
      try {
        await shell.openExternal('https://chatgpt.com/codex');
        resolve({ opened: true, fallback: true });
      } catch {
        sendMessage('暂时打不开 Codex，请先安装应用');
        resolve({ opened: false, fallback: false });
      }
    });
  });
}

function resetPosition() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const position = defaultPosition();
  mainWindow.setPosition(position.x, position.y, true);
  writeState(position);
  mainWindow.showInactive();
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.showInactive();
  }
}

function setLaunchAtLogin(enabled) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: false });
}

function contextMenuTemplate() {
  const openAtLogin = app.isPackaged && app.getLoginItemSettings().openAtLogin;
  return [
    { label: mainWindow?.isVisible() ? '隐藏桌宠' : '显示桌宠', click: toggleWindow },
    { label: '打开 Codex', click: openCodex },
    { label: '回到右下角', click: resetPosition },
    { type: 'separator' },
    {
      label: '登录时启动',
      type: 'checkbox',
      checked: openAtLogin,
      enabled: app.isPackaged,
      click: ({ checked }) => setLaunchAtLogin(checked)
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ];
}

function showContextMenu() {
  Menu.buildFromTemplate(contextMenuTemplate()).popup({ window: mainWindow });
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'build', 'tray.png');
  const trayImage = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
  tray = new Tray(trayImage);
  tray.setToolTip('Codex Desk Pet');
  tray.setContextMenu(Menu.buildFromTemplate(contextMenuTemplate()));
  tray.on('click', toggleWindow);
  tray.on('right-click', () => tray.setContextMenu(Menu.buildFromTemplate(contextMenuTemplate())));
}

function createWindow() {
  const position = savedPosition();
  const capturePath = process.env.PET_CAPTURE_PATH;

  mainWindow = new BrowserWindow({
    ...WINDOW_SIZE,
    ...position,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    acceptFirstMouse: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.showInactive();
    sendMessage('单击互动，双击打开 Codex');
  });

  mainWindow.on('moved', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [x, y] = mainWindow.getPosition();
    writeState({ x, y });
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting && !capturePath) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.webContents.on('context-menu', (event) => {
    event.preventDefault();
    showContextMenu();
  });

  if (capturePath) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const image = await mainWindow.webContents.capturePage();
          const outputPath = path.resolve(capturePath);
          fs.mkdirSync(path.dirname(outputPath), { recursive: true });
          fs.writeFileSync(outputPath, image.toPNG());
        } finally {
          isQuitting = true;
          app.quit();
        }
      }, 1200);
    });
  }
}

function registerIpc() {
  ipcMain.handle('pet:open-codex', openCodex);
  ipcMain.on('pet:hide', () => mainWindow?.hide());
  ipcMain.on('pet:context-menu', showContextMenu);
  ipcMain.on('pet:set-ignore-mouse', (_event, ignore) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
  });
  ipcMain.on('pet:drag-start', (_event, point) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [x, y] = mainWindow.getPosition();
    dragState = { windowX: x, windowY: y, pointerX: point.x, pointerY: point.y };
  });
  ipcMain.on('pet:drag-move', (_event, point) => {
    if (!dragState || !mainWindow || mainWindow.isDestroyed()) return;
    const x = Math.round(dragState.windowX + point.x - dragState.pointerX);
    const y = Math.round(dragState.windowY + point.y - dragState.pointerY);
    mainWindow.setPosition(x, y, false);
  });
  ipcMain.on('pet:drag-end', () => {
    dragState = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => mainWindow?.showInactive());
  app.whenReady().then(() => {
    if (process.platform === 'darwin') app.dock.hide();
    registerIpc();
    createWindow();
    if (!process.env.PET_CAPTURE_PATH) createTray();
  });
}

app.on('activate', () => {
  if (mainWindow) mainWindow.showInactive();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
