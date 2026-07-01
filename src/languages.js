// LeetCode language slug -> source file extension.
// Slugs come from the GraphQL submissionDetails `lang.name` field.

const LANG_EXT = {
  python: "py",
  python3: "py",
  pythondata: "py",
  c: "c",
  cpp: "cpp",
  csharp: "cs",
  java: "java",
  kotlin: "kt",
  scala: "scala",
  swift: "swift",
  golang: "go",
  go: "go",
  javascript: "js",
  typescript: "ts",
  ruby: "rb",
  rust: "rs",
  php: "php",
  racket: "rkt",
  erlang: "erl",
  elixir: "ex",
  dart: "dart",
  mysql: "sql",
  mssql: "sql",
  oraclesql: "sql",
  postgresql: "sql",
  pythonml: "py",
  bash: "sh"
};

export function extForLang(langSlug) {
  if (!langSlug) return "txt";
  return LANG_EXT[String(langSlug).toLowerCase()] || "txt";
}
