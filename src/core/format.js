/** 45 s · 2 min 05 */
export function duration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(s % 60).padStart(2, "0")}`;
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

/** Rough remaining time: « ≈ 40 s », « ≈ 3 min ». */
export function approx(ms) {
  const s = Math.max(5, Math.round(ms / 1000));
  if (s < 60) return `≈ ${Math.round(s / 5) * 5} s`;
  return `≈ ${Math.round(s / 60)} min`;
}
