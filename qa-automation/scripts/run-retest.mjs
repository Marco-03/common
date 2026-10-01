import { spawnSync } from "node:child_process";
import path from "node:path";

export function retestArguments(encoded) {
  const checks = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  if (!Array.isArray(checks) || !checks.length || checks.length > 5000) throw new Error("Invalid retest selection");
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const check of checks) {
    if (!/^tests\/platform\/(?:generated\/[A-Za-z0-9]+\.generated\.spec\.ts|par\/catalogParLinks\.spec\.ts)$/.test(check.testPath) || typeof check.testName !== "string" || !check.testName || check.testName.length > 2000) throw new Error("Invalid retest check");
  }
  return [...new Set(checks.map((check) => check.testPath)), "--marker", checks.map((check) => `${escape(path.basename(check.testPath))}.*${escape(check.testName)}(?:\\s+@\\S+)*$`).join("|")];
}

if (process.argv[1]?.endsWith("run-retest.mjs")) {
  const args = retestArguments(process.env.QA_RETEST_SELECTION || "");
  const result = spawnSync(process.execPath, ["scripts/qa.mjs", ...args, ...process.argv.slice(2)], { stdio: "inherit", env: process.env });
  process.exit(result.status ?? 1);
}
