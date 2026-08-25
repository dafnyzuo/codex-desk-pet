'use strict';

const bubble = document.querySelector('#bubble');
const bubbleText = document.querySelector('#bubble-text');
const character = document.querySelector('#character');
const openButton = document.querySelector('#open-button');
const hideButton = document.querySelector('#hide-button');

const messages = [
  '今天想把什么做出来？',
  '先拆小，再动手。',
  '我在，随时可以开始。',
  '右键还能找到更多选项。',
  '双击我，打开 Codex ✨'
];

let bubbleTimer = null;
let reactionTimer = null;
let tapTimer = null;
let lastTapAt = 0;
let drag = null;
let ignoringMouse = false;

function showBubble(message, duration = 2600) {
  window.clearTimeout(bubbleTimer);
  bubbleText.textContent = message;
  bubble.classList.add('is-visible');
  bubbleTimer = window.setTimeout(() => bubble.classList.remove('is-visible'), duration);
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
  if (ignoringMouse === ignore) return;
  ignoringMouse = ignore;
  window.deskPet.setIgnoreMouse(ignore);
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

openButton.addEventListener('click', openCodex);
hideButton.addEventListener('click', () => window.deskPet.hide());

document.addEventListener('mousemove', (event) => {
  if (drag) return setIgnoreMouse(false);
  const target = document.elementFromPoint(event.clientX, event.clientY);
  setIgnoreMouse(!target?.closest('[data-interactive]'));
});

document.addEventListener('mouseleave', () => {
  if (!drag) setIgnoreMouse(true);
});

window.deskPet.onMessage((message) => showBubble(message));
