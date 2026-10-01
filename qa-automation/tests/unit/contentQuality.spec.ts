import { expect, test } from "@playwright/test";

import { collectTextDefectDetails, collectContentQualityIssues, isLiveLabsCatalogSearchUrl, probeLinkStatus } from "../support/contentQuality.js";
import type { Page } from "@playwright/test";
import { createServer } from "node:http";
import { WorkshopInstructionsPage } from "../../pages/platform/workshopInstructionsPage.js";

test("ignores instructional TODO markers inside code samples", async ({ page }) => {
  await page.setContent(`
    <main>
      <h1>Translate text</h1>
      <h2>Task 2: Translate Text with Python SDK</h2>
      <pre><code>target_language = "de" # TODO specify the target language</code></pre>
    </main>
  `);

  const defects = await collectTextDefectDetails(page.locator("main"), page.url());

  expect(defects).toEqual([]);
});

test("keeps visible prose placeholders as findings", async ({ page }) => {
  await page.setContent(`
    <main>
      <h1>Prepare the application</h1>
      <p>TODO: replace this example before publishing.</p>
    </main>
  `);

  const defects = await collectTextDefectDetails(page.locator("main"), page.url());

  expect(defects).toHaveLength(1);
  expect(defects[0]).toMatchObject({ marker: "TODO", location: "Prepare the application" });
});

test("checks GET before reporting a rejected HEAD as broken", async () => {
  const responses: string[] = [];
  const response = (status: number) => ({ status: () => status, dispose: async () => {} });
  const page = { request: { head: async () => { responses.push("HEAD"); return response(405); }, get: async () => { responses.push("GET"); return response(200); } } } as unknown as Page;
  expect(await probeLinkStatus(page, "https://example.test/link")).toBe(200);
  expect(responses).toEqual(["HEAD", "GET"]);
});

test("does not treat LiveLabs catalog search links as broken content destinations", () => {
  expect(isLiveLabsCatalogSearchUrl("https://livelabs.oracle.com/pls/apex/f?p=133:100:100470405399556::::SEARCH:lakehouse")).toBe(true);
  expect(isLiveLabsCatalogSearchUrl("https://livelabs.oracle.com/ords/r/dbpm/livelabs/livelabs-workshop-cards?clear=100&search=livestacks")).toBe(true);
  expect(isLiveLabsCatalogSearchUrl("https://example.com/search=livestacks")).toBe(false);
});

test("checks more than fifty links by default on both page types", async ({ page }, testInfo) => {
  const requested = new Set<string>();
  const server = createServer((request, response) => { requested.add(request.url || ""); response.end("ok"); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test server port");
  try {
    await page.setContent(`<main><h1>Introduction</h1>${Array.from({ length: 61 }, (_, index) => `<p><a href="http://127.0.0.1:${address.port}/${index}">Resource ${index}</a></p>`).join("")}</main>`);
    expect(await collectContentQualityIssues(page, { contextName: "Link coverage" })).toEqual([]);
    expect(requested.size).toBe(61);
    requested.clear();
    await new WorkshopInstructionsPage(page).assertContentQuality({ contextName: "Instructions link coverage" }, testInfo);
    expect(requested.size).toBe(61);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
