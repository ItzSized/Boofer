// Updates from the GitHub releases (src-tauri/src/updates.rs): a newer version, or a newer build
// of the same version (new features pushed without changing the number). The signed installer is
// downloaded and installed over this one, then Boofer restarts. Nothing to uninstall.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** { version, rebuild, build } when there is something to install, null when up to date. Throws when offline. */
export function findUpdate() {
  return invoke("update_check");
}

/** Installs the update found by findUpdate, then restarts. `onProgress(0…1 | null)` while downloading. */
export async function installUpdate(_update, onProgress = () => {}) {
  const stop = await listen("update-progress", ({ payload }) => onProgress(payload));
  try {
    await invoke("update_install");
    onProgress(1);
  } finally {
    stop();
  }
}

const RUNS = "https://api.github.com/repos/ItzSized/Boofer/actions/workflows/release.yml/runs?branch=main&event=push&per_page=10";

/**
 * The build GitHub is making right now for a newer commit than `mine`, or null.
 * { sha, title, startedAt, expectedMs }: expectedMs is the usual length of a build (median of the
 * last successful ones). Throws when offline or rate-limited (60 calls an hour without a login).
 */
export async function buildInProgress(mine) {
  const res = await fetch(RUNS, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const { workflow_runs: runs = [] } = await res.json();
  const running = runs.find((r) => r.status !== "completed");
  if (!running || running.head_sha === mine) return null;
  const lengths = runs
    .filter((r) => r.conclusion === "success")
    .map((r) => Date.parse(r.updated_at) - Date.parse(r.run_started_at))
    .filter((ms) => ms > 0)
    .sort((a, b) => a - b);
  return {
    sha: running.head_sha,
    title: running.display_title ?? running.head_commit?.message?.split("\n")[0] ?? "",
    startedAt: Date.parse(running.run_started_at ?? running.created_at),
    expectedMs: lengths.length ? lengths[Math.floor(lengths.length / 2)] : 5 * 60_000,
  };
}
