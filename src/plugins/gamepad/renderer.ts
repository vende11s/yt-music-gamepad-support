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

function getActiveOverlay(): HTMLElement | null {
  const overlay = Array.from(document.querySelectorAll<HTMLElement>('tp-yt-iron-dropdown, iron-dropdown, tp-yt-paper-dialog, paper-dialog, ytmusic-dialog')).find(e => {
    return e.getAttribute('aria-hidden') !== 'true' && window.getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;
  });
  return overlay || null;
}

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
    'ytmusic-guide-entry-renderer',
    'ytmusic-search-suggestion',
    'ytmusic-menu-navigation-item-renderer',
    'ytmusic-menu-service-item-renderer',
    'ytmusic-toggle-menu-service-item-renderer',
    'ytmusic-playlist-add-to-option-renderer'
  ].join(', ');
  
  const elements = Array.from(document.querySelectorAll<HTMLElement>(selectors));
  const visibleElements = elements.filter((e) => {
    const rect = e.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && window.getComputedStyle(e).visibility !== 'hidden';
  });

  const complexContainers = 'ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer, ytmusic-guide-entry-renderer';
  const activeOverlay = getActiveOverlay();

  return visibleElements.filter(e => {
    // TRAP FOCUS: If a popup is open, ONLY allow elements inside the popup
    if (activeOverlay && !activeOverlay.contains(e)) {
      return false;
    }

    // Do not focus the popup wrappers, dialogs, or listboxes themselves, only their interactive children
    if (['tp-yt-iron-dropdown', 'iron-dropdown', 'paper-listbox', 'tp-yt-paper-listbox', 'ytmusic-menu-popup-renderer', 'tp-yt-paper-dialog', 'paper-dialog', 'ytmusic-dialog', 'ytmusic-popup-container'].includes(e.tagName.toLowerCase())) {
      return false;
    }

    // Exclude inner buttons/links of a menu item so you select the whole menu row cleanly
    const isMenuItem = e.closest('ytmusic-menu-navigation-item-renderer, ytmusic-menu-service-item-renderer, ytmusic-toggle-menu-service-item-renderer, ytmusic-playlist-add-to-option-renderer');
    if (isMenuItem && e !== isMenuItem) {
      return false;
    }
    // Exclude time/volume sliders and the artist/album links under the song title
    if (e.closest('.subtitle, .byline, #progress-bar, #volume-slider, tp-yt-paper-slider, tp-yt-paper-progress')) {
      return false;
    }

    // Exclude anything that is not part of the actual YouTube Music app (e.g. Electron injected titlebars)
    if (!e.closest('ytmusic-app, ytmusic-popup-container, tp-yt-iron-overlay-backdrop')) {
      return false;
    }

    // Do not focus the tab renderer container itself (but its children are fine)
    if (e.tagName.toLowerCase() === 'ytmusic-tab-renderer') {
      return false;
    }

    // Do not focus the magnifying glass, clear buttons, or inputs inside the search box separately
    if (e.closest('ytmusic-search-box') && e.tagName.toLowerCase() !== 'ytmusic-search-box' && e.tagName.toLowerCase() !== 'ytmusic-search-suggestion') {
      return false;
    }

    // For queue items, ignore the row container itself and title links to allow clean Cover <-> Dots navigation
    if (e.tagName.toLowerCase() === 'ytmusic-player-queue-item') {
      return false;
    }
    if (e.closest('ytmusic-player-queue-item') && (e.tagName.toLowerCase() === 'a' || e.classList.contains('song-title'))) {
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
        isDir = center.y < currentCenter.y - 5;
        distParallel = currentCenter.y - center.y;
        distPerp = Math.abs(currentCenter.x - center.x);
        break;
      case 'down':
        isDir = center.y > currentCenter.y + 5;
        distParallel = center.y - currentCenter.y;
        distPerp = Math.abs(currentCenter.x - center.x);
        break;
      case 'left':
        isDir = center.x < currentCenter.x - 5;
        distParallel = currentCenter.x - center.x;
        distPerp = Math.abs(currentCenter.y - center.y);
        break;
      case 'right':
        isDir = center.x > currentCenter.x + 5;
        distParallel = center.x - currentCenter.x;
        distPerp = Math.abs(currentCenter.y - center.y);
        break;
    }

    if (isDir) {
      // Prioritize elements that overlap or are very close on the perpendicular axis
      // Use different weights depending on the axis:
      // - Left/Right: heavily penalize moving up/down (weight 10) to stay strictly on the same row.
      // - Up/Down: mildly penalize moving left/right (weight 2) to allow zigzagging grids naturally.
      const weight = (direction === 'left' || direction === 'right') ? 10 : 2;
      const score = distParallel + distPerp * weight;
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

  // Find the first song thumbnail that is fully visible on the screen
  for (const e of elements) {
    if (e.tagName.toLowerCase() === 'ytmusic-thumbnail-renderer') {
      const rect = e.getBoundingClientRect();
      // 60px accounts for the top nav bar
      if (rect.top >= 60 && rect.bottom <= window.innerHeight) {
        return e;
      }
    }
  }

  // Fallback to the first element below the top bar if no thumbnails are strictly visible
  for (const e of elements) {
    const rect = e.getBoundingClientRect();
    if (rect.top >= 60) {
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
  focusedElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
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

let lastHref = location.href;
let popupWasOpen = false;

function updateGamepad() {
  if (location.href !== lastHref) {
    lastHref = location.href;
    currentZone = 'main';
    initializedFocus = false;
  }

  const popupIsOpen = getActiveOverlay() !== null;
  if (popupIsOpen !== popupWasOpen) {
    popupWasOpen = popupIsOpen;
    initializedFocus = false; // Force refocus to jump into or out of popup
  }

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
      if (getActiveOverlay()) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      } else {
        window.history.back();
      }
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
    
    window.addEventListener('yt-navigate-finish', () => {
      currentZone = 'main';
      initializedFocus = false;
    });

    const style = document.createElement('style');
    style.id = 'gamepad-plugin-style';
    style.innerHTML = `
      ytmusic-pivot-bar-renderer,
      ytmusic-tabs,
      #tab-container.ytmusic-tabs,
      ytmusic-player-page .tab-header-container,
      ytmusic-queue-header-renderer {
        display: none !important;
        margin: 0 !important;
        padding: 0 !important;
        height: 0 !important;
      }
      /* Force menu buttons (3 dots) on queue items to be always visible so they can be navigated to */
      ytmusic-player-queue-item ytmusic-menu-renderer {
        opacity: 1 !important;
        visibility: visible !important;
      }

      .gamepad-focused {
        /* Inner white ring */
        outline: 4px solid #fff !important;
        outline-offset: -4px !important;
        
        /* Force rounded corners everywhere for a softer TV look */
        border-radius: 8px !important;
        
        z-index: 99999 !important;
        opacity: 1 !important;
        
        /* Disable transitions and transforms to prevent Chromium compositor rendering bugs */
        transition: none !important;
        transform: none !important;
      }
      
      /* Preserve circular shape for icon buttons */
      tp-yt-paper-icon-button.gamepad-focused,
      yt-icon-button.gamepad-focused,
      .play-pause-button.gamepad-focused {
        border-radius: 50% !important;
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
