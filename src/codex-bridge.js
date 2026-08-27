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

function formatConversationHistory(history) {
  if (!Array.isArray(history) || !history.length) return '';
  const entries = history
    .slice(-24)
    .map((message) => {
      const role = message?.role === 'assistant' ? '助手' : '用户';
      const text = String(message?.text || '').trim().slice(0, 6000);
      return text ? `${role}：${text}` : '';
    })
    .filter(Boolean);
  if (!entries.length) return '';
  const transcript = entries.join('\n\n').slice(-16000);
  return `以下是这个桌宠会话在上次运行中保存的记录。请延续其中的上下文，不要重复这些内容：\n\n${transcript}\n\n用户的新问题：\n`;
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
    this.threadCwd = null;
    this.activeConversationId = null;
    this.conversationSessions = new Map();
    this.activeTurnId = null;
    this.latestAnswer = '';
    this.streamTimer = null;
  }

  availability() {
    return this.binary
      ? { state: this.ready ? 'ready' : 'connecting', message: this.ready ? 'Codex 已连接' : '正在连接 Codex…' }
      : { state: 'offline', message: '未检测到 Codex' };
  }

  emitStatus(state, message, detail = {}) {
    this.emit('status', {
      state,
      message,
      ...(this.activeConversationId ? { conversationId: this.activeConversationId } : {}),
      ...detail
    });
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
      this.activeTurnId = params.turn?.id || params.turnId || this.activeTurnId;
      this.emitStatus('working', 'Codex 正在思考…');
      return;
    }

    if (method === 'item/agentMessage/delta') {
      const delta = String(params.delta || '');
      if (!delta) return;
      this.latestAnswer += delta;
      this.emitStreamingStatus();
      return;
    }

    if (method === 'item/completed' && params.item?.type === 'agentMessage') {
      const text = String(params.item.text || '').trim();
      if (text) this.latestAnswer = text;
      return;
    }

    if (method === 'turn/completed') {
      clearTimeout(this.streamTimer);
      this.streamTimer = null;
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

  emitStreamingStatus() {
    if (this.streamTimer) return;
    this.streamTimer = setTimeout(() => {
      this.streamTimer = null;
      this.emitStatus('working', 'Codex 正在回复…', {
        answer: this.latestAnswer,
        partial: true
      });
    }, 80);
  }

  async ensureThread(cwd, conversationId) {
    const resolvedCwd = path.resolve(cwd);
    const session = this.conversationSessions.get(conversationId);
    if (session?.threadId && session.cwd === resolvedCwd) {
      this.activeThreadId = session.threadId;
      this.threadCwd = session.cwd;
      return { threadId: session.threadId, reused: true };
    }

    const threadResult = await this.request('thread/start', {
      cwd: resolvedCwd,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
      personality: 'friendly',
      serviceName: 'codex-desk-pet',
      developerInstructions: 'Use the same language as the user. Be concise and conversational. Remember earlier turns in this desktop-pet conversation. This session is strictly read-only: do not modify files or external state.'
    });
    const threadId = threadResult?.thread?.id || threadResult?.threadId;
    if (!threadId) throw asError('Codex 没有返回任务 ID', 'CODEX_INVALID_RESPONSE');
    this.activeThreadId = threadId;
    this.threadCwd = resolvedCwd;
    this.conversationSessions.set(conversationId, { threadId, cwd: resolvedCwd });
    return { threadId, reused: false };
  }

  async ask(prompt, inputPaths = [], conversationId = 'default', history = []) {
    const text = String(prompt || '').trim();
    if (!text) throw asError('请输入要问 Codex 的内容', 'EMPTY_PROMPT');
    if (this.activeTurnId) throw asError('Codex 正在处理上一项任务', 'CODEX_BUSY');
    this.activeTurnId = 'starting';
    this.activeConversationId = String(conversationId || 'default').slice(0, 120);

    try {
      const validPaths = inputPaths
        .slice(0, 5)
        .map((filePath) => path.resolve(String(filePath)))
        .filter((filePath) => fs.existsSync(filePath));
      const cwd = preferredWorkingDirectory(validPaths, this.defaultCwd);
      await this.connect();
      const { threadId, reused } = await this.ensureThread(cwd, this.activeConversationId);

      const pathContext = validPaths.length
        ? `\n\n用户拖入的本地路径：\n${validPaths.map((filePath) => `- ${filePath}`).join('\n')}`
        : '';
      const historyContext = reused ? '' : formatConversationHistory(history);
      const input = [{ type: 'text', text: `${historyContext}${text}${pathContext}` }];
      validPaths.forEach((filePath) => {
        if (IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
          input.push({ type: 'localImage', path: filePath });
        }
      });

      this.latestAnswer = '';
      const turnResult = await this.request('turn/start', {
        threadId,
        input,
        cwd,
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly', networkAccess: true }
      });
      if (this.activeTurnId === 'starting') {
        this.activeTurnId = turnResult?.turn?.id || turnResult?.turnId || 'active';
      }
      this.emitStatus('working', 'Codex 正在思考…', {
        answer: this.latestAnswer,
        partial: Boolean(this.latestAnswer)
      });
      return {
        started: true,
        threadId,
        reused,
        conversationId: this.activeConversationId,
        restoredHistory: Boolean(historyContext),
        paths: validPaths
      };
    } catch (error) {
      this.activeTurnId = null;
      throw error;
    }
  }

  async stop() {
    if (!this.activeTurnId || this.activeTurnId === 'starting' || !this.activeThreadId) {
      return { stopped: false };
    }
    await this.request('turn/interrupt', {
      threadId: this.activeThreadId,
      turnId: this.activeTurnId
    });
    this.emitStatus('working', '正在停止 Codex…', { answer: this.latestAnswer, partial: true });
    return { stopped: true };
  }

  newConversation(conversationId) {
    if (this.activeTurnId) throw asError('请先停止当前回复', 'CODEX_BUSY');
    const id = String(conversationId || '').slice(0, 120);
    if (id) this.conversationSessions.delete(id);
    if (!id || this.activeConversationId === id) {
      this.activeThreadId = null;
      this.threadCwd = null;
      this.activeConversationId = null;
    }
    this.latestAnswer = '';
    this.emitStatus('ready', '已开启新对话');
    return { reset: true };
  }

  handleExit(error) {
    if (this.process) {
      this.process.removeAllListeners();
      this.process = null;
    }
    this.ready = false;
    this.activeThreadId = null;
    this.threadCwd = null;
    this.activeConversationId = null;
    this.conversationSessions.clear();
    this.activeTurnId = null;
    clearTimeout(this.streamTimer);
    this.streamTimer = null;
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
    this.activeThreadId = null;
    this.threadCwd = null;
    this.activeConversationId = null;
    this.conversationSessions.clear();
    this.activeTurnId = null;
    clearTimeout(this.streamTimer);
    this.streamTimer = null;
  }
}

module.exports = { CodexBridge, findCodexBinary };
