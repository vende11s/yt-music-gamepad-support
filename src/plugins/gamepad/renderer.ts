let animationFrameId: number;
let focusedElement: HTMLElement | null = null;
let initializedFocus = false;
let lastButtonStates: Record<number, boolean> = {};
let currentZone: 'main' | 'search' | 'player' | 'sidebar' = 'main';
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
    'ytmusic-search-box',
    'ytmusic-guide-entry-renderer'
  ].join(', ');
  
  const elements = Array.from(document.querySelectorAll<HTMLElement>(selectors));
  const visibleElements = elements.filter((e) => {
    const rect = e.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && window.getComputedStyle(e).visibility !== 'hidden';
  });

  const complexContainers = 'ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer, ytmusic-guide-entry-renderer';
  return visibleElements.filter(e => {
    // Exclude time/volume sliders and the artist/album links under the song title
    if (e.closest('.subtitle, .byline, #progress-bar, #volume-slider, tp-yt-paper-slider, tp-yt-paper-progress')) {
      return false;
    }

    // Exclude custom Electron top bar
    if (e.closest('.title-bar, #title-bar, #window-controls, .in-app-menu')) {
      return false;
    }

    // Restrict navigation strictly to the current zone
    const isPlayerZone = e.closest('ytmusic-player-bar') !== null;
    const isSearchZone = e.closest('ytmusic-nav-bar') !== null;
    const isSidebarZone = e.closest('ytmusic-guide-renderer, tp-yt-app-drawer, #guide-wrapper') !== null;
    
    if (currentZone === 'player' && !isPlayerZone) return false;
    if (currentZone === 'search' && !isSearchZone) return false;
    if (currentZone === 'sidebar' && !isSidebarZone) return false;
    if (currentZone === 'main' && (isPlayerZone || isSearchZone || isSidebarZone)) return false;

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

function getBestMainElement(elements: HTMLElement[]): HTMLElement | null {
  if (elements.length === 0) return null;

  // Try to find the currently playing song if we are on the player page
  const playingItem = elements.find(e => e.closest('ytmusic-player-queue-item[selected], ytmusic-responsive-list-item-renderer[playing]'));
  if (playingItem) return playingItem;

  // Try to find the first song row or album card
  const card = elements.find(e => e.tagName.toLowerCase() === 'ytmusic-thumbnail-renderer' || e.closest('ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer'));
  if (card) return card;

  // Try to find something roughly in the viewport that is not at the very top (skipping top menus)
  for (const e of elements) {
    const rect = e.getBoundingClientRect();
    if (rect.top >= 60) { // below top bar
      return e;
    }
  }

  return elements[0];
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
    currentZone = 'sidebar';
    const elements = getFocusableElements();
    if (elements.length > 0) {
      setFocus(elements[0]);
    } else {
      // If no sidebar found, skip to search
      cycleZone();
    }
  } else if (currentZone === 'sidebar') {
    currentZone = 'search';
    const searchBox = document.querySelector<HTMLElement>('ytmusic-search-box') || document.querySelector<HTMLElement>('.search-box') || document.querySelector<HTMLElement>('tp-yt-paper-icon-button.ytmusic-search-box');
    if (searchBox) setFocus(searchBox);
  } else if (currentZone === 'search') {
    currentZone = 'player';
    const elements = getFocusableElements();
    const playPause = elements.find(e => e.classList.contains('play-pause-button') || e.id === 'play-pause-button') || elements[0];
    if (playPause) setFocus(playPause);
  } else {
    currentZone = 'main';
    if (savedMainElement && document.body.contains(savedMainElement)) {
      setFocus(savedMainElement);
    } else {
      const elements = getFocusableElements();
      const best = getBestMainElement(elements);
      if (best) setFocus(best);
    }
  }
}

function updateGamepad() {
  if (!initializedFocus) {
    const elements = getFocusableElements();
    const best = getBestMainElement(elements);
    if (best) {
      setFocus(best);
      initializedFocus = true;
    }
  }

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
      
      if (xAxis < -threshold) {
        navigate('left');
        navigated = true;
      } else if (xAxis > threshold) {
        navigate('right');
        navigated = true;
      } else if (yAxis < -threshold) {
        navigate('up');
        navigated = true;
      } else if (yAxis > threshold) {
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
    case BUTTON_DPAD_UP:
    case BUTTON_DPAD_DOWN:
      document.querySelector<HTMLElement>('.toggle-player-page-button, tp-yt-paper-icon-button.toggle-player-page-button')?.click();
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
        scroll-margin-bottom: 300px !important;
        scroll-margin-top: 100px !important;
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
