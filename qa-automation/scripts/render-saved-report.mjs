import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { writeSummaryFiles, replaceLatestReportWithRun, writeReportHistory } from "./reporters/root-summary-reporter.mjs";
import { locationOnlyExport } from "./reporters/source-quality-presentation.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const zeroCounts = () => ({ total: 0, passed: 0, failed: 0, skipped: 0, timedOut: 0, interrupted: 0, unexpected: 0, flaky: 0 });
const digest = (value) => createHash("sha256").update(value).digest("hex");

export function exportToSummary(data) {
  if (![1, 2].includes(data?.schemaVersion) || !data.run || !Array.isArray(data.items)) {
    throw new Error("Expected a complete schema-v1/v2 report.json with run and items, not a partial PAR export.");
  }
  if (!safeId.test(String(data.run.id || "")) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(data.run.id) || /[.]$/.test(data.run.id)) {
    throw new Error("Invalid archive run ID.");
  }
  const sections = new Map();
  const failures = [];
  const keys = new Set();
  const catalogItems = data.items.map((item) => {
    if (!item || !Array.isArray(item.issues) || !Array.isArray(item.checks)) throw new Error("Each item must contain issues and checks arrays.");
    const catalogItem = { ...(item.catalog || {}), type: item.type || item.catalog?.type || "workshop",
      id: String(item.livelabsId || item.catalog?.id || ""), title: item.title || item.catalog?.title || "",
      absolute_url: item.catalogUrl || item.catalog?.absolute_url || "" };
    const key = item.key || `${catalogItem.type}:${catalogItem.id}`;
    if (keys.has(key)) throw new Error(`Duplicate archived item key: ${key}`);
    keys.add(key);
    const tests = item.checks.map((check) => ({ ...check,
      title: check.title || check.section || "Archived check",
      titlePath: check.titlePath || [check.section || "Archived checks", check.title || "Archived check"],
      errors: check.errors || [], attachments: [], catalogItem,
      classification: check.classification || { code: check.status === "passed" ? "PASSED" : "UNKNOWN" } }));
    for (const test of tests) {
      const name = test.section || "Archived checks";
      if (!sections.has(name)) sections.set(name, { name, ...zeroCounts(), tests: [] });
      const section = sections.get(name);
      section.total += 1;
      if (Object.hasOwn(section, test.status)) section[test.status] += 1;
      if (test.status !== test.expectedStatus && test.status !== "skipped") section.unexpected += 1;
      section.tests.push(test);
    }
    for (const evidence of item.evidence || []) failures.push({ ...evidence, catalogItem,
      titlePath: evidence.titlePath || [evidence.section || "Archived evidence", evidence.title || "Archived check"],
      classification: evidence.classification || { code: "UNKNOWN", label: "Archived evidence" }, errors: evidence.errors || [], attachments: [] });
    return { key, keys: [key], catalogItem, status: item.status, completionState: item.completionState,
      counts: { ...zeroCounts(), ...(item.counts || {}) }, sections: item.sections || [],
      authorNames: item.authorNames || [], authorEmails: item.authorEmails || [], issues: item.issues, tests, issueCount: item.issues.length };
  });
  const categories = new Map();
  for (const item of catalogItems) for (const issue of item.issues) {
    const category = categories.get(issue.code) || { code: issue.code, label: issue.label || issue.code, count: 0 };
    category.count += 1;
    categories.set(issue.code, category);
  }
  return { runId: data.run.id, runType: data.run.type || "regression", reportChannel: data.run.type === "retest" ? "retest" : "regression",
    status: data.run.status, scope: data.run.scope || { label: "Imported archived run" }, completion: data.run.completion || { state: "unknown" },
    startedAt: data.run.startedAt, endedAt: data.run.endedAt, durationMs: data.run.durationMs || 0,
    configuredTests: data.run.configuredTests ?? catalogItems.reduce((n, item) => n + item.tests.length, 0),
    counts: { ...zeroCounts(), ...(data.run.counts || {}) }, failureCategories: data.run.failureCategories || [...categories.values()],
    sections: [...sections.values()], failures, catalogItems, presentation: data.presentation,
    archiveImport: { schemaVersion: data.schemaVersion, originalRunId: data.run.id, binaryEvidenceIncluded: false,
      ...(data.run.reportRevision ? { reportRevision: data.run.reportRevision } : {}) } };
}

export async function renderSavedReport(input, reportsBase, { promote = false, replaceImport = false } = {}) {
  const bytes = fs.readFileSync(input);
  const parsed = JSON.parse(bytes);
  exportToSummary(parsed);
  const data = locationOnlyExport(parsed);
  const summary = exportToSummary(data);
  const channelRoot = path.resolve(reportsBase, summary.reportChannel);
  const output = path.join(channelRoot, "runs", summary.runId);
  // Include shared assets in the fingerprint so UI-only updates can be rerendered.
  const rendererHash = digest(["reporters/root-summary-reporter.mjs", "reporters/par-link-report.mjs", "reporters/source-quality-presentation.mjs", "hub-ui.css", "hub-client.js"]
    .map((file) => fs.readFileSync(path.join(root, file))).map(digest).join("\n"));
  const sha256 = digest(bytes);
  let previous;
  if (fs.existsSync(output)) {
    const metadata = path.join(output, "archive-import.json");
    if (fs.lstatSync(output).isSymbolicLink() || !fs.existsSync(metadata)) throw new Error("Existing run is not a JSON import; nothing was overwritten.");
    previous = JSON.parse(fs.readFileSync(metadata, "utf8"));
    if (previous.sha256 !== sha256 || previous.rendererHash !== rendererHash) {
      if (!replaceImport || !/^[a-f0-9]{64}$/.test(previous.sha256 || "")) throw new Error("Import differs. Use --replace-import to back up and replace it.");
    } else {
      promoteIfLatest(channelRoot, output, summary, promote);
      writeReportHistory(channelRoot, "summary.html");
      return { output, runId: summary.runId, unchanged: true };
    }
  }
  fs.mkdirSync(channelRoot, { recursive: true });
  const staging = fs.mkdtempSync(path.join(channelRoot, ".import-"));
  let backup;
  try {
    writeSummaryFiles(staging, summary, channelRoot);
    fs.writeFileSync(path.join(staging, "catalog-results.json"), JSON.stringify(data, null, 2) + "\n");
    fs.writeFileSync(path.join(staging, "archive-import.json"), JSON.stringify({ sha256, rendererHash, schemaVersion: data.schemaVersion, binaryEvidenceIncluded: false }, null, 2));
    for (const file of ["summary.html", "retest-list.html"]) {
      const target = path.join(staging, file);
      const revision = data.run.reportRevision;
      const revisionNote = revision ? ` Corrected export ${String(revision.correctedAt || "").replace(/[^0-9TZ:.+-]/g, "")}; ${Number(revision.removedFindingCount) || 0} technical-identifier false positives removed. Original run date retained.` : "";
      const banner = `<aside role="note" style="padding:12px 24px;border-bottom:1px solid #ccc">Archived run ${summary.runId}. Imported from JSON; no new checks executed.${revisionNote} Screenshot and trace files are not included.</aside>`;
      fs.writeFileSync(target, fs.readFileSync(target, "utf8").replace(/<body([^>]*)>/, `<body$1>${banner}`));
    }
    fs.mkdirSync(path.dirname(output), { recursive: true });
    if (previous) {
      const backupRoot = path.join(channelRoot, ".archive-import-backups");
      fs.mkdirSync(backupRoot, { recursive: true });
      backup = path.join(backupRoot, `${summary.runId}-${previous.sha256.slice(0, 12)}-${Date.now()}`);
      fs.renameSync(output, backup);
    }
    try { fs.renameSync(staging, output); }
    catch (error) { if (backup && !fs.existsSync(output)) fs.renameSync(backup, output); throw error; }
  } finally { if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true }); }
  promoteIfLatest(channelRoot, output, summary, promote);
  writeReportHistory(channelRoot, "summary.html");
  return { output, runId: summary.runId, items: summary.catalogItems.length, backup, unchanged: false };
}

function promoteIfLatest(channelRoot, output, summary, promote) {
  const latest = path.join(channelRoot, "latest/summary.json");
  const previous = fs.existsSync(latest) ? JSON.parse(fs.readFileSync(latest, "utf8")) : null;
  if (promote && (!previous || Date.parse(summary.startedAt) >= Date.parse(previous.startedAt))) replaceLatestReportWithRun(channelRoot, output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, reportsBase, ...options] = process.argv.slice(2);
  if (!input || !reportsBase || options.some((option) => !["--promote", "--replace-import"].includes(option))) {
    console.error("Usage: node scripts/render-saved-report.mjs <report.json> <output-directory> [--promote] [--replace-import]");
    process.exitCode = 2;
  } else {
    try { console.log(JSON.stringify(await renderSavedReport(input, reportsBase, { promote: options.includes("--promote"), replaceImport: options.includes("--replace-import") }), null, 2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
