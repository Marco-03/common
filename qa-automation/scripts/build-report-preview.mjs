#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeSummaryFiles, reportHistoryPageHtml } from "./reporters/root-summary-reporter.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectRoot, "artifacts", "full-report-preview");
const previewBaseUrl = process.env.QA_PREVIEW_BASE_URL || "http://127.0.0.1:4175";
const workshopUrl = (id) => `https://livelabs.oracle.com/ords/r/dbpm/livelabs/view-workshop?wid=${id}&clear=RR`;
const liveStackUrl = (id) =>
  `https://livelabs.oracle.com/ords/r/dbpm/livelabs/livestack-landing-page?p400_id=${id}&clear=RR`;

function check(section, status = "passed", code = "PASSED", finalUrl = "") {
  return {
    title: section,
    section,
    status,
    expectedStatus: "passed",
    durationMs: 18_000,
    finalUrl,
    finalTitle: section,
    classification: { code, label: code === "PASSED" ? "Passed" : code },
    file: "tests/platform/generated/fullReportPreview.generated.spec.ts",
    line: 1,
  };
}

function item({ id, title, type = "workshop", issues = [], sections = ["Generated Workshop Overview"] }) {
  const failed = issues.length > 0;
  const url = type === "livestack" ? liveStackUrl(id) : workshopUrl(id);
  return {
    key: `${type}:${id}`,
    status: failed ? "failed" : "passed",
    issueCount: issues.length,
    counts: { total: sections.length, passed: sections.length - (failed ? 1 : 0), failed: failed ? 1 : 0, unexpected: failed ? 1 : 0 },
    sections,
    authorNames: [],
    catalogItem: { type, id: String(id), title, absolute_url: url, normalized_href: url },
    issues,
    tests: sections.map((section, index) =>
      check(
        section,
        failed && index === 0 ? "failed" : "passed",
        failed && index === 0 ? issues[0].code : "PASSED",
        url,
      ),
    ),
  };
}

const catalogItems = [
  item({
    id: 4005,
    title: "Access protected applications with Oracle Universal Authenticator",
    issues: [{
      code: "WORKSHOP_NOT_AVAILABLE",
      label: "Workshop not available",
      severity: "blocker",
      message: "The published LiveLabs catalog item does not reach an available workshop page.",
      section: "Generated Workshop Overview",
    }],
  }),
  item({
    id: 877,
    title: "Access the Data Lake using Autonomous Database and Data Catalog",
    sections: ["Catalog PAR Links"],
    issues: [{
      code: "STALE_PAR_LINK",
      label: "Stale PAR link",
      severity: "major",
      message: "One PAR link returned HTTP 404.",
      section: "Catalog PAR Links",
      details: [{
        status: "broken",
        object_name: "moviestream_sandbox",
        bucket: "moviestream_sandbox",
        namespace: "demo",
        region: "us-ashburn-1",
        http_status: 404,
        masked_url: "https://objectstorage.us-ashburn-1.oraclecloud.com/p/***/n/demo/b/moviestream_sandbox/o/",
        fingerprint: "0123456789abcdef",
        sources: [{
          label: "Preview instructions: Lab 2: Harvest Metadata from Oracle Object Storage",
          labNumber: 2,
          pageUrl: workshopUrl(877),
          section: "Add a connection to the moviestream_sandbox bucket",
          instruction: "2. Enter the Object Storage bucket connection details.",
          sourceLine: 612,
        }],
      }],
    }],
  }),
  item({
    id: 848,
    title: "Build a Starter Online Shopping App using Oracle APEX!",
    sections: ["Catalog PAR Links"],
    issues: [{
      code: "PAR_SCAN_INCOMPLETE",
      label: "PAR scan incomplete",
      severity: "major",
      message: "The Getting Started source page returned HTTP 404.",
      section: "Catalog PAR Links",
      details: [{
        page_type: "workshop-preview-source",
        label: "Preview instructions: Getting Started",
        pageUrl: workshopUrl(848),
        source_file_url: "https://oracle-livelabs.github.io/common/labs/getting-started.md",
        error: "Workshop source returned HTTP 404.",
      }],
    }],
  }),
  item({ id: 3947, title: "Build an Innovative Q&A Interface Powered by Generative AI with Oracle APEX" }),
  item({ id: 931, title: "AI Services: Introduction to OCI Vision" }),
  item({ id: 22, type: "livestack", title: "Build Energy & Utilities Intelligence on One Governed Oracle Data Platform" }),
  item({ id: 901, title: "Load and update MovieStream data in Oracle ADW using Data Studio" }),
  item({ id: 887, title: "The Beginner's Guide to Building Custom Language AI Models" }),
  item({
    id: 3811,
    title: "Build AI-Powered Image Search into your Oracle APEX App",
    sections: ["Catalog PAR Links"],
    issues: [{
      code: "PAR_LINK_UNVERIFIED",
      label: "PAR link unverified",
      severity: "major",
      message: "The PAR endpoint timed out after retries.",
      section: "Catalog PAR Links",
      details: [{
        status: "unverified",
        object_name: "sample-images.zip",
        error: "Request timed out after retries.",
        sources: [{ label: "Lab 2: Import sample images", labNumber: 2, pageUrl: workshopUrl(3811) }],
      }],
    }],
  }),
  item({
    id: "DEMO-SOURCE",
    title: "Preview example: Workshop source quality",
    sections: ["Workshop Source Quality"],
    issues: [{
      code: "MARKDOWN_FORMATTING",
      label: "Markdown formatting",
      severity: "minor",
      message: "One Markdown formatting problem was found.",
      section: "Workshop Source Quality",
      details: [{
        label: "Space before closing **",
        marker: "**",
        text: "**Important: ** Select the compartment.",
        suggestion: "Remove the space immediately before the closing **.",
        location: "Lab 2: Configure the application / Task 2: Import the sample",
        pageUrl: "https://livelabs.oracle.com/cdn/example/workshops/tenancy/index.html?lab=2-configure",
        sourceFileUrl: "https://livelabs.oracle.com/cdn/example/lab-2.md",
        sourceLine: 18,
        labTitle: "Lab 2: Configure the application",
        labNumber: 2,
        section: "Task 2: Import the sample",
      }],
    }, {
      code: "WRITING_GRAMMAR",
      label: "Grammar or punctuation",
      severity: "minor",
      message: "One repeated word was found.",
      section: "Workshop Source Quality",
      details: [{
        label: "Repeated word",
        marker: "to to",
        text: "The status goes from READY to to PENDING to RUNNING to FINISHED.",
        suggestion: "Remove one repeated \"to\".",
        location: "Lab 4: Query Data Access Autonomous Database and the Data Lake / Task 5: Review and Run the Imported Notebook",
        pageUrl: "https://livelabs.oracle.com/cdn/example/workshops/tenancy/index.html?lab=4-query-data-access",
        sourceFileUrl: "https://livelabs.oracle.com/cdn/example/lab-4.md",
        sourceLine: 242,
        labTitle: "Lab 4: Query Data Access Autonomous Database and the Data Lake",
        labNumber: 4,
        section: "Task 5: Review and Run the Imported Notebook",
      }],
    }, {
      code: "POSSIBLE_TYPO",
      label: "Possible typo",
      severity: "minor",
      message: "One word may be misspelled.",
      section: "Workshop Source Quality",
      details: [{
        label: "Possible typo: sentnce",
        marker: "sentnce",
        text: "Enter the sample sentnce.",
        suggestion: "Review \"sentnce\" and replace it with \"sentence\" if that is the intended word.",
        location: "Lab 2: Configure the application / Task 2: Import the sample",
        pageUrl: "https://livelabs.oracle.com/cdn/example/workshops/tenancy/index.html?lab=2-configure",
        sourceFileUrl: "https://livelabs.oracle.com/cdn/example/lab-2.md",
        sourceLine: 32,
        labTitle: "Lab 2: Configure the application",
        labNumber: 2,
        section: "Task 2: Import the sample",
      }],
    }],
  }),
  item({
    id: 101,
    type: "livestack",
    title: "Autonomous AI Lakehouse - The PeakGear LiveStack",
    sections: ["Generated LiveStack Overview"],
    issues: [{
      code: "AUTHENTICATION_REQUIRED",
      label: "QA sign-in required - not tested",
      severity: "minor",
      message: "The QA browser reached Oracle Sign In before it could inspect this LiveStack.",
      section: "Generated LiveStack Overview",
    }],
  }),
  item({ id: 3319, type: "sprint", title: "Oracle Database Developer Sprint", sections: ["Generated Sprint and Event Page"] }),
  item({ id: 88, type: "event", title: "Oracle LiveLabs Community Event", sections: ["Generated Sprint and Event Page"] }),
  ...[
    [648, "Get Started with Oracle Cloud Infrastructure Core Services"],
    [582, "Load and Analyze Your Data with Oracle Autonomous AI Database"],
    [631, "Converting your Spreadsheet into a Cloud App using Oracle APEX"],
    [553, "Manage and Monitor Autonomous AI Database"],
    [722, "Launch Your First MySQL HeatWave Database System"],
    [959, "Oracle Autonomous AI Database 15 Minute Quick Start"],
    [930, "Build a Movies Watchlist Application using Oracle APEX"],
    [925, "Get Started with Oracle Data Safe Fundamentals"],
    [3097, "DB Security - Oracle Audit Vault and Database Firewall"],
    [3925, "AI Vector Search - Using Vector Embedding Models with JDBC"],
    [3890, "Create a user defined REGEX parser in Logging Analytics"],
    [1030, "How can I use Oracle LiveLabs?"],
    [4242, "Machine Learning on Autonomous AI Database"],
    [3794, "Build the Perfect Digital Assistant for Your Business"],
  ].map(([id, title]) => item({ id, title })),
];

catalogItems.push(item({ id: 99990, title: "Preview example - incomplete lab coverage", issues: [{ code: "SOURCE_SCAN_INCOMPLETE", label: "Some instruction pages could not be checked", severity: "minor", message: "The workshop opened. Two instruction pages were checked, but Getting Started could not be read.", details: [{ label: "Getting Started", location: "Getting Started", error: "Source returned HTTP 404. Check the manifest filename.", suggestion: "Restore the source or correct its manifest filename." }] }] }));

catalogItems.push(item({ id: 99991, title: "Preview example - twelve findings", issues: [{ code: "POSSIBLE_TYPO", label: "Possible typo", severity: "minor", message: "Twelve example findings, all visible.", details: Array.from({ length: 12 }, (_, index) => ({ label: `Finding ${index + 1}`, marker: "sentnce", text: "Enter the sentnce.", sourceLine: index + 1, location: `Example lab / Task ${index + 1}`, suggestion: "Review sentence as a possible correction." })) }] }));

// All demonstration destinations are local fixtures, never invented public lab URLs.
const escapeHtml = (value) => String(value || "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
fs.mkdirSync(outputDir, { recursive: true });
for (const entry of catalogItems) {
  entry.catalogItem.title = "Example: " + entry.catalogItem.title;
  const fixture = `demo-${entry.catalogItem.type}-${entry.catalogItem.id}.html`;
  const url = `${previewBaseUrl}/${fixture}`;
  const details = [];
  for (const issue of entry.issues) {
    const records = Array.isArray(issue.details) ? issue.details : Object.values(issue.details || {}).find(Array.isArray) || [];
    for (const record of records) {
      if (!record || typeof record !== "object") continue;
      const exactPageUrl = record.labNumber ? `${url}?lab=${encodeURIComponent(String(record.labNumber))}` : url;
      record.pageUrl = exactPageUrl;
      record.page_url = exactPageUrl;
      record.sourceFileUrl = url;
      if (record.sources) for (const source of record.sources) { source.page_url = url; source.source_file_url = url; }
      details.push(record);
    }
  }
  entry.catalogItem.normalized_href = url;
  entry.catalogItem.absolute_url = url;
  fs.writeFileSync(path.join(outputDir, fixture), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local example lab</title><style>body{font:16px Arial;margin:32px;line-height:1.6;max-width:1000px}article{border-left:4px solid #c62828;padding:12px 20px;margin:20px 0;background:#fff4f1}code{overflow-wrap:anywhere}h1{font-size:26px}a{color:#0067a8}</style><a href="summary.html">Back to report</a><p><strong>Local demonstration only. These are not verified LiveLabs defects.</strong></p><h1>${escapeHtml(entry.catalogItem.title)}</h1>${details.map((detail) => `<article><h2>${escapeHtml(detail.location || detail.labTitle || detail.label || "Example location")}</h2><p>${escapeHtml(detail.text || detail.marker || detail.label || detail.alt || detail.object_name)}</p><code>${escapeHtml(detail.url || detail.src || detail.error)}</code><p>${escapeHtml(detail.suggestion)}</p></article>`).join("") || '<p>This example illustrates a check that could not complete. No specific content defect is asserted here.</p>'}</html>`);
}

const totalChecks = catalogItems.reduce((count, entry) => count + entry.tests.length, 0);
const issueCounts = new Map();
const issueLabels = new Map();
for (const catalogItem of catalogItems) {
  for (const issue of catalogItem.issues) {
    issueCounts.set(issue.code, (issueCounts.get(issue.code) || 0) + 1);
    issueLabels.set(issue.code, issue.label);
  }
}

const failedItems = catalogItems.filter((catalogItem) => catalogItem.status === "failed").length;
const now = new Date();
const startedAt = new Date(now.getTime() - 32 * 60_000);
const summary = {
  runId: "local-manager-preview",
  previewMode: true,
  scope: { label: "Demonstration catalog" },
  attemptId: "local-preview",
  reportChannel: "regression",
  runType: "regression",
  status: "failed",
  completion: { state: "completed" },
  startedAt: startedAt.toISOString(),
  endedAt: now.toISOString(),
  durationMs: now.getTime() - startedAt.getTime(),
  configuredTests: totalChecks,
  counts: {
    total: totalChecks,
    passed: totalChecks - failedItems,
    failed: failedItems,
    skipped: 0,
    timedOut: 0,
    interrupted: 0,
    unexpected: failedItems,
    flaky: 0,
  },
  failureCategories: Array.from(issueCounts, ([code, count]) => ({ code, count, label: issueLabels.get(code) || code })),
  catalogItems,
  failures: fs.existsSync(path.join(outputDir, "example-evidence.png")) ? (() => {
    const entry = catalogItems.find((entry) => entry.issues.some((issue) => issue.code === "MARKDOWN_FORMATTING"));
    return entry ? [{ ...entry.tests[0], catalogItem: entry.catalogItem, titlePath: [entry.catalogItem.title], issues: entry.issues, errors: [], steps: [], attachments: [{ name: "highlighted-issue-screenshot", path: path.join(outputDir, "example-evidence.png"), contentType: "image/png" }] }] : [];
  })() : [],
  sections: [],
};

fs.mkdirSync(outputDir, { recursive: true });
writeSummaryFiles(outputDir, summary, path.join(projectRoot, "artifacts"));
const history = { report_channel: "regression", runs: [{
  ...summary, href: "runs/local-manager-preview/summary.html",
  itemsTested: catalogItems.length, issuesFound: failedItems,
}] };
fs.writeFileSync(path.join(outputDir, "history.html"), reportHistoryPageHtml(history).replace('<main>', '<main><p><strong>Design preview only. This is a demonstration run, not a LiveLabs scan.</strong></p>'));
fs.writeFileSync(path.join(outputDir, "retest-history.html"), reportHistoryPageHtml({ report_channel: "retest", runs: [] }));
console.log(path.join(outputDir, "summary.html"));
