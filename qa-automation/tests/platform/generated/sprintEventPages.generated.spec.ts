import {
  attachCatalogItem,
  catalogIndexItems,
  catalogItemTestTitle,
  loadCatalogIndex,
} from "../../support/catalogIndex.js";
import {
  assertNoContentQualityIssues,
  attachContentQualityIssues,
  collectContentQualityIssues,
} from "../../support/contentQuality.js";
import { openIndexedCatalogItem } from "../../support/indexedCatalogNavigation.js";
import { test } from "../../support/test.js";

const GENERATED_SPRINT_EVENT_TAGS = ["@generated", "@platform", "@sprint", "@event", "@content", "@ui"];

const loadResult = loadCatalogIndex();
const sprintEventItems = [...catalogIndexItems("sprint"), ...catalogIndexItems("event")];

test.describe("LiveLabs generated Sprint and event pages", { tag: GENERATED_SPRINT_EVENT_TAGS }, () => {
  test.describe.configure({ timeout: 360_000 });

  if (loadResult.status === "missing") {
    test("catalog index is not generated", async () => {
      test.skip(true, loadResult.message);
    });
  } else if (sprintEventItems.length === 0) {
    test("catalog index has no Sprint or event entries in the current slice", async () => {
      test.skip(true, "The generated catalog index does not contain Sprint or event entries for this run.");
    });
  } else {
    for (const item of sprintEventItems) {
      test(`validates indexed ${catalogItemTestTitle(item)}`, async ({ authRuntime, environmentConfig, page }, testInfo) => {
        await attachCatalogItem(testInfo, item);

        await openIndexedCatalogItem(
          page,
          authRuntime,
          environmentConfig.base_url,
          item,
          `Generated ${item.type} page: ${item.title}`,
          { acceptAnyPublicRoute: true },
        );

        const contextName = `Generated ${item.type} page: ${item.title}`;
        const issues = await collectContentQualityIssues(page, {
          contextName,
          allowCustomVideoEmbeds: true,
        });

        await attachContentQualityIssues(testInfo, issues, contextName);
        assertNoContentQualityIssues(issues, contextName);
      });
    }
  }
});
