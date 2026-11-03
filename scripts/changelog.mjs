// Changelog written from the git history: each version gathers the commits up to its tag (vX.Y.Z),
// and the version being worked on (tauri.conf.json) gathers everything after the last other tag.
//   node scripts/changelog.mjs          writes CHANGELOG.md and src/changelog.json (run by `npm run build`)
//   node scripts/changelog.mjs --notes  prints the notes of the current version (GitHub release body)
// A commit's subject is one line of the notes, its « - » lines are the details under it.
// Without git (or without the history), the files already there are kept.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version: current } = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

// Commits that say nothing to someone using Boofer.
const SKIP = [/^Version \d/i, /^README\b/i, /^Merge (branch|remote)/i, /^Initial commit$/i, /^npm run/i, /^Lien vers le dépôt/i];

/** "1.2.3" → [1, 2, 3], to sort tags. */
const parts = (v) => v.split(".").map(Number);
const newer = (a, b) => parts(a).reduce((r, n, i) => r || n - parts(b)[i], 0);

function commits(range) {
  const sep = "\u001e";
  const out = git("log", "--first-parent", `--format=%s%n%b${sep}`, range);
  return out.split(sep).map((raw) => raw.trim()).filter(Boolean).flatMap((raw) => {
    let [subject, ...body] = raw.split("\n");
    // « Merge pull request #7 from … » : its title is the first line of the body.
    if (/^Merge pull request/.test(subject)) subject = body.find((l) => l.trim()) ?? "";
    subject = subject
      .replace(/^Fusionne #\d+ : /, "")
      .replace(/\s*\(v\d+\.\d+\.\d+\)$/, "")
      .trim();
    if (!subject || SKIP.some((re) => re.test(subject))) return [];
    // « - » lines, with their wrapped continuation lines.
    const details = [];
    for (const line of body) {
      if (/^(Co-Authored-By|Signed-off-by):/i.test(line)) continue;
      if (/^\s*[-*] /.test(line)) details.push(line.replace(/^\s*[-*] /, "").trim());
      else if (/^\s{2,}\S/.test(line) && details.length) details[details.length - 1] += ` ${line.trim()}`;
    }
    return [{ title: subject, details }];
  });
}

function build() {
  const tags = git("tag", "--list", "v*").split("\n").map((t) => t.trim().replace(/^v/, ""))
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v)).sort(newer);
  // The current version without its tag yet (it is created by the release), or with commits
  // after it (the release of the current version is refreshed at each push).
  const released = tags.filter((v) => newer(v, current) < 0);
  const versions = [];
  let from = null;
  for (const v of released) {
    const range = from ? `v${from}..v${v}` : `v${v}`;
    versions.push({ version: v, date: git("log", "-1", "--format=%cs", `v${v}`).trim(), items: commits(range) });
    from = v;
  }
  versions.push({
    version: current,
    date: tags.includes(current) ? git("log", "-1", "--format=%cs", `v${current}`).trim() : git("log", "-1", "--format=%cs").trim(),
    items: commits(from ? `v${from}..HEAD` : "HEAD"),
  });
  return versions.reverse();
}

function markdown(entry, heading = "##") {
  const lines = [`${heading} ${entry.version} · ${entry.date}`, ""];
  if (!entry.items.length) lines.push("- Corrections et petites améliorations");
  for (const item of entry.items) {
    lines.push(`- ${item.title}`);
    for (const d of item.details) lines.push(`  - ${d}`);
  }
  return lines.join("\n");
}

let versions;
try {
  versions = build();
} catch {
  // No git or a shallow clone: keep what is there.
  if (process.argv.includes("--notes")) process.exit(0);
  console.warn("changelog : historique git indisponible, fichiers gardés tels quels");
  process.exit(0);
}

if (process.argv.includes("--notes")) {
  const notes = versions[0].items.length
    ? versions[0].items.map((i) => [`- ${i.title}`, ...i.details.map((d) => `  - ${d}`)].join("\n")).join("\n")
    : "- Corrections et petites améliorations";
  process.stdout.write(`${notes}\n`);
} else {
  const md = ["# Nouveautés de Boofer", "", "Écrit tout seul à partir de l'historique, à chaque build.", "", ...versions.map((v) => `${markdown(v)}\n`)].join("\n");
  fs.writeFileSync(path.join(root, "CHANGELOG.md"), md);
  fs.writeFileSync(path.join(root, "src/changelog.json"), `${JSON.stringify(versions, null, 1)}\n`);
  console.log(`✔ CHANGELOG.md : ${versions.length} versions`);
}
