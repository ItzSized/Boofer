/**
 * Theme from the settings: "auto" follows Windows' app mode, or force "light" / "dark".
 * Tailwind's `dark:` variant reads <html data-theme="dark">.
 */
const systemDark = matchMedia("(prefers-color-scheme: dark)");
let mode = "auto";

function apply() {
  const dark = mode === "dark" || (mode === "auto" && systemDark.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

systemDark.addEventListener("change", apply);

export function setTheme(next) {
  mode = next ?? "auto";
  apply();
}

apply();
