/** 45 s · 2 min 05 */
export function duration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(s % 60).padStart(2, "0")}`;
}

/** 850 KB · 36 MB · 5.2 GB, counted like Windows Explorer (1 MB = 1024 KB). */
export function fileSize(bytes) {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/** What a chat and its project weigh: "this chat 129 MB · project 762 MB (3 chats)". */
export function diskLabel({ chatBytes, projectBytes, chats }) {
  return `this chat ${fileSize(chatBytes)} · project ${fileSize(projectBytes)} (${chats} chat${chats === 1 ? "" : "s"})`;
}

/** Version strings: is `a` newer than `b`? ("0.2.0" vs "0.1.0") */
export function isNewer(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

/** A time later today or tomorrow: "15:30", "tomorrow 08:00". */
export function clockTime(ms, now = Date.now()) {
  const d = new Date(ms);
  const hhmm = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date(now).toDateString() ? hhmm : `tomorrow ${hhmm}`;
}

/** Rough remaining time: "≈ 40 s", "≈ 3 min". */
export function approx(ms) {
  const s = Math.max(5, Math.round(ms / 1000));
  if (s < 60) return `≈ ${Math.round(s / 5) * 5} s`;
  return `≈ ${Math.round(s / 60)} min`;
}
