'use strict';

const DEFAULT_PRESETS = [
  { id: 'dots',     label: 'Dots',    icon: '...', mask: '.' },
  { id: 'stars',    label: 'Stars',   icon: '***', mask: '*' },
  { id: 'hash',     label: 'Hash',    icon: '###', mask: '#' },
  { id: 'heart',    label: 'Love',    icon: '❤️',  mask: '❤️' },
  { id: 'fire',     label: 'Fire',    icon: '🔥',  mask: '🔥' },
  { id: 'lock',     label: 'Lock',    icon: '🔒',  mask: '🔒' },
  { id: 'question', label: 'Q?',      icon: '???', mask: '?' },
  { id: 'redact',   label: 'Block',   icon: '███', mask: '█' },
];

let selectedPresetId = null;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToContent(msg) {
  const tab = await getActiveTab();
  if (!tab?.id) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch (e) {
    showToast('⚠️ Cannot run on this page');
    return null;
  }
}

function showToast(text, duration = 1800) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

async function refreshStats() {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const all = document.querySelectorAll('.texthider-masked');
        const revealed = document.querySelectorAll('.texthider-masked[data-texthider-revealed="true"]');
        return { total: all.length, revealed: revealed.length };
      },
    });
    const stats = result?.result ?? { total: 0, revealed: 0 };
    document.getElementById('count-hidden').textContent = stats.total;
    document.getElementById('count-revealed').textContent = stats.revealed;
  } catch (_) {}
}

async function renderPresets() {
  const { presets = DEFAULT_PRESETS, customMasks = [] } =
    await chrome.storage.sync.get(['presets', 'customMasks']);
  const allPresets = [...presets, ...customMasks];

  const grid = document.getElementById('presets-grid');
  grid.innerHTML = '';

  allPresets.forEach((preset) => {
    const btn = document.createElement('button');
    btn.className = 'preset-btn' + (preset.id === selectedPresetId ? ' active' : '');
    btn.innerHTML = `<span class="icon">${preset.icon || preset.mask}</span>
                     <span class="label">${preset.label}</span>`;
    btn.addEventListener('click', async () => {
      selectedPresetId = preset.id;
      document.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      await sendToContent({ type: 'HIDE_TEXT', mask: preset.mask });
      setTimeout(refreshStats, 300);
      showToast(`Hidden with ${preset.icon || preset.mask}`);
    });
    grid.appendChild(btn);
  });
}

document.getElementById('apply-custom').addEventListener('click', async () => {
  const input = document.getElementById('custom-mask-input');
  const mask = input.value.trim();
  if (!mask) { input.focus(); return; }
  await sendToContent({ type: 'HIDE_TEXT', mask });
  setTimeout(refreshStats, 300);
  showToast(`Hidden with "${mask}"`);
});

document.getElementById('save-custom').addEventListener('click', async () => {
  const input = document.getElementById('custom-mask-input');
  const mask = input.value.trim();
  if (!mask) { input.focus(); return; }
  const { customMasks = [] } = await chrome.storage.sync.get('customMasks');
  const id = `custom-${Date.now()}`;
  customMasks.push({ id, label: mask, icon: mask, mask });
  await chrome.storage.sync.set({ customMasks });
  showToast('✅ Saved as preset!');
  await renderPresets();
});

document.getElementById('btn-reveal-all').addEventListener('click', async () => {
  await sendToContent({ type: 'UNHIDE_ALL' });
  setTimeout(refreshStats, 300);
  showToast('👁️ All revealed');
});

document.getElementById('btn-rehide-all').addEventListener('click', async () => {
  await sendToContent({ type: 'REHIDE_ALL' });
  setTimeout(refreshStats, 300);
  showToast('🔒 All re-hidden');
});

document.getElementById('btn-hide-all-occ').addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  // Get the current text selection from the page
  let selText = '';
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection()?.toString() || '',
    });
    selText = res?.result?.trim() || '';
  } catch (_) {}

  if (!selText) {
    showToast('⚠️ Select some text first');
    return;
  }

  // Use last used mask or default
  const { lastMask = '*' } = await chrome.storage.session.get('lastMask').catch(() => ({}));
  const result = await sendToContent({ type: 'HIDE_ALL_OCCURRENCES', text: selText, mask: lastMask });
  setTimeout(refreshStats, 300);
  showToast(`🔄 Hidden ${result?.count ?? '?'} occurrence(s)`);
});

document.getElementById('open-options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

document.getElementById('open-options-footer').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// Init
(async () => {
  await renderPresets();
  await refreshStats();
})();
