import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function createHub({ directory, preview = false, reports = "/var/qa-reports", jenkins = process.env.QA_JENKINS_URL, fetcher = fetch } = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "state.json");
  let state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { retest: {}, runs: [] };
  const save = () => { fs.writeFileSync(file + ".tmp", JSON.stringify(state)); fs.renameSync(file + ".tmp", file); };
  let submitting = false;
  async function jenkinsRequest(relative, options = {}) {
    if (!jenkins) throw new Error("Jenkins has not been configured.");
    const password = fs.readFileSync(process.env.QA_JENKINS_SECRET_FILE || "/run/secrets/jenkins_admin_secret", "utf8").trim();
    const authorization = "Basic " + Buffer.from(`${process.env.JENKINS_ADMIN_USER || "qa-admin"}:${password}`).toString("base64");
    const headers = { authorization, ...options.headers };
    if (options.method === "POST") {
      const crumbResponse = await fetcher(`${jenkins}/crumbIssuer/api/json`, { headers: { authorization }, signal: AbortSignal.timeout(15000) });
      if (!crumbResponse.ok) throw new Error("Jenkins authentication or CSRF setup failed.");
      const crumb = await crumbResponse.json();
      headers[crumb.crumbRequestField] = crumb.crumb;
      const cookies = crumbResponse.headers.getSetCookie?.() || [];
      if (cookies.length) headers.cookie = cookies.map((cookie) => cookie.split(";")[0]).join("; ");
    }
    const response = await fetcher(`${jenkins}${relative}`, { ...options, headers, redirect: "manual", signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Jenkins request failed (${response.status}). No successful submission was confirmed.`);
    return response;
  }
  function selection(payload) {
    if (!Array.isArray(payload.tests) || !payload.tests.length || payload.tests.length > 500) throw new Error("Select between 1 and 500 catalog items.");
    const checks = [];
    const ids = new Set();
    for (const entry of payload.tests) {
      if (preview) { ids.add(String(entry.itemId)); continue; }
      if (!/^[A-Za-z0-9._-]+$/.test(entry.executionId || "")) throw new Error("Invalid source run.");
      let summary;
      for (const channel of ["regression", "retest"]) {
        const candidate = path.join(reports, channel, "runs", entry.executionId, "summary.json");
        if (fs.existsSync(candidate)) { summary = JSON.parse(fs.readFileSync(candidate, "utf8")); break; }
      }
      const requestedIds = Array.from(new Set((Array.isArray(entry.itemIds) ? entry.itemIds : [entry.itemId]).filter(Boolean).map(String)));
      const items = requestedIds.map((id) => summary?.catalogItems?.find((item) => String(item.catalogItem?.id) === id && item.catalogItem?.type === entry.itemType)).filter(Boolean);
      if (items.length !== requestedIds.length) throw new Error("A selected item no longer has a saved source report. Open a current report and select it again.");
      for (const item of items) {
        ids.add(String(item.catalogItem.id));
        for (const test of item.tests || []) checks.push({ testPath: test.file, testName: test.title });
      }
    }
    if (!preview && !checks.length) throw new Error("No runnable checks in the selected reports.");
    return { checks: [...new Map(checks.map((check) => [JSON.stringify(check), check])).values()], ids: [...ids] };
  }
  async function progress() {
    for (const run of state.runs.filter((run) => !run.finished)) {
      if (preview) { run.status = "Preview only - no scan executed"; run.finished = true; continue; }
      try {
        if (!run.build) {
          const queue = await (await jenkinsRequest(`/queue/item/${run.queue}/api/json`)).json();
          if (queue.cancelled) { run.status = "Cancelled"; run.finished = true; }
          if (queue.executable) run.build = queue.executable.number;
        }
        if (run.build) {
          const build = await (await jenkinsRequest(`/job/livelabs-qa-engine/${run.build}/api/json`)).json();
          run.status = build.building ? "Running" : ({ SUCCESS: "Completed", UNSTABLE: "Completed with issues", ABORTED: "Cancelled", FAILURE: "Run failed" }[build.result] || "Queued");
          run.finished = !build.building && Boolean(build.result);
          const historyFile = path.join(reports, "retest", "history.json");
          if (fs.existsSync(historyFile)) {
            const history = JSON.parse(fs.readFileSync(historyFile, "utf8"));
            const entries = Array.isArray(history) ? history : history.runs || [];
            const match = entries.find((entry) => entry.attemptId?.includes(`-${run.build}-`));
            if (match && /^[A-Za-z0-9._-]+$/.test(match.runId)) run.report = `/retest/runs/${match.runId}/summary.html`;
          }
        }
      } catch { run.status = "Status unavailable - check Jenkins"; }
    }
    save();
    return state.runs;
  }
  const send = (res, status, value) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
  return http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, "http://localhost").pathname;
      if (pathname === "/api/hub/list" && req.method === "GET") return send(res, 200, { retest: state.retest });
      if (pathname === "/api/hub/runs" && req.method === "GET") return send(res, 200, await progress());
      if (pathname.startsWith("/api/hub/") && req.method === "POST") {
        if (req.headers["x-qa-hub"] !== "1" || !req.headers["content-type"]?.startsWith("application/json")) return send(res, 403, { error: "Same-origin JSON requests only." });
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, { error: "Cross-origin requests are not allowed." });
        let body = "";
        for await (const chunk of req) { body += chunk; if (body.length > 1000000) throw new Error("Request too large."); }
        const payload = JSON.parse(body);
        if (pathname === "/api/hub/list") {
          if (!Array.isArray(payload.operations) || payload.operations.length > 500) throw new Error("Invalid list update.");
          for (const operation of payload.operations) {
            if (typeof operation.id !== "string" || operation.id.length > 500 || ["__proto__", "constructor", "prototype"].includes(operation.id)) throw new Error("Invalid item ID.");
            if (!operation.remove && (!operation.entry || operation.entry.testId !== operation.id)) throw new Error("Invalid list entry.");
          }
          const next = { ...state.retest };
          for (const operation of payload.operations) {
            if (operation.remove) delete next[operation.id];
            else next[operation.id] = operation.entry;
          }
          if (Object.keys(next).length > 500) throw new Error("The shared list is limited to 500 selected items per retest.");
          state.retest = next;
          save(); return send(res, 200, { retest: state.retest });
        }
        if (pathname === "/api/hub/retest") {
          if (submitting) return send(res, 409, { error: "Another submission is in progress." });
          submitting = true;
          try {
            const selected = selection(payload);
            const active = state.runs.find((run) => !run.finished && run.selection === JSON.stringify(selected));
            if (active) return send(res, 200, active);
            const run = { id: randomUUID(), createdAt: new Date().toISOString(), count: selected.ids.length, status: "Queued", preview, selection: JSON.stringify(selected) };
            if (!preview) {
              const parameters = new URLSearchParams({ RUN_PROFILE: "manual-items", CATALOG_ITEM_IDS: selected.ids.join(","), CATALOG_MAX_PAGES: "250", CONTENT_LINK_LIMIT: "0", RETEST_SELECTION: Buffer.from(JSON.stringify(selected.checks)).toString("base64"), LIVELABS_USERNAME_CREDENTIAL_ID: "livelabs-username", LIVELABS_SECRET_CREDENTIAL_ID: "livelabs-secret", AUTH_TARGET_URL: process.env.QA_AUTH_TARGET_URL || "" });
              const response = await jenkinsRequest("/job/livelabs-qa-engine/buildWithParameters", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: parameters });
              const match = response.headers.get("location")?.match(/\/queue\/item\/(\d+)/);
              if (!match) throw new Error("Jenkins did not return a queue ID. Check Jenkins before submitting again.");
              run.queue = Number(match[1]);
            }
            state.runs.unshift(run); save(); return send(res, 201, run);
          } finally { submitting = false; }
        }
      }
      if (preview && req.method === "GET") {
        const previewRoot = path.join(root, "artifacts/full-report-preview");
        let target;
        if (["/regression", "/regression/latest", "/retest", "/retest/latest"].includes(pathname)) {
          res.writeHead(302, { Location: pathname + "/" }); res.end(); return;
        }
        if (pathname === "/") target = path.join(root, "deploy/vm/portal/index.html");
        else if (pathname === "/retest-runs.html") target = path.join(root, "deploy/vm/portal/retest-runs.html");
        else if (["/regression/", "/regression/index.html", "/index.html"].includes(pathname)) target = path.join(previewRoot, "history.html");
        else if (["/retest/", "/retest/index.html"].includes(pathname)) target = path.join(previewRoot, "retest-history.html");
        else {
          let relative = decodeURIComponent(pathname).replace(/^\/(?:(?:regression|retest)\/(?:latest|runs\/local-manager-preview)\/)?/, "");
          if (!relative) relative = "summary.html";
          target = path.resolve(previewRoot, relative);
          if (!target.startsWith(previewRoot + path.sep)) return send(res, 404, {});
        }
        if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return send(res, 404, { error: "Not available in local preview." });
        const type = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png" }[path.extname(target)] || "text/plain";
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }); fs.createReadStream(target).pipe(res); return;
      }
      send(res, 404, { error: "Not found" });
    } catch (error) { send(res, 400, { error: error.message }); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const preview = process.argv.includes("--preview");
  createHub({ preview, directory: process.env.QA_HUB_DATA || path.join(root, "artifacts/hub-state"), reports: process.env.QA_ROOT_REPORTS_BASE }).listen(Number(process.env.PORT || 4175), preview ? "127.0.0.1" : "0.0.0.0", () => console.log("QA Hub listening"));
}
