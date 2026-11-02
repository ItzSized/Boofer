// Updates from the GitHub releases (tauri-plugin-updater): the signed installer of the latest
// version is downloaded and installed over this one, then Booffer restarts. Nothing to uninstall.

/** The available update, or null when Booffer is up to date. Throws when offline. */
export async function findUpdate() {
  const { check } = await import("@tauri-apps/plugin-updater");
  return check();
}

/** Downloads and installs `update`, then restarts. `onProgress(0…1 | null)` while downloading. */
export async function installUpdate(update, onProgress = () => {}) {
  let total = 0;
  let received = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") total = event.data.contentLength ?? 0;
    if (event.event === "Progress") {
      received += event.data.chunkLength;
      onProgress(total ? Math.min(1, received / total) : null);
    }
    if (event.event === "Finished") onProgress(1);
  });
  // On Windows the installer closes Booffer and opens the new version itself; elsewhere, restart.
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
