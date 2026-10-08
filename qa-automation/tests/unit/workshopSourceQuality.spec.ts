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

test("does not pair bold markers when a bold span crosses source lines", () => {
  const issues = inspectMarkdownFormatting(source([
    "If your tenancy policy does not allow domain discovery, open **Identity & Security >",
    "Domains > Domains**, pick the domain labeled **Current domain**, then copy the domain URL.",
  ].join("\n")));

  expect(issues).toEqual([]);
});

test("does not treat shebangs, preprocessor directives, or intraword underscores as Markdown errors", () => {
  const issues = inspectMarkdownFormatting(source([
    "#!/usr/bin/env bash",
    "#include <stdio.h>",
    "Use package__name and foo__bar as identifiers.",
  ].join("\n")));

  expect(issues).toEqual([]);
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
  expect(grammar).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: "Missing space after punctuation", marker: ";N", sourceLine: 3 }),
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

test("does not create punctuation findings across inline code", () => {
  const document = source([
    "# Lab",
    "* **Job Name:** Enter `Harvest_Data_Lake_Sandbox` .",
    "Select formats such as `.log`, `.txt`, and `.pdf` .",
    "![The Filename field shows the selected .json notebook file.](./images/open-dialog.png)",
  ].join("\n"));

  expect(inspectWritingGrammar(document)).toEqual([]);
});

test("does not create punctuation findings from Markdown images, entities, or masked content", () => {
  const document = source([
    "Click ![Open the navigation menu](./images/menu.png).",
    "Use&nbsp;text in this example.",
    "This has a real spacing problem as . Then choose as `sample_value` .",
  ].join("\n"));

  expect(inspectWritingGrammar(document)).toEqual([
    expect.objectContaining({ label: "Space before punctuation", marker: "as .", sourceLine: 3 }),
  ]);
});

test("does not apply the English typo dictionary to Spanish or Portuguese prose", async () => {
  const document = source("Seleccione el compartimento para crear los datos. Luego haga clic y use el nombre disponible en la pantalla.");
  expect(await inspectPossibleTypos(document)).toEqual([]);
});

test("accepts established technical terms outside code examples", async () => {
  const document = source("Use EMCC with the sysman account, then run RMAN and inspect tnsnames.");
  expect(await inspectPossibleTypos(document)).toEqual([]);
});

test("checks only the conditional workshop variant that is rendered", async () => {
  const document = source([
    '<if type="livelabs">',
    "# Review the Workshop Environment Setup (Optional)",
    "## Introduction",
    "This visible sentence is correct.",
    "</if>",
    '<if type="freetier">',
    "# Set Up the Workshop Environment",
    "## Task 1: Log in to the Oracle Cloud Console",
    "Then then click the image with the selcted option.",
    "</if>",
  ].join("\n"));
  document.renderedUrl = "https://example.test/workshops/livelabs/index.html?lab=setup-workshop-environment";

  expect(inspectMarkdownFormatting(document)).toEqual([]);
  expect(inspectWritingGrammar(document)).toEqual([]);
  expect(await inspectPossibleTypos(document)).toEqual([]);
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
