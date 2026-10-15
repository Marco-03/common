import { expect, test } from "@playwright/test";

import { filterSourceCandidatesByRenderedLab } from "../support/parDiscovery.js";
import type { ParCandidate } from "../support/parAudit.js";

const stalePar = "https://objectstorage.us-ashburn-1.oraclecloud.com/p/stale/n/example/b/files/o/old.zip";
const currentPar = "https://objectstorage.us-ashburn-1.oraclecloud.com/p/current/n/example/b/files/o/new.zip";
const labOne = "https://example.test/workshops/tenancy/index.html?lab=1-prepare";
const labTwo = "https://example.test/workshops/tenancy/index.html?lab=2-run";

function candidate(url: string, pageUrls: string[]): ParCandidate {
  return {
    url,
    sources: pageUrls.map((pageUrl) => ({ pageType: "source-lab", pageUrl, label: "Source lab" })),
  };
}

test("keeps only PAR URLs that exist in the corresponding rendered lab", () => {
  const filtered = filterSourceCandidatesByRenderedLab(
    [candidate(stalePar, [labOne]), candidate(currentPar, [labOne])],
    new Map([[labOne, new Set([currentPar])]]),
  );

  expect(filtered).toEqual([candidate(currentPar, [labOne])]);
});

test("retains only active source locations when a PAR appears in several labs", () => {
  const filtered = filterSourceCandidatesByRenderedLab(
    [candidate(stalePar, [labOne, labTwo])],
    new Map([
      [labOne, new Set([currentPar])],
      [labTwo, new Set([stalePar])],
    ]),
  );

  expect(filtered).toEqual([candidate(stalePar, [labTwo])]);
});

test("does not promote an unrendered source-only PAR to a confirmed failure", () => {
  expect(filterSourceCandidatesByRenderedLab([candidate(stalePar, [labOne])], new Map())).toEqual([]);
});
