import fs from "node:fs";

const RUN_ID = /^[A-Za-z0-9._:-]+$/;
const OBJECT_FILE = new Set(["results.csv", "finding-results.csv", "catalog-results.json"]);

export function archiveObjectUrl({ parFile, namespace, bucket, prefix, channel, runId, filename }) {
  if (!["regression", "retest"].includes(channel) || !RUN_ID.test(runId) || !OBJECT_FILE.has(filename)) {
    throw new Error("Invalid report download.");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(namespace || "") || !/^[A-Za-z0-9._-]+$/.test(bucket || "")) {
    throw new Error("Object Storage archive is not configured.");
  }
  const cleanPrefix = String(prefix || "livelabs-qa").replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9._/-]+$/.test(cleanPrefix) || cleanPrefix.split("/").includes("..")) {
    throw new Error("Invalid Object Storage archive prefix.");
  }
  const secret = fs.readFileSync(parFile, "utf8").trim();
  let base;
  try { base = new URL(secret); } catch { throw new Error("Invalid private archive configuration."); }
  if (base.protocol !== "https:" || !/^objectstorage\.[a-z0-9-]+\.oraclecloud\.com$/.test(base.hostname)
    || base.search || base.hash || !new RegExp(`^/p/[^/]+/n/${namespace}/b/${bucket}/o/$`).test(base.pathname)) {
    throw new Error("Invalid private archive configuration.");
  }
  const objectName = `${cleanPrefix}/${channel}/runs/${runId}/${filename}`;
  return `${base.href}${objectName.split("/").map(encodeURIComponent).join("/")}`;
}
