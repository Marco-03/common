import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { exportToSummary, renderSavedReport } from "./render-saved-report.mjs";
import { resultsJson } from "./reporters/root-summary-reporter.mjs";
import { locationOnlyExport } from "./reporters/source-quality-presentation.mjs";

const fixture = () => ({ schemaVersion: 2,
  run: { id: "2026-01-01T02-00-00-000Z", startedAt: "2026-01-01T02:00:00.000Z", type: "regression", status: "failed", counts: { total: 1, failed: 1 },
    reportRevision: { correctedAt: "2026-02-01T12:00:00.000Z", newChecksExecuted: false } },
  items: [{ key: "workshop:42", type: "workshop", livelabsId: "42", title: "Example", status: "failed", catalogUrl: "https://example.test/workshop/42",
    issues: [{ code: "MARKDOWN_FORMATTING", label: "Markdown formatting", file: "source.spec.ts", section: "Source",
      findingCount: 1, action: "Apply correction", priority: "P2", audience: "external",
      details: [{ label: "Space after opening **", marker: "**", text: "Use **Correct** then ** Wrong**.", highlightText: "** Wrong**",
        sourceLine: 65, pageUrl: "https://example.test/workshop?lab=sample", sourceFileUrl: "https://example.test/lab.md", labTitle: "Sample lab",
        suggestion: "Remove the space", correctedText: "Use **Correct** then **Wrong**." }] }],
    checks: [{ title: "Check source", file: "source.spec.ts", section: "Source", status: "failed", expectedStatus: "passed", classification: { code: "MARKDOWN_FORMATTING" } }],
    evidence: [{ title: "Check source", file: "source.spec.ts", section: "Source", classification: { code: "MARKDOWN_FORMATTING" },
      errors: ["Old correction advice"], steps: [{ error: "Old correction advice" }], bugSummary: "Old correction advice", attachments: [{ path: "missing.png" }] }] }] });

test("validates input identity and preserves data while dropping unavailable attachment paths", () => {
  const data = fixture();
  const summary = exportToSummary(data);
  assert.deepEqual(summary.catalogItems[0].issues, data.items[0].issues);
  assert.equal(summary.catalogItems[0].catalogItem.id, "42");
  assert.deepEqual(summary.failures[0].attachments, []);
  assert.deepEqual(summary.archiveImport.reportRevision, data.run.reportRevision);
  for (const id of ["../outside", "C:outside", "NUL", "A.", "x/y", "<script>"]) {
    assert.throws(() => exportToSummary({ ...data, run: { ...data.run, id } }), /Invalid archive run ID/);
  }
  assert.throws(() => exportToSummary({ ...data, items: [...data.items, ...data.items] }), /Duplicate/);
  assert.throws(() => exportToSummary({ schemaVersion: 42 }), /complete schema/);
});

test("location-only exports retain evidence locations and priorities but omit advice", () => {
  const data = fixture();
  data.items[0].issues.push({ code: "BROKEN_VISIBLE_LINK", priority: "P1", action: "Replace URL", details: [{ href: "https://example.test/missing" }] });
  const clean = locationOnlyExport(data);
  assert.deepEqual(clean.items[0].issues[1], data.items[0].issues[1]);
  assert.equal(clean.items[0].issues[0].details[0].sourceLine, 65);
  assert.doesNotMatch(JSON.stringify(clean.items[0].issues[0]), /"suggestion"|"correctedText"|"action"/);
  assert.doesNotMatch(JSON.stringify(clean.items[0].evidence), /Old correction advice/);
  assert.deepEqual(locationOnlyExport(clean), clean);
  const fresh = JSON.parse(resultsJson(exportToSummary(data)));
  assert.equal(fresh.presentation.sourceQuality.showReplacement, false);
  assert.doesNotMatch(JSON.stringify(fresh.items[0].issues[0]), /"suggestion"|"correctedText"|"action"/);
});

test("renders a standalone report, promotes unchanged imports, and safely backs up replacements", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qa-export-import-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, "report.json");
  const reports = path.join(directory, "reports");
  const data = fixture();
  fs.writeFileSync(input, JSON.stringify(data));
  const first = await renderSavedReport(input, reports);
  assert.equal(fs.existsSync(path.join(reports, "regression/latest/summary.html")), false);
  const html = fs.readFileSync(path.join(first.output, "summary.html"), "utf8");
  assert.match(html, /Imported from JSON; no new checks executed/);
  assert.match(html, /<mark>\*\* Wrong\*\*<\/mark>/);
  assert.doesNotMatch(html, /<span>Replace with<\/span>|<p class="source-quality-fix">/);
  assert.match(html, /https:\/\/example.test\/workshop/);
  for (const file of ["hub-ui.css", "hub-client.js", "catalog-results.json", "results.csv"]) assert.ok(fs.statSync(path.join(first.output, file)).size > 0);
  const exported = JSON.parse(fs.readFileSync(path.join(first.output, "catalog-results.json"), "utf8"));
  assert.deepEqual(exported.run.reportRevision, data.run.reportRevision);
  assert.equal(exported.presentation.sourceQuality.mode, "location-only");
  assert.equal((await renderSavedReport(input, reports, { promote: true })).unchanged, true);
  assert.ok(fs.existsSync(path.join(reports, "regression/latest/summary.html")));
  data.items[0].title = "New export of same run";
  fs.writeFileSync(input, JSON.stringify(data));
  await assert.rejects(renderSavedReport(input, reports), /replace-import/);
  const replacement = await renderSavedReport(input, reports, { replaceImport: true, promote: true });
  assert.equal(fs.readFileSync(path.join(replacement.backup, "summary.html"), "utf8"), html);
  assert.match(fs.readFileSync(path.join(replacement.output, "summary.html"), "utf8"), /New export of same run/);
  fs.unlinkSync(path.join(replacement.output, "archive-import.json"));
  await assert.rejects(renderSavedReport(input, reports, { replaceImport: true }), /not a JSON import/);
});
