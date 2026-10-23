import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { archiveObjectUrl } from "./report-archive.mjs";
import { createHub } from "./hub-server.mjs";
import { markRunArchived, pruneLocalReports } from "./reporters/prune-local-reports.mjs";

const bucket = { namespace: "example", bucket: "archive", prefix: "livelabs-qa" };

test("download reads the named object through the private server without exposing the PAR", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qa-archive-gateway-"));
  const parFile = path.join(directory, "par");
  fs.writeFileSync(parFile, "https://objectstorage.us-ashburn-1.oraclecloud.com/p/private-token/n/example/b/archive/o/\n");
  const archive = { ...bucket, parFile };
  const target = archiveObjectUrl({ ...archive, channel: "regression", runId: "2026-10-23T02-00-00-000Z", filename: "catalog-results.json" });
  const server = createHub({ directory, archive, archiveFetcher: async (url) => {
    assert.equal(url, target);
    return new Response('{"items":[]}', { status: 200 });
  } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/api/hub/download/regression/2026-10-23T02-00-00-000Z/catalog-results.json`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"items":[]}');
    assert.match(response.headers.get("content-disposition"), /attachment/);
    assert.equal((await fetch(`${base}/api/hub/download/regression/..%2Fbad/catalog-results.json`)).status, 404);
    assert.ok(!JSON.stringify([...response.headers]).includes("private-token"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("local HTML retention removes only archived runs after the fifth", () => {
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
    assert.equal(fs.existsSync(path.join(channelRoot, "runs", "2026-10-06T02-00-00-000Z", "catalog-results.json")), false);
  } finally { fs.rmSync(channelRoot, { recursive: true, force: true }); }
});

test("archive URL rejects arbitrary objects and invalid private endpoints", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qa-archive-url-"));
  const parFile = path.join(directory, "par");
  try {
    fs.writeFileSync(parFile, "https://evil.example/p/token/n/example/b/archive/o/");
    assert.throws(() => archiveObjectUrl({ ...bucket, parFile, channel: "regression", runId: "run-1", filename: "results.csv" }), /Invalid private/);
    assert.throws(() => archiveObjectUrl({ ...bucket, parFile, channel: "regression", runId: "../bad", filename: "results.csv" }), /Invalid report/);
    assert.throws(() => archiveObjectUrl({ ...bucket, parFile, channel: "regression", runId: "run-1", filename: "summary.html" }), /Invalid report/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
