const chatContainer = document.getElementById("chatContainer");
const objectiveInput = document.getElementById("objectiveInput");
const startButton = document.getElementById("startButton");
const micButton = document.getElementById("micButton");

// Helper to append messages to our visual chat window
function addMessage(text, sender = "system") {
  const msgDiv = document.createElement("div");
  msgDiv.classList.add("message", sender);
  msgDiv.textContent = text;
  chatContainer.appendChild(msgDiv);
  
  // Smoothly scroll down as messages arrive
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Keep track of the step count locally
let currentStep = 0;
const maxSteps = 15;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "agent_log") {
    const logText = message.text;

    // 1. Update the Header Status inside the dropdown
    const stepMatch = logText.match(/Step (\d+) of (\d+)/);
    const statusText = document.getElementById("logs-status-text");
    const indicator = document.querySelector(".status-indicator");

    if (stepMatch) {
      currentStep = parseInt(stepMatch[1]);
      if (statusText) statusText.innerText = `Working, ${currentStep}/${maxSteps}`;
      if (indicator) {
        indicator.classList.add("active");
        indicator.classList.remove("finished");
      }
    } else if (logText.includes("🤖 Screenshot captured")) {
      if (statusText) statusText.innerText = `Analyzing screenshot (Step ${currentStep})...`;
    }

    // 2. Insert the raw logs STRICTLY inside the dropdown content container
    const logPanel = document.getElementById("log-panel");
    if (logPanel) {
      const logLine = document.createElement("div");
      logLine.style.borderBottom = "1px solid rgba(255,255,255,0.03)";
      logLine.style.paddingBottom = "4px";
      logLine.innerText = logText;
      
      logPanel.appendChild(logLine);
      logPanel.scrollTop = logPanel.scrollHeight; // Auto-scroll inside the details box
    }
  }

  // Handle when the agent finishes
  if (message.action === "agent_finished") {
    const statusText = document.getElementById("logs-status-text");
    const indicator = document.querySelector(".status-indicator");
    
    if (statusText) statusText.innerText = `Completed successfully!`;
    if (indicator) {
      indicator.classList.remove("active");
      indicator.classList.add("finished");
    }
    startButton.disabled = false;
    objectiveInput.disabled = false;
  }
  if (message.action === "agent_achievement") {
    const chatContainer = document.getElementById("chatContainer");
    if (chatContainer) {
      // Create a clean agent chat bubble
      const bubble = document.createElement("div");
      bubble.className = "message agent";
      bubble.innerText = message.text;
      
      chatContainer.appendChild(bubble);
      chatContainer.scrollTop = chatContainer.scrollHeight; // Scroll main chat to bottom
    }
  }
});

// Send the objective to the agent on click
startButton.addEventListener("click", () => {
  const objective = objectiveInput.value.trim();
  if (!objective) return;

  // Render user bubble
  addMessage(objective, "user");
  objectiveInput.value = "";
  
  // Disable controls while running
  startButton.disabled = true;
  objectiveInput.disabled = true;
  
  addMessage("⚡ Initializing agent loop...", "system");

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
    micButton.textContent = "🛑";
    micButton.style.backgroundColor = "#ef4444";
    objectiveInput.placeholder = "Listening...";
  };

  recognition.onend = () => {
    isListening = false;
    micButton.textContent = "🎙️";
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
document.getElementById("stop-btn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "stop_agent" });
});