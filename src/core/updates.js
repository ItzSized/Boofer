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
