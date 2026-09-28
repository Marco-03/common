import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCatalogItem,
  catalogItemTypeFromCard,
  explicitCatalogId,
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
