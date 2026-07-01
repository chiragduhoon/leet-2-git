// Service worker: receives resolved solution data from the content script and
// pushes it to GitHub, then updates stats. All LeetCode fetching happens in the
// content script (same-origin); this worker only talks to GitHub.

import { GitHubClient } from "./github.js";
import { extForLang } from "./languages.js";
import { buildProblemReadme, buildRootReadme } from "./readme.js";

console.log("[Leet2Git] service worker ready");

const RECENT_CAP = 15;

// Serial queue: pushes are processed one at a time so the read-modify-write of
// stats never races — true for both live submissions and the bulk sync.
let chain = Promise.resolve();
const pendingSlugs = new Set();
function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.catch(() => {});
  return run;
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return settings || null;
}

async function getStats() {
  const { stats } = await chrome.storage.local.get("stats");
  return (
    stats || {
      counts: { Easy: 0, Medium: 0, Hard: 0 },
      problems: [],
      recent: [],
      solvedSlugs: []
    }
  );
}

async function setLastPush(ok, message, title) {
  await chrome.storage.local.set({
    lastPush: { ok, message, title: title || "", at: Date.now() }
  });
}

function badge(ok) {
  chrome.action.setBadgeText({ text: ok ? "✓" : "!" });
  chrome.action.setBadgeBackgroundColor({ color: ok ? "#1f9d55" : "#d64545" });
  // Best-effort clear; if the worker sleeps first the badge simply lingers.
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 6000);
}

async function handlePush({ code, lang, question: q }) {
  if (!q || !q.titleSlug) return { ok: false, error: "missing question data" };

  try {
    const settings = await getSettings();
    if (!settings || !settings.pat || !settings.owner || !settings.repo) {
      await setLastPush(false, "Not configured — open the popup to set it up.");
      badge(false);
      return { ok: false, error: "not configured" };
    }

    const folder = `${q.questionFrontendId}-${q.titleSlug}`;
    const ext = extForLang(lang);
    const solutionPath = `${folder}/solution.${ext}`;
    const problemReadmePath = `${folder}/README.md`;

    const gh = new GitHubClient(settings);
    const commitMsg = `Add solution: ${q.questionFrontendId}. ${q.title} (${q.difficulty})`;

    await gh.putFile(solutionPath, code, commitMsg);
    await gh.putFile(problemReadmePath, buildProblemReadme(q), commitMsg);

    // Update stats, then regenerate + push the root README.
    const stats = await getStats();
    if (!stats.solvedSlugs.includes(q.titleSlug)) {
      stats.solvedSlugs.push(q.titleSlug);
      if (stats.counts[q.difficulty] !== undefined) {
        stats.counts[q.difficulty] += 1;
      }
      stats.problems.push({
        id: q.questionId,
        frontendId: q.questionFrontendId,
        title: q.title,
        slug: q.titleSlug,
        difficulty: q.difficulty,
        folder,
        file: `solution.${ext}`
      });
    }
    stats.recent = [
      {
        frontendId: q.questionFrontendId,
        title: q.title,
        slug: q.titleSlug,
        difficulty: q.difficulty,
        at: Date.now()
      },
      ...stats.recent.filter((r) => r.slug !== q.titleSlug)
    ].slice(0, RECENT_CAP);

    await chrome.storage.local.set({ stats });
    await gh.putFile("README.md", buildRootReadme(stats), "Update solutions index");

    await setLastPush(true, `Pushed ${q.questionFrontendId}. ${q.title}`, q.title);
    badge(true);
    return { ok: true };
  } catch (err) {
    console.error("[Leet2Git]", err);
    await setLastPush(false, String((err && err.message) || err));
    badge(false);
    return { ok: false, error: String((err && err.message) || err) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  console.log("[Leet2Git] background received:", msg && msg.type);
  if (msg && msg.type === "PUSH_SOLUTION") {
    const slug = msg.payload && msg.payload.question && msg.payload.question.titleSlug;
    // Drop exact duplicates already waiting in the queue.
    if (slug && pendingSlugs.has(slug)) {
      sendResponse({ ok: true, skipped: true });
      return false;
    }
    if (slug) pendingSlugs.add(slug);
    enqueue(() => handlePush(msg.payload)).then((r) => {
      if (slug) pendingSlugs.delete(slug);
      sendResponse(r);
    });
    return true; // keep the channel open for the async response
  } else if (msg && msg.type === "PUSH_ERROR") {
    console.error("[Leet2Git] content error:", msg.error);
    setLastPush(false, msg.error);
    badge(false);
    sendResponse({ received: true });
  }
  return false;
});
