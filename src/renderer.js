'use strict';

const stage = document.querySelector('#stage');
const bubble = document.querySelector('#bubble');
const bubbleText = document.querySelector('#bubble-text');
const statusDot = document.querySelector('#status-dot');
const character = document.querySelector('#character');
const petImage = document.querySelector('#pet-image');
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
let busy = false;
let dropDepth = 0;
let idleTimer = null;
let motionTimer = null;
let lastInteractionAt = Date.now();
let lastIdleMotion = null;

const BASE_PET_ASSET = '../assets/pet.png';
const idleMotions = [
  { name: 'is-blinking', asset: '../assets/pet-blink.png', duration: 1100, label: '眨眨眼 ✦', message: '眨眨眼，我在听。' },
  { name: 'is-nodding', asset: '../assets/pet-nod.png', duration: 1500, label: '点点头 ✓', message: '嗯嗯，收到。' },
  { name: 'is-hopping', asset: '../assets/pet-hop.png', duration: 1650, label: '跳一下 ↑', message: '精神满满，开始吧！' },
  { name: 'is-peeking', asset: '../assets/pet-peek.png', duration: 1900, label: '探头看看 👀', message: '我来看看有什么新任务。' },
  { name: 'is-waving', asset: '../assets/pet-wave.png', duration: 1900, label: '挥挥手 👋', message: '嗨，我一直在这里。' },
  { name: 'is-stretching', asset: '../assets/pet-stretch.png', duration: 2100, label: '伸个懒腰 ↕', message: '伸展一下，继续工作。' },
  { name: 'is-shaking', asset: '../assets/pet-shake.png', duration: 1700, label: '吓一跳 ✦', message: '哎呀！吓我一跳。' }
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
const tapMotionNames = new Set(['is-blinking', 'is-nodding', 'is-hopping', 'is-waving']);

function pickMotion(motions = idleMotions) {
  const choices = motions.filter(({ name }) => name !== lastIdleMotion);
  const motion = choices[Math.floor(Math.random() * choices.length)];
  lastIdleMotion = motion.name;
  return motion;
}

function clearMotions(motions = transientMotions) {
  motions.forEach((motion) => character.classList.remove(motion));
  motionLabel.textContent = '';
  if (petImage.getAttribute('src') !== BASE_PET_ASSET) petImage.src = BASE_PET_ASSET;
}

function playMotion(motion, duration, { force = false } = {}) {
  if (!force && (panelOpen || drag || busy)) return;
  const config = idleMotions.find(({ name }) => name === motion);
  window.clearTimeout(motionTimer);
  clearMotions();
  void character.offsetWidth;
  motionLabel.textContent = config?.label || '';
  petImage.src = config?.asset || statusMotionAssets[motion] || BASE_PET_ASSET;
  character.classList.add(motion);
  motionTimer = window.setTimeout(() => {
    character.classList.remove(motion);
    motionLabel.textContent = '';
    petImage.src = BASE_PET_ASSET;
  }, duration);
}

function scheduleIdleMotion() {
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    if (!panelOpen && !drag && !busy) {
      const inactiveFor = Date.now() - lastInteractionAt;
      if (inactiveFor >= 45000) {
        playMotion('is-dozing', 6500);
      } else {
        const motion = pickMotion();
        playMotion(motion.name, motion.duration);
      }
    }
    scheduleIdleMotion();
  }, 12000 + Math.random() * 8000);
}

function noteInteraction() {
  lastInteractionAt = Date.now();
  if (character.classList.contains('is-dozing')) {
    clearMotions(['is-dozing']);
    showBubble('醒啦，继续一起做点什么？', 2200);
  }
  scheduleIdleMotion();
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
  setStatusMotion(state);

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
    showBubble(status.answer || status.message || 'Codex 已完成', 12000);
  } else if (state === 'error' || state === 'fallback' || state === 'offline') {
    setBusy(false);
    showBubble(status.message || '暂时无法连接 Codex', 5000);
  }
}

function react() {
  noteInteraction();
  const motion = pickMotion(idleMotions.filter(({ name }) => tapMotionNames.has(name)));
  playMotion(motion.name, motion.duration);
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
  playMotion(motion.name, motion.duration, { force: true });
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
window.deskPet.onSize(applyPetSize);
window.deskPet.onOpenAsk(() => setPanel(true));
window.deskPet.onPlayMotion(previewMotion);
window.deskPet.onSnapState(handleSnapState);
window.deskPet.getStatus().then(handleStatus);
window.deskPet.getSize().then(applyPetSize);
[BASE_PET_ASSET, ...idleMotions.map(({ asset }) => asset)].forEach((asset) => {
  const image = new Image();
  image.src = asset;
});
scheduleIdleMotion();
