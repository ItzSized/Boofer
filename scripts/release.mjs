// npm run release: builds Booffer, then puts the fresh exe and installer at the root of
// the project and in !_EXE_ET_INSTALLEUR, so the copy you double-click is always the latest.
// `npm run release -- --copy` skips the build and only copies the last one.
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destinations = [root, path.join(root, "!_EXE_ET_INSTALLEUR")];

if (!process.argv.includes("--copy")) {
  execSync("npm run tauri build", { cwd: root, stdio: "inherit" });
}

// Same lookup as cargo: CARGO_TARGET_DIR, then src-tauri/.cargo/config.toml, then src-tauri/target.
function targetDir() {
  if (process.env.CARGO_TARGET_DIR) return process.env.CARGO_TARGET_DIR;
  try {
    const config = fs.readFileSync(path.join(root, "src-tauri/.cargo/config.toml"), "utf8");
    const dir = config.match(/^\s*target-dir\s*=\s*"([^"]+)"/m)?.[1];
    if (dir) return path.resolve(root, "src-tauri", dir);
  } catch {}
  return path.join(root, "src-tauri/target");
}

const release = path.join(targetDir(), "release");
const nsis = path.join(release, "bundle/nsis");
const installer = fs.readdirSync(nsis).filter((f) => f.endsWith("-setup.exe"))
  .map((f) => path.join(nsis, f))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
const files = [[path.join(release, "booffer.exe"), "Booffer.exe"], [installer, path.basename(installer)]];

// A running exe can't be overwritten on Windows, but it can be renamed out of the way.
function copy(from, to) {
  const old = to.replace(/\.exe$/, ".old.exe");
  try { fs.rmSync(old, { force: true }); } catch {}
  try {
    fs.copyFileSync(from, to);
  } catch (e) {
    if (e.code !== "EBUSY" && e.code !== "EPERM") throw e;
    fs.renameSync(to, old);
    fs.copyFileSync(from, to);
  }
  // Keep the build's date: Booffer compares exe dates to replace an older running copy.
  const { atime, mtime } = fs.statSync(from);
  fs.utimesSync(to, atime, mtime);
}

for (const dir of destinations) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [from, name] of files) copy(from, path.join(dir, name));
  console.log(`✔ ${path.relative(root, dir) || "."} ← Booffer.exe, ${path.basename(installer)}`);
}

// The new exe closes any older Booffer still running when it starts.
spawn(path.join(root, "Booffer.exe"), { detached: true, stdio: "ignore" }).unref();
console.log("✔ Booffer relancé (dernière version)");
