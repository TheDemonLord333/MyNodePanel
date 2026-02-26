let token = localStorage.getItem("token") || "";

function setAuthUI() {
  document.getElementById("login").style.display = token ? "none" : "block";
  document.getElementById("app").style.display = token ? "block" : "none";
}

async function api(path, opts = {}) {
  const headers = opts.headers || {};
  if (token) headers["Authorization"] = "Bearer " + token;
  if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) throw new Error(await res.text());
  return res;
}

async function doLogin() {
  const user = document.getElementById("user").value;
  const pass = document.getElementById("pass").value;
  const el = document.getElementById("loginStatus");
  el.textContent = "…";

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

    el.textContent = "OK";
    setAuthUI();
    await refresh();
  } catch (e) {
    el.textContent = "Fehler: " + e.message;
  }
}

async function refresh() {
  const status = document.getElementById("status");
  status.textContent = "lade…";
  try {
    const res = await api("/api/apps");
    const apps = await res.json();
    const tbody = document.getElementById("tbody");
    tbody.innerHTML = "";

    for (const a of apps) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${a.name}</td>
        <td><span class="badge">${a.status}</span></td>
        <td>${a.pid ?? ""}</td>
        <td>${a.cpu ?? ""}</td>
        <td>${a.mem ?? ""}</td>
        <td>${a.restarts ?? ""}</td>
        <td class="row">
          <button data-action="start" data-name="${a.name}">Start</button>
          <button data-action="stop" data-name="${a.name}">Stop</button>
          <button data-action="delete" data-name="${a.name}">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    }

    status.textContent = "ok";
  } catch (e) {
    status.textContent = "Fehler: " + e.message;
    if (String(e.message).includes("401")) {
      token = "";
      localStorage.removeItem("token");
      setAuthUI();
    }
  }
}

async function createApp() {
  const name = document.getElementById("newName").value.trim();
  const portVal = document.getElementById("newPort").value;
  const body = { name };
  if (portVal) body.port = Number(portVal);
  await api("/api/apps", { method: "POST", body: JSON.stringify(body) });
  await refresh();
}

async function startApp(name) {
  await api(`/api/apps/${name}/start`, { method: "POST" });
  await refresh();
}

async function stopApp(name) {
  await api(`/api/apps/${name}/stop`, { method: "POST" });
  await refresh();
}

async function delApp(name) {
  if (!confirm(`Wirklich löschen: ${name}? (Ordner wird gelöscht)`)) return;
  await api(`/api/apps/${name}`, { method: "DELETE" });
  await refresh();
}

async function loadLogs() {
  const name = document.getElementById("logApp").value.trim();
  const pre = document.getElementById("logs");
  pre.textContent = "lade…";
  try {
    const res = await api(`/api/apps/${name}/logs?lines=200`);
    pre.textContent = (await res.text()) || "(leer)";
  } catch (e) {
    pre.textContent = "Fehler: " + e.message;
  }
}

document.addEventListener("click", (e) => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;

  if (t.id === "loginBtn") doLogin();
  if (t.id === "createBtn") createApp();
  if (t.id === "refreshBtn") refresh();
  if (t.id === "logsBtn") loadLogs();

  const action = t.getAttribute("data-action");
  const name = t.getAttribute("data-name");
  if (!action || !name) return;

  if (action === "start") startApp(name);
  if (action === "stop") stopApp(name);
  if (action === "delete") delApp(name);
});

setAuthUI();
if (token) refresh();
