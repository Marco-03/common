import type { Page } from "@playwright/test";

import { BasePage } from "../../pages/basePage.js";
import type { AuthRuntimeConfig } from "./authRuntime.js";
import type { CatalogIndexItem } from "./catalogIndex.js";
import { signInIfRequired } from "./authenticatedNavigation.js";

export interface IndexedCatalogNavigationResult {
  targetUrl: string;
  signedIn: boolean;
  authenticationRequired?: boolean;
}

export interface IndexedCatalogNavigationOptions {
  expectedPaths?: string[];
  acceptAnyPublicRoute?: boolean;
  allowAuthenticationRequired?: boolean;
}

class ConfirmedCatalogRouteError extends Error {}
const cookieCheckComplete = new WeakSet<Page>();

export async function openIndexedCatalogItem(
  page: Page,
  authRuntime: AuthRuntimeConfig,
  baseUrl: string,
  item: CatalogIndexItem,
  contextName: string,
  options: IndexedCatalogNavigationOptions = {},
): Promise<IndexedCatalogNavigationResult> {
  const targetUrls = resolveCatalogItemUrls(baseUrl, item);
  const basePage = new BasePage(page);
  const expectedPaths =
    options.expectedPaths?.length
      ? options.expectedPaths
      : [item.type === "livestack" ? "/livestack-landing-page" : "/view-workshop"];
  let lastError: unknown;

  for (const targetUrl of targetUrls) {
    for (let attempt = 0; attempt <= BasePage.NAVIGATION_RETRIES; attempt += 1) {
      try {
        await page.goto(targetUrl, {
          waitUntil: "commit",
          timeout: Math.max(45_000, BasePage.NAVIGATION_TIMEOUT_MS),
        });

        await page.waitForLoadState("domcontentloaded");
        if (options.allowAuthenticationRequired && isOracleSignInDestination(page.url())) {
          return { targetUrl, signedIn: false, authenticationRequired: true };
        }
        const signedIn = await signInIfRequired(page, authRuntime, contextName);
        const confirmedRouteFailure = catalogRouteFailure(page.url());
        if (confirmedRouteFailure) {
          throw new ConfirmedCatalogRouteError(confirmedRouteFailure);
        }

        if (!options.acceptAnyPublicRoute) {
          await page.waitForURL((url) => expectedPaths.some((expectedPath) => url.pathname.includes(expectedPath)), {
            timeout: Math.max(45_000, BasePage.NAVIGATION_TIMEOUT_MS),
            waitUntil: "domcontentloaded",
          });
        }
        await assertCatalogDestinationUsable(page);
        await basePage.waitForPageReady();
        if (!cookieCheckComplete.has(page)) {
          await basePage.dismissCookieBannerIfPresent();
          cookieCheckComplete.add(page);
        }

        return { targetUrl, signedIn };
      } catch (error) {
        if (error instanceof ConfirmedCatalogRouteError) {
          throw new Error(
            `Could not open indexed catalog item "${item.title}". ${error.message}`,
          );
        }
        if (await recoverUsableCatalogRoute(page, expectedPaths, options.acceptAnyPublicRoute === true)) {
          return { targetUrl, signedIn: false };
        }
        lastError = error;
        if (isHttp2ProtocolError(error)) {
          try {
            await warmCatalogSession(page, baseUrl);
          } catch {
            // Preserve the original navigation failure and continue its normal retries.
          }
        }
      }
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Could not open indexed catalog item "${item.title}" after trying ${targetUrls.join(", ")}. Last error: ${detail}`,
  );
}

function isOracleSignInDestination(rawUrl: string): boolean {
  return /signon\.oracle\.com\/signin|\.identity\.oraclecloud\.com\/(?:oauth2\/v1\/authorize|ui\/v1\/)/i.test(rawUrl);
}

async function recoverUsableCatalogRoute(
  page: Page,
  expectedPaths: string[],
  acceptAnyPublicRoute: boolean,
): Promise<boolean> {
  try {
    const currentUrl = new URL(page.url());
    if (!acceptAnyPublicRoute && !expectedPaths.some((expectedPath) => currentUrl.pathname.includes(expectedPath))) {
      return false;
    }
    await assertCatalogDestinationUsable(page, 5_000);
    return true;
  } catch {
    return false;
  }
}

async function assertCatalogDestinationUsable(page: Page, timeout = 15_000): Promise<void> {
  const currentUrl = page.url();
  if (!currentUrl || currentUrl === "about:blank" || /^chrome-error:\/\//i.test(currentUrl)) {
    throw new Error(`Catalog destination did not open: ${currentUrl || "empty URL"}`);
  }
  if (/signon\.oracle\.com\/signin|\.identity\.oraclecloud\.com\/oauth2\/v1\/authorize/i.test(currentUrl)) {
    throw new Error(`Catalog destination stopped at Oracle Sign In: ${currentUrl}`);
  }

  const body = page.locator("body");
  await body.waitFor({ state: "visible", timeout });
  const bodyText = (await body.innerText({ timeout })).replace(/\s+/g, " ").trim();
  if (/ERR-1002|Unable to find item ID|p1_invalid_(?:workshop|livestack)_id|Page not found/i.test(bodyText)) {
    throw new Error(`Catalog destination displayed a LiveLabs error: ${bodyText.slice(0, 240)}`);
  }
  if (bodyText.length < 20) {
    throw new Error("Catalog destination opened without enough visible content to validate.");
  }
}

export function catalogRouteFailure(rawUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }

  const invalidWorkshopId = url.searchParams.get("p1_invalid_workshop_id");
  if (invalidWorkshopId) {
    return `LiveLabs reported p1_invalid_workshop_id=${invalidWorkshopId}; this workshop route is invalid.`;
  }

  const invalidLiveStackId = url.searchParams.get("p1_invalid_livestack_id");
  if (invalidLiveStackId) {
    return `LiveLabs reported p1_invalid_livestack_id=${invalidLiveStackId}; this LiveStack route is invalid.`;
  }

  return undefined;
}

function resolveCatalogItemUrls(baseUrl: string, item: CatalogIndexItem): string[] {
  const candidates = [item.normalized_href, item.absolute_url, item.href]
    .filter(Boolean)
    .map((value) => {
      const url = new URL(value, `${baseUrl}/`);
      for (const key of ["session", "cs", "p_instance", "x01"]) url.searchParams.delete(key);
      return url.toString();
    });

  return Array.from(new Set(candidates));
}

async function warmCatalogSession(page: Page, baseUrl: string): Promise<void> {
  const catalogUrl = new URL(
    "/ords/r/dbpm/livelabs/livelabs-workshop-cards?clear=100&search=",
    `${baseUrl}/`,
  ).toString();
  await page.goto(catalogUrl, {
    waitUntil: "domcontentloaded",
    timeout: Math.max(45_000, BasePage.NAVIGATION_TIMEOUT_MS),
  });
}

function isHttp2ProtocolError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("ERR_HTTP2_PROTOCOL_ERROR");
}
