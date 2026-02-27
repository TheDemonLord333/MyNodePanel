// NodePanel - Enhanced UI with original API compatibility
let token = localStorage.getItem("token") || "";

// DOM Elements
const loginDiv = document.getElementById('login');
const appDiv = document.getElementById('app');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userInput = document.getElementById('user');
const passInput = document.getElementById('pass');
const loginStatus = document.getElementById('loginStatus');
const createBtn = document.getElementById('createBtn');
const refreshBtn = document.getElementById('refreshBtn');
const newNameInput = document.getElementById('newName');
const newPortInput = document.getElementById('newPort');
const statusSpan = document.getElementById('status');
const appsContainer = document.getElementById('appsContainer');
const logsBtn = document.getElementById('logsBtn');
const logAppInput = document.getElementById('logApp');
const logsPre = document.getElementById('logs');

// Set auth UI state
function setAuthUI() {
  if (token) {
    loginDiv.classList.add('hidden');
    appDiv.classList.remove('hidden');
  } else {
    loginDiv.classList.remove('hidden');
    appDiv.classList.add('hidden');
  }
}

// API helper function
async function api(path, opts = {}) {
  const headers = opts.headers || {};
  if (token) headers["Authorization"] = "Bearer " + token;
  if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(text || res.statusText);
    err.status = res.status;
    throw err;
  }
  return res;
}

// Show status message with animation
function showStatus(element, message, type = 'info') {
  element.textContent = message;
  element.className = type === 'error' ? 'text-error' : type === 'success' ? 'text-success' : '';
  setTimeout(() => {
    element.textContent = '';
    element.className = '';
  }, 3000);
}

// Logout handler
function doLogout() {
  token = "";
  localStorage.removeItem("token");
  stopAutoRefresh();
  setAuthUI();
}

// Login handler
async function doLogin() {
  const user = userInput.value;
  const pass = passInput.value;
  
  loginStatus.textContent = '⏳ Logging in...';
  loginStatus.className = '';

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, pass })
    });
    
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();

    token = data.token;
    localStorage.setItem("token", token);

    showStatus(loginStatus, '✓ Login erfolgreich!', 'success');
    setAuthUI();
    await refresh();
  } catch (e) {
    showStatus(loginStatus, `✗ Login fehlgeschlagen: ${e.message}`, 'error');
  }
}

// Allow Enter key for login
passInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') doLogin();
});

// Create app handler
async function createApp() {
  const name = newNameInput.value.trim();
  const portVal = newPortInput.value;
  
  if (!name) {
    showStatus(statusSpan, '✗ Bitte App-Name eingeben', 'error');
    return;
  }
  
  try {
    createBtn.disabled = true;
    createBtn.innerHTML = '<span class="loading"></span> Erstelle...';
    
    const body = { name };
    if (portVal) body.port = Number(portVal);
    
    await api("/api/apps", { method: "POST", body: JSON.stringify(body) });
    showStatus(statusSpan, `✓ App "${name}" erfolgreich erstellt!`, 'success');
    newNameInput.value = '';
    newPortInput.value = '';
    await refresh();
  } catch (e) {
    showStatus(statusSpan, `✗ Fehler: ${e.message}`, 'error');
  } finally {
    createBtn.disabled = false;
    createBtn.textContent = 'App erstellen';
  }
}

// Load and display apps as cards
async function refresh() {
  const status = statusSpan;
  status.textContent = '⏳ Lade Apps...';
  
  try {
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '<span class="loading"></span> Lädt...';
    
    const res = await api("/api/apps");
    const apps = await res.json();

    // Token is valid – ensure app UI is visible
    setAuthUI();

    if (apps.length === 0) {
      appsContainer.innerHTML = `
        <div style="text-align: center; padding: 60px 20px; color: var(--text-muted);">
          <div style="font-size: 48px; margin-bottom: 16px;">📦</div>
          <p style="font-size: 18px; margin-bottom: 8px;">Keine Apps vorhanden</p>
          <p style="font-size: 14px;">Erstelle deine erste App oben!</p>
        </div>
      `;
      status.textContent = '';
      return;
    }

    // Create card-based layout
    appsContainer.innerHTML = `<div class="apps-grid">${apps.map((app, index) => createAppCard(app, index)).join('')}</div>`;

    status.textContent = '';
  } catch (e) {
    // Check for 401 unauthorized (expired / invalid token)
    if (e.status === 401) {
      token = "";
      localStorage.removeItem("token");
      stopAutoRefresh();
      setAuthUI();
      showStatus(loginStatus, '✗ Session abgelaufen – bitte neu einloggen', 'error');
      return;
    }

    status.textContent = `✗ Fehler: ${e.message}`;
    status.className = 'text-error';
    
    appsContainer.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--text-error);">
        <p>Fehler beim Laden der Apps: ${e.message}</p>
      </div>
    `;
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.innerHTML = '🔄 Refresh';
  }
}

// Create HTML for app card
function createAppCard(app, index) {
  const statusClass = app.status === 'online' ? 'online' : app.status === 'stopped' ? 'stopped' : 'error';
  const statusText = app.status === 'online' ? 'Online' : app.status === 'stopped' ? 'Offline' : app.status;
  
  return `
    <div class="app-card" style="animation-delay: ${index * 0.05}s;">
      <div class="app-header">
        <div>
          <div class="app-name">${app.name}</div>
          <span class="badge ${statusClass}">${statusText}</span>
        </div>
      </div>
      
      <div class="app-stats">
        <div class="stat">
          <div class="stat-label">PID</div>
          <div class="stat-value">${app.pid ?? '-'}</div>
        </div>
        <div class="stat">
          <div class="stat-label">CPU</div>
          <div class="stat-value">${app.cpu ?? '-'}</div>
        </div>
        <div class="stat">
          <div class="stat-label">RAM</div>
          <div class="stat-value">${app.mem ?? '-'}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Restarts</div>
          <div class="stat-value">${app.restarts ?? 0}</div>
        </div>
      </div>
      
      <div class="app-actions">
        ${app.status === 'stopped' 
          ? `<button data-action="start" data-name="${app.name}">▶ Start</button>`
          : `<button class="secondary" data-action="stop" data-name="${app.name}">⏸ Stop</button>`
        }
        <button class="secondary" data-action="logs" data-name="${app.name}">📜 Logs</button>
        <button class="danger" data-action="delete" data-name="${app.name}">🗑 Delete</button>
      </div>
    </div>
  `;
}

// App action handlers
async function startApp(name) {
  try {
    const btn = document.querySelector(`[data-action="start"][data-name="${name}"]`);
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="loading"></span> Starting...';
    }
    
    await api(`/api/apps/${name}/start`, { method: "POST" });
    showStatus(statusSpan, `✓ "${name}" gestartet`, 'success');
    await refresh();
  } catch (e) {
    showStatus(statusSpan, `✗ Fehler: ${e.message}`, 'error');
    await refresh();
  }
}

async function stopApp(name) {
  try {
    const btn = document.querySelector(`[data-action="stop"][data-name="${name}"]`);
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="loading"></span> Stopping...';
    }
    
    await api(`/api/apps/${name}/stop`, { method: "POST" });
    showStatus(statusSpan, `✓ "${name}" gestoppt`, 'success');
    await refresh();
  } catch (e) {
    showStatus(statusSpan, `✗ Fehler: ${e.message}`, 'error');
    await refresh();
  }
}

async function delApp(name) {
  if (!confirm(`Wirklich löschen: ${name}? (Ordner wird gelöscht)`)) return;
  
  try {
    const btn = document.querySelector(`[data-action="delete"][data-name="${name}"]`);
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="loading"></span> Deleting...';
    }
    
    await api(`/api/apps/${name}`, { method: "DELETE" });
    showStatus(statusSpan, `✓ "${name}" gelöscht`, 'success');
    await refresh();
  } catch (e) {
    showStatus(statusSpan, `✗ Fehler: ${e.message}`, 'error');
    await refresh();
  }
}

// Load logs handler
async function loadLogs(appName = null) {
  const name = appName || logAppInput.value.trim();
  
  if (!name) {
    logsPre.textContent = '⚠ Bitte App-Name eingeben';
    return;
  }
  
  try {
    logsBtn.disabled = true;
    logsBtn.innerHTML = '<span class="loading"></span> Lade Logs...';
    logsPre.textContent = '⏳ Logs werden geladen...';
    
    const res = await api(`/api/apps/${name}/logs?lines=200`);
    const logsText = await res.text();
    logsPre.textContent = logsText || '(Keine Logs verfügbar)';
    
    // Scroll to logs section if triggered from card button
    if (appName) {
      logAppInput.value = name;
      logsPre.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  } catch (e) {
    logsPre.textContent = `✗ Fehler beim Laden der Logs: ${e.message}`;
  } finally {
    logsBtn.disabled = false;
    logsBtn.innerHTML = 'Logs laden';
  }
}

// Event delegation for all clicks
document.addEventListener("click", (e) => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;

  // Button handlers
  if (t.id === "loginBtn") doLogin();
  if (t.id === "logoutBtn") doLogout();
  if (t.id === "createBtn") createApp();
  if (t.id === "refreshBtn") refresh();
  if (t.id === "logsBtn") loadLogs();

  // Action buttons with data attributes
  const action = t.getAttribute("data-action");
  const name = t.getAttribute("data-name");
  if (!action || !name) return;

  if (action === "start") startApp(name);
  if (action === "stop") stopApp(name);
  if (action === "delete") delApp(name);
  if (action === "logs") loadLogs(name);
});

// Auto-refresh every 5 seconds when app section is visible
let autoRefreshInterval = null;

function startAutoRefresh() {
  if (autoRefreshInterval) return;
  autoRefreshInterval = setInterval(() => {
    if (!appDiv.classList.contains('hidden')) {
      refresh();
    }
  }, 5000);
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

// Initialize
if (token) {
  // Token in localStorage: validate it first before showing app screen.
  // refresh() calls setAuthUI() on success, or clears token + shows login on 401.
  refresh().then(() => startAutoRefresh());
} else {
  // No token: show login form immediately.
  setAuthUI();
}

// Clean up on page unload
window.addEventListener('beforeunload', stopAutoRefresh);
