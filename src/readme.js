// Builds the per-problem README (from the LeetCode HTML statement) and the
// repository root README (problem table + solved counts) from stored stats.

// Lightweight HTML -> readable text/markdown. LeetCode statements use a small,
// predictable tag set, so a full parser isn't needed in the service worker.
function htmlToMarkdown(html) {
  if (!html) return "";
  let s = html;
  s = s.replace(/<sup>(.*?)<\/sup>/gi, "^$1");
  s = s.replace(/<sub>(.*?)<\/sub>/gi, "_$1");
  s = s.replace(/<strong>(.*?)<\/strong>/gi, "**$1**");
  s = s.replace(/<b>(.*?)<\/b>/gi, "**$1**");
  s = s.replace(/<em>(.*?)<\/em>/gi, "*$1*");
  s = s.replace(/<code>(.*?)<\/code>/gi, "`$1`");
  s = s.replace(/<\/?(pre)>/gi, "\n```\n");
  s = s.replace(/<li>/gi, "\n- ").replace(/<\/li>/gi, "");
  s = s.replace(/<\/p>/gi, "\n\n").replace(/<p>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/?(ul|ol|div)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, ""); // drop any remaining tags
  // Decode the few HTML entities LeetCode emits.
  const ent = {
    "&nbsp;": " ",
    "&lt;": "<",
    "&gt;": ">",
    "&amp;": "&",
    "&quot;": '"',
    "&#39;": "'",
    "&times;": "×",
    "&le;": "≤",
    "&ge;": "≥",
    "&minus;": "−"
  };
  s = s.replace(/&[a-z#0-9]+;/gi, (m) => ent[m] || m);
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

export function buildProblemReadme(q) {
  const url = `https://leetcode.com/problems/${q.titleSlug}/`;
  return [
    `# ${q.questionFrontendId}. ${q.title}`,
    "",
    `**Difficulty:** ${q.difficulty}  `,
    `**Link:** ${url}`,
    "",
    "---",
    "",
    htmlToMarkdown(q.content),
    ""
  ].join("\n");
}

// stats.problems is an array of { id, frontendId, title, slug, difficulty, folder, file }
export function buildRootReadme(stats) {
  const counts = stats.counts || { Easy: 0, Medium: 0, Hard: 0 };
  const total = (counts.Easy || 0) + (counts.Medium || 0) + (counts.Hard || 0);
  const rows = [...(stats.problems || [])]
    .sort((a, b) => Number(a.frontendId) - Number(b.frontendId))
    .map((p) => {
      const sol = `${p.folder}/${p.file}`;
      const lcUrl = `https://leetcode.com/problems/${p.slug}/`;
      return `| ${p.frontendId} | [${p.title}](${lcUrl}) | ${p.difficulty} | [Solution](${p.folder}/) (\`${sol}\`) |`;
    });

  return [
    "# LeetCode Solutions",
    "",
    "Automatically synced from LeetCode by [Leet2Git](https://github.com).",
    "",
    `**Total solved:** ${total} &nbsp;·&nbsp; 🟢 Easy: ${counts.Easy || 0} &nbsp;·&nbsp; 🟡 Medium: ${
      counts.Medium || 0
    } &nbsp;·&nbsp; 🔴 Hard: ${counts.Hard || 0}`,
    "",
    "| # | Problem | Difficulty | Solution |",
    "| --- | --- | --- | --- |",
    ...rows,
    ""
  ].join("\n");
}
