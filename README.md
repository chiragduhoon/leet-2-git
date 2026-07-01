# ⚡ Leet2Git

A Chrome extension that **automatically pushes every accepted LeetCode solution to a GitHub
repository** and tracks your progress (total solved + Easy/Medium/Hard counts + recent submissions).

Each accepted submission is committed as a folder per problem:

```
15-3sum/
├── solution.py     ← your submitted code
└── README.md       ← the problem statement
```

…and a root `README.md` index with a problem table + solved counts is kept up to date.

## Install (load unpacked)

1. Open `chrome://extensions` in Chrome (or any Chromium browser).
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** and select the `leet2git/` folder.
4. The ⚡ icon appears in your toolbar. Pin it for convenience.

## One-time setup

Click the ⚡ icon and fill in:

| Field | What it is |
| --- | --- |
| **Personal Access Token** | A GitHub PAT with **Contents: read & write** on your target repo. |
| **Username (owner)** | Your GitHub username. |
| **Repository name** | The repo to push solutions to (create it first; can be empty). |
| **Branch** | Defaults to `main`. |

Click **Test connection** to verify, then **Save**. The token is stored only in your browser's
local extension storage and is sent only to `api.github.com`.

### Creating the token

- **Fine-grained token** (recommended): GitHub → Settings → Developer settings → Fine-grained tokens
  → select the target repo → **Repository permissions → Contents: Read and write**.
- **Classic token**: the `repo` scope works.

## How it works

1. A content script in the page's **MAIN world** patches `fetch`/`XHR` to watch LeetCode's
   `/submissions/detail/{id}/check/` response. When it reads `Accepted`, it relays the submission id
   to the **ISOLATED-world** content script.
2. The isolated content script fetches your code + the problem statement via LeetCode's GraphQL API.
   This call is **same-origin**, so your session cookie / CSRF token / Referer are all correct — it
   would fail from the background worker. It then hands the resolved data to the worker.
3. The **background service worker** commits the files to GitHub via the REST Contents API. The PAT
   lives only here and is never exposed to the page.
4. Stats are saved to local storage and shown in the popup.

## Import your already-solved problems

The extension only catches **new** accepted submissions automatically. To backfill the problems you
solved before installing it:

1. Open **leetcode.com** in a tab and make sure you're **logged in**.
2. Open the Leet2Git popup and click **⤓ Sync existing solutions**.
3. It scans your submission history, keeps the latest accepted solution per problem, and pushes each
   one (throttled, with a live progress bar). Keep the LeetCode tab open until it finishes.

Already-synced problems are skipped, so it's safe to run again. Very old submissions may be truncated
by LeetCode's own history limits, but recent ones import reliably.

## Notes

- You must be **logged in to LeetCode** for the extension to read your submission code.
- Re-solving a problem **updates** the existing files (no duplicates).
- Wrong/failed submissions are ignored.
- SQL problems are saved with a `.sql` extension; the language→extension map lives in
  [`src/languages.js`](src/languages.js).

## Project structure

```
leet2git/
├── manifest.json
├── src/
│   ├── interceptor.js   # MAIN world: detect accepted submissions
│   ├── content.js       # ISOLATED world: fetch code via GraphQL, relay to background
│   ├── background.js    # GitHub push + stats
│   ├── github.js        # Contents API client
│   ├── readme.js        # builds per-problem + root READMEs
│   └── languages.js     # language → file extension
├── popup/               # setup form + stats UI
└── icons/
```

## Troubleshooting

- **Nothing pushed:** open `chrome://extensions` → Leet2Git → **Inspect views: service worker** and
  check the console for errors. Re-check your PAT scope and that you're logged into LeetCode.
- **401/404 on save:** the token is wrong/expired or lacks access to that repo.
- **Sync stops early / "rate-limited":** LeetCode throttles its submissions API. The sync backs off
  and retries; if history is truncated, wait a few minutes and run it again to pick up older problems.

## License

[MIT](LICENSE) © Chirag Duhoon
