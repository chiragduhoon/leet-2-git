(function () {
if (globalThis.__leet2gitContentLoaded) {
  console.log("[Leet2Git] content script already ready on", location.href);
  return;
}
globalThis.__leet2gitContentLoaded = true;

// Runs in the ISOLATED world. Two jobs:
//  1. Receive the "accepted" signal from the MAIN-world interceptor.
//  2. Fetch the submitted code + problem metadata from LeetCode's GraphQL API.
//
// Crucially, this fetch is SAME-ORIGIN (leetcode.com page -> leetcode.com/graphql),
// so the session cookie, csrftoken header and Referer are all correct — which they
// are NOT from the background service worker. The PAT never touches this context;
// the resolved data is handed to the background worker for the GitHub push.

console.log("[Leet2Git] content script ready on", location.href);

const GRAPHQL = "https://leetcode.com/graphql";

function csrfToken() {
  const m = document.cookie.match(/csrftoken=([^;]+)/);
  return m ? m[1] : "";
}

async function gql(query, variables) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json"
  };
  const token = csrfToken();
  if (token) headers["x-csrftoken"] = token;

  const res = await fetch(GRAPHQL, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error(`LeetCode GraphQL ${res.status}`);
  const json = await res.json();
  if (json.errors && json.errors.length) {
    throw new Error("LeetCode: " + json.errors[0].message);
  }
  return json.data;
}

async function getSubmissionDetails(submissionId) {
  const data = await gql(
    `query submissionDetails($submissionId: Int!) {
       submissionDetails(submissionId: $submissionId) {
         code
         lang { name }
         question { questionId titleSlug }
       }
     }`,
    { submissionId: Number(submissionId) }
  );
  return data.submissionDetails;
}

async function getQuestion(titleSlug) {
  const data = await gql(
    `query questionData($titleSlug: String!) {
       question(titleSlug: $titleSlug) {
         questionId
         questionFrontendId
         title
         titleSlug
         difficulty
         content
       }
     }`,
    { titleSlug }
  );
  return data.question;
}

function send(msg) {
  // Swallow "receiving end does not exist" if the worker is briefly asleep.
  chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError);
}

async function handleAccepted(payload) {
  try {
    // The submission record can lag a beat behind the "Accepted" verdict; retry once.
    let details = await getSubmissionDetails(payload.submissionId);
    if (!details || !details.code) {
      await new Promise((r) => setTimeout(r, 1200));
      details = await getSubmissionDetails(payload.submissionId);
    }
    if (!details || !details.code) {
      throw new Error("Submission code not available yet.");
    }

    const slug =
      payload.titleSlug || (details.question && details.question.titleSlug);
    if (!slug) throw new Error("Could not determine problem slug.");

    const question = await getQuestion(slug);
    if (!question) throw new Error("Could not fetch problem metadata.");

    send({
      type: "PUSH_SOLUTION",
      payload: {
        code: details.code,
        lang: details.lang && details.lang.name,
        question
      }
    });
  } catch (e) {
    send({ type: "PUSH_ERROR", error: String((e && e.message) || e) });
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== "leet2git" || data.type !== "ACCEPTED") return;
  handleAccepted(data.payload);
});

// ---------------------------------------------------------------------------
// One-time backfill: import already-solved problems.
// Triggered by the popup (chrome.tabs.sendMessage). Runs here because it needs
// same-origin access to LeetCode's authenticated submission history.
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let syncing = false;

async function setSyncStatus(s) {
  await chrome.storage.local.set({ syncStatus: { ...s, updatedAt: Date.now() } });
}

// Push one resolved solution and wait for the background worker to finish it.
function pushAndWait(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "PUSH_SOLUTION", payload }, (resp) => {
      void chrome.runtime.lastError;
      resolve(resp || { ok: false });
    });
  });
}

// Walk the paginated submissions API, newest first, keeping the latest Accepted
// submission id per problem slug. LeetCode rate-limits this endpoint (returns
// 403/429 on rapid requests), so we pace requests and back off on a block. If it
// keeps refusing, we return what we have rather than failing the whole sync.
async function fetchAcceptedSubmissions() {
  const latestBySlug = new Map(); // slug -> submissionId
  const limit = 20;
  let offset = 0;
  let guard = 0;
  let partial = false;

  while (guard++ < 1000) {
    let res;
    let attempt = 0;
    // Retry this page on rate-limit with exponential backoff.
    while (true) {
      res = await fetch(
        `https://leetcode.com/api/submissions/?offset=${offset}&limit=${limit}`,
        {
          credentials: "include",
          headers: {
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest"
          }
        }
      );
      if (res.ok) break;
      if ((res.status === 403 || res.status === 429) && attempt < 4) {
        attempt++;
        const wait = 3000 * Math.pow(2, attempt - 1); // 3s, 6s, 12s, 24s
        console.warn(
          `[Leet2Git] submissions ${res.status} at offset ${offset}; retry ${attempt} in ${wait}ms`
        );
        await setSyncStatus({
          running: true,
          phase: "scanning",
          note: `LeetCode rate-limited — waiting ${wait / 1000}s…`,
          done: 0,
          total: 0,
          error: ""
        });
        await sleep(wait);
        continue;
      }
      // Give up paging further; use whatever we've gathered.
      console.warn(
        `[Leet2Git] submissions stopped at offset ${offset} (${res.status})`
      );
      partial = true;
      return { map: latestBySlug, partial };
    }

    const data = await res.json();
    const dump = data.submissions_dump || [];
    for (const s of dump) {
      if (s.status_display === "Accepted" && !latestBySlug.has(s.title_slug)) {
        latestBySlug.set(s.title_slug, String(s.id));
      }
    }
    await setSyncStatus({
      running: true,
      phase: "scanning",
      note: `Scanned ${offset + dump.length} submissions; found ${latestBySlug.size} accepted problems.`,
      done: offset + dump.length,
      total: 0,
      error: ""
    });
    if (!data.has_next || dump.length === 0) break;
    offset += limit;
    await sleep(1000); // pace to avoid the rate limit
  }
  return { map: latestBySlug, partial };
}

async function runSync() {
  console.log("[Leet2Git] sync requested");
  if (syncing) {
    await setSyncStatus({
      running: true,
      phase: "scanning",
      note: "Sync is already running in this LeetCode tab.",
      error: ""
    });
    return;
  }
  syncing = true;
  try {
    await setSyncStatus({ running: true, phase: "scanning", done: 0, total: 0, error: "" });

    // Skip problems already in the repo to avoid re-fetching/re-committing.
    const { stats } = await chrome.storage.local.get("stats");
    const already = new Set((stats && stats.solvedSlugs) || []);

    let map, partial;
    try {
      ({ map, partial } = await fetchAcceptedSubmissions());
    } catch (e) {
      await setSyncStatus({ running: false, error: String((e && e.message) || e) });
      return;
    }

    console.log(
      `[Leet2Git] found ${map.size} accepted problems, ${already.size} already synced` +
        (partial ? " (history truncated by LeetCode rate limit)" : "")
    );
    const entries = [...map.entries()].filter(([slug]) => !already.has(slug));
    const total = entries.length;
    await setSyncStatus({ running: true, phase: "pushing", done: 0, total, error: "" });

    let done = 0;
    let failed = 0;
    for (const [slug, submissionId] of entries) {
      try {
        const details = await getSubmissionDetails(submissionId);
        const question = await getQuestion(slug);
        if (details && details.code && question) {
          const resp = await pushAndWait({
            code: details.code,
            lang: details.lang && details.lang.name,
            question
          });
          if (!resp || !resp.ok) failed++;
        } else {
          failed++;
        }
      } catch (e) {
        failed++;
        console.warn("[Leet2Git] sync skipped", slug, e);
      }
      done++;
      await setSyncStatus({
        running: true,
        phase: "pushing",
        done,
        total,
        failed,
        lastTitle: slug,
        error: ""
      });
      await sleep(1200); // throttle GitHub commits
    }

    await setSyncStatus({
      running: false,
      phase: "done",
      done,
      total,
      failed,
      partial,
      error: ""
    });
  } finally {
    syncing = false;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "START_SYNC") {
    runSync();
    sendResponse({ started: true, alreadyRunning: syncing });
  }
  return false;
});
})();
