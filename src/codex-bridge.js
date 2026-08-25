'use strict';

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const IMAGE_EXTENSIONS = new Set(['.avif', '.bmp', '.gif', '.heic', '.heif', '.jpeg', '.jpg', '.png', '.webp']);

function executable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findCodexBinary() {
  const candidates = [
    process.env.CODEX_PATH,
    '/Applications/Codex.app/Contents/Resources/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    path.join(os.homedir(), '.local', 'bin', 'codex'),
    ...String(process.env.PATH || '').split(path.delimiter).map((entry) => path.join(entry, 'codex'))
  ].filter(Boolean);

  return [...new Set(candidates)].find(executable) || null;
}

function asError(message, code = 'CODEX_BRIDGE_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function preferredWorkingDirectory(filePaths, fallback) {
  if (!filePaths.length) return fallback;
  try {
    const first = fs.statSync(filePaths[0]);
    return first.isDirectory() ? filePaths[0] : path.dirname(filePaths[0]);
  } catch {
    return fallback;
  }
}

class CodexBridge extends EventEmitter {
  constructor({ defaultCwd, version = '1.0.0' } = {}) {
    super();
    this.defaultCwd = defaultCwd || os.homedir();
    this.version = version;
    this.binary = findCodexBinary();
    this.process = null;
    this.reader = null;
    this.pending = new Map();
    this.nextId = 1;
    this.connecting = null;
    this.ready = false;
    this.activeThreadId = null;
    this.activeTurnId = null;
    this.latestAnswer = '';
  }

  availability() {
    return this.binary
      ? { state: this.ready ? 'ready' : 'connecting', message: this.ready ? 'Codex 已连接' : '正在连接 Codex…' }
      : { state: 'offline', message: '未检测到 Codex' };
  }

  emitStatus(state, message, detail = {}) {
    this.emit('status', { state, message, ...detail });
  }

  async connect() {
    if (this.ready && this.process) return;
    if (this.connecting) return this.connecting;
    if (!this.binary) throw asError('未检测到 Codex 应用或 Codex CLI', 'CODEX_NOT_FOUND');

    this.connecting = this.startServer();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async startServer() {
    this.emitStatus('connecting', '正在连接 Codex…');
    const child = spawn(this.binary, ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, RUST_LOG: process.env.RUST_LOG || 'error' }
    });
    this.process = child;
    this.reader = readline.createInterface({ input: child.stdout });
    this.reader.on('line', (line) => this.handleLine(line));
    child.stderr.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) console.warn('Codex app-server:', text.slice(0, 500));
    });
    child.once('error', (error) => this.handleExit(error));
    child.once('exit', (code, signal) => {
      const reason = asError(`Codex 服务已退出 (${signal || code || 0})`, 'CODEX_SERVER_EXITED');
      this.handleExit(reason);
    });

    await this.request('initialize', {
      clientInfo: {
        name: 'codex_desk_pet',
        title: 'Codex Desk Pet',
        version: this.version
      },
      capabilities: { experimentalApi: true }
    });
    this.notify('initialized', {});

    const account = await this.request('account/read', { refreshToken: false });
    if (account?.requiresOpenaiAuth && !account?.account) {
      throw asError('请先在 Codex 中登录', 'CODEX_LOGIN_REQUIRED');
    }

    this.ready = true;
    this.emitStatus('ready', 'Codex 已连接');
  }

  send(payload) {
    if (!this.process?.stdin?.writable) throw asError('Codex 服务尚未连接', 'CODEX_NOT_CONNECTED');
    this.process.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  notify(method, params) {
    this.send({ method, params });
  }

  request(method, params, timeoutMs = 20000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(asError(`Codex 请求超时：${method}`, 'CODEX_TIMEOUT'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (Object.hasOwn(message, 'id') && (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error'))) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(asError(message.error.message || 'Codex 请求失败', 'CODEX_RPC_ERROR'));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (Object.hasOwn(message, 'id') && message.method) {
      this.send({ id: message.id, error: { code: -32001, message: '桌宠处于只读模式，无法批准交互操作。' } });
      return;
    }

    if (message.method) this.handleNotification(message.method, message.params || {});
  }

  handleNotification(method, params) {
    if (method === 'turn/started') {
      this.emitStatus('working', 'Codex 正在思考…');
      return;
    }

    if (method === 'item/completed' && params.item?.type === 'agentMessage') {
      const text = String(params.item.text || '').trim();
      if (text) this.latestAnswer = text;
      return;
    }

    if (method === 'turn/completed') {
      const status = params.turn?.status || params.status || 'completed';
      const failed = status === 'failed';
      const interrupted = status === 'interrupted';
      const message = failed
        ? 'Codex 处理失败'
        : interrupted
          ? 'Codex 已停止'
          : this.latestAnswer || 'Codex 已完成';
      this.emitStatus(failed ? 'error' : interrupted ? 'ready' : 'completed', message, {
        answer: this.latestAnswer,
        turnStatus: status
      });
      this.activeTurnId = null;
      return;
    }

    if (method === 'error') {
      const text = params.error?.message || params.message || 'Codex 发生错误';
      this.emitStatus('error', text);
    }
  }

  async ask(prompt, inputPaths = []) {
    const text = String(prompt || '').trim();
    if (!text) throw asError('请输入要问 Codex 的内容', 'EMPTY_PROMPT');
    if (this.activeTurnId) throw asError('Codex 正在处理上一项任务', 'CODEX_BUSY');

    const validPaths = inputPaths
      .slice(0, 5)
      .map((filePath) => path.resolve(String(filePath)))
      .filter((filePath) => fs.existsSync(filePath));
    const cwd = preferredWorkingDirectory(validPaths, this.defaultCwd);
    await this.connect();

    const threadResult = await this.request('thread/start', {
      cwd,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
      personality: 'friendly',
      serviceName: 'codex-desk-pet',
      developerInstructions: 'Use the same language as the user. Be concise. This desktop-pet session is strictly read-only: do not modify files or external state.'
    });
    const threadId = threadResult?.thread?.id || threadResult?.threadId;
    if (!threadId) throw asError('Codex 没有返回任务 ID', 'CODEX_INVALID_RESPONSE');

    const pathContext = validPaths.length
      ? `\n\n用户拖入的本地路径：\n${validPaths.map((filePath) => `- ${filePath}`).join('\n')}`
      : '';
    const input = [{ type: 'text', text: `${text}${pathContext}` }];
    validPaths.forEach((filePath) => {
      if (IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
        input.push({ type: 'localImage', path: filePath });
      }
    });

    this.activeThreadId = threadId;
    this.latestAnswer = '';
    const turnResult = await this.request('turn/start', {
      threadId,
      input,
      cwd,
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: true }
    });
    this.activeTurnId = turnResult?.turn?.id || turnResult?.turnId || 'active';
    this.emitStatus('working', 'Codex 正在思考…');
    return { started: true, threadId, paths: validPaths };
  }

  handleExit(error) {
    if (this.process) {
      this.process.removeAllListeners();
      this.process = null;
    }
    this.ready = false;
    this.activeThreadId = null;
    this.activeTurnId = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    if (!this.connecting) this.emitStatus('offline', error.message);
  }

  close() {
    this.reader?.close();
    this.reader = null;
    if (this.process && !this.process.killed) this.process.kill();
    this.process = null;
    this.ready = false;
  }
}

module.exports = { CodexBridge, findCodexBinary };
