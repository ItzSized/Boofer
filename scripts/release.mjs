// npm run release: builds Boofer, then puts the fresh exe at the root of the project and in
// !_EXE_ET_INSTALLEUR, so the copy you double-click is always the latest, and relaunches it.
// Fast by default: exe only, incremental compile (the installers are built by GitHub on push).
//   npm run release -- --installer   also builds the .msi / setup.exe locally
//   npm run release -- --copy        skips the build and only copies the last one
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destinations = [root, path.join(root, "!_EXE_ET_INSTALLEUR")];

const withInstaller = process.argv.includes("--installer");
if (!process.argv.includes("--copy")) {
  // The update signature needs the private key, which only GitHub has: local installers go without.
  execSync(`npm run tauri build -- ${withInstaller ? "--config scripts/local-build.json" : "--no-bundle"}`, {
    cwd: root,
    stdio: "inherit",
    // Only rebuilds what changed; same optimizations otherwise.
    env: { ...process.env, CARGO_PROFILE_RELEASE_INCREMENTAL: "true" },
  });
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
// Only this version's installers: the bundle folders keep the old ones.
const { version } = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
const bundles = [path.join(release, "bundle/nsis"), path.join(release, "bundle/msi")];
const installers = withInstaller
  ? bundles.filter((dir) => fs.existsSync(dir)).flatMap((dir) =>
    fs.readdirSync(dir).filter((f) => /(-setup\.exe|\.msi)$/.test(f) && f.includes(`_${version}_`)).map((f) => path.join(dir, f)))
  : [];
const files = [[path.join(release, "boofer.exe"), "Boofer.exe"], ...installers.map((f) => [f, path.basename(f)])];

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
  // Keep the build's date: Boofer compares exe dates to replace an older running copy.
  const { atime, mtime } = fs.statSync(from);
  fs.utimesSync(to, atime, mtime);
}

for (const dir of destinations) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [from, name] of files) copy(from, path.join(dir, name));
  console.log(`✔ ${path.relative(root, dir) || "."} ← ${files.map(([, name]) => name).join(", ")}`);
}

// The new exe closes any older Boofer still running when it starts.
spawn(path.join(root, "Boofer.exe"), { detached: true, stdio: "ignore" }).unref();
console.log("✔ Boofer relancé (dernière version)");
