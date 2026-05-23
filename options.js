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

const DEFAULT_SETTINGS = {
  presets: DEFAULT_PRESETS,
  customMasks: [],
  theme: 'crimson',
  clickToggle: true,
  tooltip: true,
  badge: true,
  persist: false,
  autoHideFilters: [],
};

const THEME_STYLES = {
  crimson: { bg: '#1a1a2e', color: '#e94560', revealBg: '#2ecc71', revealColor: '#000' },
  ocean:   { bg: '#0a1628', color: '#0ea5e9', revealBg: '#22d3ee', revealColor: '#000' },
  forest:  { bg: '#0a1a0f', color: '#22c55e', revealBg: '#86efac', revealColor: '#000' },
  gold:    { bg: '#1a1500', color: '#eab308', revealBg: '#fde68a', revealColor: '#000' },
  purple:  { bg: '#1a0a2e', color: '#a855f7', revealBg: '#c084fc', revealColor: '#000' },
  mono:    { bg: '#111',    color: '#888888', revealBg: '#ccc',    revealColor: '#000' },
  none:    null, // special: no background, dotted underline only
};

let state = { ...DEFAULT_SETTINGS };

// ---- Preset list rendering ----

function renderPresets() {
  const list = document.getElementById('preset-list');
  list.innerHTML = '';
  const all = [...(state.presets || []), ...(state.customMasks || [])];
  all.forEach((preset, idx) => {
    const item = document.createElement('div');
    item.className = 'preset-item';
    item.draggable = true;
    item.dataset.idx = idx;
    item.innerHTML = `
      <span class="drag-handle" title="Drag to reorder">⠿</span>
      <span class="icon-preview">${preset.icon || preset.mask}</span>
      <input type="text" class="input-label" value="${escHtml(preset.label)}" placeholder="Label" data-field="label" data-id="${preset.id}" />
      <input type="text" class="input-mask" value="${escHtml(preset.mask)}" placeholder="Mask" maxlength="10" data-field="mask" data-id="${preset.id}" />
      <button class="btn-remove" data-id="${preset.id}" title="Remove">✕</button>
    `;

    // Live icon preview on mask change
    item.querySelector('[data-field="mask"]').addEventListener('input', (e) => {
      item.querySelector('.icon-preview').textContent = e.target.value || '?';
    });

    item.querySelector('.btn-remove').addEventListener('click', () => {
      removePreset(preset.id);
    });

    setupDrag(item);
    list.appendChild(item);
  });
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function collectPresetsFromDOM() {
  const items = document.querySelectorAll('.preset-item');
  const presets = [];
  items.forEach((item) => {
    const id = item.querySelector('[data-field="label"]').dataset.id;
    const label = item.querySelector('[data-field="label"]').value.trim() || 'Preset';
    const mask = item.querySelector('[data-field="mask"]').value.trim() || '*';
    const icon = mask;
    presets.push({ id, label, icon, mask });
  });
  return presets;
}

function removePreset(id) {
  state.presets = state.presets.filter((p) => p.id !== id);
  state.customMasks = (state.customMasks || []).filter((p) => p.id !== id);
  renderPresets();
}

document.getElementById('btn-add-preset').addEventListener('click', () => {
  const id = `custom-${Date.now()}`;
  state.customMasks = [...(state.customMasks || []), { id, label: 'New', icon: '?', mask: '?' }];
  renderPresets();
  // Focus the new label input
  const items = document.querySelectorAll('.preset-item');
  const last = items[items.length - 1];
  last?.querySelector('.input-label')?.focus();
});

// ---- Drag & drop reorder ----
let dragSrc = null;

function setupDrag(item) {
  item.addEventListener('dragstart', () => { dragSrc = item; item.style.opacity = '0.5'; });
  item.addEventListener('dragend', () => { item.style.opacity = '1'; });
  item.addEventListener('dragover', (e) => { e.preventDefault(); });
  item.addEventListener('drop', () => {
    if (dragSrc === item) return;
    const list = document.getElementById('preset-list');
    const children = [...list.children];
    const srcIdx = children.indexOf(dragSrc);
    const dstIdx = children.indexOf(item);
    if (srcIdx < dstIdx) list.insertBefore(dragSrc, item.nextSibling);
    else list.insertBefore(dragSrc, item);
  });
}

// ---- Auto-hide Filters ----

function renderAutoHideFilters() {
  const list = document.getElementById('autohide-list');
  if (!list) return;
  list.innerHTML = '';
  const filters = state.autoHideFilters || [];
  if (filters.length === 0) {
    list.innerHTML = '<p style="color:#555;font-size:12px;font-style:italic;">No filters added yet.</p>';
    return;
  }
  filters.forEach((filter, idx) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;background:#0f0f1a;border:1px solid #252540;border-radius:8px;padding:10px 12px;';
    row.innerHTML = `
      <label class="toggle" title="Enable/disable this filter">
        <input type="checkbox" ${filter.enabled !== false ? 'checked' : ''} data-idx="${idx}" class="autohide-toggle" />
        <span class="toggle-slider"></span>
      </label>
      <span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(filter.text)}">${escHtml(filter.text)}</span>
      <code style="background:#1a1a2e;border-radius:4px;padding:2px 8px;font-size:12px;color:#e94560;">${escHtml(filter.mask || '*')}</code>
      <button class="btn-remove autohide-remove" data-idx="${idx}" title="Remove filter" style="background:none;border:none;color:#555;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;">&#x2715;</button>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('.autohide-toggle').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      const i = parseInt(e.target.dataset.idx, 10);
      if (state.autoHideFilters[i]) state.autoHideFilters[i].enabled = e.target.checked;
    });
  });

  list.querySelectorAll('.autohide-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const i = parseInt(e.target.closest('[data-idx]').dataset.idx, 10);
      state.autoHideFilters.splice(i, 1);
      renderAutoHideFilters();
    });
    btn.addEventListener('mouseenter', (e) => { e.target.style.color = '#e94560'; });
    btn.addEventListener('mouseleave', (e) => { e.target.style.color = '#555'; });
  });
}

document.getElementById('btn-add-autohide').addEventListener('click', () => {
  const textEl = document.getElementById('autohide-new-text');
  const maskEl = document.getElementById('autohide-new-mask');
  const text = textEl.value.trim();
  const mask = maskEl.value.trim() || '*';
  if (!text) { textEl.focus(); return; }
  if (!state.autoHideFilters) state.autoHideFilters = [];
  // Prevent duplicates
  if (state.autoHideFilters.some((f) => f.text.toLowerCase() === text.toLowerCase())) {
    textEl.select();
    return;
  }
  state.autoHideFilters.push({ text, mask, enabled: true });
  renderAutoHideFilters();
  textEl.value = '';
  maskEl.value = '*';
  textEl.focus();
});

document.getElementById('autohide-new-text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-add-autohide').click();
});

// ---- Theme ----
function renderTheme() {
  document.querySelectorAll('.theme-card').forEach((card) => {
    card.classList.toggle('active', card.dataset.theme === state.theme);
  });
}

document.getElementById('theme-grid').addEventListener('click', (e) => {
  const card = e.target.closest('.theme-card');
  if (!card) return;
  state.theme = card.dataset.theme;
  renderTheme();
});

// ---- Toggles ----
function bindToggle(id, key) {
  document.getElementById(id).addEventListener('change', (e) => {
    state[key] = e.target.checked;
  });
}
bindToggle('opt-click-toggle', 'clickToggle');
bindToggle('opt-tooltip', 'tooltip');
bindToggle('opt-badge', 'badge');
bindToggle('opt-persist', 'persist');

function applyStateToForm() {
  document.getElementById('opt-click-toggle').checked = state.clickToggle !== false;
  document.getElementById('opt-tooltip').checked = state.tooltip !== false;
  document.getElementById('opt-badge').checked = state.badge !== false;
  document.getElementById('opt-persist').checked = !!state.persist;
  renderTheme();
  renderPresets();
  renderAutoHideFilters();
}

// ---- Save ----
async function applyThemeToContentScripts() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url || tab.url.startsWith('chrome://')) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'APPLY_THEME', theme: state.theme });
    } catch (_) {}
  }
}

document.getElementById('btn-save').addEventListener('click', async () => {
  // Collect latest preset values from DOM
  const domPresets = collectPresetsFromDOM();
  // Split back into presets vs custom (custom ids start with 'custom-')
  state.presets = domPresets.filter((p) => !p.id.startsWith('custom-'));
  state.customMasks = domPresets.filter((p) => p.id.startsWith('custom-'));

  await chrome.storage.sync.set({
    presets: state.presets,
    customMasks: state.customMasks,
    theme: state.theme,
    clickToggle: state.clickToggle,
    tooltip: state.tooltip,
    badge: state.badge,
    persist: state.persist,
    autoHideFilters: state.autoHideFilters || [],
  });

  await applyThemeToContentScripts();

  const badge = document.getElementById('saved-badge');
  badge.classList.add('show');
  setTimeout(() => badge.classList.remove('show'), 2000);
});

document.getElementById('btn-cancel').addEventListener('click', () => {
  window.close();
});

document.getElementById('btn-reset').addEventListener('click', async () => {
  if (!confirm('Reset all settings to defaults? This cannot be undone.')) return;
  await chrome.storage.sync.set(DEFAULT_SETTINGS);
  state = { ...DEFAULT_SETTINGS };
  applyStateToForm();
});

// ---- Export / Import ----
document.getElementById('btn-export').addEventListener('click', async () => {
  const { presets, customMasks } = await chrome.storage.sync.get(['presets', 'customMasks']);
  const data = JSON.stringify({ presets: presets || [], customMasks: customMasks || [] }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'texthider-presets.json';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('btn-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const status = document.getElementById('import-status');
    if (!Array.isArray(data.presets) && !Array.isArray(data.customMasks)) {
      status.textContent = '❌ Invalid file format.';
      status.style.color = '#e94560';
      status.style.display = 'block';
      return;
    }
    if (Array.isArray(data.presets)) state.presets = data.presets;
    if (Array.isArray(data.customMasks)) state.customMasks = data.customMasks;
    await chrome.storage.sync.set({ presets: state.presets, customMasks: state.customMasks });
    renderPresets();
    status.textContent = `✅ Imported ${(data.presets?.length || 0) + (data.customMasks?.length || 0)} presets successfully.`;
    status.style.color = '#2ecc71';
    status.style.display = 'block';
    setTimeout(() => { status.style.display = 'none'; }, 3000);
  } catch (err) {
    const status = document.getElementById('import-status');
    status.textContent = '❌ Failed to parse file: ' + err.message;
    status.style.color = '#e94560';
    status.style.display = 'block';
  }
  e.target.value = ''; // reset file input
});

// ---- Load ----
(async () => {
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  state = { ...DEFAULT_SETTINGS, ...stored };
  applyStateToForm();
})();
