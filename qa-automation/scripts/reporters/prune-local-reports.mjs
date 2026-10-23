#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeReportHistory } from "./root-summary-reporter.mjs";

const SAFE_RUN_ID = /^[A-Za-z0-9._:-]+$/;

export function markRunArchived(channelRoot, runId) {
  if (!SAFE_RUN_ID.test(runId)) throw new Error("Invalid run ID.");
  const runDir = path.join(path.resolve(channelRoot), "runs", runId);
  const summary = JSON.parse(fs.readFileSync(path.join(runDir, "summary.json"), "utf8"));
  if (summary.runId !== runId) throw new Error("Run ID does not match its report.");
  fs.writeFileSync(path.join(runDir, ".archive-complete"), `${new Date().toISOString()}\n`);
}

export function pruneLocalReports(channelRoot, keep = 5) {
  if (!Number.isInteger(keep) || keep < 1) throw new Error("Keep count must be a positive integer.");
  const root = path.resolve(channelRoot);
  const runsRoot = path.join(root, "runs");
  const runs = fs.readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SAFE_RUN_ID.test(entry.name))
    .flatMap((entry) => {
      const runDir = path.join(runsRoot, entry.name);
      return fs.existsSync(path.join(runDir, "summary.json")) ? [{ id: entry.name, runDir }] : [];
    })
    .sort((left, right) => right.id.localeCompare(left.id));

  const removed = [];
  for (const run of runs.slice(keep)) {
    if (!fs.existsSync(path.join(run.runDir, ".archive-complete"))) continue;
    fs.rmSync(run.runDir, { recursive: true });
    removed.push(run.id);
  }
  writeReportHistory(root, "summary.html");
  return removed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, channelRoot, value] = process.argv.slice(2);
  try {
    if (action === "--mark") markRunArchived(channelRoot, value);
    else if (action === "--prune") {
      const keep = Number(value || 5);
      console.log(`Removed ${pruneLocalReports(channelRoot, keep).length} archived HTML report(s).`);
    } else throw new Error("Usage: prune-local-reports.mjs <--mark|--prune> <channel-root> [run-id|keep-count]");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
