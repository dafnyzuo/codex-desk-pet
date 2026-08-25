'use strict';

const { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, Notification, screen, shell, Tray } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { CodexBridge } = require('./codex-bridge');

const PET_SIZES = Object.freeze({
  mini: { label: '迷你', width: 232, height: 284 },
  small: { label: '小巧', width: 284, height: 344 },
  standard: { label: '标准', width: 340, height: 412 }
});
const DEFAULT_PET_SIZE = 'small';
const EXPANDED_SIZE = { width: 350, height: 500 };
const EDGE_SNAP_DISTANCE = 64;
const STATE_FILENAME = 'window-state.json';

let mainWindow = null;
let tray = null;
let isQuitting = false;
let dragState = null;
let compactBounds = null;
let codexBridge = null;
let codexStatus = { state: 'connecting', message: '正在连接 Codex…' };
let petSize = DEFAULT_PET_SIZE;

function petDimensions(size = petSize) {
  const { width, height } = PET_SIZES[size] || PET_SIZES[DEFAULT_PET_SIZE];
  return { width, height };
}

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
  const dimensions = petDimensions();
  return {
    x: Math.round(workArea.x + workArea.width - dimensions.width - 28),
    y: Math.round(workArea.y + workArea.height - dimensions.height - 18)
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
  const dimensions = petDimensions();
  const candidate = {
    x: Number.isFinite(saved.x) ? Math.round(saved.x) : 0,
    y: Number.isFinite(saved.y) ? Math.round(saved.y) : 0,
    ...dimensions
  };
  return isVisibleOnAnyDisplay(candidate) ? { x: candidate.x, y: candidate.y } : defaultPosition();
}

function clampToDisplay(bounds) {
  const { workArea } = screen.getDisplayMatching(bounds);
  return {
    ...bounds,
    x: Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - bounds.width)),
    y: Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - bounds.height))
  };
}

function snapToDisplayEdge(bounds) {
  const { workArea } = screen.getDisplayMatching(bounds);
  const clamped = clampToDisplay(bounds);
  const edges = [
    { distance: Math.abs(clamped.x - workArea.x), axis: 'x', value: workArea.x },
    {
      distance: Math.abs(workArea.x + workArea.width - (clamped.x + clamped.width)),
      axis: 'x',
      value: workArea.x + workArea.width - clamped.width
    },
    { distance: Math.abs(clamped.y - workArea.y), axis: 'y', value: workArea.y },
    {
      distance: Math.abs(workArea.y + workArea.height - (clamped.y + clamped.height)),
      axis: 'y',
      value: workArea.y + workArea.height - clamped.height
    }
  ];
  const nearest = edges.sort((a, b) => a.distance - b.distance)[0];
  if (nearest.distance <= EDGE_SNAP_DISTANCE) clamped[nearest.axis] = nearest.value;
  return clamped;
}

function setPetSize(nextSize) {
  if (!PET_SIZES[nextSize] || nextSize === petSize) return;
  petSize = nextSize;
  writeState({ petSize });

  if (!mainWindow || mainWindow.isDestroyed()) return;
  const dimensions = petDimensions();
  mainWindow.webContents.send('pet:size', petSize);

  if (compactBounds) {
    compactBounds = clampToDisplay({
      x: compactBounds.x + compactBounds.width - dimensions.width,
      y: compactBounds.y + compactBounds.height - dimensions.height,
      ...dimensions
    });
    return;
  }

  const bounds = mainWindow.getBounds();
  const resized = clampToDisplay({
    x: bounds.x + bounds.width - dimensions.width,
    y: bounds.y + bounds.height - dimensions.height,
    ...dimensions
  });
  mainWindow.setBounds(resized, true);
  writeState({ x: resized.x, y: resized.y });
}

function sendMessage(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pet:message', message);
  }
}

function sendStatus(status) {
  codexStatus = {
    ...status,
    message: truncate(status.message || ''),
    ...(status.answer ? { answer: truncate(status.answer, 600) } : {})
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pet:status', codexStatus);
  }
}

function truncate(text, length = 150) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > length ? `${normalized.slice(0, length - 1)}…` : normalized;
}

function setPetExpanded(expanded) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (expanded) {
    if (compactBounds) return;
    compactBounds = mainWindow.getBounds();
    mainWindow.setBounds({
      x: compactBounds.x - (EXPANDED_SIZE.width - compactBounds.width),
      y: compactBounds.y - (EXPANDED_SIZE.height - compactBounds.height),
      ...EXPANDED_SIZE
    }, true);
    mainWindow.show();
    return;
  }

  if (compactBounds) {
    mainWindow.setBounds(compactBounds, true);
    compactBounds = null;
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
    { label: '问问 Codex', click: () => mainWindow?.webContents.send('pet:open-ask') },
    { label: '打开 Codex', click: openCodex },
    { label: '回到右下角', click: resetPosition },
    {
      label: '桌宠尺寸',
      submenu: Object.entries(PET_SIZES).map(([value, config]) => ({
        label: config.label,
        type: 'radio',
        checked: petSize === value,
        click: () => setPetSize(value)
      }))
    },
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
  const dimensions = petDimensions();

  mainWindow = new BrowserWindow({
    ...dimensions,
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
    mainWindow.webContents.send('pet:size', petSize);
    sendMessage('点 ✦ 可直接问 Codex');
    sendStatus(codexStatus);
    if (process.env.PET_CAPTURE_EXPANDED) {
      setTimeout(() => mainWindow?.webContents.send('pet:open-ask'), 120);
    }
  });

  mainWindow.on('moved', () => {
    if (!mainWindow || mainWindow.isDestroyed() || compactBounds) return;
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
  ipcMain.handle('pet:get-status', () => codexStatus);
  ipcMain.handle('pet:get-size', () => petSize);
  ipcMain.handle('pet:ask', async (_event, payload = {}) => {
    const prompt = String(payload.prompt || '').slice(0, 8000);
    const paths = Array.isArray(payload.paths) ? payload.paths.slice(0, 5) : [];
    try {
      return await codexBridge.ask(prompt, paths);
    } catch (error) {
      const fallbackText = [prompt, paths.length ? `\n本地文件：\n${paths.join('\n')}` : ''].join('').trim();
      if (fallbackText) clipboard.writeText(fallbackText);
      sendStatus({
        state: 'fallback',
        message: `${error.message}；问题已复制，正在打开 Codex`,
        errorCode: error.code
      });
      await openCodex();
      return { started: false, fallback: true, error: error.message };
    }
  });
  ipcMain.on('pet:hide', () => mainWindow?.hide());
  ipcMain.on('pet:set-expanded', (_event, expanded) => setPetExpanded(Boolean(expanded)));
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
    if (mainWindow && !mainWindow.isDestroyed() && dragState) {
      const snapped = snapToDisplayEdge(mainWindow.getBounds());
      mainWindow.setBounds(snapped, true);
      writeState({ x: snapped.x, y: snapped.y });
    }
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
    const saved = readState();
    const captureSize = process.env.PET_CAPTURE_SIZE;
    petSize = PET_SIZES[captureSize]
      ? captureSize
      : PET_SIZES[saved.petSize]
        ? saved.petSize
        : DEFAULT_PET_SIZE;
    codexBridge = new CodexBridge({ defaultCwd: app.getPath('documents'), version: app.getVersion() });
    codexStatus = codexBridge.availability();
    codexBridge.on('status', (status) => {
      sendStatus({ ...status, message: truncate(status.message || status.answer || '') });
      if (status.state === 'completed' && Notification.isSupported()) {
        new Notification({
          title: 'Codex 已完成',
          body: truncate(status.answer || status.message || '任务处理完成', 140),
          silent: false
        }).show();
      }
    });
    registerIpc();
    createWindow();
    if (!process.env.PET_CAPTURE_PATH) createTray();
    codexBridge.connect().catch((error) => {
      sendStatus({ state: 'offline', message: error.message, errorCode: error.code });
    });
  });
}

app.on('activate', () => {
  if (mainWindow) mainWindow.showInactive();
});

app.on('before-quit', () => {
  isQuitting = true;
  codexBridge?.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
