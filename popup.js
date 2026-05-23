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

// ---- Find & Mask ----
let _findDebounce = null;

document.getElementById('find-input').addEventListener('input', (e) => {
  clearTimeout(_findDebounce);
  const countEl = document.getElementById('find-count');
  const text = e.target.value.trim();
  if (!text) {
    countEl.textContent = '\u2014';
    countEl.classList.remove('has-matches');
    return;
  }
  _findDebounce = setTimeout(async () => {
    const tab = await getActiveTab();
    if (!tab?.id) return;
    try {
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'COUNT_MATCHES', text });
      const n = result?.count ?? 0;
      countEl.textContent = `${n} match${n !== 1 ? 'es' : ''}`;
      countEl.classList.toggle('has-matches', n > 0);
    } catch (_) {
      countEl.textContent = '\u2014';
      countEl.classList.remove('has-matches');
    }
  }, 300);
});

document.getElementById('btn-find-mask').addEventListener('click', async () => {
  const input = document.getElementById('find-input');
  const text = input.value.trim();
  if (!text) { input.focus(); return; }
  const { lastMask = '*' } = await chrome.storage.session.get('lastMask').catch(() => ({}));
  const result = await sendToContent({ type: 'HIDE_ALL_OCCURRENCES', text, mask: lastMask });
  const n = result?.count ?? 0;
  if (n > 0) {
    input.value = '';
    document.getElementById('find-count').textContent = '\u2014';
    document.getElementById('find-count').classList.remove('has-matches');
    setTimeout(refreshStats, 300);
    showToast(`\ud83d\udd0d Masked ${n} occurrence${n !== 1 ? 's' : ''}`);
  } else {
    showToast('\u26a0\ufe0f No matches found');
  }
});

// ---- Undo Last ----
document.getElementById('btn-undo').addEventListener('click', async () => {
  const result = await sendToContent({ type: 'UNDO_LAST' });
  const n = result?.count ?? 0;
  if (n > 0) {
    setTimeout(refreshStats, 300);
    showToast(`\u21a9 Undid ${n} hidden item${n !== 1 ? 's' : ''}`);
  } else {
    showToast('\u26a0\ufe0f Nothing to undo');
  }
});

// ---- Temp Reveal (Peek) ----
document.getElementById('btn-temp-reveal').addEventListener('click', async () => {
  const btn = document.getElementById('btn-temp-reveal');
  const result = await sendToContent({ type: 'TEMP_REVEAL', seconds: 5 });
  const n = result?.count ?? 0;
  if (n === 0) { showToast('\u26a0\ufe0f No hidden items on this page'); return; }
  showToast(`\u23f1 Showing ${n} item${n !== 1 ? 's' : ''} for 5s\u2026`);
  // Visual countdown on button
  btn.disabled = true;
  let remaining = 5;
  const orig = btn.textContent;
  const tick = setInterval(() => {
    remaining--;
    btn.textContent = `\u23f1 Re-hiding in ${remaining}s\u2026`;
    if (remaining <= 0) {
      clearInterval(tick);
      btn.textContent = orig;
      btn.disabled = false;
      setTimeout(refreshStats, 300);
    }
  }, 1000);
});

// Init
(async () => {
  await renderPresets();
  await refreshStats();
})();
