'use strict';

const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  shell,
  Tray
} = require('electron');
const { execFile, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { CodexBridge } = require('./codex-bridge');

const PET_SIZES = Object.freeze({
  mini: { label: '迷你', width: 232, height: 284 },
  small: { label: '小巧', width: 284, height: 344 },
  standard: { label: '标准', width: 340, height: 412 }
});
const DEFAULT_PET_SIZE = 'small';
const EXPANDED_SIZE = { width: 408, height: 640 };
const EDGE_SNAP_DISTANCE = 104;
const MENU_BAR_SAFE_INSET = 34;
const DOCK_SAFE_INSET_MIN = 58;
const DOCK_SAFE_INSET_MAX = 112;
const STATE_FILENAME = 'window-state.json';
const GLOBAL_WAKE_SHORTCUT = 'CommandOrControl+Shift+Space';
const GLOBAL_WAKE_SHORTCUT_LABEL = '⌘⇧Space';
const MOTION_PREVIEWS = Object.freeze([
  { label: '眨眼', name: 'is-blinking' },
  { label: '点头', name: 'is-nodding' },
  { label: '跳一下', name: 'is-hopping' },
  { label: '探头看看', name: 'is-peeking' },
  { label: '挥挥手', name: 'is-waving' },
  { label: '伸懒腰', name: 'is-stretching' },
  { label: '吓一跳', name: 'is-shaking' },
  { label: '左右跳舞', name: 'is-dancing' },
  { label: '开心庆祝', name: 'is-cheering' },
  { label: '送你一颗心', name: 'is-hearting' }
]);

let mainWindow = null;
let tray = null;
let isQuitting = false;
let dragState = null;
let compactBounds = null;
let codexBridge = null;
let codexStatus = { state: 'connecting', message: '正在连接 Codex…' };
let petSize = DEFAULT_PET_SIZE;
let dockPreferences = { orientation: 'bottom', autohide: false, tileSize: 64 };

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

function readDockPreference(key) {
  if (process.platform !== 'darwin') return '';
  try {
    return execFileSync('/usr/bin/defaults', ['read', 'com.apple.dock', key], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000
    }).trim();
  } catch {
    return '';
  }
}

function refreshDockPreferences() {
  const orientation = readDockPreference('orientation');
  const autohide = readDockPreference('autohide');
  const tileSize = Number(readDockPreference('tilesize'));
  dockPreferences = {
    orientation: ['left', 'right', 'bottom'].includes(orientation) ? orientation : 'bottom',
    autohide: ['1', 'true', 'YES'].includes(autohide),
    tileSize: Number.isFinite(tileSize) && tileSize > 0 ? tileSize : 64
  };
}

function safeWorkArea(display) {
  const { bounds, workArea } = display;
  let left = Math.max(bounds.x, workArea.x);
  let top = Math.max(bounds.y + MENU_BAR_SAFE_INSET, workArea.y);
  let right = Math.min(bounds.x + bounds.width, workArea.x + workArea.width);
  let bottom = Math.min(bounds.y + bounds.height, workArea.y + workArea.height);

  if (process.platform === 'darwin') {
    const dockInset = Math.max(
      DOCK_SAFE_INSET_MIN,
      Math.min(DOCK_SAFE_INSET_MAX, Math.round(dockPreferences.tileSize + 12))
    );
    if (dockPreferences.orientation === 'left') left = Math.max(left, bounds.x + dockInset);
    if (dockPreferences.orientation === 'right') right = Math.min(right, bounds.x + bounds.width - dockInset);
    if (dockPreferences.orientation === 'bottom') bottom = Math.min(bottom, bounds.y + bounds.height - dockInset);
  }

  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

function defaultPosition() {
  const workArea = safeWorkArea(screen.getPrimaryDisplay());
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
  if (!isVisibleOnAnyDisplay(candidate)) return defaultPosition();
  const clamped = clampToDisplay(candidate);
  return { x: clamped.x, y: clamped.y };
}

function clampToDisplay(bounds) {
  const workArea = safeWorkArea(screen.getDisplayMatching(bounds));
  return {
    ...bounds,
    x: Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - bounds.width)),
    y: Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - bounds.height))
  };
}

function snapToDisplayEdge(bounds) {
  const workArea = safeWorkArea(screen.getDisplayMatching(bounds));
  const clamped = clampToDisplay(bounds);
  const edges = [
    { edge: 'left', distance: Math.abs(clamped.x - workArea.x), axis: 'x', value: workArea.x },
    {
      edge: 'right',
      distance: Math.abs(workArea.x + workArea.width - (clamped.x + clamped.width)),
      axis: 'x',
      value: workArea.x + workArea.width - clamped.width
    },
    { edge: 'top', distance: Math.abs(clamped.y - workArea.y), axis: 'y', value: workArea.y },
    {
      edge: 'bottom',
      distance: Math.abs(workArea.y + workArea.height - (clamped.y + clamped.height)),
      axis: 'y',
      value: workArea.y + workArea.height - clamped.height
    }
  ];
  const nearest = edges.sort((a, b) => a.distance - b.distance)[0];
  const edge = nearest.distance <= EDGE_SNAP_DISTANCE ? nearest.edge : null;
  if (edge) clamped[nearest.axis] = nearest.value;
  return { bounds: clamped, edge };
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
    ...(status.answer ? { answer: preserveAnswer(status.answer, 16000) } : {})
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pet:status', codexStatus);
  }
}

function preserveAnswer(text, length = 16000) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  return normalized.length > length ? `${normalized.slice(0, length - 1)}…` : normalized;
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
    mainWindow.setBounds(clampToDisplay({
      x: compactBounds.x - (EXPANDED_SIZE.width - compactBounds.width),
      y: compactBounds.y - (EXPANDED_SIZE.height - compactBounds.height),
      ...EXPANDED_SIZE
    }), true);
    mainWindow.show();
    return;
  }

  if (compactBounds) {
    mainWindow.setBounds(compactBounds, true);
    compactBounds = null;
  }
}

function temporaryCapturePath(prefix, extension) {
  const directory = path.join(app.getPath('temp'), 'codex-desk-pet');
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, `${prefix}-${Date.now()}.${extension}`);
}

function isNonEmptyFile(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

function captureRegion() {
  if (process.platform !== 'darwin') {
    return Promise.resolve({ captured: false, error: '区域截图目前仅支持 macOS' });
  }

  const filePath = temporaryCapturePath('screenshot', 'png');
  mainWindow?.hide();
  return new Promise((resolve) => {
    execFile('/usr/sbin/screencapture', ['-i', '-x', filePath], (error) => {
      mainWindow?.showInactive();
      const captured = !error && isNonEmptyFile(filePath);
      if (captured) {
        resolve({ captured: true, path: filePath });
      } else {
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch {}
        resolve({ captured: false, cancelled: true });
      }
    });
  });
}

function captureCurrentScreen() {
  if (process.platform !== 'darwin') {
    return Promise.resolve({ captured: false, error: '屏幕截图目前仅支持 macOS' });
  }

  const filePath = temporaryCapturePath('screen', 'png');
  const display = mainWindow
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay();
  const { x, y, width, height } = display.bounds;
  mainWindow?.hide();
  return new Promise((resolve) => {
    setTimeout(() => {
      execFile('/usr/sbin/screencapture', ['-x', '-R', `${x},${y},${width},${height}`, filePath], (error) => {
        mainWindow?.showInactive();
        const captured = !error && isNonEmptyFile(filePath);
        if (captured) {
          resolve({ captured: true, path: filePath });
        } else {
          try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          } catch {}
          resolve({ captured: false, error: '没有截取到当前屏幕，请检查屏幕录制权限。' });
        }
      });
    }, 140);
  });
}

async function selectFiles() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择要交给 Codex 的文件',
    buttonLabel: '选择文件',
    properties: ['openFile', 'multiSelections']
  });
  return {
    selected: !result.canceled && result.filePaths.length > 0,
    paths: result.filePaths.slice(0, 5)
  };
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

function wakePet() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.showInactive();
  if (mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('pet:wake', { shortcut: GLOBAL_WAKE_SHORTCUT_LABEL });
    });
    return;
  }
  mainWindow.webContents.send('pet:wake', { shortcut: GLOBAL_WAKE_SHORTCUT_LABEL });
}

function registerGlobalShortcuts() {
  const registered = globalShortcut.register(GLOBAL_WAKE_SHORTCUT, wakePet);
  if (!registered) {
    console.warn(`Could not register global shortcut: ${GLOBAL_WAKE_SHORTCUT}`);
  } else {
    console.info(`Registered global shortcut: ${GLOBAL_WAKE_SHORTCUT}`);
  }
}

function setLaunchAtLogin(enabled) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: false });
}

function contextMenuTemplate() {
  const openAtLogin = app.isPackaged && app.getLoginItemSettings().openAtLogin;
  return [
    { label: '唤醒桌宠', accelerator: GLOBAL_WAKE_SHORTCUT, click: wakePet },
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
    {
      label: '动作预览',
      submenu: MOTION_PREVIEWS.map(({ label, name }) => ({
        label,
        click: () => mainWindow?.webContents.send('pet:play-motion', name)
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
  tray.setToolTip(`Codex Desk Pet · ${GLOBAL_WAKE_SHORTCUT_LABEL} 唤醒`);
  tray.setContextMenu(Menu.buildFromTemplate(contextMenuTemplate()));
  tray.on('click', toggleWindow);
  tray.on('right-click', () => tray.setContextMenu(Menu.buildFromTemplate(contextMenuTemplate())));
}

function createWindow() {
  const position = savedPosition();
  const capturePath = process.env.PET_CAPTURE_PATH;
  const captureMotion = process.env.PET_CAPTURE_MOTION;
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
      if (captureMotion) {
        setTimeout(() => mainWindow?.webContents.send('pet:play-motion', captureMotion), 120);
      }
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
  ipcMain.handle('pet:capture-screen', captureCurrentScreen);
  ipcMain.handle('pet:capture-region', captureRegion);
  ipcMain.handle('pet:select-files', selectFiles);
  ipcMain.handle('pet:copy-text', (_event, text) => {
    clipboard.writeText(String(text || ''));
    return { copied: true };
  });
  ipcMain.handle('pet:stop', async () => {
    try {
      return await codexBridge.stop();
    } catch (error) {
      sendStatus({ state: 'error', message: error.message, errorCode: error.code });
      return { stopped: false, error: error.message };
    }
  });
  ipcMain.handle('pet:new-conversation', (_event, conversationId) => {
    try {
      return codexBridge.newConversation(conversationId);
    } catch (error) {
      return { reset: false, error: error.message };
    }
  });
  ipcMain.handle('pet:ask', async (_event, payload = {}) => {
    const prompt = String(payload.prompt || '').slice(0, 8000);
    const paths = Array.isArray(payload.paths) ? payload.paths.slice(0, 5) : [];
    const conversationId = String(payload.conversationId || 'default').slice(0, 120);
    const history = Array.isArray(payload.history)
      ? payload.history.slice(-24).map((message) => ({
        role: message?.role === 'assistant' ? 'assistant' : 'user',
        text: String(message?.text || '').slice(0, 6000)
      }))
      : [];
    try {
      return await codexBridge.ask(prompt, paths, conversationId, history);
    } catch (error) {
      if (['CODEX_BUSY', 'EMPTY_PROMPT'].includes(error.code)) {
        sendStatus({
          state: error.code === 'CODEX_BUSY' ? 'working' : 'ready',
          message: error.message,
          conversationId
        });
        return { started: false, fallback: false, error: error.message };
      }
      const fallbackText = [prompt, paths.length ? `\n本地文件：\n${paths.join('\n')}` : ''].join('').trim();
      if (fallbackText) clipboard.writeText(fallbackText);
      sendStatus({
        state: 'fallback',
        message: `${error.message}；问题已复制，正在打开 Codex`,
        errorCode: error.code,
        conversationId
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
    dragState = { windowX: x, windowY: y, pointerX: point.x, pointerY: point.y, snapEdge: null };
  });
  ipcMain.on('pet:drag-move', (_event, point) => {
    if (!dragState || !mainWindow || mainWindow.isDestroyed()) return;
    const x = Math.round(dragState.windowX + point.x - dragState.pointerX);
    const y = Math.round(dragState.windowY + point.y - dragState.pointerY);
    const snapped = snapToDisplayEdge({ ...mainWindow.getBounds(), x, y });
    mainWindow.setBounds(snapped.bounds, false);
    if (dragState.snapEdge !== snapped.edge) {
      dragState.snapEdge = snapped.edge;
      mainWindow.webContents.send('pet:snap-state', { edge: snapped.edge, final: false });
    }
  });
  ipcMain.on('pet:drag-end', () => {
    if (mainWindow && !mainWindow.isDestroyed() && dragState) {
      const snapped = snapToDisplayEdge(mainWindow.getBounds());
      mainWindow.setBounds(snapped.bounds, true);
      mainWindow.webContents.send('pet:snap-state', { edge: snapped.edge, final: true });
      writeState({ x: snapped.bounds.x, y: snapped.bounds.y });
    }
    dragState = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', wakePet);
  app.whenReady().then(() => {
    if (process.platform === 'darwin') app.dock.hide();
    refreshDockPreferences();
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
      sendStatus({ ...status, message: status.message || status.answer || '' });
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
    registerGlobalShortcuts();
    if (!process.env.PET_CAPTURE_PATH) createTray();
    codexBridge.connect().catch((error) => {
      sendStatus({ state: 'offline', message: error.message, errorCode: error.code });
    });
  });
}

app.on('activate', () => {
  wakePet();
});

app.on('before-quit', () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  codexBridge?.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
