// Popup: first run shows Setup; once configured shows stats. "Test connection"
// validates the PAT/repo via GET /repos/{owner}/{repo} before saving.

const $ = (id) => document.getElementById(id);

const statsView = $("statsView");
const settingsView = $("settingsView");

async function getLocal(keys) {
  return chrome.storage.local.get(keys);
}

function showView(which) {
  statsView.classList.toggle("hidden", which !== "stats");
  settingsView.classList.toggle("hidden", which !== "settings");
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}

function renderStats(stats, settings, lastPush) {
  const c = (stats && stats.counts) || { Easy: 0, Medium: 0, Hard: 0 };
  const total = (c.Easy || 0) + (c.Medium || 0) + (c.Hard || 0);
  $("totalNum").textContent = total;
  $("easyNum").textContent = c.Easy || 0;
  $("medNum").textContent = c.Medium || 0;
  $("hardNum").textContent = c.Hard || 0;

  const list = $("recentList");
  list.innerHTML = "";
  const recent = (stats && stats.recent) || [];
  if (!recent.length) {
    list.innerHTML = '<li class="empty">No submissions yet.</li>';
  } else {
    for (const r of recent) {
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="dot ${escapeHtml(r.difficulty)}"></span>
        <span class="num">${escapeHtml(r.frontendId)}.</span>
        <span class="name">${escapeHtml(r.title)}</span>
        <span class="num">${timeAgo(r.at)}</span>`;
      list.appendChild(li);
    }
  }

  const bar = $("statusBar");
  if (lastPush && lastPush.message) {
    bar.classList.remove("hidden", "ok", "err");
    bar.classList.add(lastPush.ok ? "ok" : "err");
    bar.textContent = lastPush.message;
  } else {
    bar.classList.add("hidden");
  }

  const link = $("repoLink");
  if (settings && settings.owner && settings.repo) {
    link.href = `https://github.com/${settings.owner}/${settings.repo}`;
    link.classList.remove("hidden");
  } else {
    link.classList.add("hidden");
  }
}

function fillSettings(settings) {
  settings = settings || {};
  $("pat").value = settings.pat || "";
  $("owner").value = settings.owner || "";
  $("repo").value = settings.repo || "";
  $("branch").value = settings.branch || "main";
}

function readSettings() {
  return {
    pat: $("pat").value.trim(),
    owner: $("owner").value.trim(),
    repo: $("repo").value.trim(),
    branch: $("branch").value.trim() || "main"
  };
}

function setMsg(text, kind) {
  const el = $("settingsMsg");
  el.textContent = text;
  el.className = "settings-msg" + (kind ? " " + kind : "");
}

async function testConnection(s) {
  const res = await fetch(`https://api.github.com/repos/${s.owner}/${s.repo}`, {
    headers: {
      Authorization: `token ${s.pat}`,
      Accept: "application/vnd.github+json"
    }
  });
  if (res.status === 401) throw new Error("Invalid or expired token (401).");
  if (res.status === 404) throw new Error("Repo not found or no access (404).");
  if (!res.ok) throw new Error(`GitHub returned ${res.status}.`);
  return res.json();
}

function renderSync(status) {
  const el = $("syncProgress");
  const btn = $("syncBtn");
  if (!status) {
    el.classList.add("hidden");
    btn.disabled = false;
    btn.textContent = "⤓ Sync existing solutions";
    return;
  }
  if (status.error) {
    el.classList.remove("hidden");
    el.classList.add("err");
    el.textContent = "Sync failed: " + status.error;
    btn.disabled = false;
    btn.textContent = "⤓ Sync existing solutions";
    return;
  }
  el.classList.remove("hidden", "err");

  if (status.running) {
    btn.disabled = true;
    btn.textContent = "Syncing…";
    if (status.phase === "scanning") {
      el.innerHTML = escapeHtml(
        status.note || "Scanning your LeetCode submissions…"
      );
    } else {
      const pct = status.total ? Math.round((status.done / status.total) * 100) : 0;
      el.innerHTML = `Pushing ${status.done}/${status.total}…<div class="bar"><span style="width:${pct}%"></span></div>`;
    }
  } else if (status.phase === "done") {
    btn.disabled = false;
    btn.textContent = "⤓ Sync existing solutions";
    const fail = status.failed ? ` (${status.failed} skipped)` : "";
    const trunc = status.partial
      ? " LeetCode limited how far back it would return — run again later to get older ones."
      : "";
    el.innerHTML = escapeHtml(`✓ Synced ${status.done}/${status.total}${fail}.${trunc}`);
  } else {
    el.classList.add("hidden");
    btn.disabled = false;
    btn.textContent = "⤓ Sync existing solutions";
  }
}

// Reflect current storage state into the UI. Safe to call repeatedly.
async function refresh() {
  const { settings, stats, lastPush, syncStatus } = await getLocal([
    "settings",
    "stats",
    "lastPush",
    "syncStatus"
  ]);
  const configured =
    settings && settings.pat && settings.owner && settings.repo;

  if (configured) {
    showView("stats");
    renderStats(stats, settings, lastPush);
    renderSync(syncStatus);
  } else {
    showView("settings");
    fillSettings(settings);
  }
  return configured;
}

// Bind listeners exactly once.
function bindOnce() {
  $("gearBtn").addEventListener("click", async () => {
    if (settingsView.classList.contains("hidden")) {
      const { settings } = await getLocal(["settings"]);
      fillSettings(settings);
      showView("settings");
    } else {
      // Only allow leaving settings if configured.
      const { settings } = await getLocal(["settings"]);
      if (settings && settings.pat && settings.owner && settings.repo) {
        refresh();
      }
    }
  });

  $("testBtn").addEventListener("click", async () => {
    const s = readSettings();
    if (!s.pat || !s.owner || !s.repo) {
      setMsg("Fill in token, username and repo first.", "err");
      return;
    }
    setMsg("Testing…", "");
    $("testBtn").disabled = true;
    try {
      await testConnection(s);
      setMsg("✓ Connected. Repo is reachable.", "ok");
    } catch (e) {
      setMsg("✗ " + e.message, "err");
    } finally {
      $("testBtn").disabled = false;
    }
  });

  $("saveBtn").addEventListener("click", async () => {
    const s = readSettings();
    if (!s.pat || !s.owner || !s.repo) {
      setMsg("Fill in token, username and repo first.", "err");
      return;
    }
    setMsg("Verifying & saving…", "");
    $("saveBtn").disabled = true;
    try {
      await testConnection(s);
      await chrome.storage.local.set({ settings: s });
      setMsg("✓ Saved.", "ok");
      setTimeout(refresh, 600);
    } catch (e) {
      setMsg("✗ " + e.message, "err");
    } finally {
      $("saveBtn").disabled = false;
    }
  });

  $("syncBtn").addEventListener("click", async () => {
    const el = $("syncProgress");
    el.classList.remove("hidden", "err");
    el.textContent = "Looking for an open LeetCode tab…";
    let tabs = [];
    try {
      tabs = await chrome.tabs.query({ url: "https://leetcode.com/*" });
    } catch (_) {
      /* fall through to the no-tab message */
    }
    if (!tabs.length) {
      el.classList.add("err");
      el.textContent =
        "Open leetcode.com in a tab (logged in), then click Sync again.";
      return;
    }
    chrome.tabs.sendMessage(tabs[0].id, { type: "START_SYNC" }, () => {
      void chrome.runtime.lastError;
    });
    $("syncBtn").disabled = true;
    el.textContent = "Sync started — keep that LeetCode tab open.";
  });

  // Live-update while the popup is open.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.syncStatus) renderSync(changes.syncStatus.newValue);
    if (changes.stats || changes.lastPush) refresh();
  });
}

bindOnce();
refresh();
