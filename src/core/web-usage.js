/**
 * Answers from AI chats in the browser (web.rs), counted here since no file on the PC
 * records them: one row per day, site and model, in the same shape as `model_usage` rows.
 * Tokens are estimates (≈ 4 characters each). Shared by the ghost and the settings window.
 */
import { localDay } from "./models.js";

const KEY = "booffer.webUsage";
const KEEP_DAYS = 120;

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

/** @param {{ tool: string, model: string, input: number, output: number }} answer */
export function recordWebAnswer(answer) {
  const day = localDay(0);
  const rows = load().filter((r) => r.day >= localDay(KEEP_DAYS));
  let row = rows.find((r) => r.day === day && r.tool === answer.tool && r.model === answer.model);
  if (!row) rows.push((row = { tool: answer.tool, model: answer.model, day, calls: 0, input: 0, output: 0 }));
  row.calls += 1;
  row.input += answer.input;
  row.output += answer.output;
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    // storage full or blocked: this answer just isn't counted
  }
}

/** `model_usage` rows plus the browser's. */
export const withWebUsage = (rows) => [...(rows ?? []), ...load()];
