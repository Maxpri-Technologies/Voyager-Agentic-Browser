if (window.hasAgentContentScriptRun !== true) {
  window.hasAgentContentScriptRun = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log(`[Agent Content] Received command:`, message);

    // ==================== 1. EXECUTE CLICK ====================
    if (message.action === "execute_click") {
      const adjustedX = parseFloat(message.x);
      const adjustedY = parseFloat(message.y);

      console.log(`[Agent Content] Clicking at translated CSS coordinates: X: ${adjustedX}, Y: ${adjustedY}`);

      // Draw the debugger target ring
      // Manage or Create the persistent virtual BLUE CURSOR
      let agentCursor = document.getElementById("gemini-agent-cursor");
      if (!agentCursor) {
        agentCursor = document.createElement("div");
        agentCursor.id = "gemini-agent-cursor";
        const blueCursorSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32"><path fill="#007bff" stroke="#ffffff" stroke-width="2" d="M10,2 L24,16 L17,17 L22,27 L18,29 L13,19 L9,22 Z"/></svg>`;
        Object.assign(agentCursor.style, {
          position: "fixed", width: "24px", height: "24px", zIndex: "2147483647", pointerEvents: "none", transform: "translate(-3px, -2px)", transition: "top 0.3s ease-out, left 0.3s ease-out",
          backgroundImage: `url('data:image/svg+xml;utf8,${encodeURIComponent(blueCursorSvg)}')`, backgroundRepeat: "no-repeat", backgroundSize: "contain"
        });
        document.body.appendChild(agentCursor);
      }
      agentCursor.style.left = `${adjustedX}px`;
      agentCursor.style.top = `${adjustedY}px`;

      // Execute the click at the exact location
      // Spawn a temporary BLUE ripple to visually show the click impact
      const ripple = document.createElement("div");
      Object.assign(ripple.style, {
        position: "fixed", left: `${adjustedX}px`, top: `${adjustedY}px`, width: "10px", height: "10px", border: "3px solid #007bff", borderRadius: "50%", zIndex: "2147483646", pointerEvents: "none", transform: "translate(-50%, -50%) scale(1)", opacity: "1", transition: "transform 0.8s cubic-bezier(0.1, 0.8, 0.3, 1), opacity 0.8s ease-out"
      });
      document.body.appendChild(ripple);
      requestAnimationFrame(() => { ripple.style.transform = "translate(-50%, -50%) scale(5)"; ripple.style.opacity = "0"; });
      setTimeout(() => { ripple.remove(); }, 800);

      // Execute the click at the exact location
      const success = simulateClickAtCoordinates(adjustedX, adjustedY);
      sendResponse({ success: success });
      const el = document.elementFromPoint(message.x, message.y);
  
      // If the exact coordinate hits a transparent margin/padding or misses the button slightly:
      let target = el;
      if (el) {
        // Walk up the DOM tree to see if we clicked right next to a button/link/input
        target = el.closest('button, a, input, [role="button"]') || el;
      }
      
      if (target) {
        target.click();
        target.focus();
      }
    }

    // ==================== 2. EXECUTE TYPE ====================
    else if (message.action === "execute_type") {
      let activeEl = document.activeElement;

      // Check if we are currently focused on a valid text input element
      const isTextInput = activeEl && (
        activeEl.tagName === "INPUT" || 
        activeEl.tagName === "TEXTAREA" || 
        activeEl.contentEditable === "true"
      );

      // SELF-HEALING: If no input is focused, automatically find the best match on the page
      if (!isTextInput) {
        console.log("⚠️ Typing requested but no input focused. Finding logical target...");
        const inputCandidate = 
          document.querySelector('input[type="search"]') || 
          document.querySelector('input[type="text"]') || 
          document.querySelector('input:not([type="hidden"]):not([type="submit"]):not([type="button"])') ||
          document.querySelector('textarea');

        if (inputCandidate) {
          inputCandidate.focus();
        }
      }

      const success = simulateType(message.text);
      sendResponse({ success: success });
    } 

    // ==================== 3. PRESS ENTER ====================
    else if (message.action === "press_enter") {
      const success = simulateEnterKey();
      sendResponse({ success: success });
    } 

    // ==================== 4. SCROLL ====================
    else if (message.action === "execute_scroll") {
      const success = simulateScroll(message.direction);
      sendResponse({ success: success });
    }
    
    return true; // Keeps the message channel open for async sendResponse
  });
}

// ==================== HELPER FUNCTIONS ====================

// Helper to draw a temporary red target ripple on the page
function showVisualClickIndicator(x, y) {
  const indicator = document.createElement("div");
  Object.assign(indicator.style, {
    position: "fixed",
    left: `${x - 20}px`,
    top: `${y - 20}px`,
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    border: "3px solid #ff3333",
    backgroundColor: "rgba(255, 51, 51, 0.2)",
    pointerEvents: "none",
    zIndex: "999999",
    transition: "transform 0.8s ease-out, opacity 0.8s ease-out",
    transform: "scale(0.5)",
    opacity: "1"
  });

  document.body.appendChild(indicator);

  requestAnimationFrame(() => {
    indicator.style.transform = "scale(1.5)";
    indicator.style.opacity = "0";
  });

  setTimeout(() => {
    indicator.remove();
  }, 800);
}

// Helper to simulate a mouse click at specific viewport coordinates
function simulateClickAtCoordinates(x, y) {
  let element = document.elementFromPoint(x, y);
  if (!element) return false;

  // If we hit a child element, bubble up to the interactive container
  const interactiveParent = element.closest('a, button, input, select, [role="button"]');
  if (interactiveParent) {
    element = interactiveParent;
  }

  element.focus();

  // Try clicking the true center of the element to avoid clicking edge boundaries
  // Use the exact translated coordinates instead of forcing the geometric center
  const clickX = x;
  const clickY = y;

  const events = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
  events.forEach(eventName => {
    const event = eventName.startsWith("pointer")
      ? new PointerEvent(eventName, { bubbles: true, cancelable: true, clientX: clickX, clientY: clickY })
      : new MouseEvent(eventName, { bubbles: true, cancelable: true, clientX: clickX, clientY: clickY });
    element.dispatchEvent(event);
  });

  return true;
}

// Helper to simulate keyboard typing (clears the field first)
function simulateType(text) {
  const activeElement = document.activeElement;
  if (!activeElement) return false;

  if (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA" || activeElement.isContentEditable) {
    // Clear existing text to prevent double appending
    if (activeElement.isContentEditable) {
      activeElement.innerText = ""; 
    } else {
      activeElement.value = ""; 
    }
    
    // Insert new text
    if (activeElement.isContentEditable) {
      activeElement.innerText = text;
    } else {
      activeElement.value = text;
    }
    
    // Dispatch input events for modern frameworks (React, Angular, Vue)
    activeElement.dispatchEvent(new Event("input", { bubbles: true }));
    activeElement.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  return false;
}

// Helper to simulate pressing Enter key
function simulateEnterKey() {
  const activeElement = document.activeElement || document.body;
  
  const keydown = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 });
  const keypress = new KeyboardEvent("keypress", { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 });
  const keyup = new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 });

  activeElement.dispatchEvent(keydown);
  activeElement.dispatchEvent(keypress);
  
  // Submit if part of a form
  if (activeElement.tagName === "INPUT" && activeElement.form) {
    activeElement.form.requestSubmit();
  }

  activeElement.dispatchEvent(keyup);
  return true;
}

// Helper to scroll
function simulateScroll(direction) {
  const distance = direction === "down" ? 400 : -400;
  window.scrollBy({
    top: distance,
    behavior: "smooth"
  });
  return true;
}