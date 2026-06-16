# 🤖 Agent Dev Notes: Gamepad Support & UI Overhaul

**Target Application**: `better_ytmusic` (Electron-based YouTube Music desktop wrapper built with TypeScript, Vite, and SolidJS).
**Goal**: Create a native, TV-like experience using Gamepad (Xbox controller layout) and refine the UI for couch-friendly viewing.

## 1. Gamepad Navigation (Spatial Grid Navigation)
YouTube Music does not use consistent HTML grid layouts; flexboxes and absolute positionings are everywhere. 
- **Solution**: We implemented Euclidean-distance-based spatial navigation. 
- **Math Weighting**: Horizontal distance is penalized heavily (`dx^2 * 10 + dy^2 * 2`). This prevents the cursor from randomly jumping diagonally to a different row when simply trying to move left/right within a song list.
- **Dead-zones**: Analog sticks must pass a `0.5` threshold to trigger navigation, preventing accidental micro-jumps and drifting.

## 2. Focus Management & Chromium Rendering Bugs
- **The Bug**: The built-in Chromium version in this Electron app has a compositor bug. If an element has an `outline` (our cursor) and simultaneously uses CSS `transform`, `transition`, or `filter`, the outline flickers, glitches, or completely disappears.
- **The Fix**: The `.gamepad-focused` CSS class forcefully strips `transition: none !important; transform: none !important;`.
- **The Exception**: The native `#progress-bar` (`tp-yt-paper-slider`) relies on `transform: translateY(...)` for its native positioning. Stripping it caused the progress bar to physically drop down on the screen when focused. We added a strict CSS `:not` exception for the progress bar to preserve its native alignment.
- **Aesthetics**: Replaced standard bounding boxes with `border-radius: 8px` globally, while specifically keeping `border-radius: 50%` for circular UI icon buttons (`tp-yt-paper-icon-button`, `yt-icon-button`).

## 3. Popups and Dialog Focus Traps
- **The Bug**: Opening "Add to playlist" or context menus (`ytmusic-menu-popup-renderer`, `tp-yt-paper-dialog`) allowed the gamepad cursor to escape into the blurred background.
- **The Fix**: The `getFocusableElements` function dynamically detects if any popup is open. If so, it exclusively restricts the array of focusable elements to children of that popup (Focus Trap). 
- **UX**: Pressing the `B` button manually fires an `Escape` KeyboardEvent, safely closing any active overlays.

## 4. TV-Style Progress Bar Scrubbing
- **The Feature**: Emulating Spotify's console app scrubbing behavior.
- **Mechanics**: 
  - Instead of standard navigation, if the user focuses the progress bar and tilts the stick left/right (`Math.abs(xAxis) > 0.5`), the app automatically enters `isSeeking = true` mode.
  - The video natively continues playing in the background. 
  - We use a state-machine that ticks via `requestAnimationFrame` to smoothly accelerate the virtual `scrubTime` based on stick deflection.
- **UI Architecture**: 
  - We inject a massive `position: fixed` Glassmorphic timer overlay (`backdrop-filter: blur(16px)`) in the center of the screen.
  - A custom white "Ghost Thumb" line (`position: fixed`, 24px height) is perfectly vertically centered onto the progress bar using `getBoundingClientRect()`. 
  - Pressing `A` writes `video.currentTime = scrubTime` and exits. Pressing `B` cancels.

## 5. Fullscreen Mode & `in-app-menu` Plugin Overhaul
- **The Goal**: Clean edge-to-edge video when pressing F11, hiding the custom `in-app-menu` plugin TitleBar.
- **The Problems Encountered**:
  1. `@media (display-mode: fullscreen)` didn't trigger consistently inside this specific Electron window setup.
  2. Trying to initialize `window.innerHeight` at the top level of `TitleBar.tsx` (SolidJS) caused a fatal `ReferenceError: window is not defined` because Vite builds the plugins using SSR (Server-Side Rendering) for the backend. This crashed the ENTIRE plugin loader (no plugins loaded).
  3. `in-app-menu` injects a global `margin-top: 36px` to make room for its bar. Even if `TitleBar.tsx` was hidden, a giant black bar remained.
  4. Multiple `ipc.on('window-fullscreen')` listeners were overwriting each other due to the app's internal IPC wrapper constraints.
- **The Ultimate Solution**:
  - `main.ts` (Backend): Listens to `win.on('enter-full-screen')` and `win.isFullScreen()` native OS events and relays them via IPC.
  - `renderer.tsx` (Frontend Bridge): Listens to the IPC event and adds `data-fullscreen="true"` to `document.documentElement` (`<html>`), while dynamically setting `document.documentElement.style.setProperty('--menu-bar-height', '0px', 'important')`.
  - `titlebar.css` (Styles): `html[data-fullscreen="true"] nav { display: none !important; }`. 
  - *Result*: 100% robust, no React/Solid state race-conditions.

## 6. CLI Launch Arguments
- Implemented `process.argv.includes('--fullscreen')` check inside `src/index.ts` during `BrowserWindow` creation.
- Allows the user to create a shortcut launching the app natively into OS fullscreen by passing `--fullscreen`.

## 7. UI Testing Environment (Agent Visual Preview)
- **The Tool**: `tests/agent-ui-inspector.js` is a dedicated Playwright-based script for agents to capture and verify visual UI states in isolation. It utilizes a temporary Electron profile, ensuring no collision with background processes.
- **Why it exists**: Because agents cannot "look" at the live Electron desktop window directly. After modifying CSS/JS, agents must run this tool, output `.png` files, and use the `view_file` tool to visually analyze the results.
- **Capabilities**:
  - `--screenshot=<path>`: Defines where the `.png` is saved.
  - `--route=<path>`: Direct navigation (e.g. `--route=/library`).
  - `--click=<selector>`: Click an element (e.g. `--click="ytmusic-play-button-renderer"`).
  - `--type=<selector>::<text>`: Fill input fields.
  - `--wait=<ms>`: Explicit delays for loading and animations.
- **Automated Reporting**: Run `npm run test:ui-preview` to automatically take screenshots of the Home, Explore, and Library tabs, placing them in `ui-reports/` and generating a single Markdown artifact.

## Future Agent Guidance
- **Plugin Rebuilding**: Always remember that modifying `.tsx` files inside `src/plugins/` often requires the user to run `npm run build` or restart their `npm run dev` server. Modifying `src/main/` or backend `main.ts` files ALWAYS requires completely closing and restarting the Electron executable. 
- **CSS Injections**: When tweaking gamepad UI, always prefer injecting `<style>` blocks natively in `gamepad/renderer.ts` rather than modifying the app's core CSS, as it's easier to hot-reload and isolated.
- **DOM Math**: YouTube Music lazily loads the DOM. Always rely on `getBoundingClientRect()` rather than hardcoded offsets.
- **UI Modifications**: After completing UI changes, always run the inspector script and analyze the screenshots to ensure nothing is broken or misaligned before finalizing the task.
## 8. TV-Style UI Edge Cases & Regressions
- **Sidebar Startup State Bug**: Forcing `#guide-wrapper` to 90px caused the text inside `ytmusic-guide-entry-renderer` items to wrap aggressively, destroying the vertical layout until the first `:focus-within` trigger unwrapped them.
- **Sidebar Right-Shift Bug**: Stripping the inner width overrides from the sidebar caused YT Music's native flexbox logic to re-evaluate the container, accidentally pushing the 90px wrapper far to the right. **Conclusion**: Never mess with YTM's core sidebar structural CSS unless absolutely anchoring it with `position: fixed`. Best approach is leaving the sidebar natively styled.
- **Shadow DOM / Dynamic Rendering Resistance**: Hiding specific sidebar UI items (like the "Zwiń/Zmień" section buttons) using advanced CSS pseudo-selectors (e.g., `:has(tp-yt-paper-item[aria-label="..."])`) failed completely because YTM renders these strings dynamically and often inside web components/Shadow DOM where global CSS cannot penetrate reliably.
  - **The Fix**: A brute-force `setInterval` inside `renderer.ts` that runs every 500ms, scans `.textContent` of all `ytmusic-guide-entry-renderer` elements, and directly injects `style.display = 'none'` via JS.
- **Variable Injection Danger**: When using `multi_replace_file_content` to inject intervals or imports, deleting a globally scoped plugin variable (like `focusedElement`) by accident immediately causes a fatal ReferenceError, preventing the entire gamepad plugin from booting. Always double-check block replacements!

