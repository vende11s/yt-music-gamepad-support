let animationFrameId: number;
let focusedElement: HTMLElement | null = null;
let lastButtonStates: Record<number, boolean> = {};
let currentZone: 'main' | 'search' | 'player' = 'main';
let savedMainElement: HTMLElement | null = null;

const BUTTON_A = 0;
const BUTTON_B = 1;
const BUTTON_X = 2;
const BUTTON_Y = 3;
const BUTTON_LB = 4;
const BUTTON_RB = 5;
const BUTTON_DPAD_UP = 12;
const BUTTON_DPAD_DOWN = 13;
const BUTTON_DPAD_LEFT = 14;
const BUTTON_DPAD_RIGHT = 15;

const AXIS_X = 0;
const AXIS_Y = 1;

let lastNavTime = 0;
const NAV_COOLDOWN = 200; // ms

function getFocusableElements(): HTMLElement[] {
  const selectors = [
    'a',
    'button',
    '[tabindex]:not([tabindex="-1"])',
    'ytmusic-responsive-list-item-renderer',
    'ytmusic-two-row-item-renderer',
    'ytmusic-thumbnail-renderer',
    'yt-icon-button',
    'paper-icon-button',
    'tp-yt-paper-button',
    'ytmusic-navigation-button-renderer',
    'ytmusic-search-box'
  ].join(', ');
  
  const elements = Array.from(document.querySelectorAll<HTMLElement>(selectors));
  const visibleElements = elements.filter((e) => {
    const rect = e.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && window.getComputedStyle(e).visibility !== 'hidden';
  });

  const complexContainers = 'ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer';
  return visibleElements.filter(e => {
    const container = e.closest(complexContainers);
    if (container) {
      const thumb = container.querySelector('ytmusic-thumbnail-renderer');
      if (thumb && visibleElements.includes(thumb as HTMLElement)) {
        return e === thumb;
      } else {
        return e === container;
      }
    }
    return true;
  });
}

function getCenter(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function navigate(direction: 'up' | 'down' | 'left' | 'right') {
  const elements = getFocusableElements();
  if (elements.length === 0) return;

  if (!focusedElement || !document.body.contains(focusedElement)) {
    focusedElement = document.activeElement as HTMLElement;
    if (!focusedElement || !elements.includes(focusedElement)) {
      focusedElement = elements.find(e => e.classList.contains('play-pause-button')) || elements[0];
    }
  }

  const currentRect = focusedElement.getBoundingClientRect();
  const currentCenter = getCenter(currentRect);

  let bestElement: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const element of elements) {
    if (element === focusedElement) continue;

    const rect = element.getBoundingClientRect();
    const center = getCenter(rect);

    let isDir = false;
    let distParallel = 0;
    let distPerp = 0;

    switch (direction) {
      case 'up':
        isDir = center.y < currentCenter.y;
        distParallel = currentCenter.y - center.y;
        distPerp = Math.abs(currentCenter.x - center.x);
        break;
      case 'down':
        isDir = center.y > currentCenter.y;
        distParallel = center.y - currentCenter.y;
        distPerp = Math.abs(currentCenter.x - center.x);
        break;
      case 'left':
        isDir = center.x < currentCenter.x;
        distParallel = currentCenter.x - center.x;
        distPerp = Math.abs(currentCenter.y - center.y);
        break;
      case 'right':
        isDir = center.x > currentCenter.x;
        distParallel = center.x - currentCenter.x;
        distPerp = Math.abs(currentCenter.y - center.y);
        break;
    }

    if (isDir) {
      // Prioritize elements that overlap or are very close on the perpendicular axis
      const score = distParallel + distPerp * 2;
      if (score < bestScore) {
        bestScore = score;
        bestElement = element;
      }
    }
  }

  if (bestElement) {
    setFocus(bestElement);
  }
}

function setFocus(element: HTMLElement) {
  if (focusedElement) {
    focusedElement.classList.remove('gamepad-focused');
  }
  focusedElement = element;
  focusedElement.classList.add('gamepad-focused');
  focusedElement.focus();
  focusedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
}

function cycleZone() {
  if (currentZone === 'main') {
    savedMainElement = focusedElement;
    currentZone = 'search';
    const searchBox = document.querySelector<HTMLElement>('ytmusic-search-box') || document.querySelector<HTMLElement>('.search-box') || document.querySelector<HTMLElement>('tp-yt-paper-icon-button.ytmusic-search-box');
    if (searchBox) setFocus(searchBox);
  } else if (currentZone === 'search') {
    currentZone = 'player';
    const playPause = document.querySelector<HTMLElement>('.play-pause-button') || document.querySelector<HTMLElement>('ytmusic-player-bar');
    if (playPause) setFocus(playPause);
  } else {
    currentZone = 'main';
    if (savedMainElement && document.body.contains(savedMainElement)) {
      setFocus(savedMainElement);
    } else {
      const elements = getFocusableElements();
      if (elements.length > 0) setFocus(elements[0]);
    }
  }
}

function updateGamepad() {
  const gamepads = navigator.getGamepads();
  for (const pad of gamepads) {
    if (!pad) continue;

    const now = performance.now();

    // Check stick navigation
    if (now - lastNavTime > NAV_COOLDOWN) {
      let navigated = false;
      const xAxis = pad.axes[AXIS_X];
      const yAxis = pad.axes[AXIS_Y];
      
      const threshold = 0.5;
      
      if (xAxis < -threshold || pad.buttons[BUTTON_DPAD_LEFT]?.pressed) {
        navigate('left');
        navigated = true;
      } else if (xAxis > threshold || pad.buttons[BUTTON_DPAD_RIGHT]?.pressed) {
        navigate('right');
        navigated = true;
      } else if (yAxis < -threshold || pad.buttons[BUTTON_DPAD_UP]?.pressed) {
        navigate('up');
        navigated = true;
      } else if (yAxis > threshold || pad.buttons[BUTTON_DPAD_DOWN]?.pressed) {
        navigate('down');
        navigated = true;
      }
      
      if (navigated) {
        lastNavTime = now;
      }
    }

    // Check button presses (trigger only on first press)
    for (let i = 0; i < pad.buttons.length; i++) {
      const isPressed = pad.buttons[i].pressed;
      const wasPressed = lastButtonStates[i] || false;
      
      if (isPressed && !wasPressed) {
        handleButtonPress(i);
      }
      lastButtonStates[i] = isPressed;
    }
  }

  animationFrameId = requestAnimationFrame(updateGamepad);
}

function handleButtonPress(buttonIndex: number) {
  switch (buttonIndex) {
    case BUTTON_Y:
      cycleZone();
      break;
    case BUTTON_A:
      if (focusedElement) {
        let targetToClick = focusedElement;
        if (focusedElement.tagName.toLowerCase() === 'ytmusic-thumbnail-renderer') {
          const container = focusedElement.closest('ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer');
          if (container) {
            const playBtn = container.querySelector<HTMLElement>('ytmusic-play-button-renderer, #play-button');
            if (playBtn) targetToClick = playBtn;
          }
        } else if (focusedElement.tagName.toLowerCase() === 'ytmusic-search-box') {
          const searchBtn = focusedElement.querySelector<HTMLElement>('tp-yt-paper-icon-button, .search-icon, #placeholder, input, button');
          if (searchBtn) targetToClick = searchBtn;
        }
        targetToClick.click();
      } else if (document.activeElement) {
        (document.activeElement as HTMLElement).click();
      }
      break;
    case BUTTON_B:
      window.history.back();
      break;
    case BUTTON_X:
      document.querySelector<HTMLElement>('.play-pause-button')?.click();
      break;
    case BUTTON_LB:
      document.querySelector<HTMLElement>('.previous-button')?.click();
      break;
    case BUTTON_RB:
      document.querySelector<HTMLElement>('.next-button')?.click();
      break;
  }
}

export function onPlayerApiReady() {
  try {
    console.log('[GamepadPlugin] Initializing gamepad support...');
    const style = document.createElement('style');
    style.id = 'gamepad-plugin-style';
    style.innerHTML = `
      .gamepad-focused {
        outline: 4px solid #f00 !important;
        outline-offset: -4px !important;
        border-radius: inherit;
        z-index: 9999 !important;
        transition: outline 0.1s;
      }
    `;
    document.head.appendChild(style);

    animationFrameId = requestAnimationFrame(updateGamepad);
    console.log('[GamepadPlugin] Gamepad support initialized successfully!');
  } catch (err) {
    console.error('[GamepadPlugin] Failed to initialize:', err);
  }
}

export function onUnload() {
  cancelAnimationFrame(animationFrameId);
  document.getElementById('gamepad-plugin-style')?.remove();
  if (focusedElement) {
    focusedElement.classList.remove('gamepad-focused');
  }
}
