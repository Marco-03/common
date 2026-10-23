import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { markRunArchived, pruneLocalReports } from "./prune-local-reports.mjs";

test("local retention removes only archived runs after the fifth and keeps current downloads", () => {
  const channelRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qa-archive-retention-"));
  try {
    for (let day = 1; day <= 6; day += 1) {
      const runId = `2026-10-${String(day).padStart(2, "0")}T02-00-00-000Z`;
      const runDir = path.join(channelRoot, "runs", runId);
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify({ runId, startedAt: `2026-10-${String(day).padStart(2, "0")}T02:00:00Z`, counts: { total: 1 } }));
      fs.writeFileSync(path.join(runDir, "summary.html"), "HTML remains local");
      fs.writeFileSync(path.join(runDir, "catalog-results.json"), "{}");
      fs.writeFileSync(path.join(runDir, "results.csv"), "run_id\n");
      fs.writeFileSync(path.join(runDir, "finding-results.csv"), "run_id\n");
      if (day !== 1) markRunArchived(channelRoot, runId);
    }
    assert.deepEqual(pruneLocalReports(channelRoot, 5), []);
    const oldest = "2026-10-01T02-00-00-000Z";
    markRunArchived(channelRoot, oldest);
    assert.deepEqual(pruneLocalReports(channelRoot, 5), [oldest]);
    assert.equal(fs.existsSync(path.join(channelRoot, "runs", oldest)), false);
    assert.equal(fs.existsSync(path.join(channelRoot, "runs", "2026-10-06T02-00-00-000Z", "summary.html")), true);
    assert.equal(fs.existsSync(path.join(channelRoot, "runs", "2026-10-06T02-00-00-000Z", "catalog-results.json")), true);
  } finally { fs.rmSync(channelRoot, { recursive: true, force: true }); }
});
