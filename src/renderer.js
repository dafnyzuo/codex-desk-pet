'use strict';

const stage = document.querySelector('#stage');
const bubble = document.querySelector('#bubble');
const bubbleText = document.querySelector('#bubble-text');
const statusDot = document.querySelector('#status-dot');
const character = document.querySelector('#character');
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
const dropOverlay = document.querySelector('#drop-overlay');

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
let busy = false;
let dropDepth = 0;

function showBubble(message, duration = 2600) {
  window.clearTimeout(bubbleTimer);
  bubbleText.textContent = message;
  bubble.classList.add('is-visible');
  if (duration > 0) {
    bubbleTimer = window.setTimeout(() => bubble.classList.remove('is-visible'), duration);
  }
}

function setPanel(open) {
  panelOpen = open;
  stage.classList.toggle('is-expanded', open);
  askPanel.classList.toggle('is-visible', open);
  askPanel.setAttribute('aria-hidden', String(!open));
  window.deskPet.setExpanded(open);
  setIgnoreMouse(false);
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
  promptInput.disabled = nextBusy;
  sendAsk.textContent = nextBusy ? '发送中…' : '发送';
}

function handleStatus(status = {}) {
  const state = status.state || 'offline';
  stage.dataset.status = state;
  statusDot.dataset.status = state;
  connectionState.dataset.status = state;

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

  if (state === 'working') {
    setBusy(false);
    showBubble('Codex 正在思考…', 0);
  } else if (state === 'completed') {
    setBusy(false);
    showBubble(status.answer || status.message || 'Codex 已完成', 9000);
  } else if (state === 'error' || state === 'fallback' || state === 'offline') {
    setBusy(false);
    showBubble(status.message || '暂时无法连接 Codex', 5000);
  }
}

function react() {
  window.clearTimeout(reactionTimer);
  character.classList.remove('is-reacting');
  void character.offsetWidth;
  character.classList.add('is-reacting');
  reactionTimer = window.setTimeout(() => character.classList.remove('is-reacting'), 650);
  showBubble(messages[Math.floor(Math.random() * messages.length)]);
}

async function openCodex() {
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
  const prompt = promptInput.value.trim();
  if (!prompt) {
    promptInput.focus();
    showBubble('先告诉我想让 Codex 做什么。');
    return;
  }

  setBusy(true);
  showBubble('正在交给 Codex…', 0);
  const result = await window.deskPet.ask(prompt, attachedPaths);
  setBusy(false);
  if (result.started) {
    promptInput.value = '';
    attachedPaths = [];
    updateAttachment();
    setPanel(false);
  } else if (result.fallback) {
    setPanel(false);
  }
}

character.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  character.setPointerCapture(event.pointerId);
  drag = {
    pointerId: event.pointerId,
    startX: event.screenX,
    startY: event.screenY,
    moved: false
  };
  window.deskPet.dragStart(event.screenX, event.screenY);
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
removeAttachment.addEventListener('click', () => {
  attachedPaths = [];
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
  updateAttachment();
  if (!promptInput.value.trim()) promptInput.value = '请帮我查看并简要说明这个文件。';
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
window.deskPet.onOpenAsk(() => setPanel(true));
window.deskPet.getStatus().then(handleStatus);
