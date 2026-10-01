import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHub } from "./hub-server.mjs";
import { retestArguments } from "./run-retest.mjs";

test("shared list persists, rejects cross-origin writes, and previews do not call Jenkins", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qa-hub-test-"));
  const server = createHub({ directory, preview: true, fetcher: () => { throw new Error("Must not call Jenkins in preview"); } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body, headers = {}) => fetch(base + url, { method: "POST", headers: { "Content-Type": "application/json", "X-QA-Hub": "1", ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await post("/api/hub/list", { operations: [] }, { Origin: "https://other.test" })).status, 403);
    const entry = { testId: "run:workshop:1", itemId: "1" };
    assert.equal((await post("/api/hub/list", { operations: [{ id: entry.testId, entry }] })).status, 200);
    assert.deepEqual((await (await fetch(base + "/api/hub/list")).json()).retest[entry.testId], entry);
    const run = await (await post("/api/hub/retest", { tests: [entry] })).json();
    assert.equal(run.preview, true);
    assert.equal(run.count, 1);
    const runs = await (await fetch(base + "/api/hub/runs")).json();
    assert.match(runs[0].status, /no scan executed/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "state.json"))).runs.length, 1);
  } finally { await new Promise((resolve) => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); }
});

test("retest selection cannot execute arbitrary files and anchors exact titles", () => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
  assert.throws(() => retestArguments(encode([{ testPath: "../../bad.js", testName: "x" }])));
  const args = retestArguments(encode([{ testPath: "tests/platform/generated/workshopOverview.generated.spec.ts", testName: "checks workshop (12)" }]));
  assert.equal(args[0], "tests/platform/generated/workshopOverview.generated.spec.ts");
  const regex = new RegExp(args[2]);
  assert.ok(regex.test("chromium tests/platform/generated/workshopOverview.generated.spec.ts checks workshop (12)"));
  assert.ok(regex.test("chromium tests/platform/generated/workshopOverview.generated.spec.ts checks workshop (12) @generated @workshop"));
  assert.ok(!regex.test("chromium tests/platform/generated/workshopOverview.generated.spec.ts checks workshop (123)"));
});

test("production submits saved checks, not browser-supplied test commands", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qa-hub-live-test-"));
  const previousSecret = process.env.QA_JENKINS_SECRET_FILE;
  process.env.QA_JENKINS_SECRET_FILE = path.join(directory, "secret");
  fs.writeFileSync(process.env.QA_JENKINS_SECRET_FILE, "test-only-password");
  const reports = path.join(directory, "reports");
  const source = path.join(reports, "regression/runs/source-run");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "summary.json"), JSON.stringify({ catalogItems: [{ catalogItem: { id: "22", type: "livestack" }, tests: [{ file: "tests/platform/generated/livestackResources.generated.spec.ts", title: "Saved exact check" }] }] }));
  const calls = [];
  const server = createHub({ directory, reports, jenkins: "http://jenkins.test/jenkins", fetcher: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("crumbIssuer/api/json")) return new Response(JSON.stringify({ crumbRequestField: "Jenkins-Crumb", crumb: "test-crumb" }), { headers: { "Set-Cookie": "JSESSIONID=test; Path=/jenkins" } });
    return new Response(null, { status: 201, headers: { Location: "http://jenkins.test/jenkins/queue/item/42/" } });
  } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/hub/retest`, { method: "POST", headers: { "Content-Type": "application/json", "X-QA-Hub": "1" }, body: JSON.stringify({ tests: [{ executionId: "source-run", itemId: "22", itemType: "livestack", checks: [{ testPath: "evil.sh" }] }] }) });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).queue, 42);
    assert.equal(calls[1].options.headers["Jenkins-Crumb"], "test-crumb");
    assert.match(calls[1].options.headers.cookie, /JSESSIONID=test/);
    const params = calls[1].options.body;
    assert.equal(params.get("CONTENT_LINK_LIMIT"), "0");
    assert.deepEqual(JSON.parse(Buffer.from(params.get("RETEST_SELECTION"), "base64")), [{ testPath: "tests/platform/generated/livestackResources.generated.spec.ts", testName: "Saved exact check" }]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousSecret === undefined) delete process.env.QA_JENKINS_SECRET_FILE; else process.env.QA_JENKINS_SECRET_FILE = previousSecret;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
