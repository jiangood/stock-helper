let config = {};

const $ = id => document.getElementById(id);

function formatTime(ts) {
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

function updateClock() {
  const now = new Date();
  const timeStr = formatTime(now);
  if ($("currentTime")) $("currentTime").textContent = timeStr;
}

function showToast(msg, type) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast " + type + " show";
  clearTimeout(t._hide);
  t._hide = setTimeout(() => t.classList.remove("show"), 2500);
}

async function loadConfig() {
  try {
    const res = await fetch("config.json", { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    config = await res.json();
  } catch {
    config = {};
  }
}

async function checkAccess() {
  await loadConfig();
  const params = new URLSearchParams(window.location.search);
  if (params.get("random") === config.password) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "app.css";
    document.head.appendChild(link);

    $("publicPage").style.display = "none";
    $("appContent").style.display = "block";

    const script = document.createElement("script");
    script.src = "app.js";
    document.body.appendChild(script);
  }
}

document.addEventListener("DOMContentLoaded", checkAccess);

updateClock();
setInterval(updateClock, 1000);
