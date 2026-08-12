const chatContainer = document.getElementById("chatContainer");
const objectiveInput = document.getElementById("objectiveInput");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stop-btn");
const micButton = document.getElementById("micButton");
const authButton = document.getElementById("authButton");
const userName = document.getElementById("userName");
const userAvatar = document.getElementById("userAvatar");
const agentStateContainer = document.getElementById("agent-state-container");
const idleStateContainer = document.getElementById("idle-state-container");

let currentUser = null;

// Load existing User Session & Chat History on Panel Launch
chrome.storage.local.get(["googleUser", "chatHistory"], (data) => {
  if (data.googleUser) {
    updateUserUI(data.googleUser);
  }
  if (data.chatHistory && Array.isArray(data.chatHistory)) {
    data.chatHistory.forEach(item => {
      addMessage(item.text, item.sender); 
    });
  }
});


// Google Sign-In / Sign-Out Handler
authButton.addEventListener("click", () => {
  if (currentUser) {
    // Sign Out
    chrome.identity.clearAllCachedAuthTokens(() => {
      currentUser = null;
      chrome.storage.local.remove("googleUser");
      updateUserUI(null);
    });
  } else {
    // Sign In via Chrome Identity API
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        console.error("Authentication Error:", chrome.runtime.lastError?.message || "No token received and no specific error message.");
        return;
      }

      // Fetch Profile Data using token
      fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${token}` }
      })
      .then(res => res.json())
      .then(profile => {
        currentUser = profile;
        chrome.storage.local.set({ googleUser: profile });
        updateUserUI(profile);
      })
      .catch(err => console.error("Profile Fetch Error:", err));
    });
  }
});

function updateUserUI(user) {
  currentUser = user;
  if (user) {
    userName.textContent = user.name || user.email;
    if (user.picture) {
      userAvatar.src = user.picture;
      userAvatar.style.display = "block";
    }
    authButton.textContent = "Sign Out";
    authButton.style.backgroundColor = "#ef4444";
  } else {
    userName.textContent = "Not signed in";
    userAvatar.style.display = "none";
    authButton.textContent = "Sign In";
    authButton.style.backgroundColor = "#4f74d9";
  }
}

// Helper to append messages to our visual chat window
function addMessage(text, sender = "system") {
  const senderName = {
    user: "You",
    agent: "Agent",
    system: "System"
  }[sender];

  const msgDiv = document.createElement("div");
  msgDiv.classList.add("message-bubble", `sender-${sender}`);
  
  const senderTag = document.createElement("div");
  senderTag.classList.add("sender-tag");
  senderTag.textContent = senderName;

  msgDiv.innerHTML = `<div class="sender-tag">${senderName}</div><div class="message-text">${text}</div>`;
  chatContainer.appendChild(msgDiv);

  // Smoothly scroll down as messages arrive
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Keep track of the step count locally
let currentStep = 0;
const maxSteps = 15;

function setAgentState(isRunning) {
  if (isRunning) {
    agentStateContainer.style.display = 'block';
    idleStateContainer.style.display = 'none';
    stopButton.style.display = 'inline-block';
  } else {
    agentStateContainer.style.display = 'none';
    idleStateContainer.style.display = 'flex';
    stopButton.style.display = 'none';
    startButton.disabled = false;
    objectiveInput.disabled = false;
  }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "agent_log") {
    const logText = message.text;

    // 1. Update the Header Status inside the dropdown
    const stepMatch = logText.match(/Step (\d+) of (\d+)/);
    const statusText = document.getElementById("logs-status-text");
    const agentStatusText = document.getElementById("agent-status-text");
    const indicator = document.querySelector(".status-indicator");

    if (stepMatch) {
      currentStep = parseInt(stepMatch[1]);
      if (statusText) statusText.innerText = `Working, ${currentStep}/${maxSteps}`;
      if (indicator) {
        indicator.classList.add("active");
        indicator.classList.remove("finished");
      }
      if (agentStatusText) agentStatusText.innerText = `Working... (Step ${currentStep}/${maxSteps})`;
    } else if (logText.includes("🤖 Screenshot captured")) {
      if (statusText) statusText.innerText = `Analyzing screenshot (Step ${currentStep})...`;
      if (agentStatusText) agentStatusText.innerText = `Analyzing... (Step ${currentStep})`;
    }

    // 2. Insert the raw logs STRICTLY inside the dropdown content container
    const logPanel = document.getElementById("log-panel");
    if (logPanel) {
      let icon = '➡️';
      if (logText.toLowerCase().includes('click')) icon = '🖱️';
      if (logText.toLowerCase().includes('type')) icon = '⌨️';
      if (logText.toLowerCase().includes('scroll')) icon = '↕️';
      if (logText.toLowerCase().includes('navigating')) icon = '🌐';
      if (logText.toLowerCase().includes('analyzing')) icon = '🧠';
      if (logText.toLowerCase().includes('error') || logText.toLowerCase().includes('failed')) icon = '❌';
      if (logText.toLowerCase().includes('stop')) icon = '🛑';

      const logLine = document.createElement("div");
      logLine.className = "log-line";
      logLine.style.borderBottom = "1px solid rgba(255,255,255,0.03)";
      logLine.innerHTML = `<span style="margin-right: 8px;">${icon}</span> ${logText}`;
      
      logPanel.appendChild(logLine);
      logPanel.scrollTop = logPanel.scrollHeight; // Auto-scroll inside the details box
    }
  }

  // Handle when the agent finishes
  if (message.action === "agent_finished") {
    const statusText = document.getElementById("logs-status-text");
    const agentStatusText = document.getElementById("agent-status-text");
    const indicator = document.querySelector(".status-indicator");
    
    if (statusText) statusText.innerText = `Completed successfully!`;
    if (agentStatusText) agentStatusText.innerText = `Finished!`;
    if (indicator) {
      indicator.classList.remove("active");
      indicator.classList.add("finished");
    }
    setAgentState(false);
  }
  if (message.action === "agent_achievement") {
    addMessage(message.text, "agent");
    saveMessageToHistory("agent", message.text);
  }
});

// Send the objective to the agent on click
startButton.addEventListener("click", () => {
  const objective = objectiveInput.value.trim();
  if (!objective) return;

  // Verify user is signed in (optional but good practice)
  // chrome.identity.getAuthToken({ interactive: false }, (token) => { ... });

  setAgentState(true); // Switch to "running" view

  // Render & save user message
  addMessage(objective, "user");
  saveMessageToHistory("user", objective);

  objectiveInput.value = "";
  objectiveInput.style.height = "40px"; // Reset height
  
  saveMessageToHistory("system", "⚡ Initializing agent loop...");

  // Broadcast to background.js to kick off the loop
  chrome.runtime.sendMessage({
    action: "start_agent_with_objective",
    objective: objective
  });
});

// Auto-resize textarea height based on content
objectiveInput.addEventListener("input", function() {
  this.style.height = "auto";
  this.style.height = this.scrollHeight + "px";
});

// Support CMD/Ctrl + Enter to send and reset height
// Speech Recognition Engine
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  let isListening = false;

  micButton.addEventListener("click", () => {
    if (!isListening) {
      recognition.start();
    } else {
      recognition.stop();
    }
  });

  recognition.onstart = () => {
    isListening = true;
    micButton.textContent = "■"; // Stop square
    micButton.style.backgroundColor = "#ef4444";
    objectiveInput.placeholder = "Listening...";
  };

  recognition.onend = () => {
    isListening = false;
    micButton.textContent = "🎙️"; // This one is generally well-supported, but could be "Mic"
    micButton.style.backgroundColor = "#161618";
    objectiveInput.placeholder = "Ask the agent to do something...";
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    objectiveInput.value = objectiveInput.value ? objectiveInput.value + " " + transcript : transcript;
    
    // Automatically trigger the height recalculation for the new voice text
    objectiveInput.dispatchEvent(new Event("input"));
  };

  recognition.onerror = (event) => {
    console.error("Speech recognition error:", event.error);
    if (event.error === "not-allowed") {
      chrome.tabs.create({
        url: chrome.runtime.getURL("popup.html?requestMic=true")
      });
    }
  };

// Check if this page was opened as the temporary permission tab
if (window.location.search.includes("requestMic=true")) {
  // Overwrite the body instantly to show a clean permission prompt screen
  document.body.innerHTML = `
    <div style="background:#121214; color:#e4e4e7; font-family:sans-serif; text-align:center; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; margin:0;">
      <h2>Microphone Access Required</h2>
      <p>Please click 'Allow' when prompted to enable voice input for your agent.</p>
    </div>
  `;
  
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then((stream) => {
      // Stop the tracks immediately since we just needed the permission grant
      stream.getTracks().forEach(track => track.stop());
      window.close();
    })
    .catch((err) => {
      console.error("Permission page error:", err);
    });
}
} else {
  micButton.style.display = "none"; // Fallback safety if API isn't supported
}

stopButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "stop_agent" });
  setAgentState(false);
});
// Function to save chat messages to chrome local storage
function saveMessageToHistory(sender, text) {
  chrome.storage.local.get(["chatHistory"], (data) => {
    const history = data.chatHistory || [];
    history.push({
      sender: sender,
      text: text,
      userEmail: currentUser ? currentUser.email : "anonymous",
      timestamp: new Date().toISOString()
    });
    chrome.storage.local.set({ chatHistory: history });
  });
}