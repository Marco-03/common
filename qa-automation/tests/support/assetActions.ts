import { expect, type Page } from "@playwright/test";

import type { LiveStackActionRecord } from "../../pages/platform/liveStackLandingPage.js";

export async function assertAssetActionWorks(
  page: Page,
  clickAssetAction: (record: LiveStackActionRecord) => Promise<void>,
  record: LiveStackActionRecord,
): Promise<void> {
  const beforeUrl = page.url();
  const popupPromise = page
    .waitForEvent("popup", { timeout: 12_000 })
    .then((popup) => ({ type: "popup" as const, popup }))
    .catch(() => ({ type: "none" as const }));
  const downloadPromise = page
    .waitForEvent("download", { timeout: 12_000 })
    .then((download) => ({ type: "download" as const, download }))
    .catch(() => ({ type: "none" as const }));
  const navigationPromise = page
    .waitForURL((url) => url.toString() !== beforeUrl, { timeout: 12_000 })
    .then(() => ({ type: "navigation" as const }))
    .catch(() => ({ type: "none" as const }));

  await clickAssetAction(record);

  const outcome = await Promise.race([
    popupPromise,
    downloadPromise,
    navigationPromise,
    delay(12_000).then(() => ({ type: "none" as const })),
  ]);

  if (outcome.type === "download") {
    expect(outcome.download.suggestedFilename(), `${record.title} should start a named download`).not.toHaveLength(0);
    return;
  }

  if (outcome.type === "popup") {
    await outcome.popup.waitForLoadState("domcontentloaded").catch(() => undefined);
    await assertNoBrowserError(outcome.popup, `Asset popup: ${record.title}`);
    await outcome.popup.close();
    return;
  }

  if (outcome.type === "navigation" || page.url() !== beforeUrl) {
    await assertNoBrowserError(page, `Asset action: ${record.title}`);
    return;
  }

  if (record.href && await assetHrefIsReachable(page, record.href, beforeUrl)) {
    return;
  }

  throw new Error(`Asset action "${record.title}" did not open a page, popup, or download.`);
}

export function isExpectedProtectedOracleAssetAction(record: LiveStackActionRecord, currentUrl: string): boolean {
  return isProtectedOracleProfileUrl(record.href) && isProtectedOracleProfileUrl(currentUrl);
}

function isProtectedOracleProfileUrl(value?: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value, "https://livelabs.oracle.com/");
    const host = url.hostname.toLowerCase();
    return host === "signon.oracle.com" || host.endsWith(".identity.oraclecloud.com");
  } catch {
    return false;
  }
}

export async function assertNoBrowserError(page: Page, contextName: string): Promise<void> {
  const currentUrl = page.url();

  expect(currentUrl, `${contextName} should not end on a browser error page`).not.toMatch(/^chrome-error:\/\//i);
  expect(currentUrl, `${contextName} should not be blank`).not.toBe("about:blank");
}

async function assetHrefIsReachable(page: Page, href: string, baseUrl: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(href, baseUrl);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(url.protocol)) return false;

  try {
    const response = await page.request.head(url.toString(), {
      failOnStatusCode: false,
      maxRedirects: 5,
      timeout: 15_000,
    });
    const status = response.status();
    await response.dispose();
    return status >= 200 && status < 400;
  } catch {
    return false;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
