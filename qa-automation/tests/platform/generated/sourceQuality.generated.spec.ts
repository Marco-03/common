import type { Page } from "@playwright/test";

import { WorkshopInstructionsPage } from "../../../pages/platform/workshopInstructionsPage.js";
import {
  assertNoContentQualityIssues,
  attachContentQualityIssues,
  type ContentQualityIssue,
} from "../../support/contentQuality.js";
import {
  attachCatalogItem,
  catalogIndexItems,
  catalogItemTestTitle,
  loadCatalogIndex,
} from "../../support/catalogIndex.js";
import { signInIfRequired } from "../../support/authenticatedNavigation.js";
import { openIndexedCatalogItem } from "../../support/indexedCatalogNavigation.js";
import { test } from "../../support/test.js";
import { collectWorkshopSourceQualityIssues } from "../../support/workshopSourceQuality.js";

const GENERATED_SOURCE_QUALITY_TAGS = [
  "@generated",
  "@platform",
  "@workshop",
  "@source-quality",
  "@markdown",
  "@spelling",
];

const loadResult = loadCatalogIndex();
const workshopItems = catalogIndexItems("workshop");

test.describe("LiveLabs generated workshop source quality", { tag: GENERATED_SOURCE_QUALITY_TAGS }, () => {
  test.describe.configure({ timeout: 720_000 });

  if (loadResult.status === "missing") {
    test("catalog index is not generated", async () => {
      test.skip(true, loadResult.message);
    });
  } else if (workshopItems.length === 0) {
    test("catalog index has no workshop entries in the current slice", async () => {
      test.skip(true, "The generated catalog index does not contain workshop entries for this run.");
    });
  } else {
    for (const item of workshopItems) {
      test(`checks Markdown, grammar, and spelling for indexed ${catalogItemTestTitle(item)}`, async ({
        authRuntime,
        environmentConfig,
        page,
        workshopLandingPage,
        workshopLaunchOptionsDialog,
      }, testInfo) => {
        await attachCatalogItem(testInfo, item);
        const collectedIssues: ContentQualityIssue[] = [];
        let documentsScanned = 0;

        const openLaunchOptions = async (contextName: string) => {
          await openIndexedCatalogItem(page, authRuntime, environmentConfig.base_url, item, contextName);
          await workshopLandingPage.assertLoaded();
          await workshopLandingPage.openLaunchOptions();
          await workshopLaunchOptionsDialog.assertHasLaunchAction();
        };

        const scanInstructions = async (instructionsPage: Page, surface: string) => {
          await signInIfRequired(instructionsPage, authRuntime, `${surface}: ${item.title}`);
          const pageModel = new WorkshopInstructionsPage(instructionsPage);
          await pageModel.assertLoaded();
          const result = await collectWorkshopSourceQualityIssues(
            instructionsPage,
            `${surface}: ${item.title}`,
          );
          documentsScanned += result.documentsScanned;
          collectedIssues.push(...result.issues);
          if (instructionsPage !== page) await instructionsPage.close();
        };

        await openLaunchOptions("Workshop source quality preview");
        if (await workshopLaunchOptionsDialog.hasPreviewInstructions()) {
          await scanInstructions(
            await workshopLaunchOptionsDialog.openPreviewInstructions(),
            "Preview instructions source",
          );
        }

        await openLaunchOptions("Workshop source quality tenancy");
        if (await workshopLaunchOptionsDialog.hasRunOnYourEnvironmentInstructions()) {
          await scanInstructions(
            await workshopLaunchOptionsDialog.openRunOnYourEnvironmentInstructions(),
            "Run on your tenancy instructions source",
          );
        }

        const issues = mergeIssues(collectedIssues);
        testInfo.annotations.push({
          type: "source-quality",
          description: `${documentsScanned} Markdown source document(s) checked.`,
        });
        test.skip(documentsScanned === 0 && issues.length === 0, "No published Markdown source was available for this workshop.");
        await attachContentQualityIssues(testInfo, issues, `Workshop source quality: ${item.title}`);
        assertNoContentQualityIssues(issues, `Workshop source quality: ${item.title}`);
      });
    }
  }
});

function mergeIssues(issues: ContentQualityIssue[]): ContentQualityIssue[] {
  const byCode = new Map<string, ContentQualityIssue>();

  for (const issue of issues) {
    const existing = byCode.get(issue.code);
    const details = Array.isArray(issue.details) ? issue.details : [];
    if (!existing) {
      byCode.set(issue.code, { ...issue, details: deduplicateDetails(details) });
      continue;
    }
    const mergedDetails = deduplicateDetails([
      ...(Array.isArray(existing.details) ? existing.details : []),
      ...details,
    ]);
    byCode.set(issue.code, {
      ...existing,
      count: mergedDetails.length,
      details: mergedDetails,
      message: `${mergedDetails.length} source issue${mergedDetails.length === 1 ? "" : "s"} found.`,
    });
  }

  return Array.from(byCode.values());
}

function deduplicateDetails(details: unknown[]): unknown[] {
  const seen = new Set<string>();
  return details.filter((detail) => {
    const record = detail && typeof detail === "object" ? detail as Record<string, unknown> : {};
    const key = [record.sourceFileUrl, record.sourceLine, record.marker, record.label].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
