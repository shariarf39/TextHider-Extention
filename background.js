/**
 * TextHider Background Service Worker
 * Manages context menus, storage defaults, badge counts, and keyboard commands.
 */

'use strict';

// Default mask presets
const DEFAULT_PRESETS = [
  { id: 'dots',       label: '... (Dots)',          mask: '.' },
  { id: 'stars',      label: '*** (Stars)',          mask: '*' },
  { id: 'hash',       label: '### (Hash)',           mask: '#' },
  { id: 'heart',      label: '❤️ (Love Sticker)',   mask: '❤️' },
  { id: 'fire',       label: '🔥 (Fire)',            mask: '🔥' },
  { id: 'lock',       label: '🔒 (Lock)',            mask: '🔒' },
  { id: 'question',   label: '? (Question)',         mask: '?' },
  { id: 'redact',     label: '█ (Redact)',           mask: '█' },
];

const PARENT_ID = 'texthider-root';
const CUSTOM_ID = 'texthider-custom';
const UNHIDE_ID = 'texthider-unhide-all';
const REHIDE_ID = 'texthider-rehide-all';
const HIDE_ALL_OCC_ID = 'texthider-hide-all-occurrences';
const QUICK_HIDE_ID = 'texthider-quick-hide';

/**
 * Guard flag — prevents concurrent buildMenus() calls.
 * Root cause of the duplicate-ID error:
 *   onInstalled → storage.set → storage.onChanged → buildMenus() fires twice.
 */
let _menuBuilding = false;

/**
 * Build all context menus from storage presets.
 */
async function buildMenus() {
  if (_menuBuilding) return;        // prevent re-entrant / concurrent builds
  _menuBuilding = true;
  try {
    await chrome.contextMenus.removeAll();
  } catch (_) {}
  // small yield so removeAll fully commits before creates begin
  await new Promise((r) => setTimeout(r, 0));

  // Root menu
  chrome.contextMenus.create({
    id: PARENT_ID,
    title: 'TextHider — Hide selected text',
    contexts: ['selection'],
  });

  // Load user presets (merge defaults + custom)
  const { presets = DEFAULT_PRESETS, customMasks = [] } =
    await chrome.storage.sync.get(['presets', 'customMasks']);

  const allPresets = [...presets, ...customMasks];

  allPresets.forEach((preset) => {
    chrome.contextMenus.create({
      id: `texthider-preset-${preset.id}`,
      parentId: PARENT_ID,
      title: preset.label,
      contexts: ['selection'],
    });
  });

  // Separator + custom entry
  chrome.contextMenus.create({
    id: 'texthider-sep1',
    parentId: PARENT_ID,
    type: 'separator',
    contexts: ['selection'],
  });

  chrome.contextMenus.create({
    id: CUSTOM_ID,
    parentId: PARENT_ID,
    title: '✏️ Custom mask...',
    contexts: ['selection'],
  });

  // Separator + page-level actions
  chrome.contextMenus.create({
    id: 'texthider-sep2',
    parentId: PARENT_ID,
    type: 'separator',
    contexts: ['selection'],
  });

  chrome.contextMenus.create({
    id: UNHIDE_ID,
    parentId: PARENT_ID,
    title: '👁️ Reveal all on this page',
    contexts: ['selection'],
  });

  chrome.contextMenus.create({
    id: REHIDE_ID,
    parentId: PARENT_ID,
    title: '🔒 Re-hide all on this page',
    contexts: ['selection'],
  });

  // Separator + advanced actions
  chrome.contextMenus.create({
    id: 'texthider-sep3',
    parentId: PARENT_ID,
    type: 'separator',
    contexts: ['selection'],
  });

  chrome.contextMenus.create({
    id: HIDE_ALL_OCC_ID,
    parentId: PARENT_ID,
    title: '🔁 Hide ALL occurrences of selection',
    contexts: ['selection'],
  });

  chrome.contextMenus.create({
    id: QUICK_HIDE_ID,
    parentId: PARENT_ID,
    title: '⚡ Quick hide (last used mask)',
    contexts: ['selection'],
  });

  _menuBuilding = false;
}

// Initialize on install / update
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get('presets');
  if (!existing.presets) {
    // Set storage first — this WILL trigger storage.onChanged.
    // The _menuBuilding guard prevents the duplicate-ID race.
    await chrome.storage.sync.set({ presets: DEFAULT_PRESETS, customMasks: [] });
  }
  await buildMenus();
});

// Also build menus on service-worker startup (after browser restart)
chrome.runtime.onStartup.addListener(() => buildMenus());

// Rebuild menus when user changes presets from options page
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes.presets || changes.customMasks)) {
    buildMenus(); // guard flag prevents concurrent builds
  }
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  const menuId = String(info.menuItemId);

  if (menuId === UNHIDE_ID) {
    await chrome.tabs.sendMessage(tab.id, { type: 'UNHIDE_ALL' });
    return;
  }

  if (menuId === REHIDE_ID) {
    await chrome.tabs.sendMessage(tab.id, { type: 'REHIDE_ALL' });
    return;
  }

  if (menuId === CUSTOM_ID) {
    // Inject a small prompt overlay on the page
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: showCustomMaskPrompt,
    });
    return;
  }

  if (menuId === HIDE_ALL_OCC_ID) {
    const { lastMask = '*' } = await chrome.storage.session.get('lastMask').catch(() => ({}));
    await chrome.tabs.sendMessage(tab.id, {
      type: 'HIDE_ALL_OCCURRENCES',
      text: info.selectionText,
      mask: lastMask,
    });
    setTimeout(() => updateBadge(tab.id), 400);
    return;
  }

  if (menuId === QUICK_HIDE_ID) {
    const { lastMask = '*' } = await chrome.storage.session.get('lastMask').catch(() => ({}));
    await chrome.tabs.sendMessage(tab.id, { type: 'HIDE_TEXT', mask: lastMask });
    setTimeout(() => updateBadge(tab.id), 400);
    return;
  }

  if (menuId.startsWith('texthider-preset-')) {
    const presetId = menuId.replace('texthider-preset-', '');
    const { presets = DEFAULT_PRESETS, customMasks = [] } =
      await chrome.storage.sync.get(['presets', 'customMasks']);
    const allPresets = [...presets, ...customMasks];
    const preset = allPresets.find((p) => p.id === presetId);
    if (preset) {
      // Remember last used mask
      chrome.storage.session.set({ lastMask: preset.mask }).catch(() => {});
      await chrome.tabs.sendMessage(tab.id, { type: 'HIDE_TEXT', mask: preset.mask });
      setTimeout(() => updateBadge(tab.id), 400);
    }
  }
});

// Handle keyboard shortcut: Ctrl+Shift+H = hide with last used mask
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'hide-selection') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const { lastMask = '*' } = await chrome.storage.session.get('lastMask').catch(() => ({}));
  try {
    // scripting.executeScript is more reliable than sendMessage for keyboard shortcuts:
    // the message port can be unresponsive even when the content script is alive.
    // We post a window.postMessage that the content script's existing listener handles.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (mask) => {
        window.postMessage({ __texthider: true, type: 'HIDE_TEXT', mask }, '*');
      },
      args: [lastMask],
    });
  } catch (_) {
    // Fallback: direct sendMessage (e.g. scripting API unavailable on this tab)
    try { await chrome.tabs.sendMessage(tab.id, { type: 'HIDE_TEXT', mask: lastMask }); } catch (__) {}
  }
  setTimeout(() => updateBadge(tab.id), 400);
});

/**
 * Injected into page to show a custom mask input dialog.
 * Runs in page context (no chrome.* access here).
 */
function showCustomMaskPrompt() {
  // Remove any existing prompt
  const existing = document.getElementById('texthider-custom-prompt');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'texthider-custom-prompt';
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 2147483647; font-family: system-ui, sans-serif;
  `;

  overlay.innerHTML = `
    <div style="background:#1a1a2e;color:#fff;border-radius:12px;padding:28px 32px;
                min-width:340px;max-width:480px;box-shadow:0 8px 40px rgba(0,0,0,0.6);">
      <h2 style="margin:0 0 8px;font-size:18px;color:#e94560;">🔒 TextHider — Custom Mask</h2>
      <p style="margin:0 0 16px;font-size:13px;color:#aaa;">
        Enter a symbol or emoji. Each word in your selection will be replaced by
        N copies of this symbol (N = word length).
      </p>
      <input id="th-mask-input" type="text" placeholder="e.g.  ★  or  💀  or  @"
        style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;
               border:2px solid #e94560;background:#0f0f1a;color:#fff;font-size:16px;
               outline:none;margin-bottom:8px;" maxlength="10" />
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:16px;">
        <input id="th-save-custom" type="checkbox" style="width:16px;height:16px;" />
        <label for="th-save-custom" style="font-size:13px;color:#aaa;cursor:pointer;">
          Save as a preset in options
        </label>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="th-cancel" style="padding:9px 20px;border-radius:8px;border:none;
          background:#333;color:#ccc;cursor:pointer;font-size:14px;">Cancel</button>
        <button id="th-apply" style="padding:9px 20px;border-radius:8px;border:none;
          background:#e94560;color:#fff;cursor:pointer;font-size:14px;font-weight:600;">
          Apply</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const input = overlay.querySelector('#th-mask-input');
  input.focus();

  overlay.querySelector('#th-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#th-apply').addEventListener('click', () => {
    const mask = input.value.trim();
    if (!mask) { input.focus(); return; }
    const save = overlay.querySelector('#th-save-custom').checked;
    // Post message to content script listener
    window.postMessage({ __texthider: true, type: 'HIDE_TEXT', mask, save }, '*');
    overlay.remove();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') overlay.querySelector('#th-apply').click();
    if (e.key === 'Escape') overlay.remove();
  });
}

// Listen for messages from content script (badge updates, custom mask save)
chrome.runtime.onMessage.addListener(async (message, sender) => {
  if (message.type === 'TEXT_HIDDEN' && sender.tab?.id) {
    updateBadge(sender.tab.id);
    if (message.mask) {
      chrome.storage.session.set({ lastMask: message.mask }).catch(() => {});
    }
  }
  if (message.type === 'ALL_REVEALED' && sender.tab?.id) {
    chrome.action.setBadgeText({ text: '', tabId: sender.tab.id });
  }
  if (message.type === 'SAVE_CUSTOM_MASK') {
    const { mask, label } = message;
    const { customMasks = [] } = await chrome.storage.sync.get('customMasks');
    const id = `custom-${Date.now()}`;
    customMasks.push({ id, label: label || `Custom: ${mask}`, icon: mask, mask });
    await chrome.storage.sync.set({ customMasks });
  }
});

async function updateBadge(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.querySelectorAll('.texthider-masked').length,
    });
    const count = result?.result ?? 0;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '', tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#e94560', tabId });
  } catch (_) {}
}
