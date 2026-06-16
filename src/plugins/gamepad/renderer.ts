let animationFrameId: number;
let cleanupIntervalId: NodeJS.Timeout;
let focusedElement: HTMLElement | null = null;
let initializedFocus = false;
let lastButtonStates: Record<number, boolean> = {};

const BUTTON_A = 0;
const BUTTON_B = 1;
const BUTTON_X = 2;
const BUTTON_Y = 3;
const BUTTON_LB = 4;
const BUTTON_RB = 5;
const BUTTON_DPAD_UP = 12;
const BUTTON_DPAD_DOWN = 13;
// @ts-expect-error unused
const BUTTON_DPAD_LEFT = 14;
// @ts-expect-error unused
const BUTTON_DPAD_RIGHT = 15;

const AXIS_X = 0;
const AXIS_Y = 1;

let lastNavTime = 0;
const NAV_COOLDOWN = 200; // ms

let lastInputTime = performance.now();
const INACTIVITY_TIMEOUT = 4000;

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
    'ytmusic-playlist-add-to-option-renderer',
    'ytmusic-player-queue-item'
  ].join(', ');
  
  const elements = Array.from(document.querySelectorAll<HTMLElement>(selectors));
  const visibleElements = elements.filter((e) => {
    const rect = e.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && window.getComputedStyle(e).visibility !== 'hidden';
  });

  const complexContainers = 'ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer, ytmusic-guide-entry-renderer, ytmusic-player-queue-item';
  const activeOverlay = getActiveOverlay();

  return visibleElements.filter(e => {
    if (activeOverlay && !activeOverlay.contains(e)) return false;
    
    if (['tp-yt-iron-dropdown', 'iron-dropdown', 'paper-listbox', 'tp-yt-paper-listbox', 'ytmusic-menu-popup-renderer', 'tp-yt-paper-dialog', 'paper-dialog', 'ytmusic-dialog', 'ytmusic-popup-container'].includes(e.tagName.toLowerCase())) return false;

    const isMenuItem = e.closest('ytmusic-menu-navigation-item-renderer, ytmusic-menu-service-item-renderer, ytmusic-toggle-menu-service-item-renderer, ytmusic-playlist-add-to-option-renderer');
    if (isMenuItem && e !== isMenuItem) return false;

    // Filter out volume, bylines, settings, toggle-player-page, header titles, and logo
    if (e.closest('.subtitle, .byline, #volume-slider, ytmusic-settings-button, ytmusic-logo, .ytmusic-logo')) return false;
    if (e.classList.contains('toggle-player-page-button') || e.closest('.toggle-player-page-button')) return false;
    if (e.tagName.toLowerCase() === 'h2' || e.classList.contains('title') || e.closest('ytmusic-carousel-shelf-basic-header-renderer')) return false;

    if (!e.closest('ytmusic-app, ytmusic-popup-container, tp-yt-iron-overlay-backdrop')) return false;
    if (e.tagName.toLowerCase() === 'ytmusic-tab-renderer') return false;

    if (e.closest('ytmusic-search-box') && e.tagName.toLowerCase() !== 'ytmusic-search-box' && e.tagName.toLowerCase() !== 'ytmusic-search-suggestion') return false;

    const container = e.closest(complexContainers);
    if (container) {
      // Keep the container itself, OR keep specific important buttons inside it (like the 3-dots menu button)
      if (e === container) return true;
      if (e.tagName.toLowerCase() === 'tp-yt-paper-icon-button' && e.closest('ytmusic-menu-renderer')) return true;
      if (e.tagName.toLowerCase() === 'yt-icon-button' && e.closest('ytmusic-menu-renderer')) return true;
      return false;
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
  for (const e of elements) {
    if (e.tagName.toLowerCase() === 'ytmusic-thumbnail-renderer') {
      const rect = e.getBoundingClientRect();
      if (rect.top >= 60 && rect.bottom <= window.innerHeight) return e;
    }
  }
  for (const e of elements) {
    const rect = e.getBoundingClientRect();
    if (rect.top >= 60) return e;
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

let lastHref = location.href;
let popupWasOpen = false;
let isSeeking = false;
let scrubTime = 0;
let scrubOverlay: HTMLElement | null = null;
let scrubLine: HTMLElement | null = null;

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function showScrubUI(video: HTMLVideoElement) {
  if (!scrubOverlay) {
    scrubOverlay = document.createElement('div');
    scrubOverlay.style.position = 'fixed';
    scrubOverlay.style.bottom = '120px';
    scrubOverlay.style.left = '50%';
    scrubOverlay.style.transform = 'translateX(-50%)';
    scrubOverlay.style.background = 'rgba(20, 20, 20, 0.4)';
    scrubOverlay.style.backdropFilter = 'blur(16px)';
    // @ts-expect-error WebkitBackdropFilter is non-standard but supported in Webkit
    scrubOverlay.style.WebkitBackdropFilter = 'blur(16px)';
    scrubOverlay.style.border = '1px solid rgba(255, 255, 255, 0.15)';
    scrubOverlay.style.color = 'white';
    scrubOverlay.style.fontSize = '48px';
    scrubOverlay.style.fontWeight = 'bold';
    scrubOverlay.style.padding = '15px 30px';
    scrubOverlay.style.borderRadius = '16px';
    scrubOverlay.style.zIndex = '999999';
    scrubOverlay.style.pointerEvents = 'none';
    scrubOverlay.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
    document.body.appendChild(scrubOverlay);
  }
  
  if (!scrubLine) {
    scrubLine = document.createElement('div');
    scrubLine.style.position = 'fixed';
    scrubLine.style.width = '3px';
    scrubLine.style.borderRadius = '2px';
    scrubLine.style.background = '#fff';
    scrubLine.style.boxShadow = '0 0 10px #fff';
    scrubLine.style.zIndex = '999999';
    scrubLine.style.pointerEvents = 'none';
    document.body.appendChild(scrubLine);
  }
  
  scrubOverlay.style.display = 'block';
  scrubLine.style.display = 'block';
  focusedElement?.classList.add('gamepad-seeking');
  updateScrubUI(video);
}

function hideScrubUI() {
  if (scrubOverlay) scrubOverlay.style.display = 'none';
  if (scrubLine) scrubLine.style.display = 'none';
  focusedElement?.classList.remove('gamepad-seeking');
}

function updateScrubUI(video: HTMLVideoElement) {
  if (!scrubOverlay || !scrubLine || !focusedElement) return;
  
  scrubOverlay.textContent = `${formatTime(scrubTime)} / ${formatTime(video.duration)}`;
  
  const rect = focusedElement.getBoundingClientRect();
  const percentage = scrubTime / video.duration;
  
  const thumbHeight = 24;
  const centerY = rect.top + rect.height / 2;
  
  scrubLine.style.left = `${rect.left + rect.width * percentage}px`;
  scrubLine.style.top = `${centerY - thumbHeight / 2}px`;
  scrubLine.style.height = `${thumbHeight}px`;
}

function updateGamepad() {
  if (location.href !== lastHref) {
    lastHref = location.href;
    initializedFocus = false;
  }

  const popupIsOpen = getActiveOverlay() !== null;
  if (popupIsOpen !== popupWasOpen) {
    popupWasOpen = popupIsOpen;
    initializedFocus = false;
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
  let hasInput = false;

  for (const pad of gamepads) {
    if (!pad) continue;

    const now = performance.now();
    const xAxis = pad.axes[AXIS_X];
    const yAxis = pad.axes[AXIS_Y];
    const threshold = 0.5;

    if (Math.abs(xAxis) > 0.1 || Math.abs(yAxis) > 0.1) hasInput = true;

    if (!isSeeking && focusedElement && (focusedElement.id === 'progress-bar' || focusedElement.tagName.toLowerCase() === 'tp-yt-paper-slider' || focusedElement.tagName.toLowerCase() === 'tp-yt-paper-progress')) {
      if (Math.abs(xAxis) > threshold) {
        const video = document.querySelector('video');
        if (video) {
          isSeeking = true;
          scrubTime = video.currentTime;
          showScrubUI(video);
        }
      }
    }

    if (isSeeking) {
      if (Math.abs(xAxis) > 0.1) {
        const video = document.querySelector('video');
        if (video) {
          const scrubSpeed = 30;
          scrubTime += (xAxis * scrubSpeed) / 60;
          scrubTime = Math.max(0, Math.min(scrubTime, video.duration));
          updateScrubUI(video);
        }
      }
    } else {
      if (now - lastNavTime > NAV_COOLDOWN) {
        let navigated = false;
        if (xAxis < -threshold) { navigate('left'); navigated = true; }
        else if (xAxis > threshold) { navigate('right'); navigated = true; }
        else if (yAxis < -threshold) { navigate('up'); navigated = true; }
        else if (yAxis > threshold) { navigate('down'); navigated = true; }
        
        if (navigated) lastNavTime = now;
      }
    }

    for (let i = 0; i < pad.buttons.length; i++) {
      const isPressed = pad.buttons[i].pressed;
      if (isPressed) hasInput = true;
      const wasPressed = lastButtonStates[i] || false;
      if (isPressed && !wasPressed) handleButtonPress(i);
      lastButtonStates[i] = isPressed;
    }
  }

  const nowTime = performance.now();
  if (hasInput) {
    lastInputTime = nowTime;
    if (document.body.classList.contains('tv-inactive')) {
      document.body.classList.remove('tv-inactive');
    }
  } else if (nowTime - lastInputTime > INACTIVITY_TIMEOUT) {
    if (!document.body.classList.contains('tv-inactive')) {
      document.body.classList.add('tv-inactive');
    }
  }

  animationFrameId = requestAnimationFrame(updateGamepad);
}

function handleButtonPress(buttonIndex: number) {
  switch (buttonIndex) {
    case BUTTON_Y:
      const searchBox = document.querySelector<HTMLElement>('ytmusic-search-box') || document.querySelector<HTMLElement>('tp-yt-paper-icon-button.ytmusic-search-box');
      if (searchBox) setFocus(searchBox);
      break;
    case BUTTON_A:
      if (isSeeking) {
        const video = document.querySelector('video');
        if (video) video.currentTime = scrubTime;
        isSeeking = false;
        hideScrubUI();
      } else if (focusedElement && (focusedElement.id === 'progress-bar' || focusedElement.tagName.toLowerCase() === 'tp-yt-paper-slider' || focusedElement.tagName.toLowerCase() === 'tp-yt-paper-progress')) {
        const video = document.querySelector('video');
        if (video) {
          isSeeking = true;
          scrubTime = video.currentTime;
          showScrubUI(video);
        }
      } else if (focusedElement) {
        let targetToClick = focusedElement;
        const tagName = focusedElement.tagName.toLowerCase();
        
        if (tagName === 'ytmusic-responsive-list-item-renderer' || tagName === 'ytmusic-two-row-item-renderer' || tagName === 'ytmusic-player-queue-item') {
          // Find the play button first, as clicking the wrapper or thumb doesn't always trigger playback
          const playBtn = focusedElement.querySelector<HTMLElement>('ytmusic-play-button-renderer, #play-button, .play-button');
          if (playBtn) {
            targetToClick = playBtn;
          } else {
            const thumb = focusedElement.querySelector<HTMLElement>('ytmusic-thumbnail-renderer');
            if (thumb) targetToClick = thumb;
          }
        } else if (tagName === 'ytmusic-thumbnail-renderer') {
          const container = focusedElement.closest('ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer');
          if (container) {
            const playBtn = container.querySelector<HTMLElement>('ytmusic-play-button-renderer, #play-button');
            if (playBtn) targetToClick = playBtn;
          }
        } else if (focusedElement.tagName.toLowerCase() === 'ytmusic-search-box') {
          const searchBtn = focusedElement.querySelector<HTMLElement>('tp-yt-paper-icon-button, .search-icon, #placeholder, input, button');
          if (searchBtn) targetToClick = searchBtn;
        } else if (focusedElement.tagName.toLowerCase() === 'ytmusic-guide-entry-renderer' && (focusedElement.getAttribute('tab-id') === 'FEmusic_home' || focusedElement.querySelector('yt-icon')?.getAttribute('icon') === 'home' || focusedElement.textContent?.toLowerCase().includes('główna') || focusedElement.textContent?.toLowerCase().includes('home'))) {
          document.querySelector<HTMLElement>('.toggle-player-page-button, tp-yt-paper-icon-button.toggle-player-page-button')?.click();
          return;
        }
        targetToClick.click();
      } else if (document.activeElement) {
        (document.activeElement as HTMLElement).click();
      }
      break;
    case BUTTON_B:
      if (isSeeking) {
        isSeeking = false;
        hideScrubUI();
      } else if (getActiveOverlay()) {
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
    console.log('[GamepadPlugin] Initializing TV UI gamepad support...');
    
    window.addEventListener('yt-navigate-finish', () => {
      initializedFocus = false;
    });

    const style = document.createElement('style');
    style.id = 'gamepad-plugin-style';
    style.innerHTML = `
      /* TV UI Overhaul CSS */
      
      /* 1. Ukrycie paska przewijania (Scrollbars) */
      ::-webkit-scrollbar {
        display: none !important;
        width: 0 !important;
        background: transparent !important;
      }
      
      /* 2. Ukrywanie elementów webowych / niepotrzebnych */
      ytmusic-player-bar .dislike,
      ytmusic-player-bar ytmusic-like-button-renderer tp-yt-paper-icon-button.dislike,
      ytmusic-player-bar ytmusic-menu-renderer,
      ytmusic-player-bar tp-yt-paper-icon-button[aria-label*="Więcej"],
      ytmusic-player-bar tp-yt-paper-icon-button[aria-label*="More"],
      ytmusic-player-bar yt-icon-button[aria-label*="Więcej"],
      ytmusic-player-bar yt-icon-button[aria-label*="More"],
      ytmusic-player-page .tab-header-container,
      ytmusic-queue-header-renderer,
      ytmusic-settings-button,
      #guide-button,
      tp-yt-paper-icon-button.volume,
      .volume,
      #volume-slider,
      #expand-volume-slider,
      #expand-volume,
      tp-yt-paper-icon-button[icon="yt-sys-icons:closed-caption"],
      tp-yt-paper-icon-button[icon="yt-icons:subtitles"],
      tp-yt-paper-icon-button[aria-label*="Napisy"],
      tp-yt-paper-icon-button[aria-label*="Subtitles"],
      yt-icon-button[aria-label*="Napisy"],
      yt-icon-button[aria-label*="Subtitles"],
      .player-captions-button,
      .ytp-subtitles-button,
      yt-icon-button.captions,
      ytmusic-guide-entry-renderer:has(tp-yt-paper-item[title*="Zmień"]),
      ytmusic-guide-entry-renderer:has(tp-yt-paper-item[title*="Zwiń"]),
      ytmusic-guide-entry-renderer:has(tp-yt-paper-item[aria-label*="Zmień"]),
      ytmusic-guide-entry-renderer:has(tp-yt-paper-item[aria-label*="Zwiń"]),
      a.sign-in-link,
      yt-button-renderer.sign-in-link,
      .sign-in-link {
        display: none !important;
        margin: 0 !important;
        padding: 0 !important;
        height: 0 !important;
      }
      
      ytmusic-player-queue-item ytmusic-menu-renderer {
        opacity: 1 !important;
        visibility: visible !important;
      }

      /* 3. Powiększanie Siatki i elementów listy (Oversize dla TV) */
      ytmusic-responsive-list-item-renderer {
        margin-bottom: 12px !important;
        padding: 12px !important;
        border-radius: 12px !important;
        transform-origin: left center !important;
      }
      
      ytmusic-two-row-item-renderer {
        margin: 24px !important;
        transform: scale(1.2) !important;
        transform-origin: center center !important;
      }

      ytmusic-thumbnail-renderer {
        border-radius: 16px !important;
        overflow: hidden !important;
      }
      
      h2.ytmusic-carousel-shelf-basic-header-renderer {
        font-size: 32px !important;
        line-height: 40px !important;
        margin-top: 32px !important;
        margin-bottom: 24px !important;
      }

      /* 4. Modyfikacje Paska Bocznego (Guide / Nav Bar) */
      ytmusic-nav-bar {
        padding-top: 24px !important;
        padding-bottom: 24px !important;
      }


      /* 6. Marginesy bezpieczeństwa dla TV (Overscan margin) */
      #browse-page {
        padding-left: 60px !important;
        padding-right: 60px !important;
        padding-bottom: 80px !important;
      }

      /* 7. Gamepad Focus States */
      .gamepad-focused {
        /* Force the outline to draw completely INSIDE the element to prevent clipping */
        box-shadow: inset 0 0 0 4px #fff, inset 0 0 20px rgba(255,255,255,0.5) !important;
        border-radius: 12px !important;
        z-index: 99999 !important;
        outline: none !important;
      }
      
      /* Disable transitions and transforms to prevent Chromium compositor rendering bugs, except on the progress bar */
      .gamepad-focused:not(#progress-bar):not(tp-yt-paper-slider):not(tp-yt-paper-progress) {
        transition: none !important;
        transform: none !important;
      }
      
      ytmusic-two-row-item-renderer.gamepad-focused,
      ytmusic-responsive-list-item-renderer.gamepad-focused,
      ytmusic-player-queue-item.gamepad-focused {
        background: rgba(255,255,255,0.05) !important;
      }
      
      tp-yt-paper-icon-button.gamepad-focused,
      yt-icon-button.gamepad-focused,
      .play-pause-button.gamepad-focused {
        border-radius: 50% !important;
      }
      
      tp-yt-paper-progress, #progress-bar {
        width: 100% !important;
        left: 0 !important;
        right: 0 !important;
        clip-path: inset(0 round 16px 16px 0 0) !important;
        transform-origin: bottom !important;
      }

      #progress-bar.gamepad-focused,
      tp-yt-paper-slider.gamepad-focused,
      tp-yt-paper-progress.gamepad-focused {
        box-shadow: 0 -2px 10px rgba(255,255,255,0.5) !important;
        transform: scaleY(1.5) !important;
        clip-path: inset(-20px round 16px) !important;
      }
      
      .gamepad-seeking {
        opacity: 0.5 !important;
      }

      /* TV INACTIVITY FADES */
      body.tv-inactive ytmusic-nav-bar,
      body.tv-inactive #guide-wrapper {
        opacity: 0 !important;
        pointer-events: none !important;
      }
      
      ytmusic-nav-bar, #guide-wrapper {
        transition: opacity 0.5s ease-in-out, width 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
      }

      ytmusic-app:not([player-page-open]) ytmusic-player-bar {
        border-radius: 16px !important;
        margin: 16px 60px 24px 60px !important;
        width: calc(100% - 120px) !important;
        box-shadow: 0 10px 40px rgba(0,0,0,0.5) !important;
        bottom: 0 !important;
        overflow: visible !important;
        position: fixed !important;
        z-index: 100 !important;
      }

      /* SPOTIFY TV NOW PLAYING STYLING (Full Screen) */
      ytmusic-app[player-page-open] ytmusic-player-bar {
        background: transparent !important;
        border-top: none !important;
        justify-content: center !important;
        padding-bottom: 40px !important;
        transition: opacity 0.5s ease-in-out !important;
      }

      body.tv-inactive ytmusic-app[player-page-open] ytmusic-player-bar {
        opacity: 0 !important;
        pointer-events: none !important;
      }

      ytmusic-app[player-page-open] ytmusic-player-bar .thumbnail-image-wrapper {
        display: none !important;
      }

      ytmusic-app[player-page-open] ytmusic-player-bar .left-controls {
        position: fixed !important;
        bottom: 180px !important;
        left: 5vw !important;
        width: 90vw !important;
        text-align: left !important;
        justify-content: flex-start !important;
        transform: scale(1.3) !important;
        transform-origin: left bottom !important;
      }

      ytmusic-app[player-page-open] ytmusic-player-bar .middle-controls {
        position: fixed !important;
        bottom: 80px !important;
        left: 50% !important;
        transform: translateX(-50%) scale(1.3) !important;
      }

      ytmusic-player-bar .right-controls {
        padding-right: 16px !important;
      }

      ytmusic-app[player-page-open] ytmusic-player-bar .right-controls {
        position: fixed !important;
        bottom: 80px !important;
        right: 5vw !important;
      }

      ytmusic-app[player-page-open] ytmusic-player-bar .toggle-player-page-button {
        display: none !important;
      }
    `;
    document.head.appendChild(style);

    cleanupIntervalId = setInterval(() => {
      document.querySelectorAll('ytmusic-guide-entry-renderer').forEach(el => {
        const text = el.textContent?.toLowerCase() || '';
        if (text.includes('zmień') || text.includes('zwiń') || text.includes('collapse')) {
          (el as HTMLElement).style.display = 'none';
        }
      });
    }, 500);

    animationFrameId = requestAnimationFrame(updateGamepad);
    console.log('[GamepadPlugin] Gamepad TV UI support initialized successfully!');
  } catch (err) {
    console.error('[GamepadPlugin] Failed to initialize:', err);
  }
}

export function onUnload() {
  cancelAnimationFrame(animationFrameId);
  clearInterval(cleanupIntervalId);
  document.getElementById('gamepad-plugin-style')?.remove();
  if (focusedElement) {
    focusedElement.classList.remove('gamepad-focused');
  }
}
