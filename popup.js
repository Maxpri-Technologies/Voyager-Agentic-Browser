const chatContainer = document.getElementById("chatContainer");
const objectiveInput = document.getElementById("objectiveInput");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stop-btn");
const micButton = document.getElementById("micButton");
const emptyChatState = document.getElementById("emptyChatState");
const authButton = document.getElementById("authButton");
const userName = document.getElementById("userName");
const userAvatar = document.getElementById("userAvatar");
const agentStateContainer = document.getElementById("agent-state-container");
const idleStateContainer = document.getElementById("idle-state-container");
const chatList = document.getElementById("chatList");
const newChatButton = document.getElementById("newChatButton");
const toggleSidebarButton = document.getElementById("toggleSidebarButton");
const continueChatButton = document.getElementById("continueChatButton");
const chatTitle = document.getElementById("chatTitle");
const agentTaskBoard = document.getElementById("agentTaskBoard");
const agentTaskList = document.getElementById("agentTaskList");
const agentTaskSummary = document.getElementById("agentTaskSummary");
const driveFolderNameInput = document.getElementById("driveFolderNameInput");
const driveFileNameInput = document.getElementById("driveFileNameInput");
const driveFileContentInput = document.getElementById("driveFileContentInput");
const driveCreateFolderButton = document.getElementById("driveCreateFolderButton");
const driveCreateFileButton = document.getElementById("driveCreateFileButton");
const driveListFilesButton = document.getElementById("driveListFilesButton");
const driveStatus = document.getElementById("driveStatus");

let currentUser = null;
let googleAccessToken = null;
let chats = [];
let activeChatId = null;
let continueCurrentChat = true;

function renderAgentTaskList(tasks) {
  const taskItems = Array.isArray(tasks) ? tasks : [];
  agentTaskList.replaceChildren();
  agentTaskBoard.hidden = taskItems.length === 0;
  if (!taskItems.length) return;

  const completedCount = taskItems.filter((task) => task.status === "completed").length;
  agentTaskSummary.textContent = `${completedCount}/${taskItems.length} complete`;

  taskItems.forEach((task) => {
    const item = document.createElement("li");
    const status = ["planned", "in_progress", "completed", "blocked"].includes(task.status)
      ? task.status
      : "planned";
    item.className = `agent-task agent-task-${status}`;

    const marker = document.createElement("span");
    marker.className = "agent-task-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = status === "completed" ? "✓" : status === "blocked" ? "!" : status === "in_progress" ? "•" : "○";

    const label = document.createElement("span");
    label.textContent = task.title;
    item.append(marker, label);
    agentTaskList.appendChild(item);
  });
}

function createInitialTaskBoard(objective) {
  if (typeof getVoyagerTaskPlan === "function") return getVoyagerTaskPlan(objective);
  return [{ id: "complete", title: "Complete the requested task", status: "in_progress" }];
}

chrome.storage.local.get(["sidebarCollapsed"], (data) => {
  setSidebarCollapsed(data.sidebarCollapsed === true);
});

const CHEVRON_LEFT_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
const CHEVRON_RIGHT_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

function setSidebarCollapsed(collapsed) {
  document.querySelector(".app-shell").classList.toggle("sidebar-collapsed", collapsed);
  toggleSidebarButton.innerHTML = collapsed ? CHEVRON_RIGHT_SVG : CHEVRON_LEFT_SVG;
  toggleSidebarButton.title = collapsed ? "Expand chats" : "Collapse chats";
  toggleSidebarButton.setAttribute("aria-label", toggleSidebarButton.title);
}

const GOOGLE_AUTH_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/generative-language.retriever",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/drive.file"
];

function requestFreshGoogleAccessToken() {
  return new Promise((resolve) => {
    chrome.identity.clearAllCachedAuthTokens(() => {
      chrome.identity.getAuthToken({ interactive: true, scopes: GOOGLE_AUTH_SCOPES }, (token) => {
        const authError = chrome.runtime.lastError;
        if (authError || !token) {
          console.error("Authentication Error: Sign in again before running the agent.", authError);
          resolve(null);
        } else {
          resolve(token);
        }
      });
    });
  });
}

function createChat(title = "New conversation", messages = []) {
  return {
    id: crypto.randomUUID(),
    title,
    messages,
    updatedAt: new Date().toISOString()
  };
}

function activeChat() {
  return chats.find(chat => chat.id === activeChatId);
}

function persistChats() {
  chrome.storage.local.set({ chats, activeChatId });
}

function renderChatList() {
  chatList.innerHTML = "";
  chats
    .slice()
    .sort((first, second) => new Date(second.updatedAt) - new Date(first.updatedAt))
    .forEach(chat => {
      const item = document.createElement("div");
      item.className = "chat-list-item-wrap";

      const button = document.createElement("button");
      button.className = `chat-list-item${chat.id === activeChatId ? " active" : ""}`;
      button.type = "button";
      button.title = chat.title;
      button.innerHTML = `<strong>${chat.title}</strong><span>${chat.messages.length} message${chat.messages.length === 1 ? "" : "s"}</span>`;
      button.addEventListener("click", () => switchChat(chat.id));

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "chat-delete-button";
      deleteButton.title = `Delete chat: ${chat.title}`;
      deleteButton.setAttribute("aria-label", `Delete chat: ${chat.title}`);
      deleteButton.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 6h18"/>
          <path d="M8 6V4h8v2"/>
          <path d="M19 6l-1 14H6L5 6"/>
          <path d="M10 11v6"/>
          <path d="M14 11v6"/>
        </svg>
      `;
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteChat(chat.id);
      });

      item.appendChild(button);
      item.appendChild(deleteButton);
      chatList.appendChild(item);
    });
}

function renderMessage(text, sender = "system") {
  const senderNames = { user: "You", agent: "Agent", system: "System" };
  const msgDiv = document.createElement("div");
  msgDiv.classList.add("message-bubble", `sender-${sender}`);

  const senderTag = document.createElement("div");
  senderTag.className = "sender-tag";
  senderTag.textContent = senderNames[sender] || "System";
  const messageText = document.createElement("div");
  messageText.className = "message-text";
  messageText.textContent = text;
  msgDiv.append(senderTag, messageText);
  chatContainer.appendChild(msgDiv);
}

function renderActiveChat() {
  const chat = activeChat();
  chatContainer.innerHTML = "";
  chatTitle.textContent = chat ? chat.title : "New conversation";
  emptyChatState.hidden = Boolean(chat && chat.messages.length > 0);
  chatContainer.appendChild(emptyChatState);
  if (chat && chat.messages.length > 0) {
    chat.messages.forEach(message => renderMessage(message.text, message.sender));
  }
  chatContainer.scrollTop = chatContainer.scrollHeight;
  renderChatList();
}

function switchChat(chatId) {
  if (!chats.some(chat => chat.id === chatId)) return;
  activeChatId = chatId;
  continueCurrentChat = true;
  persistChats();
  renderActiveChat();
  objectiveInput.focus();
}

function deleteChat(chatId) {
  const index = chats.findIndex(chat => chat.id === chatId);
  if (index === -1) return;

  chats.splice(index, 1);
  if (activeChatId === chatId) {
    activeChatId = chats[0]?.id || null;
  }
  if (!activeChatId && chats.length === 0) {
    const newChat = createChat();
    chats.push(newChat);
    activeChatId = newChat.id;
  }

  persistChats();
  renderActiveChat();
  objectiveInput.focus();
}

function startNewChat() {
  const chat = createChat();
  chats.push(chat);
  activeChatId = chat.id;
  continueCurrentChat = true;
  persistChats();
  renderActiveChat();
  objectiveInput.focus();
}

// Load existing user session and migrate the previous flat history into one chat.
chrome.storage.local.get(["googleUser", "chatHistory", "chats", "activeChatId", "agentTaskList"], (data) => {
  if (data.googleUser) {
    updateUserUI(data.googleUser);
  }
  if (Array.isArray(data.chats) && data.chats.length) {
    chats = data.chats;
    activeChatId = data.activeChatId || chats[0].id;
  } else {
    const legacyMessages = Array.isArray(data.chatHistory) ? data.chatHistory : [];
    const migratedChat = createChat(legacyMessages[0]?.text?.slice(0, 42) || "New conversation", legacyMessages);
    chats = [migratedChat];
    activeChatId = migratedChat.id;
    persistChats();
  }
  renderActiveChat();
  renderAgentTaskList(data.agentTaskList);
  chrome.runtime.sendMessage({ action: "get_agent_task_list" }, (response) => {
    if (!chrome.runtime.lastError) renderAgentTaskList(response?.tasks);
  });
});

// Receive every task change, including updates made while this panel was not
// the active runtime-message receiver.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.agentTaskList) {
    renderAgentTaskList(changes.agentTaskList.newValue);
  }
});

newChatButton.addEventListener("click", startNewChat);
toggleSidebarButton.addEventListener("click", () => {
  const collapsed = !document.querySelector(".app-shell").classList.contains("sidebar-collapsed");
  setSidebarCollapsed(collapsed);
  chrome.storage.local.set({ sidebarCollapsed: collapsed });
});
continueChatButton.addEventListener("click", () => {
  continueCurrentChat = true;
  objectiveInput.focus();
});


// Google Sign-In / Sign-Out Handler
authButton.addEventListener("click", () => {
  if (currentUser) {
    // Sign Out
    chrome.identity.clearAllCachedAuthTokens(() => {
      currentUser = null;
      googleAccessToken = null;
      chrome.storage.local.remove("googleUser");
      updateUserUI(null);
    });
  } else {
    // Sign In via Chrome Identity API
    requestFreshGoogleAccessToken().then((token) => {
      const authError = chrome.runtime.lastError;
      if (authError || !token) {
        const errorMessage = authError?.message || "No token received and no specific error message.";
        if (errorMessage.includes("bad client id")) {
          console.error(
            "Authentication Error: The OAuth client ID is not registered for this extension. " +
            "Create a Chrome App OAuth client for extension ID " + chrome.runtime.id +
            " and update oauth2.client_id in manifest.json.",
            authError
          );
        } else {
          console.error("Authentication Error:", errorMessage);
        }
        return;
      }

      googleAccessToken = token;

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

function setDriveStatus(message) {
  if (driveStatus) {
    driveStatus.textContent = message;
  }
}

async function ensureDriveAccess() {
  if (googleAccessToken) return googleAccessToken;
  googleAccessToken = await requestFreshGoogleAccessToken();
  return googleAccessToken;
}

async function listDriveFiles() {
  const token = await ensureDriveAccess();
  if (!token) {
    setDriveStatus("Please sign in to Google Drive first.");
    return;
  }

  setDriveStatus("Loading your Drive files...");
  chrome.runtime.sendMessage({ action: "list_drive_files" }, (response) => {
    if (chrome.runtime.lastError) {
      setDriveStatus(`Drive listing failed: ${chrome.runtime.lastError.message}`);
      return;
    }

    if (!response || !response.ok) {
      setDriveStatus(`Drive listing failed: ${response?.error || "Unknown error"}`);
      return;
    }

    const files = Array.isArray(response.files) ? response.files : [];
    if (!files.length) {
      setDriveStatus("No files were found in the connected Google Drive.");
      return;
    }

    const summary = files
      .slice(0, 20)
      .map((file) => `${file.name} (${file.mimeType || "unknown type"})`)
      .join("\n");

    setDriveStatus(summary + (files.length > 20 ? `\n...and ${files.length - 20} more` : ""));
  });
}

async function createDriveFolder() {
  const token = await ensureDriveAccess();
  if (!token) {
    setDriveStatus("Please sign in to Google Drive first.");
    return;
  }

  const folderName = (driveFolderNameInput.value || "").trim();
  if (!folderName) {
    setDriveStatus("Enter a folder name before creating a Drive folder.");
    return;
  }

  setDriveStatus(`Creating folder "${folderName}"...`);
  chrome.runtime.sendMessage({ action: "create_drive_folder", folderName }, (response) => {
    if (chrome.runtime.lastError) {
      setDriveStatus(`Folder creation failed: ${chrome.runtime.lastError.message}`);
      return;
    }

    if (!response || !response.ok) {
      setDriveStatus(`Folder creation failed: ${response?.error || "Unknown error"}`);
      return;
    }

    setDriveStatus(`Created folder: ${response.folder?.name || folderName}`);
    driveFolderNameInput.value = "";
  });
}

async function createDriveDoc() {
  const token = await ensureDriveAccess();
  if (!token) {
    setDriveStatus("Please sign in to Google Drive first.");
    return;
  }

  const fileName = (driveFileNameInput.value || "").trim();
  const content = (driveFileContentInput.value || "").trim();
  if (!fileName) {
    setDriveStatus("Enter a document name before creating a Drive file.");
    return;
  }

  setDriveStatus(`Creating Drive document "${fileName}"...`);
  chrome.runtime.sendMessage({
    action: "create_drive_file",
    name: fileName,
    mimeType: "application/vnd.google-apps.document",
    content
  }, (response) => {
    if (chrome.runtime.lastError) {
      setDriveStatus(`Document creation failed: ${chrome.runtime.lastError.message}`);
      return;
    }

    if (!response || !response.ok) {
      setDriveStatus(`Document creation failed: ${response?.error || "Unknown error"}`);
      return;
    }

    const fileNameResult = response.file?.name || fileName;
    setDriveStatus(`Created Drive document: ${fileNameResult}`);
    driveFileNameInput.value = "";
    driveFileContentInput.value = "";
  });
}

// Append a message to the active chat and persist the complete transcript.
function addMessage(text, sender = "system") {
  const chat = activeChat();
  if (!chat) return;
  const message = { sender, text, timestamp: new Date().toISOString() };
  chat.messages.push(message);
  chat.updatedAt = message.timestamp;
  if (sender === "user" && chat.title === "New conversation") {
    chat.title = text.slice(0, 42) || "New conversation";
  }
  emptyChatState.hidden = true;
  renderMessage(text, sender);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  persistChats();
  renderChatList();
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
function getLogIconSvg(logText) {
  const lower = logText.toLowerCase();
  
  // Thought / Reasoning
  if (lower.includes('thought') || lower.includes('reasoning')) {
    return `<svg class="log-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>`;
  }
  // Click
  if (lower.includes('click')) {
    return `<svg class="log-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="m13 13 6 6"/></svg>`;
  }
  // Type / Input
  if (lower.includes('type') || lower.includes('input') || lower.includes('clear')) {
    return `<svg class="log-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.001"/><path d="M10 8h.001"/><path d="M14 8h.001"/><path d="M18 8h.001"/><path d="M8 12h.001"/><path d="M12 12h.001"/><path d="M16 12h.001"/><path d="M7 16h10"/></svg>`;
  }
  // Key press
  if (lower.includes('key')) {
    return `<svg class="log-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/></svg>`;
  }
  // Hover
  if (lower.includes('hover')) {
    return `<svg class="log-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>`;
  }
  // Select
  if (lower.includes('select')) {
    return `<svg class="log-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
  }
  // Scroll
  if (lower.includes('scroll')) {
    return `<svg class="log-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 18 12 22 16 18"/><polyline points="8 6 12 2 16 6"/><line x1="12" y1="2" x2="12" y2="22"/></svg>`;
  }
  // Navigation / URL
  if (lower.includes('navigating') || lower.includes('url') || lower.includes('navigate')) {
    return `<svg class="log-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
  }
  // Analyzing / Screenshot / Thinking / Learning
  if (lower.includes('analyzing') || lower.includes('screenshot') || lower.includes('reflecting') || lower.includes('learned') || lower.includes('memory') || lower.includes('summarizing')) {
    return `<svg class="log-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/></svg>`;
  }
  // Error
  if (lower.includes('error') || lower.includes('failed')) {
    return `<svg class="log-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
  }
  // Warning
  if (lower.includes('warning') || lower.includes('attempt failed')) {
    return `<svg class="log-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  }
  // Stop / Finish
  if (lower.includes('stop') || lower.includes('complete') || lower.includes('finished')) {
    return `<svg class="log-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 12 15 16 10"/></svg>`;
  }
  // Default Arrow
  return `<svg class="log-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
}

function sanitizeLogText(text) {
  if (!text) return "";
  return text.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "").trim();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "agent_task_list") {
    renderAgentTaskList(message.tasks);
  }

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
    } else if (logText.includes("Screenshot captured") || logText.includes("Analyzing screenshot")) {
      if (statusText) statusText.innerText = `Analyzing screenshot (Step ${currentStep})...`;
      if (agentStatusText) agentStatusText.innerText = `Analyzing... (Step ${currentStep})`;
    }

    // 2. Insert the raw logs STRICTLY inside the dropdown content container
    const logPanel = document.getElementById("log-panel");
    if (logPanel) {
      const iconSvg = getLogIconSvg(logText);
      const cleanText = sanitizeLogText(logText);

      const logLine = document.createElement("div");
      logLine.className = "log-line";
      logLine.style.borderBottom = "1px solid rgba(255,255,255,0.03)";
      logLine.innerHTML = `${iconSvg} <span>${cleanText}</span>`;
      
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
  }
});

// Send the objective to the agent on click
startButton.addEventListener("click", async () => {
  const objective = objectiveInput.value.trim();
  if (!objective) return;

  if (!googleAccessToken) {
    googleAccessToken = await requestFreshGoogleAccessToken();
    if (!googleAccessToken) return;
  }

  if (!continueCurrentChat && activeChat().messages.length > 0) {
    startNewChat();
  }

  // Render immediately so task progress is visible even before the service
  // worker sends its first state update.
  renderAgentTaskList(createInitialTaskBoard(objective));
  setAgentState(true); // Switch to "running" view

  // Render & save user message
  addMessage(objective, "user");

  objectiveInput.value = "";
  objectiveInput.style.height = "40px"; // Reset height
  
  addMessage("Initializing agent loop...", "system");

  // Broadcast to background.js to kick off the loop
  chrome.runtime.sendMessage({
    action: "start_agent_with_objective",
    objective: objective,
    accessToken: googleAccessToken,
    chatContext: activeChat().messages
  });
  continueCurrentChat = true;
});

document.querySelectorAll(".prompt-chip[data-prompt]").forEach((promptButton) => {
  promptButton.addEventListener("click", () => {
    objectiveInput.value = promptButton.dataset.prompt;
    objectiveInput.dispatchEvent(new Event("input"));
    objectiveInput.focus();
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

  const MIC_ICON_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" x2="12" y1="19" y2="22"/></svg>`;
  const STOP_MIC_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`;

  recognition.onstart = () => {
    isListening = true;
    micButton.innerHTML = STOP_MIC_ICON_SVG;
    micButton.classList.add("listening");
    objectiveInput.placeholder = "Listening...";
  };

  recognition.onend = () => {
    isListening = false;
    micButton.innerHTML = MIC_ICON_SVG;
    micButton.classList.remove("listening");
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

// The Drive controls are optional in this side-panel layout. Guard these
// listeners so a layout without that legacy section can still initialize.
if (driveCreateFolderButton) driveCreateFolderButton.addEventListener("click", createDriveFolder);
if (driveCreateFileButton) driveCreateFileButton.addEventListener("click", createDriveDoc);
if (driveListFilesButton) driveListFilesButton.addEventListener("click", listDriveFiles);

// ==================== USER-EDITABLE MEMORY ====================
const userMemoryStatusText = document.getElementById("user-memory-status-text");
const userMemoryPanel = document.getElementById("user-memory-panel");
const userMemoryForm = document.getElementById("userMemoryForm");
const userMemoryKey = document.getElementById("userMemoryKey");
const userMemoryValue = document.getElementById("userMemoryValue");
const clearUserMemoryBtn = document.getElementById("clearUserMemoryBtn");

function renderUserMemory(memories) {
  const items = Array.isArray(memories) ? memories : [];
  if (userMemoryStatusText) {
    userMemoryStatusText.textContent = `Memory (${items.length})`;
  }
  if (!userMemoryPanel) return;

  userMemoryPanel.replaceChildren();

  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-learned";
    empty.textContent = "Add details such as your name, preferred airline, budget, or accessibility needs.";
    userMemoryPanel.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "user-memory-card";

    const domainSpan = document.createElement("span");
    domainSpan.className = "memory-key";
    domainSpan.textContent = item.key;

    const textSpan = document.createElement("span");
    textSpan.className = "memory-value";
    textSpan.textContent = item.value;

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-memory-btn";
    deleteButton.type = "button";
    deleteButton.title = `Delete ${item.key}`;
    deleteButton.textContent = "Remove";
    deleteButton.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "delete_user_memory_item", id: item.id }, (response) => {
        if (!chrome.runtime.lastError) renderUserMemory(response?.memories || []);
      });
    });

    card.append(domainSpan, textSpan, deleteButton);
    userMemoryPanel.appendChild(card);
  });
}

chrome.runtime.sendMessage({ action: "get_user_memory" }, (response) => {
  if (!chrome.runtime.lastError) renderUserMemory(response?.memories || []);
});

if (userMemoryForm) {
  userMemoryForm.addEventListener("submit", (e) => {
    e.stopPropagation();
    e.preventDefault();
    chrome.runtime.sendMessage({ action: "add_user_memory_item", key: userMemoryKey.value, value: userMemoryValue.value }, (response) => {
      if (chrome.runtime.lastError || !response?.success) return;
      userMemoryForm.reset();
      renderUserMemory(response.memories || []);
    });
  });
}

if (clearUserMemoryBtn) {
  clearUserMemoryBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (confirm("Clear all saved user memory?")) {
      chrome.runtime.sendMessage({ action: "clear_user_memory" }, (response) => {
        if (!chrome.runtime.lastError) renderUserMemory(response?.memories || []);
      });
    }
  });
}
