/**
 * TextHider Content Script
 * Handles text masking/unmasking directly in the page DOM.
 */

'use strict';

// Track all hidden spans so we can undo them
const HIDDEN_ATTR = 'data-texthider-original';
const HIDDEN_CLASS = 'texthider-masked';

/**
 * Cache the last non-empty selection range.
 * When the user clicks in the popup, the page selection is cleared.
 * We capture it via selectionchange so we can still use it.
 */
let _cachedRange = null;

document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
    try { _cachedRange = sel.getRangeAt(0).cloneRange(); } catch (_) {}
  }
});

// Apply saved theme on page load
(async () => {
  try {
    const { theme = 'crimson' } = await chrome.storage.sync.get('theme');
    applyThemeCSS(theme);
  } catch (_) {}
})();

function applyThemeCSS(theme) {
  let style = document.getElementById('texthider-theme');
  if (!style) {
    style = document.createElement('style');
    style.id = 'texthider-theme';
    document.head.appendChild(style);
  }
  if (theme === 'none') {
    style.textContent = `
      .texthider-masked {
        background-color: transparent !important;
        color: inherit !important;
        border-bottom: 2px dotted #888 !important;
        border-radius: 0 !important;
        padding: 0 !important;
        opacity: 0.55;
      }
      .texthider-masked:hover { opacity: 1; }
      .texthider-masked[data-texthider-revealed="true"] {
        background-color: transparent !important;
        color: inherit !important;
        border-bottom: 2px solid #2ecc71 !important;
        opacity: 1;
      }
    `;
  } else {
    const MAP = {
      crimson: { bg: '#1a1a2e', color: '#e94560', revealBg: '#2ecc71', revealColor: '#000' },
      ocean:   { bg: '#0a1628', color: '#0ea5e9', revealBg: '#22d3ee', revealColor: '#000' },
      forest:  { bg: '#0a1a0f', color: '#22c55e', revealBg: '#86efac', revealColor: '#000' },
      gold:    { bg: '#1a1500', color: '#eab308', revealBg: '#fde68a', revealColor: '#000' },
      purple:  { bg: '#1a0a2e', color: '#a855f7', revealBg: '#c084fc', revealColor: '#000' },
      mono:    { bg: '#111',    color: '#888888', revealBg: '#ccc',    revealColor: '#000' },
    };
    const t = MAP[theme] || MAP.crimson;
    style.textContent = `
      .texthider-masked { background-color: ${t.bg} !important; color: ${t.color} !important; opacity: 1; }
      .texthider-masked[data-texthider-revealed="true"] { background-color: ${t.revealBg} !important; color: ${t.revealColor} !important; }
    `;
  }
}

/**
 * Build a mask string that has the same character/word count as the original.
 * Each word is replaced by N copies of the mask unit.
 * @param {string} text  - The original selected text
 * @param {string} mask  - The mask symbol/emoji/string (e.g. "...", "***", "❤️")
 * @returns {string}
 */
function buildMask(text, mask) {
  // Split into tokens preserving whitespace
  return text.replace(/\S+/g, (word) => {
    const len = [...word].length; // Unicode-safe length
    // Repeat mask unit so the count equals word length
    let repeated = '';
    for (let i = 0; i < len; i++) {
      repeated += mask;
    }
    return repeated;
  });
}

/**
 * Hide selected text. Resolves the live or cached range, then delegates to hideRangeNodes.
 */
function hideSelection(mask) {
  const selection = window.getSelection();

  // Determine the range to use:
  // 1. Live selection (keyboard shortcut / right-click path)
  // 2. Cached range (popup click path — clicking popup clears page selection)
  let range = null;
  if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
    range = selection.getRangeAt(0);
    _cachedRange = range.cloneRange();
  } else if (_cachedRange) {
    range = _cachedRange;
    try { selection.removeAllRanges(); selection.addRange(range); } catch (_) {}
  }

  if (!range || range.collapsed) return;
  if (!range.toString().trim()) return;

  const count = hideRangeNodes(range, mask);
  if (count > 0) {
    if (selection) selection.removeAllRanges();
    _cachedRange = null;
    chrome.runtime.sendMessage({ type: 'TEXT_HIDDEN', mask });
  }
}

/**
 * Replace all text nodes within a Range with masked <span> elements.
 *
 * Uses atomic parent.replaceChild(fragment, textNode) so the original text is
 * NEVER deleted before the replacement is ready — this eliminates the
 * "text cut with no sticker" bug caused by surroundContents / deleteContents
 * failing on cross-element selections.
 *
 * Works for single-node and multi-element selections.
 * Returns the number of spans created.
 */
function hideRangeNodes(range, mask) {
  const root = range.commonAncestorContainer;
  const walker = document.createTreeWalker(
    root.nodeType === Node.TEXT_NODE ? root.parentNode : root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const tag = node.parentElement?.tagName?.toUpperCase();
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest('.' + HIDDEN_CLASS)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  // Collect all text nodes that intersect the range, with per-node char offsets
  const segments = [];
  let node;
  while ((node = walker.nextNode())) {
    if (!range.intersectsNode(node)) continue;
    const from = (node === range.startContainer) ? range.startOffset : 0;
    const to   = (node === range.endContainer)   ? range.endOffset   : node.textContent.length;
    const text = node.textContent.slice(from, to);
    if (!text.trim()) continue;
    segments.push({ node, from, to, text });
  }

  // Process in reverse document order so earlier positions stay valid
  let count = 0;
  for (let i = segments.length - 1; i >= 0; i--) {
    const { node, from, to, text } = segments[i];
    const parent = node.parentNode;
    if (!parent) continue;

    const before = node.textContent.slice(0, from);
    const after  = node.textContent.slice(to);
    const frag   = document.createDocumentFragment();

    if (before) frag.appendChild(document.createTextNode(before));

    const span = document.createElement('span');
    span.className = HIDDEN_CLASS;
    span.setAttribute(HIDDEN_ATTR, text);
    span.setAttribute('data-texthider-mask', mask);
    span.setAttribute('title', '🔒 Hidden by TextHider — Click to reveal');
    span.setAttribute('aria-label', 'hidden text');
    span.setAttribute('role', 'button');
    span.setAttribute('tabindex', '0');
    span.style.cursor = 'pointer';
    span.textContent = buildMask(text, mask);
    span.addEventListener('click', handleToggleReveal);
    span.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') handleToggleReveal(e); });
    frag.appendChild(span);

    if (after) frag.appendChild(document.createTextNode(after));

    parent.replaceChild(frag, node); // atomic: original preserved until replacement is ready
    count++;
  }

  return count;
}

/**
 * Click handler: toggle between masked and original text.
 */
function handleToggleReveal(e) {
  const span = e.currentTarget;
  const isRevealed = span.getAttribute('data-texthider-revealed') === 'true';

  if (isRevealed) {
    // Re-hide
    const mask = span.getAttribute('data-texthider-mask');
    const original = span.getAttribute(HIDDEN_ATTR);
    span.textContent = buildMask(original, mask);
    span.setAttribute('data-texthider-revealed', 'false');
    span.setAttribute('title', '🔒 Hidden by TextHider — Click to reveal');
  } else {
    // Reveal
    const original = span.getAttribute(HIDDEN_ATTR);
    span.textContent = original;
    span.setAttribute('data-texthider-revealed', 'true');
    span.setAttribute('title', '🔓 Click to hide again');
  }
}

/**
 * Hide every occurrence of a given text string across the whole page.
 */
function hideAllOccurrences(text, mask) {
  if (!text || !text.trim()) return 0;
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'gi');
  let count = 0;

  // Walk all text nodes in the document
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        // Skip nodes already inside a masked span
        if (node.parentElement?.closest('.' + HIDDEN_CLASS)) return NodeFilter.FILTER_REJECT;
        // Skip script/style
        const tag = node.parentElement?.tagName?.toUpperCase();
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
        return regex.test(node.textContent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    }
  );

  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);

  nodes.forEach((textNode) => {
    regex.lastIndex = 0;
    const parent = textNode.parentNode;
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(textNode.textContent)) !== null) {
      // text before match
      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(textNode.textContent.slice(lastIndex, match.index)));
      }
      // masked span
      const span = document.createElement('span');
      span.className = HIDDEN_CLASS;
      span.setAttribute(HIDDEN_ATTR, match[0]);
      span.setAttribute('data-texthider-mask', mask);
      span.setAttribute('title', '\ud83d\udd12 Hidden by TextHider \u2014 Click to reveal');
      span.style.cursor = 'pointer';
      span.setAttribute('aria-label', 'hidden text');
      span.setAttribute('role', 'button');
      span.setAttribute('tabindex', '0');
      span.textContent = buildMask(match[0], mask);
      span.addEventListener('click', handleToggleReveal);
      span.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') handleToggleReveal(e); });
      frag.appendChild(span);
      lastIndex = match.index + match[0].length;
      count++;
    }

    if (lastIndex < textNode.textContent.length) {
      frag.appendChild(document.createTextNode(textNode.textContent.slice(lastIndex)));
    }

    parent.replaceChild(frag, textNode);
  });

  if (count > 0) chrome.runtime.sendMessage({ type: 'TEXT_HIDDEN', mask });
  return count;
}

/**
 * Unhide all masked spans on the page.
 */
function unhideAll() {
  const spans = document.querySelectorAll(`.${HIDDEN_CLASS}`);
  spans.forEach((span) => {
    const original = span.getAttribute(HIDDEN_ATTR);
    const text = document.createTextNode(original);
    span.replaceWith(text);
  });
  chrome.runtime.sendMessage({ type: 'ALL_REVEALED' });
}

/**
 * Re-hide all currently revealed spans.
 */
function rehideAll() {
  const spans = document.querySelectorAll(`.${HIDDEN_CLASS}`);
  spans.forEach((span) => {
    if (span.getAttribute('data-texthider-revealed') === 'true') {
      const mask = span.getAttribute('data-texthider-mask');
      const original = span.getAttribute(HIDDEN_ATTR);
      span.textContent = buildMask(original, mask);
      span.setAttribute('data-texthider-revealed', 'false');
      span.setAttribute('title', '🔒 Hidden by TextHider — Click to reveal');
    }
  });
}

/**
 * Return count of hidden spans on the page.
 */
function getHiddenCount() {
  return document.querySelectorAll(`.${HIDDEN_CLASS}`).length;
}

// Listen for postMessage from the injected custom-mask prompt (same page context)
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || !msg.__texthider) return;
  if (msg.type === 'HIDE_TEXT') {
    // The prompt was triggered by right-click, so live selection is still active
    hideSelection(msg.mask);
    if (msg.save) {
      chrome.runtime.sendMessage({
        type: 'SAVE_CUSTOM_MASK',
        mask: msg.mask,
        label: `Custom: ${msg.mask}`,
      });
    }
  }
});

// Listen for messages from background / popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'HIDE_TEXT':
      hideSelection(message.mask);
      sendResponse({ success: true });
      break;
    case 'HIDE_ALL_OCCURRENCES': {
      const n = hideAllOccurrences(message.text, message.mask);
      sendResponse({ success: true, count: n });
      break;
    }
    case 'UNHIDE_ALL':
      unhideAll();
      sendResponse({ success: true });
      break;
    case 'REHIDE_ALL':
      rehideAll();
      sendResponse({ success: true });
      break;
    case 'GET_COUNT':
      sendResponse({ count: getHiddenCount() });
      break;
    case 'APPLY_THEME':
      applyThemeCSS(message.theme);
      sendResponse({ success: true });
      break;
  }
  return true; // keep channel open for async
});
