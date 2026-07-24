// Paste your Gemini AQ key here
const GEMINI_API_KEY = "AQ.Ab8RN6JPXAB0QZmQx2jux1DIQwLffb1HVUP7DmNICvvOMx20EA"; 

// Global state variables (Declared only once)
let actionHistory = [];
let userObjective = "";
let agentMemory = ""; // Persistent working memory for the agent to store notes, prices, or findings
let agentShouldStop = false;
// Helper to send logs to the sidebar UI
function logToPanel(text) {
  console.log(text); // Print to service worker debugger console
  chrome.runtime.sendMessage({ action: "agent_log", text: text }).catch(() => {
    // Gracefully ignore if the side panel is closed
  });
}

// Helper to alert popup the entire loop has completed
function notifyFinish() {
  chrome.runtime.sendMessage({ action: "agent_finished" }).catch(() => {});
}

// 1. Message listener to kick off the loop
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "start_agent_with_objective") {
    userObjective = message.objective; 
    actionHistory = []; 
    agentMemory = ""; // Reset memory for the new run
    agentShouldStop = false; // Reset the stop flag for the new run
    agentShouldStop = false; // Reset the stop flag for the new run
    
    // Find the active tab and start the async loop safely
    // Find the active tab and start the async loop safely
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab) {
        runAgentLoop(activeTab.id);
      } else {
        logToPanel("❌ Error: Could not find an active tab to start on.");
        notifyFinish();
      }
    });
  }

  if (message.action === "stop_agent") {
    agentShouldStop = true;
    logToPanel("🛑 Stop requested! Terminating loop...");
  }
});

// 2. Self-healing agent loop (Marked as async)
async function runAgentLoop(initialTabId) {
  let steps = 0;
  const maxSteps = 25; // BUMPED up to 15 steps so it doesn't cut off early!
  let targetTabId = initialTabId;
  
  // Track state to prevent silent click loops
  let lastScreenshotDataUrl = null;
  let executionFailedCount = 0;

  while (steps < maxSteps) {
    
    // Put this check first
    if (agentShouldStop) {
      logToPanel("🛑 Loop terminated by user.");
      break;
    }
    logToPanel(`Step ${steps + 1} of ${maxSteps}: Analyzing state...`);

    // DYNAMIC TRACKING: Check if active tab changed
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.id !== targetTabId) {
      logToPanel(`🔄 Connected to active tab change: ${activeTab.id}`);
      targetTabId = activeTab.id;
    }

    // Wait until the tab is loaded
    await waitTillTabIsLoaded(targetTabId);

    // Proactively re-inject content script
    try {
      await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        files: ["content.js"]
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (err) {
      // Ignore frame errors
    }

    // Take screenshot using window profile helper
    const screenshotData = await captureTab(targetTabId);
    if (!screenshotData || !screenshotData.success) {
      logToPanel("⚠️ Failed capturing browser window. Retrying step...");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue; 
    }

    // STATE VALIDATION: Check if the last action actually changed the page visually
    if (lastScreenshotDataUrl && lastScreenshotDataUrl === screenshotData.dataUrl) {
      executionFailedCount++;
      logToPanel(`⚠️ State Change Warning: The page layout did not change after the last action. (Count: ${executionFailedCount})`);
    } else {
      executionFailedCount = 0; // Reset counter if state successfully changed
    }

    lastScreenshotDataUrl = screenshotData.dataUrl; // Cache screenshot state

    logToPanel("🤖 Screenshot captured. Processing with Gemini...");
    const action = await getModelDecision(screenshotData.dataUrl, executionFailedCount > 0);
    if (!action) {
      logToPanel("❌ API returned empty decision. Stopping loop.");
      break;
    }

    // Save whatever notes or data Gemini wants to remember for the next step
    if (action.memory) {
      agentMemory = action.memory;
      logToPanel(`🧠 Memory Scratchpad Updated: "${agentMemory}"`);
    }

    // Define the execution block so we can easily retry it if no visual change occurs
    // Define how to execute a single sub-action from the array
    const executeSubAction = async (subAction) => {
      if (subAction.type === "click") {
        const [tabInfo] = await chrome.tabs.query({ active: true, currentWindow: true });
        const cssWidth = tabInfo ? tabInfo.width : 1920;
        const cssHeight = tabInfo ? tabInfo.height : 1080;

        const cssX = Math.round((subAction.x / 1000) * cssWidth);
        const cssY = Math.round((subAction.y / 1000) * cssHeight);

        logToPanel(`◤ Action: Scaled click (${subAction.x}, ${subAction.y}) to CSS (${cssX}, ${cssY})`);
        await chrome.tabs.sendMessage(targetTabId, { action: "execute_click", x: cssX, y: cssY });
      } 
      else if (subAction.type === "type") {
        logToPanel(`⌨️ Action: Typing text: "${subAction.text}"`);
        await chrome.tabs.sendMessage(targetTabId, { action: "execute_type", text: subAction.text }); 
      }
      else if (subAction.type === "enter") {
        logToPanel(`⏎ Action: Simulating Enter key`);
        await chrome.tabs.sendMessage(targetTabId, { action: "press_enter" });
      } 
      else if (subAction.type === "scroll") {
        logToPanel(`📜 Action: Scrolling page ${subAction.direction}`);
        await chrome.tabs.sendMessage(targetTabId, { action: "execute_scroll", direction: subAction.direction });
      }
      else if (subAction.type === "url") {
        logToPanel(`🌐 Action: Navigating to: "${subAction.url}"`);
        let targetUrl = subAction.url;
        if (!/^https?:\/\//i.test(targetUrl)) {
          targetUrl = `https://${targetUrl}`;
        }
        await chrome.tabs.update(targetTabId, { url: targetUrl });
      }
    };

    // PROCESS ACTIONS SEQUENTIALLY
    const retryableTypes = ["click", "type", "enter", "scroll"];
    let stopRequested = false;

    if (action.actions && Array.isArray(action.actions)) {
      for (let i = 0; i < action.actions.length; i++) {
        const subAction = action.actions[i];
        let actionSuccess = false;

        if (retryableTypes.includes(subAction.type)) {
          const maxRetries = 3;
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            logToPanel(`⚡ Executing [${i + 1}/${action.actions.length}] ${subAction.type} (Attempt ${attempt}/${maxRetries})...`);
            
            try {
              await executeSubAction(subAction);
            } catch (err) {
              logToPanel(`⚠️ Execution attempt failed: ${err.message}`);
            }

            // Wait a moment for layout to process
            await new Promise((resolve) => setTimeout(resolve, 1200));

            // Verify visual change
            const checkScreenshot = await captureTab(targetTabId);
            if (checkScreenshot && checkScreenshot.success && checkScreenshot.dataUrl !== lastScreenshotDataUrl) {
              logToPanel(`✅ Visual change detected on attempt ${attempt}!`);
              actionSuccess = true;
              lastScreenshotDataUrl = checkScreenshot.dataUrl; // Update cached state for the next sub-action

              // Record history
              actionHistory.push(`Step ${steps + 1}.${i + 1}: Successfully executed ${subAction.type}`);
              break;
            } else {
              logToPanel(`❓ No visual change registered yet.`);
            }
          }

          if (!actionSuccess) {
            logToPanel(`❌ Sub-action ${subAction.type} failed visual change check. Proceeding to let Gemini re-evaluate.`);
            actionHistory.push(`Step ${steps + 1}.${i + 1}: Attempted ${subAction.type} but it had no visual effect.`);
            break; // Stop running further chained actions in this step if a blocker occurs
          }
        } else {
          // Non-retryable actions (URL, STOP)
          try {
            await executeSubAction(subAction);
            if (subAction.type === "url") {
              actionHistory.push(`Step ${steps + 1}.${i + 1}: Navigated to URL "${subAction.url}"`);
            }
            if (subAction.type === "stop") {
              stopRequested = true;
            }
          } catch (err) {
            logToPanel(`⚠️ Execution error: ${err.message}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }

        if (stopRequested) break;
      }
    }

    if (stopRequested) {
      logToPanel("🛑 Action: Complete! Objective satisfied.");
      break;
    }

    steps++;
  }

    

  // Generate the one-sentence English summary
  logToPanel("✨ Summarizing progress...");
  const achievementSummary = await getAchievementSummary(userObjective, actionHistory);
  
  // Send the achievement cleanly outside the logs dropdown
  chrome.runtime.sendMessage({ 
    action: "agent_achievement", 
    text: achievementSummary 
  }).catch(() => {});

  notifyFinish();
}



// Fixed window tracking screenshot handlers
function captureVisibleTabDirectly(windowId) {
  return new Promise((resolve) => {
    chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 60 }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve({ success: true, dataUrl: dataUrl });
      }
    });
  });
}

async function captureTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, async (tab) => {
      if (!tab) {
        resolve({ success: false, error: "Tab not found" });
        return;
      }
      const result = await captureVisibleTabDirectly(tab.windowId);
      resolve(result);
    });
  });
}

async function getModelDecision(dataUrl, didLastActionFail = false) {
  const base64Image = dataUrl.split(",")[1];

  

  const failureContext = didLastActionFail 
    ? "\n⚠️ CRITICAL WARNING: Your last action resulted in NO visual change on the screen. The click or action might have missed. Try targeting a different element, checking coordinates, or trying an alternate path.\n"
    : "";

  const systemInstruction = `
    You are an autonomous web browser agent. 
    
    YOUR CURRENT TASK IS: "${userObjective}"
    ${failureContext}
    CRITICAL COORDINATE SYSTEM:
    The screenshot provided must be analyzed as if it has a resolution of exactly 1000 width by 1000 height pixels (normalized coordinate system).
    Regardless of the actual screen dimensions, treat the top-left corner as (0, 0) and the bottom-right corner as (1000, 1000).
    When choosing coordinates to click, return integer values between 0 and 1000 based on this 1000x1000 grid.
    🧠 MY WORKING MEMORY SCRATCHPAD:
    "${agentMemory || "Empty. Write down important details here (like prices, names, or notes) that I want to remember in future steps."}"

    Here is a list of actions I have already executed in this session:
    [HISTORY BEGINS]
    ${actionHistory.length > 0 ? actionHistory.join("\n") : "No actions executed yet."}
    [HISTORY ENDS]
    If the prompt contains the word "@deep reasearch", I will run multiple search queries on the topic requested, and compare results and give a summary with the details of the topic to the user.
    Determine my next single step to take to accomplish MY CURRENT TASK, and return a clean JSON object. 
    I MUST include a "memory" field in my JSON containing my updated scratchpad notes (like running notes, item names, or prices I noticed in this step). 
    If there is nothing new to store, preserve my existing notes inside the "memory" field!
    My JSON output structure MUST follow this exact schema, containing an array of "actions" to execute sequentially in this single step:
    {
      "actions": [
        {
          "type": "url" | "click" | "type" | "enter" | "scroll" | "stop",
          "x": integer (0 to 1000, only for "click"),
          "y": integer (0 to 1000, only for "click"),
          "text": "text" (only for "type"),
          "url": "url" (only for "url"),
          "direction": "down" or "up" (only for "scroll")
        }
      ],
      "memory": "updated text containing prices, findings, or tasks to carry over to the next step"
    }
    

    CRITICAL Rules:
    - If you are on a page that REQUIRES authentication, and you have completed all the tasks, stop the loop. if you have not complted all the tasks and are on a page that requires authentication, you should complete all the avalible tasks and then naviagate to the authentication page and stop the loop.
    - My click coordinates "x" and "y" MUST be integers between 0 and 1000.
    - Return ONLY valid JSON. No markdown formatting.
    - If I type into a search input or any text box where submitting is required (like Google, Amazon, or Best Buy search bars), I MUST follow my "type" action with a {"type": "enter"} action on the very next step to submit the search. Do not attempt to click the search button unless pressing enter fails.
    - ONLY issue {"type": "stop"} if the current screenshot visibly confirms that the goal has been fully met. If I am comparing, I must not stop until I have gathered all necessary information and am ready to conclude.   
  `;

  const payload = {
    contents: [
      {
        parts: [
          { text: systemInstruction },
          { text: "Analyze the page screenshot and decide on the next step." },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image
            }
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  try {
    // Keep using the correct 3.1 model!
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent`;
    const response = await fetch(url, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    
    if (!response.ok) {
      // THIS WILL TELL US THE EXACT ERROR (e.g. API key invalid, quota reached, payload size, etc.)
      const errorDetail = data.error ? `${data.error.status}: ${data.error.message}` : "Unknown error";
      logToPanel(`❌ Google API Rejected Request: ${errorDetail}`);
      throw new Error(errorDetail);
    }

    const resultText = data.candidates[0].content.parts[0].text.trim();
    return JSON.parse(resultText);

  } catch (err) {
    logToPanel(`❌ Gemini Processing Error: ${err.message}`);
    return null;
  }
}

// Loading state check with safety fallback timeout
function waitTillTabIsLoaded(tabId) {
  return new Promise((resolve) => {
    let completed = false;

    const safetyTimeout = setTimeout(() => {
      if (!completed) {
        completed = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }, 3000);

    const listener = (changeTabId, changeInfo) => {
      if (changeTabId === tabId && changeInfo.status === "complete") {
        if (!completed) {
          completed = true;
          clearTimeout(safetyTimeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }
    };

    chrome.tabs.get(tabId, (tab) => {
      if (!tab || tab.status === "complete") {
        completed = true;
        clearTimeout(safetyTimeout);
        resolve();
      } else {
        chrome.tabs.onUpdated.addListener(listener);
      }
    });
  });
}
// Generates a clean, one-sentence summary of the agent's achievements
async function getAchievementSummary(objective, history) {
  if (history.length === 0) {
    return "The agent was started but did not execute any actions.";
  }

  const promptText = `
    You are summarizing your own actions as an autonomous web browser agent.
    
    My original objective was: "${objective}"
    
    Here is my final working memory notes (where I stored collected prices and findings):
    "${agentMemory || "No notes stored."}"

    Here is the history of actions I executed:
    ${history.join("\n")}
    Output the contents of memory notes in English exactly as described in the memory notes.
    Based on the history and my stored notes above, write exactly one concise, clear sentence in English describing what I successfully achieved. Use the first-person perspective ("I achieved...", "I found...", "I compared...").
    Do not include any introductory text, markdown, quotes, or JSON formatting. Just output the single plain-text sentence.
  `;

  const payload = {
    contents: [{ parts: [{ text: promptText }] }]
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent`;
    const response = await fetch(url, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) return "The agent finished running its sequence.";

    return data.candidates[0].content.parts[0].text.trim();
  } catch (err) {
    console.error("Summary generation failed:", err);
    return "The agent completed its scheduled navigation run.";
  }
}

// Open the side panel when the user clicks the extension toolbar icon
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("Error setting panel behavior:", error));