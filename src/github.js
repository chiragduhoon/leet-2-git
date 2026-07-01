// GitHub REST Contents API helpers. A GitHubClient is constructed from the saved
// settings (pat / owner / repo / branch) and exposes getFile / putFile / repoInfo.

const API = "https://api.github.com";

// UTF-8 safe base64 (btoa alone mangles multibyte chars).
function toBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

export class GitHubClient {
  constructor({ pat, owner, repo, branch }) {
    this.pat = pat;
    this.owner = owner;
    this.repo = repo;
    this.branch = branch || "main";
  }

  get headers() {
    return {
      Authorization: `token ${this.pat}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json"
    };
  }

  base() {
    return `${API}/repos/${this.owner}/${this.repo}`;
  }

  // Validates token + repo access; throws with a readable message otherwise.
  async repoInfo() {
    const res = await fetch(this.base(), { headers: this.headers });
    if (res.status === 401) throw new Error("Invalid or expired token (401).");
    if (res.status === 404)
      throw new Error("Repo not found or token lacks access (404).");
    if (!res.ok) throw new Error(`GitHub repo check failed (${res.status}).`);
    return res.json();
  }

  // Returns { sha } for an existing file, or null if it doesn't exist (404).
  async getFile(path) {
    const url = `${this.base()}/contents/${encodePath(path)}?ref=${encodeURIComponent(
      this.branch
    )}`;
    const res = await fetch(url, { headers: this.headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub getFile ${res.status} for ${path}`);
    return res.json();
  }

  // Create or update a file. Looks up the sha automatically when not supplied.
  async putFile(path, content, message, sha) {
    if (sha === undefined) {
      const existing = await this.getFile(path);
      sha = existing ? existing.sha : undefined;
    }
    const body = {
      message,
      content: toBase64(content),
      branch: this.branch
    };
    if (sha) body.sha = sha;

    const res = await fetch(`${this.base()}/contents/${encodePath(path)}`, {
      method: "PUT",
      headers: this.headers,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`GitHub putFile ${res.status} for ${path}: ${txt}`);
    }
    return res.json();
  }
}

// Encode each path segment but keep the slashes.
function encodePath(path) {
  return path
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
}
