/**
 * TextHider Content Script
 * Handles text masking/unmasking directly in the page DOM.
 */

'use strict';

// Track all hidden spans so we can undo them
const HIDDEN_ATTR = 'data-texthider-original';
const HIDDEN_CLASS = 'texthider-masked';

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
 * Wrap every text node that contains the selection with a <span>,
 * replacing visible text with the mask.
 */
function hideSelection(mask) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

  const range = selection.getRangeAt(0);
  const selectedText = selection.toString();
  if (!selectedText.trim()) return;

  try {
    // Surround the selected range with a span
    const span = document.createElement('span');
    span.className = HIDDEN_CLASS;
    span.setAttribute(HIDDEN_ATTR, selectedText);
    span.setAttribute('data-texthider-mask', mask);
    span.setAttribute('title', '🔒 Hidden by TextHider — Click to reveal');
    span.style.cursor = 'pointer';

    range.surroundContents(span);

    // Set the masked text
    span.textContent = buildMask(selectedText, mask);

    // Click to toggle reveal
    span.addEventListener('click', handleToggleReveal);

    selection.removeAllRanges();

    // Notify background that we masked something (for badge count)
    chrome.runtime.sendMessage({ type: 'TEXT_HIDDEN' });
  } catch (e) {
    // surroundContents can fail when selection spans multiple elements
    // Fallback: replace innerHTML inside the range
    fallbackHide(range, selectedText, mask);
  }
}

/**
 * Fallback hide for complex multi-node selections.
 */
function fallbackHide(range, selectedText, mask) {
  const fragment = range.extractContents();
  const span = document.createElement('span');
  span.className = HIDDEN_CLASS;
  span.setAttribute(HIDDEN_ATTR, selectedText);
  span.setAttribute('data-texthider-mask', mask);
  span.setAttribute('title', '🔒 Hidden by TextHider — Click to reveal');
  span.style.cursor = 'pointer';
  span.textContent = buildMask(selectedText, mask);
  span.appendChild(fragment); // keep original in DOM but hidden
  span.firstChild && hideNode(span);
  span.addEventListener('click', handleToggleReveal);
  range.insertNode(span);
  chrome.runtime.sendMessage({ type: 'TEXT_HIDDEN' });
}

function hideNode(span) {
  // Hide all child nodes visually (we show only the textContent mask)
  Array.from(span.childNodes).forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      node.style.display = 'none';
    } else if (node.nodeType === Node.TEXT_NODE) {
      node.textContent = '';
    }
  });
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
  }
  return true; // keep channel open for async
});
