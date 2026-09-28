#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeSummaryFiles } from "./reporters/root-summary-reporter.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectRoot, "artifacts", "full-report-preview");
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
    counts: { total: 3, passed: failed ? 2 : 3, failed: failed ? 1 : 0, unexpected: failed ? 1 : 0 },
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
  item({ id: 101, type: "livestack", title: "Autonomous AI Lakehouse - The PeakGear LiveStack" }),
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
  attemptId: "local-preview",
  reportChannel: "regression",
  runType: "regression",
  status: "failed",
  completion: { state: "completed" },
  startedAt: startedAt.toISOString(),
  endedAt: now.toISOString(),
  durationMs: now.getTime() - startedAt.getTime(),
  configuredTests: catalogItems.length * 3,
  counts: {
    total: catalogItems.length * 3,
    passed: catalogItems.length * 3 - failedItems,
    failed: failedItems,
    skipped: 0,
    timedOut: 0,
    interrupted: 0,
    unexpected: failedItems,
    flaky: 0,
  },
  failureCategories: Array.from(issueCounts, ([code, count]) => ({ code, count, label: issueLabels.get(code) || code })),
  catalogItems,
  failures: [],
  sections: [],
};

fs.mkdirSync(outputDir, { recursive: true });
writeSummaryFiles(outputDir, summary, path.join(projectRoot, "artifacts"));
console.log(path.join(outputDir, "summary.html"));
