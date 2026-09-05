if (window.hasAgentContentScriptRun !== true) {
  window.hasAgentContentScriptRun = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log(`[Agent Content] Received command:`, message);

    // ==================== 0. EXTRACT INTERACTIVE DOM ELEMENTS ====================
    if (message.action === "get_interactive_elements") {
      try {
        const elements = extractVisibleInteractiveElements();
        sendResponse({ success: true, elements: elements });
      } catch (err) {
        console.error("[Agent Content] Error extracting interactive elements:", err);
        sendResponse({ success: false, elements: [] });
      }
      return true;
    }

    // ==================== 1. EXECUTE CLICK ====================
    else if (message.action === "execute_click") {
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1920;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1080;

      const clickX = message.normX !== undefined
        ? Math.round((parseFloat(message.normX) / 1000) * viewportWidth)
        : parseFloat(message.x || 0);

      const clickY = message.normY !== undefined
        ? Math.round((parseFloat(message.normY) / 1000) * viewportHeight)
        : parseFloat(message.y || 0);

      console.log(`[Agent Content] Viewport: ${viewportWidth}x${viewportHeight}, Translating (${message.normX}, ${message.normY}) -> (${clickX}, ${clickY})`);

      const clickSuccess = simulateClickAtCoordinates(clickX, clickY);
      sendResponse({ success: clickSuccess });
    }

    // ==================== 2. EXECUTE TYPE ====================
    else if (message.action === "execute_type") {
      let activeEl = document.activeElement;

      const isTextInput = activeEl && (
        activeEl.tagName === "INPUT" || 
        activeEl.tagName === "TEXTAREA" || 
        activeEl.contentEditable === "true"
      );

      if (!isTextInput) {
        console.log("[Warning] Typing requested but no input focused. Finding logical target...");
        const inputCandidate = 
          document.querySelector('input[type="search"]') || 
          document.querySelector('input[type="text"]') || 
          document.querySelector('input:not([type="hidden"]):not([type="submit"]):not([type="button"])') ||
          document.querySelector('textarea');

        if (inputCandidate) {
          inputCandidate.focus();
        }
      }

      const typeSuccess = simulateType(message.text);
      sendResponse({ success: typeSuccess });
    } 

    // ==================== 3. PRESS ENTER ====================
    else if (message.action === "press_enter") {
      const enterSuccess = simulateEnterKey();
      sendResponse({ success: enterSuccess });
    } 

    // ==================== 4. SCROLL ====================
    else if (message.action === "execute_scroll") {
      const scrollSuccess = simulateScroll(message.direction);
      sendResponse({ success: scrollSuccess });
    }

    // ==================== 5. HOVER ====================
    else if (message.action === "execute_hover") {
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1920;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1080;

      const hoverX = message.normX !== undefined
        ? Math.round((parseFloat(message.normX) / 1000) * viewportWidth)
        : parseFloat(message.x || 0);

      const hoverY = message.normY !== undefined
        ? Math.round((parseFloat(message.normY) / 1000) * viewportHeight)
        : parseFloat(message.y || 0);

      const hoverSuccess = simulateHoverAtCoordinates(hoverX, hoverY);
      sendResponse({ success: hoverSuccess });
    }

    // ==================== 6. SELECT DROPDOWN OPTION ====================
    else if (message.action === "execute_select") {
      const selectSuccess = simulateSelectOption(message.value || message.text);
      sendResponse({ success: selectSuccess });
    }

    // ==================== 7. EXECUTE SPECIAL KEY (Escape, Tab, Backspace, etc.) ====================
    else if (message.action === "execute_key") {
      const keySuccess = simulateSpecialKey(message.key);
      sendResponse({ success: keySuccess });
    }

    // ==================== 8. CLEAR INPUT ====================
    else if (message.action === "clear_input") {
      const clearSuccess = simulateClearInput();
      sendResponse({ success: clearSuccess });
    }
    
    return true;
  });
}

// ==================== INTERACTIVE ELEMENT EXTRACTION ====================

function extractVisibleInteractiveElements() {
  const selector = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="combobox"], [role="searchbox"], [contenteditable="true"]';
  const nodes = Array.from(document.querySelectorAll(selector));
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1920;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1080;
  
  const results = [];
  const seenCenters = new Set();

  for (const el of nodes) {
    if (results.length >= 45) break;

    const rect = el.getBoundingClientRect();
    if (rect.width < 5 || rect.height < 5) continue;
    if (rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth) continue;

    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) < 0.1) continue;

    const centerX = Math.round(rect.left + rect.width / 2);
    const centerY = Math.round(rect.top + rect.height / 2);

    const normX = Math.round((centerX / viewportWidth) * 1000);
    const normY = Math.round((centerY / viewportHeight) * 1000);

    const posKey = `${Math.round(normX / 15)}_${Math.round(normY / 15)}`;
    if (seenCenters.has(posKey)) continue;
    seenCenters.add(posKey);

    let tag = el.tagName.toLowerCase();
    let text = "";

    if (tag === "input") {
      const type = el.getAttribute("type") || "text";
      tag = `input[${type}]`;
      text = el.placeholder || el.getAttribute("aria-label") || el.value || el.name || "";
    } else if (tag === "textarea") {
      text = el.placeholder || el.getAttribute("aria-label") || el.value || "";
    } else if (tag === "select") {
      const selected = el.options[el.selectedIndex];
      text = selected ? selected.text : (el.getAttribute("aria-label") || "");
    } else {
      text = el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || el.getAttribute("alt") || "";
    }

    text = text.replace(/\s+/g, " ").trim().slice(0, 35);

    results.push({
      tag: tag,
      text: text,
      x: normX,
      y: normY
    });
  }

  return results;
}

// ==================== HELPER FUNCTIONS ====================

function simulateClickAtCoordinates(x, y) {
  let element = document.elementFromPoint(x, y);

  let interactiveTarget = element
    ? element.closest('a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="combobox"], [role="searchbox"], [contenteditable="true"]')
    : null;

  if (!interactiveTarget) {
    interactiveTarget = findClosestInteractiveElement(x, y, 60);
  }

  let finalX = x;
  let finalY = y;

  if (interactiveTarget) {
    element = interactiveTarget;
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      finalX = Math.round(rect.left + rect.width / 2);
      finalY = Math.round(rect.top + rect.height / 2);
    }
  }

  if (!element) return false;

  if (pointsToJavaScriptUrl(element)) {
    console.warn("[Agent Content] Refusing to execute a javascript: URL.");
    return false;
  }

  let agentCursor = document.getElementById("gemini-agent-cursor");
  if (!agentCursor) {
    agentCursor = document.createElement("div");
    agentCursor.id = "gemini-agent-cursor";
    const blueCursorSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32"><path fill="#007bff" stroke="#ffffff" stroke-width="2" d="M10,2 L24,16 L17,17 L22,27 L18,29 L13,19 L9,22 Z"/></svg>`;
    Object.assign(agentCursor.style, {
      position: "fixed", width: "24px", height: "24px", zIndex: "2147483647", pointerEvents: "none", transform: "translate(-3px, -2px)", transition: "top 0.25s ease-out, left 0.25s ease-out",
      backgroundImage: `url('data:image/svg+xml;utf8,${encodeURIComponent(blueCursorSvg)}')`, backgroundRepeat: "no-repeat", backgroundSize: "contain"
    });
    document.body.appendChild(agentCursor);
  }
  agentCursor.style.left = `${finalX}px`;
  agentCursor.style.top = `${finalY}px`;

  const ripple = document.createElement("div");
  Object.assign(ripple.style, {
    position: "fixed", left: `${finalX}px`, top: `${finalY}px`, width: "10px", height: "10px", border: "3px solid #007bff", borderRadius: "50%", zIndex: "2147483646", pointerEvents: "none", transform: "translate(-50%, -50%) scale(1)", opacity: "1", transition: "transform 0.8s cubic-bezier(0.1, 0.8, 0.3, 1), opacity 0.8s ease-out"
  });
  document.body.appendChild(ripple);
  requestAnimationFrame(() => { ripple.style.transform = "translate(-50%, -50%) scale(5)"; ripple.style.opacity = "0"; });
  setTimeout(() => { ripple.remove(); }, 800);

  try {
    element.focus();
  } catch (e) {}

  const events = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
  events.forEach(eventName => {
    const event = eventName.startsWith("pointer")
      ? new PointerEvent(eventName, { bubbles: true, cancelable: true, clientX: finalX, clientY: finalY, view: window })
      : new MouseEvent(eventName, { bubbles: true, cancelable: true, clientX: finalX, clientY: finalY, view: window });
    element.dispatchEvent(event);
  });

  return true;
}

function findClosestInteractiveElement(x, y, radius = 60) {
  const selector = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="combobox"], [role="searchbox"], [contenteditable="true"]';
  const candidates = document.querySelectorAll(selector);
  const viewportWidth = window.innerWidth || 1920;
  const viewportHeight = window.innerHeight || 1080;
  let closest = null;
  let minDistance = radius;

  candidates.forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 5 || rect.height < 5) return;
    if (rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth) return;

    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) < 0.1) return;

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dist = Math.hypot(cx - x, cy - y);
    if (dist < minDistance) {
      minDistance = dist;
      closest = el;
    }
  });

  return closest;
}

function simulateHoverAtCoordinates(x, y) {
  let element = document.elementFromPoint(x, y);
  const interactiveTarget = element ? element.closest('a, button, input, select, [role="button"], [role="link"]') : null;
  if (interactiveTarget) element = interactiveTarget;
  else {
    const closest = findClosestInteractiveElement(x, y, 50);
    if (closest) element = closest;
  }
  if (!element) return false;

  const rect = element.getBoundingClientRect();
  const hoverX = rect.width > 0 ? Math.round(rect.left + rect.width / 2) : x;
  const hoverY = rect.height > 0 ? Math.round(rect.top + rect.height / 2) : y;

  const events = ["pointerover", "mouseover", "pointerenter", "mouseenter", "pointermove", "mousemove"];
  events.forEach(eventName => {
    const event = eventName.startsWith("pointer")
      ? new PointerEvent(eventName, { bubbles: true, cancelable: true, clientX: hoverX, clientY: hoverY, view: window })
      : new MouseEvent(eventName, { bubbles: true, cancelable: true, clientX: hoverX, clientY: hoverY, view: window });
    element.dispatchEvent(event);
  });
  return true;
}

function simulateSelectOption(optionValueOrText) {
  const activeElement = document.activeElement;
  if (activeElement && activeElement.tagName === "SELECT") {
    let matchedIndex = -1;
    for (let i = 0; i < activeElement.options.length; i++) {
      const opt = activeElement.options[i];
      if (opt.value.toLowerCase() === optionValueOrText.toLowerCase() || opt.text.toLowerCase().includes(optionValueOrText.toLowerCase())) {
        matchedIndex = i;
        break;
      }
    }
    if (matchedIndex !== -1) {
      activeElement.selectedIndex = matchedIndex;
      activeElement.dispatchEvent(new Event("change", { bubbles: true }));
      activeElement.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
  }
  return false;
}

function simulateSpecialKey(keyName) {
  const activeElement = document.activeElement || document.body;
  const keyMap = {
    "Escape": { key: "Escape", code: "Escape", keyCode: 27 },
    "Tab": { key: "Tab", code: "Tab", keyCode: 9 },
    "Backspace": { key: "Backspace", code: "Backspace", keyCode: 8 },
    "ArrowDown": { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
    "ArrowUp": { key: "ArrowUp", code: "ArrowUp", keyCode: 38 }
  };
  const info = keyMap[keyName] || { key: keyName, code: keyName, keyCode: 0 };
  const keydown = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: info.key, code: info.code, keyCode: info.keyCode });
  const keyup = new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: info.key, code: info.code, keyCode: info.keyCode });
  activeElement.dispatchEvent(keydown);
  activeElement.dispatchEvent(keyup);
  return true;
}

function simulateClearInput() {
  const activeElement = document.activeElement;
  if (activeElement && (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA" || activeElement.isContentEditable)) {
    if (activeElement.isContentEditable) {
      activeElement.innerText = "";
    } else {
      activeElement.value = "";
    }
    activeElement.dispatchEvent(new Event("input", { bubbles: true }));
    activeElement.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  return false;
}

function pointsToJavaScriptUrl(element) {
  const link = element.closest("a[href], area[href]");
  const formControl = element.closest("button[formaction], input[formaction]");
  const candidateUrl = link?.getAttribute("href") || formControl?.getAttribute("formaction");
  return typeof candidateUrl === "string" && /^\s*javascript:/i.test(candidateUrl);
}

function formUsesJavaScriptUrl(form) {
  const action = form?.getAttribute("action");
  return typeof action === "string" && /^\s*javascript:/i.test(action);
}

function simulateType(text) {
  const activeElement = document.activeElement;
  if (!activeElement) return false;

  if (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA" || activeElement.isContentEditable) {
    if (activeElement.isContentEditable) {
      activeElement.innerText = ""; 
    } else {
      activeElement.value = ""; 
    }
    
    if (activeElement.isContentEditable) {
      activeElement.innerText = text;
    } else {
      activeElement.value = text;
    }
    
    activeElement.dispatchEvent(new Event("input", { bubbles: true }));
    activeElement.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  return false;
}

function simulateEnterKey() {
  const activeElement = document.activeElement || document.body;
  
  const keydown = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 });
  const keypress = new KeyboardEvent("keypress", { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 });
  const keyup = new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 });

  activeElement.dispatchEvent(keydown);
  activeElement.dispatchEvent(keypress);
  
  if (activeElement.tagName === "INPUT" && activeElement.form) {
    if (formUsesJavaScriptUrl(activeElement.form)) {
      console.warn("[Agent Content] Refusing to submit a javascript: form action.");
      return false;
    }
    activeElement.form.requestSubmit();
  }

  activeElement.dispatchEvent(keyup);
  return true;
}

function simulateScroll(direction) {
  const distance = direction === "down" ? 400 : -400;
  window.scrollBy({
    top: distance,
    behavior: "smooth"
  });
  return true;
}
