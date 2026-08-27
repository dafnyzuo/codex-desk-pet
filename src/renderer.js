'use strict';

const stage = document.querySelector('#stage');
const bubble = document.querySelector('#bubble');
const bubbleText = document.querySelector('#bubble-text');
const statusDot = document.querySelector('#status-dot');
const character = document.querySelector('#character');
const petImage = document.querySelector('#pet-image');
const petMotionVideo = document.querySelector('#pet-motion-video');
const askButton = document.querySelector('#ask-button');
const openButton = document.querySelector('#open-button');
const hideButton = document.querySelector('#hide-button');
const askPanel = document.querySelector('#ask-panel');
const promptInput = document.querySelector('#prompt-input');
const connectionState = document.querySelector('#connection-state');
const attachment = document.querySelector('#attachment');
const attachmentName = document.querySelector('#attachment-name');
const removeAttachment = document.querySelector('#remove-attachment');
const closeAsk = document.querySelector('#close-ask');
const sendAsk = document.querySelector('#send-ask');
const stopAsk = document.querySelector('#stop-ask');
const activeConversationTitle = document.querySelector('#active-conversation-title');
const captureScreenButton = document.querySelector('#capture-screen');
const captureRegionButton = document.querySelector('#capture-region');
const selectFilesButton = document.querySelector('#select-files');
const conversationSwitchButton = document.querySelector('#conversation-switch');
const conversationSwitcher = document.querySelector('#conversation-switcher');
const createConversationButton = document.querySelector('#create-conversation');
const conversationList = document.querySelector('#conversation-list');
const conversation = document.querySelector('#conversation');
const conversationEmpty = document.querySelector('#conversation-empty');
const dropOverlay = document.querySelector('#drop-overlay');
const motionLabel = document.querySelector('#motion-label');
const snapIndicator = document.querySelector('#snap-indicator');

const messages = [
  '今天想把什么做出来？',
  '先拆小，再动手。',
  '我在，随时可以开始。',
  '把文件拖给我也可以。',
  '点 ✦ 可以直接问 Codex。'
];

let bubbleTimer = null;
let reactionTimer = null;
let tapTimer = null;
let lastTapAt = 0;
let drag = null;
let ignoringMouse = false;
let panelOpen = false;
let attachedPaths = [];
let contextFallbackPrompt = '';
let busy = false;
let dropDepth = 0;
let idleTimer = null;
let motionTimer = null;
let lastInteractionAt = Date.now();
let lastIdleMotion = null;
let dozedSinceInteraction = false;
let activeAssistantMessage = null;
let activeAssistantRecord = null;
let lastSubmitted = null;
let lastStatusState = null;
let conversations = [];
let activeConversationId = null;
const retryPayloads = new WeakMap();

const CONVERSATION_STORAGE_KEY = 'codex-desk-pet.conversations.v1';
const ACTIVE_CONVERSATION_KEY = 'codex-desk-pet.active-conversation.v1';
const MAX_CONVERSATIONS = 10;
const MAX_MESSAGES_PER_CONVERSATION = 40;
const MAX_STORED_MESSAGE_LENGTH = 8000;

const IDLE_MOTION_MIN_DELAY = 35000;
const IDLE_MOTION_MAX_DELAY = 55000;
const DOZE_AFTER = 120000;

const BASE_PET_ASSET = '../assets/pet.png';
const idleMotions = [
  { name: 'is-blinking', asset: '../assets/pet-blink.png', duration: 1100, label: '眨眨眼 ✦', message: '眨眨眼，我在听。' },
  { name: 'is-nodding', asset: '../assets/pet-nod.png', duration: 1500, label: '点点头 ✓', message: '嗯嗯，收到。' },
  { name: 'is-hopping', asset: '../assets/pet-hop.png', duration: 1650, label: '跳一下 ↑', message: '精神满满，开始吧！' },
  { name: 'is-peeking', asset: '../assets/pet-peek.png', duration: 1900, label: '探头看看 👀', message: '我来看看有什么新任务。' },
  {
    name: 'is-waving',
    asset: '../assets/pet-wave.png',
    videoAsset: '../assets/pet-wave-loop.webm',
    duration: 5050,
    label: '连续挥手 👋',
    message: '嗨，我一直在这里。'
  },
  { name: 'is-stretching', asset: '../assets/pet-stretch.png', duration: 2100, label: '伸个懒腰 ↕', message: '伸展一下，继续工作。' },
  { name: 'is-shaking', asset: '../assets/pet-shake.png', duration: 1700, label: '吓一跳 ✦', message: '哎呀！吓我一跳。' },
  { name: 'is-dancing', asset: '../assets/pet-wave.png', duration: 2800, label: '左右跳舞 ♪', message: '放松一下，跳两步。' },
  { name: 'is-cheering', asset: '../assets/pet-hop.png', duration: 2700, label: '开心庆祝 ✦', message: '完成一件事，值得庆祝！' },
  { name: 'is-hearting', asset: '../assets/pet-wave.png', duration: 2600, label: '送你一颗心 ♥', message: '辛苦啦，给你一点能量。' }
];
const statusMotionAssets = {
  'is-dozing': '../assets/pet-blink.png',
  'is-celebrating': '../assets/pet-hop.png',
  'is-sad': '../assets/pet-nod.png'
};
const transientMotions = [
  ...idleMotions.map(({ name }) => name),
  'is-dozing',
  'is-celebrating',
  'is-sad'
];
const tapMotionNames = new Set([
  'is-blinking',
  'is-nodding',
  'is-hopping',
  'is-waving',
  'is-dancing',
  'is-cheering',
  'is-hearting'
]);

function pickMotion(motions = idleMotions) {
  const choices = motions.filter(({ name }) => name !== lastIdleMotion);
  const motion = choices[Math.floor(Math.random() * choices.length)];
  lastIdleMotion = motion.name;
  return motion;
}

function clearMotions(motions = transientMotions) {
  motions.forEach((motion) => character.classList.remove(motion));
  motionLabel.textContent = '';
  petMotionVideo.pause();
  petMotionVideo.hidden = true;
  petMotionVideo.removeAttribute('src');
  petMotionVideo.load();
  petImage.hidden = false;
  if (petImage.getAttribute('src') !== BASE_PET_ASSET) petImage.src = BASE_PET_ASSET;
}

function playMotion(motion, duration, { force = false, showLabel = false } = {}) {
  if (!force && (panelOpen || drag || busy)) return;
  const config = idleMotions.find(({ name }) => name === motion);
  window.clearTimeout(motionTimer);
  clearMotions();
  void character.offsetWidth;
  motionLabel.textContent = showLabel ? config?.label || '' : '';
  const fallbackAsset = config?.asset || statusMotionAssets[motion] || BASE_PET_ASSET;
  const videoAsset = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? null
    : config?.videoAsset;
  if (videoAsset) {
    petImage.hidden = true;
    petMotionVideo.src = videoAsset;
    petMotionVideo.hidden = false;
    petMotionVideo.currentTime = 0;
    petMotionVideo.play().catch(() => {
      petMotionVideo.hidden = true;
      petMotionVideo.removeAttribute('src');
      petImage.hidden = false;
      petImage.src = fallbackAsset;
    });
  } else {
    petImage.src = fallbackAsset;
  }
  character.classList.add(motion);
  motionTimer = window.setTimeout(() => {
    clearMotions([motion]);
  }, duration);
}

function scheduleIdleMotion() {
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    if (!panelOpen && !drag && !busy) {
      const inactiveFor = Date.now() - lastInteractionAt;
      if (inactiveFor >= DOZE_AFTER && !dozedSinceInteraction) {
        dozedSinceInteraction = true;
        playMotion('is-dozing', 6500);
      } else if (inactiveFor < DOZE_AFTER) {
        const motion = pickMotion();
        playMotion(motion.name, motion.duration);
      }
    }
    scheduleIdleMotion();
  }, IDLE_MOTION_MIN_DELAY + Math.random() * (IDLE_MOTION_MAX_DELAY - IDLE_MOTION_MIN_DELAY));
}

function noteInteraction() {
  lastInteractionAt = Date.now();
  dozedSinceInteraction = false;
  if (character.classList.contains('is-dozing')) {
    clearMotions(['is-dozing']);
    showBubble('醒啦，继续一起做点什么？', 2200);
  }
  scheduleIdleMotion();
}

function handleWake({ shortcut = '⌘⇧Space' } = {}) {
  noteInteraction();
  setPanel(true);
  if (!busy) {
    window.clearTimeout(reactionTimer);
    character.classList.remove('is-reacting');
    void character.offsetWidth;
    character.classList.add('is-reacting');
    reactionTimer = window.setTimeout(() => character.classList.remove('is-reacting'), 650);
  }
  showBubble(`我在。${shortcut} 可以随时叫我。`, 2600);
}

function applyPetSize(size) {
  if (!['mini', 'small', 'standard'].includes(size)) return;
  document.documentElement.dataset.petSize = size;
}

function setStatusMotion(state) {
  character.classList.remove('is-thinking');
  clearMotions();

  if (state === 'working') {
    character.classList.add('is-thinking');
  } else if (state === 'completed') {
    playMotion('is-celebrating', 1800, { force: true });
  } else if (state === 'error' || state === 'offline') {
    playMotion('is-sad', 2200, { force: true });
  }
}

function showBubble(message, duration = 2600) {
  window.clearTimeout(bubbleTimer);
  bubbleText.textContent = message;
  bubble.classList.add('is-visible');
  if (duration > 0) {
    bubbleTimer = window.setTimeout(() => bubble.classList.remove('is-visible'), duration);
  }
}

function setPanel(open) {
  noteInteraction();
  panelOpen = open;
  stage.classList.toggle('is-expanded', open);
  askPanel.classList.toggle('is-visible', open);
  askPanel.setAttribute('aria-hidden', String(!open));
  window.deskPet.setExpanded(open);
  setIgnoreMouse(false);
  if (!open) toggleConversationSwitcher(false);
  if (open) window.setTimeout(() => promptInput.focus(), 220);
}

function updateAttachment() {
  if (!attachedPaths.length) {
    attachment.hidden = true;
    attachmentName.textContent = '';
    return;
  }
  const first = attachedPaths[0].split('/').filter(Boolean).pop() || attachedPaths[0];
  attachmentName.textContent = attachedPaths.length === 1 ? first : `${first} 等 ${attachedPaths.length} 项`;
  attachment.hidden = false;
}

function setBusy(nextBusy) {
  busy = nextBusy;
  sendAsk.disabled = nextBusy;
  stopAsk.hidden = !nextBusy;
  sendAsk.textContent = nextBusy ? '回复中…' : '发送';
  conversationSwitchButton.disabled = nextBusy;
  createConversationButton.disabled = nextBusy;
}

function compactAnswer(text, maxLength = 180) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function makeId(prefix) {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function makeConversation() {
  const now = Date.now();
  return {
    id: makeId('conversation'),
    title: '新对话',
    createdAt: now,
    updatedAt: now,
    messages: []
  };
}

function sanitizeMessage(message) {
  const role = message?.role === 'assistant' ? 'assistant' : 'user';
  let text = String(message?.text || '').slice(0, MAX_STORED_MESSAGE_LENGTH);
  const wasPending = Boolean(message?.pending);
  if (wasPending && role === 'assistant') text = text && text !== '正在思考…' ? text : '上次回复未完成。';
  return {
    id: String(message?.id || makeId('message')).slice(0, 160),
    role,
    text,
    pending: false,
    retryPrompt: String(message?.retryPrompt || '').slice(0, 8000),
    retryPaths: Array.isArray(message?.retryPaths)
      ? message.retryPaths.slice(0, 5).map((item) => String(item))
      : []
  };
}

function sanitizeConversation(item) {
  const now = Date.now();
  return {
    id: String(item?.id || makeId('conversation')).slice(0, 160),
    title: String(item?.title || '新对话').trim().slice(0, 32) || '新对话',
    createdAt: Number.isFinite(item?.createdAt) ? item.createdAt : now,
    updatedAt: Number.isFinite(item?.updatedAt) ? item.updatedAt : now,
    messages: Array.isArray(item?.messages)
      ? item.messages.slice(-MAX_MESSAGES_PER_CONVERSATION).map(sanitizeMessage)
      : []
  };
}

function currentConversationData() {
  return conversations.find(({ id }) => id === activeConversationId) || null;
}

function saveConversationState() {
  const active = currentConversationData();
  if (active) active.updatedAt = Math.max(active.updatedAt, Date.now());
  conversations.sort((a, b) => b.updatedAt - a.updatedAt);
  conversations = conversations.slice(0, MAX_CONVERSATIONS);
  try {
    localStorage.setItem(CONVERSATION_STORAGE_KEY, JSON.stringify(conversations));
    localStorage.setItem(ACTIVE_CONVERSATION_KEY, activeConversationId || '');
  } catch {
    showBubble('对话仍可使用，但本地历史暂时无法保存。', 3000);
  }
}

function loadConversationState() {
  try {
    const saved = JSON.parse(localStorage.getItem(CONVERSATION_STORAGE_KEY) || '[]');
    conversations = Array.isArray(saved)
      ? saved.slice(0, MAX_CONVERSATIONS).map(sanitizeConversation)
      : [];
  } catch {
    conversations = [];
  }
  if (!conversations.length) conversations = [makeConversation()];
  const savedActiveId = localStorage.getItem(ACTIVE_CONVERSATION_KEY);
  activeConversationId = conversations.some(({ id }) => id === savedActiveId)
    ? savedActiveId
    : conversations[0].id;
  saveConversationState();
}

function titleFromPrompt(prompt) {
  const title = String(prompt || '').replace(/\s+/g, ' ').trim();
  return title.length > 20 ? `${title.slice(0, 19)}…` : title || '新对话';
}

function appendStoredMessage(role, text, retryPayload = null) {
  const active = currentConversationData();
  if (!active) return null;
  const record = {
    id: makeId('message'),
    role,
    text: String(text || '').slice(0, MAX_STORED_MESSAGE_LENGTH),
    pending: role === 'assistant',
    retryPrompt: String(retryPayload?.prompt || '').slice(0, 8000),
    retryPaths: Array.isArray(retryPayload?.paths) ? retryPayload.paths.slice(0, 5) : []
  };
  active.messages.push(record);
  active.messages = active.messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
  if (role === 'user' && active.title === '新对话') active.title = titleFromPrompt(text);
  active.updatedAt = Date.now();
  saveConversationState();
  renderConversationList();
  return record;
}

function updateStoredMessage(record, text, { final = false } = {}) {
  if (!record) return;
  record.text = String(text || '').slice(0, MAX_STORED_MESSAGE_LENGTH);
  record.pending = !final;
  if (final) {
    const active = currentConversationData();
    if (active) active.updatedAt = Date.now();
    saveConversationState();
    renderConversationList();
  }
}

function historyForActiveConversation() {
  const active = currentConversationData();
  if (!active) return [];
  return active.messages
    .filter((message) => !message.pending && message.text && message.text !== '上次回复未完成。')
    .slice(-24)
    .map(({ role, text }) => ({ role, text }));
}

function formatConversationTime(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date);
  }
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date);
}

function renderConversationList() {
  conversationList.replaceChildren();
  conversations.forEach((item) => {
    const row = document.createElement('div');
    row.className = `conversation-option${item.id === activeConversationId ? ' is-active' : ''}`;

    const selectButton = document.createElement('button');
    selectButton.type = 'button';
    selectButton.className = 'conversation-option-main';
    selectButton.dataset.conversationId = item.id;
    const title = document.createElement('strong');
    title.textContent = item.title;
    const meta = document.createElement('small');
    meta.textContent = `${item.messages.length} 条消息 · ${formatConversationTime(item.updatedAt)}`;
    selectButton.append(title, meta);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'conversation-option-delete';
    deleteButton.dataset.deleteConversation = item.id;
    deleteButton.setAttribute('aria-label', `删除对话 ${item.title}`);
    deleteButton.title = '删除对话';
    deleteButton.textContent = '×';
    row.append(selectButton, deleteButton);
    conversationList.append(row);
  });
  activeConversationTitle.textContent = currentConversationData()?.title || '新对话';
}

function toggleConversationSwitcher(force) {
  const open = typeof force === 'boolean' ? force : conversationSwitcher.hidden;
  conversationSwitcher.hidden = !open;
  conversationSwitchButton.setAttribute('aria-expanded', String(open));
  if (open) renderConversationList();
}

function scrollConversation() {
  conversation.scrollTop = conversation.scrollHeight;
}

function addConversationMessage(role, text = '', { record = null, streaming = false } = {}) {
  conversationEmpty.hidden = true;
  const message = document.createElement('article');
  message.className = `conversation-message ${role}`;
  if (record?.id) message.dataset.messageId = record.id;
  const body = document.createElement('div');
  body.className = 'message-body';
  body.textContent = text;
  message.append(body);
  message.classList.toggle('is-streaming', streaming);
  if (role === 'assistant' && !streaming) addMessageActions(message, record);
  conversation.append(message);
  scrollConversation();
  return { element: message, body };
}

function addMessageActions(message, record = null) {
  if (message.querySelector('.message-actions')) return;
  const actions = document.createElement('div');
  actions.className = 'message-actions';
  actions.innerHTML = '<button type="button" data-action="copy">复制</button><button type="button" data-action="retry">重试</button>';
  message.append(actions);
  if (record?.retryPrompt) {
    retryPayloads.set(message, { prompt: record.retryPrompt, paths: [...record.retryPaths] });
  }
}

function renderConversationView() {
  conversation.querySelectorAll('.conversation-message').forEach((message) => message.remove());
  const active = currentConversationData();
  conversationEmpty.hidden = Boolean(active?.messages.length);
  active?.messages.forEach((record) => {
    addConversationMessage(record.role, record.text, { record, streaming: false });
  });
  activeConversationTitle.textContent = active?.title || '新对话';
  activeAssistantMessage = null;
  activeAssistantRecord = null;
  lastSubmitted = null;
  scrollConversation();
}

function finishAssistantMessage() {
  if (!activeAssistantMessage) return;
  addMessageActions(activeAssistantMessage.element, activeAssistantRecord);
  activeAssistantMessage = null;
  activeAssistantRecord = null;
  scrollConversation();
}

function updateAssistantMessage(text, { final = false } = {}) {
  if (!activeAssistantMessage) {
    if (!activeAssistantRecord) activeAssistantRecord = appendStoredMessage('assistant', '', lastSubmitted);
    activeAssistantMessage = addConversationMessage('assistant', '', {
      record: activeAssistantRecord,
      streaming: true
    });
  }
  activeAssistantMessage.body.textContent = text || '…';
  activeAssistantMessage.element.classList.toggle('is-streaming', !final);
  updateStoredMessage(activeAssistantRecord, text || '…', { final });
  scrollConversation();
  if (final) finishAssistantMessage();
}

function handleStatus(status = {}) {
  const state = status.state || 'offline';
  const belongsToAnotherConversation = Boolean(
    status.conversationId && status.conversationId !== activeConversationId
  );
  stage.dataset.status = state;
  statusDot.dataset.status = state;
  connectionState.dataset.status = state;
  if (state !== lastStatusState) {
    setStatusMotion(state);
    lastStatusState = state;
  }

  const labels = {
    connecting: '连接中',
    ready: '已连接',
    working: '处理中',
    completed: '已完成',
    fallback: '已转到应用',
    offline: '未连接',
    error: '出错了'
  };
  connectionState.textContent = labels[state] || 'Codex';

  if (belongsToAnotherConversation) return;

  if (status.turnStatus === 'interrupted') {
    setBusy(false);
    if (activeAssistantMessage) {
      updateAssistantMessage(status.answer || '回复已停止。', { final: true });
    }
    showBubble('Codex 已停止。', 2200);
  } else if (state === 'working') {
    setBusy(true);
    if (status.answer) updateAssistantMessage(status.answer);
    showBubble(status.answer ? 'Codex 正在回复…' : (status.message || 'Codex 正在思考…'), 0);
  } else if (state === 'completed') {
    setBusy(false);
    updateAssistantMessage(status.answer || status.message || 'Codex 已完成', { final: true });
    showBubble(compactAnswer(status.answer || status.message || 'Codex 已完成'), 6500);
  } else if (state === 'error' || state === 'fallback' || state === 'offline') {
    setBusy(false);
    if (activeAssistantMessage) updateAssistantMessage(status.message || '暂时无法连接 Codex', { final: true });
    showBubble(status.message || '暂时无法连接 Codex', 5000);
  } else if (state === 'ready' || state === 'connecting') {
    setBusy(false);
  }
}

function react() {
  noteInteraction();
  const motion = pickMotion(idleMotions.filter(({ name }) => tapMotionNames.has(name)));
  playMotion(motion.name, motion.duration, { showLabel: true });
  window.clearTimeout(reactionTimer);
  character.classList.remove('is-reacting');
  void character.offsetWidth;
  character.classList.add('is-reacting');
  reactionTimer = window.setTimeout(() => character.classList.remove('is-reacting'), 650);
  showBubble(motion.message || messages[Math.floor(Math.random() * messages.length)]);
}

function previewMotion(name) {
  const motion = idleMotions.find((candidate) => candidate.name === name);
  if (!motion) return;
  noteInteraction();
  playMotion(motion.name, motion.duration, { force: true, showLabel: true });
  showBubble(motion.message, motion.duration + 650);
}

function handleSnapState({ edge, final } = {}) {
  const labels = { left: '左侧', right: '右侧', top: '顶部', bottom: '底部' };
  stage.dataset.snapEdge = edge || '';
  snapIndicator.textContent = edge ? `吸附到${labels[edge]}` : '';
  if (!final) return;
  if (edge) showBubble(`已吸附到${labels[edge]}，并避开 Dock 与菜单栏。`, 2600);
  window.setTimeout(() => {
    if (stage.dataset.snapEdge === edge) stage.dataset.snapEdge = '';
  }, 900);
}

async function openCodex() {
  noteInteraction();
  character.classList.remove('is-opening');
  void character.offsetWidth;
  character.classList.add('is-opening');
  showBubble('正在打开 Codex…', 1800);
  await window.deskPet.openCodex();
  window.setTimeout(() => character.classList.remove('is-opening'), 700);
}

function handleTap() {
  const now = Date.now();
  if (now - lastTapAt < 330) {
    window.clearTimeout(tapTimer);
    lastTapAt = 0;
    openCodex();
    return;
  }

  lastTapAt = now;
  tapTimer = window.setTimeout(() => {
    react();
    lastTapAt = 0;
  }, 335);
}

function setIgnoreMouse(ignore) {
  if (panelOpen) ignore = false;
  if (ignoringMouse === ignore) return;
  ignoringMouse = ignore;
  window.deskPet.setIgnoreMouse(ignore);
}

async function submitQuestion() {
  if (busy) return;
  const typedPrompt = promptInput.value.trim();
  const prompt = typedPrompt || (attachedPaths.length ? contextFallbackPrompt : '');
  if (!prompt) {
    promptInput.focus();
    showBubble('输入问题，或者先选择屏幕、文件。');
    return;
  }

  const submittedPaths = [...attachedPaths];
  const submittedConversationId = activeConversationId;
  const savedHistory = historyForActiveConversation();
  lastSubmitted = { prompt, paths: submittedPaths };
  const userRecord = appendStoredMessage('user', prompt);
  addConversationMessage('user', prompt, { record: userRecord });
  activeAssistantRecord = appendStoredMessage('assistant', '正在思考…', lastSubmitted);
  activeAssistantMessage = addConversationMessage('assistant', '正在思考…', {
    record: activeAssistantRecord,
    streaming: true
  });
  retryPayloads.set(activeAssistantMessage.element, lastSubmitted);
  setBusy(true);
  showBubble('正在交给 Codex…', 0);
  try {
    const result = await window.deskPet.ask(
      prompt,
      submittedPaths,
      submittedConversationId,
      savedHistory
    );
    if (result.started) {
      promptInput.value = '';
      attachedPaths = [];
      contextFallbackPrompt = '';
      updateAttachment();
      promptInput.focus();
    } else {
      setBusy(false);
      if (activeAssistantMessage) {
        updateAssistantMessage(result.error || '已转到 Codex 应用。', { final: true });
      }
    }
  } catch (error) {
    setBusy(false);
    updateAssistantMessage(error.message || '提问失败，请重试。', { final: true });
  }
}

function clearDraftContext() {
  promptInput.value = '';
  attachedPaths = [];
  contextFallbackPrompt = '';
  updateAttachment();
}

function selectConversation(conversationId) {
  if (busy) {
    showBubble('等这条回复结束后再切换对话。', 2200);
    return;
  }
  const next = conversations.find(({ id }) => id === conversationId);
  if (!next) return;
  activeConversationId = next.id;
  next.updatedAt = Date.now();
  clearDraftContext();
  saveConversationState();
  renderConversationView();
  renderConversationList();
  toggleConversationSwitcher(false);
  showBubble(`已切换到「${next.title}」。`, 1800);
  promptInput.focus();
}

function createConversation() {
  if (busy) {
    showBubble('等这条回复结束后再新建对话。', 2200);
    return;
  }
  const next = makeConversation();
  conversations.unshift(next);
  activeConversationId = next.id;
  clearDraftContext();
  saveConversationState();
  renderConversationView();
  renderConversationList();
  toggleConversationSwitcher(false);
  showBubble('新的独立对话已开启。', 1800);
  promptInput.focus();
}

async function deleteConversation(conversationId) {
  if (busy) {
    showBubble('等这条回复结束后再删除对话。', 2200);
    return;
  }
  const target = conversations.find(({ id }) => id === conversationId);
  if (!target) return;
  const result = await window.deskPet.newConversation(conversationId);
  if (!result.reset) {
    showBubble(result.error || '暂时无法删除对话。', 2600);
    return;
  }
  conversations = conversations.filter(({ id }) => id !== conversationId);
  if (!conversations.length) conversations = [makeConversation()];
  if (activeConversationId === conversationId) activeConversationId = conversations[0].id;
  clearDraftContext();
  saveConversationState();
  renderConversationView();
  renderConversationList();
  showBubble(`已删除「${target.title}」。`, 1800);
}

function attachContext(paths, { fallbackPrompt, message, replace = false }) {
  const nextPaths = replace ? paths : [...attachedPaths, ...paths];
  attachedPaths = [...new Set(nextPaths)].slice(0, 5);
  contextFallbackPrompt = fallbackPrompt;
  updateAttachment();
  showBubble(message, 1900);
  promptInput.focus();
}

async function attachCurrentScreen() {
  if (busy) return;
  showBubble('正在读取当前屏幕…', 0);
  try {
    const result = await window.deskPet.captureScreen();
    if (result.captured) {
      attachContext([result.path], {
        fallbackPrompt: '请分析当前屏幕，概括关键信息，并告诉我下一步可以怎么做。',
        message: '已读取当前屏幕，可以直接提问。'
      });
    } else {
      showBubble(result.error || '没有截取到当前屏幕。', 2600);
    }
  } catch (error) {
    showBubble(error.message || '读取屏幕失败。', 2600);
  }
}

async function attachRegionCapture() {
  if (busy) return;
  showBubble('拖出一个区域完成截图，Esc 取消。', 0);
  try {
    const result = await window.deskPet.captureRegion();
    if (result.captured) {
      attachContext([result.path], {
        fallbackPrompt: '请分析我框选的屏幕区域，说明其中的关键信息和可能的问题。',
        message: '框选内容已读取，可以直接提问。'
      });
    } else {
      showBubble(result.error || '已取消截图。', 1800);
    }
  } catch (error) {
    showBubble(error.message || '框选截图失败。', 2600);
  }
  promptInput.focus();
}

async function chooseFiles() {
  if (busy) return;
  try {
    const result = await window.deskPet.selectFiles();
    if (!result.selected) return;
    attachContext(result.paths, {
      fallbackPrompt: '请阅读我选择的文件，概括重点，并指出值得关注的问题。',
      message: `已选择 ${result.paths.length} 个文件。`
    });
  } catch (error) {
    showBubble(error.message || '选择文件失败。', 2600);
  }
}

character.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || panelOpen) return;
  character.setPointerCapture(event.pointerId);
  drag = {
    pointerId: event.pointerId,
    startX: event.screenX,
    startY: event.screenY,
    moved: false
  };
  window.deskPet.dragStart(event.screenX, event.screenY);
});

character.addEventListener('pointerenter', () => {
  if (character.classList.contains('is-dozing')) noteInteraction();
});

character.addEventListener('pointermove', (event) => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const distance = Math.hypot(event.screenX - drag.startX, event.screenY - drag.startY);
  if (distance > 4) drag.moved = true;
  if (drag.moved) window.deskPet.dragMove(event.screenX, event.screenY);
});

character.addEventListener('pointerup', (event) => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const wasMoved = drag.moved;
  character.releasePointerCapture(event.pointerId);
  drag = null;
  window.deskPet.dragEnd();
  if (!wasMoved) handleTap();
});

character.addEventListener('pointercancel', () => {
  drag = null;
  window.deskPet.dragEnd();
});

character.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  noteInteraction();
  window.deskPet.showContextMenu();
});

character.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') openCodex();
  if (event.key === ' ') {
    event.preventDefault();
    react();
  }
});

askButton.addEventListener('click', () => setPanel(!panelOpen));
openButton.addEventListener('click', openCodex);
hideButton.addEventListener('click', () => window.deskPet.hide());
closeAsk.addEventListener('click', () => setPanel(false));
stopAsk.addEventListener('click', async () => {
  stopAsk.disabled = true;
  const result = await window.deskPet.stop();
  stopAsk.disabled = false;
  if (!result.stopped && result.error) showBubble(result.error, 2600);
});
captureScreenButton.addEventListener('click', attachCurrentScreen);
captureRegionButton.addEventListener('click', attachRegionCapture);
selectFilesButton.addEventListener('click', chooseFiles);
conversationSwitchButton.addEventListener('click', () => toggleConversationSwitcher());
createConversationButton.addEventListener('click', createConversation);
conversationList.addEventListener('click', (event) => {
  const deleteButton = event.target.closest('button[data-delete-conversation]');
  if (deleteButton) {
    deleteConversation(deleteButton.dataset.deleteConversation);
    return;
  }
  const selectButton = event.target.closest('button[data-conversation-id]');
  if (selectButton) selectConversation(selectButton.dataset.conversationId);
});
conversation.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const message = button.closest('.conversation-message');
  if (button.dataset.action === 'copy') {
    await window.deskPet.copyText(message?.querySelector('.message-body')?.textContent || '');
    showBubble('回复已复制。', 1600);
  }
  const retryPayload = retryPayloads.get(message) || lastSubmitted;
  if (button.dataset.action === 'retry' && retryPayload && !busy) {
    promptInput.value = retryPayload.prompt;
    attachedPaths = [...retryPayload.paths];
    updateAttachment();
    submitQuestion();
  }
});
removeAttachment.addEventListener('click', () => {
  attachedPaths = [];
  contextFallbackPrompt = '';
  updateAttachment();
});
askPanel.addEventListener('submit', (event) => {
  event.preventDefault();
  submitQuestion();
});
promptInput.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submitQuestion();
  if (event.key === 'Escape') setPanel(false);
});

document.addEventListener('pointerdown', (event) => {
  if (conversationSwitcher.hidden) return;
  if (conversationSwitcher.contains(event.target) || conversationSwitchButton.contains(event.target)) return;
  toggleConversationSwitcher(false);
});

document.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dropDepth += 1;
  dropOverlay.classList.add('is-visible');
  setIgnoreMouse(false);
});

document.addEventListener('dragover', (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});

document.addEventListener('dragleave', (event) => {
  event.preventDefault();
  dropDepth = Math.max(0, dropDepth - 1);
  if (!dropDepth) dropOverlay.classList.remove('is-visible');
});

document.addEventListener('drop', (event) => {
  event.preventDefault();
  dropDepth = 0;
  dropOverlay.classList.remove('is-visible');
  const paths = [...event.dataTransfer.files]
    .map((file) => window.deskPet.getPathForFile(file))
    .filter(Boolean)
    .slice(0, 5);
  if (!paths.length) return;
  attachedPaths = paths;
  contextFallbackPrompt = '请阅读我拖入的内容，概括重点，并回答我的问题。';
  updateAttachment();
  setPanel(true);
});

document.addEventListener('mousemove', (event) => {
  if (drag || panelOpen) return setIgnoreMouse(false);
  const target = document.elementFromPoint(event.clientX, event.clientY);
  setIgnoreMouse(!target?.closest('[data-interactive]'));
});

document.addEventListener('mouseleave', () => {
  if (!drag && !panelOpen) setIgnoreMouse(true);
});

window.deskPet.onMessage((message) => showBubble(message));
window.deskPet.onStatus(handleStatus);
window.deskPet.onSize(applyPetSize);
window.deskPet.onOpenAsk(() => setPanel(true));
window.deskPet.onWake(handleWake);
window.deskPet.onPlayMotion(previewMotion);
window.deskPet.onSnapState(handleSnapState);
loadConversationState();
renderConversationView();
renderConversationList();
window.deskPet.getStatus().then(handleStatus);
window.deskPet.getSize().then(applyPetSize);
[BASE_PET_ASSET, ...idleMotions.map(({ asset }) => asset)].forEach((asset) => {
  const image = new Image();
  image.src = asset;
});
scheduleIdleMotion();
