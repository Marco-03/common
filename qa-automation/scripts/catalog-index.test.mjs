import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCatalogItem,
  catalogItemTypeFromCard,
  explicitCatalogId,
  mergeCatalogDuplicates,
} from "./catalog-index.mjs";

test("keeps Sprints and events out of the workshop type", () => {
  assert.equal(
    catalogItemTypeFromCard({ href: "/view-workshop?wid=3319", catalogTypeHint: "Sprints" }),
    "sprint",
  );
  assert.equal(
    catalogItemTypeFromCard({ href: "/view-workshop?wid=88", cardClass: "cards-class event-card-class" }),
    "event",
  );
  assert.equal(
    catalogItemTypeFromCard({ href: "/view-workshop?wid=848", cardClass: "workshop-card-class" }),
    "workshop",
  );
  assert.equal(
    catalogItemTypeFromCard({ href: "/view-workshop?wid=1057", catalogTypeHint: "Sprints", title: "Can I try out other things on my workshop reservation?" }),
    "sprint",
  );
  assert.equal(
    catalogItemTypeFromCard({ href: "/view-workshop?wid=3386", catalogTypeHint: "Sprints", title: "Como adicionar notas para apoiar a apresentação e a narrativa no Oracle Analytics Cloud (OAC)?" }),
    "sprint",
  );
});

test("uses the LiveStack p400_id as its catalog identifier", () => {
  const url = "https://livelabs.oracle.com/ords/r/dbpm/livelabs/livestack-landing-page?p400_id=22&clear=RR";
  assert.equal(explicitCatalogId(url, "livestack"), "22");

  const item = buildCatalogItem("https://livelabs.oracle.com", {
    title: "Build Energy & Utilities Intelligence on One Governed Oracle Data Platform",
    href: `${url}&session=private-session-value`,
    cardText: "Build Energy & Utilities Intelligence on One Governed Oracle Data Platform",
    cardClass: "cards-class livestack-card-class",
    labels: ["LiveStack"],
    catalogPage: 1,
    catalogPosition: 1,
  });

  assert.equal(item.type, "livestack");
  assert.equal(item.id, "22");
  assert.doesNotMatch(item.normalized_href, /session=/);
});

test("prefers a published LiveLabs ID label when a card provides one", () => {
  assert.equal(
    explicitCatalogId(
      "https://livelabs.oracle.com/ords/r/dbpm/livelabs/livestack-landing-page?p400_id=22",
      "livestack",
      "LiveStack ID: 4022",
    ),
    "4022",
  );
});

test("merges duplicate catalog titles into one canonical item", () => {
  const first = { id: "3605", type: "workshop", title: "HeatWave", normalized_href: "https://example.test/3605" };
  const second = { id: "4252", type: "workshop", title: "HeatWave", normalized_href: "https://example.test/4252" };
  assert.deepEqual(mergeCatalogDuplicates(first, second).duplicate_ids, ["3605", "4252"]);
  assert.deepEqual(mergeCatalogDuplicates(first, second).duplicate_urls, ["https://example.test/3605", "https://example.test/4252"]);
});
