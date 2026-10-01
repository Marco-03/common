import { expect, test } from "@playwright/test";

import { loadWorkshopSourceDocuments, type WorkshopSourceDocument } from "../support/parSourceDiscovery.js";
import type { Page } from "@playwright/test";
import {
  inspectMarkdownFormatting,
  inspectPossibleTypos,
  inspectWritingGrammar,
} from "../support/workshopSourceQuality.js";

function source(text: string): WorkshopSourceDocument {
  return {
    sourceUrl: "https://example.test/source/lab.md",
    renderedUrl: "https://example.test/workshop?lab=sample-lab",
    labNumber: 2,
    label: "Lab 2: Sample lab",
    text,
  };
}

test("reports malformed Markdown bold markers with the exact source line", () => {
  const issues = inspectMarkdownFormatting(source([
    "# Lab title",
    "",
    "**Correct label:** value",
    "**Incorrect label: ** value",
  ].join("\n")));

  expect(issues).toHaveLength(1);
  expect(issues[0]).toMatchObject({
    label: "Space before closing **",
    sourceLine: 4,
    labTitle: "Lab 2: Sample lab",
  });
});

test("ignores Markdown and spelling examples inside code blocks", async () => {
  const document = source([
    "# Lab title",
    "",
    "```python",
    "print('** Incorrect: **')",
    "sentnce = 'TODO replace this example'",
    "```",
  ].join("\n"));

  expect(inspectMarkdownFormatting(document)).toEqual([]);
  expect(await inspectPossibleTypos(document)).toEqual([]);
});

test("reports high-confidence punctuation and spelling candidates", async () => {
  const document = source([
    "# Lab title",
    "",
    "This is is a sentnce ;Next step.",
  ].join("\n"));

  const grammar = inspectWritingGrammar(document);
  const typos = await inspectPossibleTypos(document);

  expect(grammar.map((issue) => issue.label)).toEqual(expect.arrayContaining([
    "Repeated word",
    "Space before punctuation",
    "Missing space after punctuation",
  ]));
  expect(typos).toEqual(expect.arrayContaining([
    expect.objectContaining({ marker: "sentnce", sourceLine: 3 }),
  ]));
});

test("accepts configured Oracle and workshop terminology", async () => {
  const typos = await inspectPossibleTypos(source(
    "Use terraform with kubernetes in the tenancy for the moviestream workshop.",
  ));

  expect(typos).toEqual([]);
});

test("all language checks ignore HTML, indented, and nested-fence code", async () => {
  const document = source([
    "# Lab",
    "<pre><code>", "This is is a sentnce ;Next ** Wrong: **", "</code></pre>",
    "", "    This is is a sentnce ;Next ** Wrong: **", "",
    "````markdown", "```python", "This is is a sentnce ;Next ** Wrong: **", "```", "````",
    "", "<copy>This is is a sentnce ;Next ** Wrong: **</copy>",
    "", "Use `sentnce` and https://example.test/sentnce:next normally.",
  ].join("\n"));
  expect(inspectMarkdownFormatting(document)).toEqual([]);
  expect(inspectWritingGrammar(document)).toEqual([]);
  expect(await inspectPossibleTypos(document)).toEqual([]);
});

test("prose after code retains original source line", () => {
  const document = source("<pre>is is</pre>\n\nThis is is repeated.");
  expect(inspectWritingGrammar(document)).toEqual([expect.objectContaining({ sourceLine: 3, marker: "is is" })]);
});

test("keeps missing source pages separate from successfully scanned labs", async () => {
  const url = "https://example.test/coverage/index.html";
  const page = {
    url: () => url,
    frames: () => [{ url: () => url }],
    evaluate: async () => { throw new Error("Use request fallback"); },
    request: { get: async (target: string) => ({
      status: () => target.endsWith("missing.md") ? 404 : 200,
      text: async () => target.endsWith("manifest.json") ? JSON.stringify({ tutorials: [{ title: "Introduction", filename: "intro.md" }, { title: "Getting Started", filename: "missing.md" }] }) : "# Introduction\nWorking source.",
      dispose: async () => {},
    }) },
  } as unknown as Page;
  const result = await loadWorkshopSourceDocuments(page);
  expect(result.documents).toHaveLength(1);
  expect(result.scanErrors).toEqual([expect.objectContaining({ label: "Getting Started", error: expect.stringContaining("404") })]);
});
