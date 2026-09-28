import { expect, test } from "@playwright/test";

import { collectTextDefectDetails } from "../support/contentQuality.js";

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
