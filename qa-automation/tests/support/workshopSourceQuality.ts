import type { Page } from "@playwright/test";
import { spellCheckDocument } from "cspell-lib";
import MarkdownIt from "markdown-it";

import { WORKSHOP_DICTIONARY } from "../../config/workshopDictionary.js";
import { contentQualityIssue, type ContentQualityIssue } from "./contentQuality.js";
import { loadWorkshopSourceDocuments, type WorkshopSourceDocument } from "./parSourceDiscovery.js";

const NON_PROSE_MASK = "\uE000";
const ENGLISH_SIGNAL_WORDS = new Set([
  "and", "are", "click", "enter", "for", "from", "in", "is", "next", "of", "on", "open", "select", "that", "the", "then", "this", "to", "use", "with", "you", "your",
]);
const SPANISH_PORTUGUESE_SIGNAL_WORDS = new Set([
  "archivo", "arquivos", "clique", "compartimento", "con", "crear", "criar", "dados", "datos", "depois", "disponible", "donde", "el", "haga", "las", "los", "luego", "nombre", "onde", "pantalla", "para", "paso", "passo", "puede", "seleccione", "selecione", "seguinte", "sobre", "tela", "todos", "todas", "uma", "una", "usar", "veja", "voce", "voces",
]);

export interface SourceQualityDetail {
  label: string;
  marker: string;
  text: string;
  suggestion: string;
  location: string;
  pageUrl: string;
  sourceFileUrl: string;
  sourceLine: number;
  labTitle: string;
  labNumber?: number;
  section?: string;
}

export interface WorkshopSourceQualityResult {
  documentsScanned: number;
  issues: ContentQualityIssue[];
}

export async function collectWorkshopSourceQualityIssues(
  page: Page,
  contextName: string,
): Promise<WorkshopSourceQualityResult> {
  const { documents, scanErrors } = await loadWorkshopSourceDocuments(page);
  const markdownDetails = documents.flatMap(inspectMarkdownFormatting);
  const grammarDetails = documents.flatMap(inspectWritingGrammar);
  const typoDetails = (await Promise.all(documents.map(inspectPossibleTypos))).flat();
  const issues: ContentQualityIssue[] = [];
  if (scanErrors.length) issues.push(contentQualityIssue(
    "SOURCE_SCAN_INCOMPLETE", "Some instruction pages could not be checked", "minor",
    `The workshop opened, but ${scanErrors.length} source page(s) could not be read. ${documents.length} page(s) were checked.`,
    scanErrors.map((error) => ({ label: error.label, pageUrl: error.page_url, sourceFileUrl: error.source_file_url, error: error.error, location: error.label,
      suggestion: "Open this lab. If it is blank or missing, restore its Markdown file or correct the manifest path. If it opens correctly, investigate the source fetch before changing workshop content." })),
  ));

  if (markdownDetails.length > 0) {
    issues.push(
      contentQualityIssue(
        "MARKDOWN_FORMATTING",
        "Markdown formatting",
        "minor",
        `${contextName} contains ${markdownDetails.length} Markdown formatting problem${markdownDetails.length === 1 ? "" : "s"}.`,
        markdownDetails,
      ),
    );
  }
  if (grammarDetails.length > 0) {
    issues.push(
      contentQualityIssue(
        "WRITING_GRAMMAR",
        "Grammar or punctuation",
        "minor",
        `${contextName} contains ${grammarDetails.length} likely grammar or punctuation problem${grammarDetails.length === 1 ? "" : "s"}.`,
        grammarDetails,
      ),
    );
  }
  if (typoDetails.length > 0) {
    issues.push(
      contentQualityIssue(
        "POSSIBLE_TYPO",
        "Possible typo",
        "minor",
        `${contextName} contains ${typoDetails.length} word${typoDetails.length === 1 ? "" : "s"} that may be misspelled.`,
        typoDetails,
      ),
    );
  }

  return { documentsScanned: documents.length, issues };
}

export function inspectMarkdownFormatting(document: WorkshopSourceDocument): SourceQualityDetail[] {
  const lines = document.text.split(/\r?\n/);
  const proseLines = maskMarkdownNonProse(document.text, document.renderedUrl).split(/\r?\n/);
  const details: SourceQualityDetail[] = [];
  const strongMarkers: Array<{ line: number; marker: "**" | "__" }> = [];
  let fence: { marker: string; line: number } | undefined;
  let frontMatter = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    if (lineIndex === 0 && rawLine.trim() === "---") {
      frontMatter = true;
      continue;
    }
    if (frontMatter) {
      if (rawLine.trim() === "---") frontMatter = false;
      continue;
    }

    const fenceMatch = rawLine.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      if (!fence) fence = { marker: fenceMatch[1], line: lineIndex };
      else if (fence.marker[0] === fenceMatch[1][0] && fenceMatch[1].length >= fence.marker.length && rawLine.trim() === fenceMatch[1]) fence = undefined;
      continue;
    }
    if (fence) continue;

    const line = proseLines[lineIndex];
    if (/^\s*#{1,6}[^\s#]/.test(line) && !/^\s*#(?:!|include\b|define\b|ifn?def\b|endif\b|else\b|elif\b|pragma\b)/i.test(line)) {
      details.push(sourceDetail(document, lines, lineIndex, "Heading is missing a space", line.trim(), "Add one space after the # heading markers."));
    }
    for (const marker of ["**", "__"] as const) {
      const escapedMarker = marker === "**" ? "\\*\\*" : "__";
      const markerCount = strongMarkerMatches(line, marker).length;
      if (markerCount % 2 !== 0) continue;
      const pairedStrong = new RegExp(`(?<!\\\\)${escapedMarker}(.+?)${escapedMarker}`, "g");
      for (const match of line.matchAll(pairedStrong)) {
        const content = match[1] || "";
        if (/^[ \t]+\S/.test(content)) {
          details.push(sourceDetail(document, lines, lineIndex, `Space after opening ${marker}`, marker, `Remove the space immediately after the opening ${marker}.`));
        }
        if (/\S[ \t]+$/.test(content)) {
          details.push(sourceDetail(document, lines, lineIndex, `Space before closing ${marker}`, marker, `Remove the space immediately before the closing ${marker}.`));
        }
      }
    }
    for (const match of line.matchAll(/\][ \t]+\(/g)) {
      details.push(sourceDetail(document, lines, lineIndex, "Link contains a space before (", match[0], "Remove the space between ] and ( so the Markdown link renders."));
    }

    if (!/^\s*\*{3,}\s*$/.test(line)) {
      for (const match of line.matchAll(/(?<!\\)\*\*/g)) strongMarkers.push({ line: lineIndex, marker: "**" });
    }
    for (const match of strongMarkerMatches(line, "__")) strongMarkers.push({ line: lineIndex, marker: "__" });
  }

  if (fence) {
    details.push(sourceDetail(document, lines, fence.line, "Code block is not closed", lines[fence.line].trim(), `Add a closing ${fence.marker} fence.`));
  }

  for (const marker of ["**", "__"] as const) {
    const markers = strongMarkers.filter((entry) => entry.marker === marker);
    if (markers.length % 2 === 1) {
      const last = markers.at(-1);
      if (last) details.push(sourceDetail(document, lines, last.line, `Unmatched ${marker} marker`, marker, `Add or remove a ${marker} marker so the bold text has a matching pair.`));
    }
  }

  return deduplicateDetails(details);
}

export function inspectWritingGrammar(document: WorkshopSourceDocument): SourceQualityDetail[] {
  const lines = document.text.split(/\r?\n/);
  const proseLines = maskMarkdownNonProse(document.text, document.renderedUrl).split(/\r?\n/);
  const details: SourceQualityDetail[] = [];
  let inFence = false;
  let frontMatter = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    if (lineIndex === 0 && rawLine.trim() === "---") {
      frontMatter = true;
      continue;
    }
    if (frontMatter) {
      if (rawLine.trim() === "---") frontMatter = false;
      continue;
    }
    const line = proseLines[lineIndex];
    for (const match of line.matchAll(/\b([A-Za-z]{2,})[ \t]+\1\b/gi)) {
      if (/^(?:had|that)$/i.test(match[1])) continue;
      if (!sourceLineContainsMarker(rawLine, match[0])) continue;
      details.push(sourceDetail(document, lines, lineIndex, "Repeated word", match[0], `Remove one repeated "${match[1]}".`));
    }
    for (const match of line.matchAll(/\b[A-Za-z]+[ \t]+(?:[,;!?]|\.(?![A-Za-z0-9]))/g)) {
      const matchEnd = (match.index || 0) + match[0].length;
      if (match[0].trimEnd().endsWith("!") && line[matchEnd] === "[") continue;
      if (!sourceLineContainsMarker(rawLine, match[0])) continue;
      details.push(sourceDetail(document, lines, lineIndex, "Space before punctuation", match[0], "Remove the space before the punctuation mark."));
    }
    for (const match of line.matchAll(/[,;:!?][A-Za-z]/g)) {
      if (match[0].startsWith(";") && isHtmlEntityTerminator(line, match.index || 0)) continue;
      if (!sourceLineContainsMarker(rawLine, match[0])) continue;
      details.push(sourceDetail(document, lines, lineIndex, "Missing space after punctuation", match[0], "Add a space after the punctuation mark."));
    }
  }

  return deduplicateDetails(details);
}

function sourceLineContainsMarker(sourceLine: string, marker: string): boolean {
  const literalMarker = marker.trim().toLowerCase();
  return Boolean(literalMarker && sourceLine.toLowerCase().includes(literalMarker));
}

function strongMarkerMatches(line: string, marker: "**" | "__"): RegExpMatchArray[] {
  const pattern = marker === "**"
    ? /(?<!\\)\*\*/g
    : /(?<![\\A-Za-z0-9])__|__(?![A-Za-z0-9])/g;
  return Array.from(line.matchAll(pattern));
}

function isHtmlEntityTerminator(line: string, semicolonIndex: number): boolean {
  return /&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+)$/i.test(line.slice(0, semicolonIndex));
}

export async function inspectPossibleTypos(document: WorkshopSourceDocument): Promise<SourceQualityDetail[]> {
  const text = maskMarkdownNonProse(document.text, document.renderedUrl);
  if (hasStrongSpanishOrPortugueseSignal(text)) return [];
  const result = await spellCheckDocument(
    { uri: document.sourceUrl, text, languageId: "markdown", locale: "en,en-US,en-GB" },
    { generateSuggestions: true, noConfigSearch: true, forceCheck: true },
    {
      language: "en,en-US,en-GB",
      words: WORKSHOP_DICTIONARY,
      allowCompoundWords: true,
      minWordLength: 4,
      suggestionsTimeout: 1_000,
    },
  );
  const lines = document.text.split(/\r?\n/);
  const seen = new Set<string>();
  const details: SourceQualityDetail[] = [];

  for (const issue of result.issues) {
    const word = issue.text || "";
    const suggestion = issue.suggestions?.[0] || "";
    const lineIndex = lineIndexAtOffset(text, issue.offset);
    const key = `${word.toLowerCase()}|${lineIndex}`;
    if (!isHighConfidenceTypo(word, suggestion) || seen.has(key)) continue;
    seen.add(key);
    details.push(
      sourceDetail(
        document,
        lines,
        lineIndex,
        `Possible typo: ${word}`,
        word,
        `Review "${word}" and replace it with "${suggestion}" if that is the intended word.`,
      ),
    );
  }

  return details;
}

function sourceDetail(
  document: WorkshopSourceDocument,
  lines: string[],
  lineIndex: number,
  label: string,
  marker: string,
  suggestion: string,
): SourceQualityDetail {
  const safeLineIndex = Math.max(0, Math.min(lineIndex, Math.max(lines.length - 1, 0)));
  const section = nearestHeading(lines, safeLineIndex);
  return {
    label,
    marker: marker.trim(),
    text: (lines[safeLineIndex] || marker).replace(/\s+/g, " ").trim().slice(0, 280),
    suggestion,
    location: [document.label, section].filter(Boolean).join(" / "),
    pageUrl: document.renderedUrl,
    sourceFileUrl: document.sourceUrl,
    sourceLine: safeLineIndex + 1,
    labTitle: document.label,
    labNumber: document.labNumber,
    section,
  };
}

function nearestHeading(lines: string[], lineIndex: number): string | undefined {
  for (let index = lineIndex; index >= 0; index -= 1) {
    const heading = lines[index].match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) return heading[1].replace(/[*_`]/g, "").trim();
  }
  return undefined;
}

function maskMarkdownNonProse(text: string, renderedUrl: string): string {
  // Mask before removing tags, preserving offsets and original source line numbers.
  const prepared = maskInactiveWorkshopVariants(text, renderedUrl)
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, maskValue)
    .replace(/<!--[\s\S]*?(?:-->|$)/g, maskValue)
    .replace(/<(pre|copy|code)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, maskValue);
  const lines = prepared.split(/(?<=\n)/);
  for (const token of new MarkdownIt({ html: true }).parse(prepared, {})) {
    if (!["fence", "code_block"].includes(token.type) || !token.map) continue;
    for (let index = token.map[0]; index < token.map[1]; index++) lines[index] = maskValue(lines[index]);
  }
  return lines.map(maskNonProse).join("");
}

function maskInactiveWorkshopVariants(text: string, renderedUrl: string): string {
  const variant = renderedUrl.match(/\/workshops\/([^/?#]+)\//i)?.[1]?.toLowerCase();
  if (!variant) return text;

  return text.replace(
    /(<if\s+type\s*=\s*["']([^"']+)["'][^>]*>)([\s\S]*?)(<\/if\s*>)/gi,
    (block, openingTag: string, configuredTypes: string, content: string, closingTag: string) => {
      const types = configuredTypes.toLowerCase().split(/[\s,|]+/).filter(Boolean);
      if (!types.includes(variant)) return maskValue(block);
      return `${maskValue(openingTag)}${content}${maskValue(closingTag)}`;
    },
  );
}

function maskNonProse(value: string): string {
  return maskInlineCode(value)
    .replace(/https?:\/\/[^\s)>]+/gi, maskValue)
    .replace(/\b[A-Za-z][A-Za-z0-9+.-]*@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, maskValue)
    .replace(/(?<=\]\()[^)\n]+(?=\))/g, maskValue)
    .replace(/<[^>]+>/g, maskValue)
    .replace(/\{\{[^}\n]+\}\}/g, maskValue);
}

function maskInlineCode(value: string): string {
  return value.replace(/(`+)[\s\S]*?\1/g, maskValue);
}

function maskValue(value: string): string {
  return value.replace(/[^\r\n]/g, NON_PROSE_MASK);
}

function hasStrongSpanishOrPortugueseSignal(text: string): boolean {
  const words = new Set((text.toLowerCase().match(/\p{L}+/gu) || []).map((word) => word.normalize("NFD").replace(/\p{M}/gu, "")));
  const englishSignals = Array.from(words).filter((word) => ENGLISH_SIGNAL_WORDS.has(word)).length;
  const nonEnglishSignals = Array.from(words).filter((word) => SPANISH_PORTUGUESE_SIGNAL_WORDS.has(word)).length;
  return nonEnglishSignals >= 5 && nonEnglishSignals >= englishSignals + 2;
}

function isHighConfidenceTypo(word: string, suggestion: string): boolean {
  if (!(
    word.length >= 4 &&
    word === word.toLowerCase() &&
    /^[a-z]+(?:'[a-z]+)?$/.test(word) &&
    Boolean(suggestion) &&
    suggestion.toLowerCase() !== word.toLowerCase()
  )) return false;

  const normalizedWord = word.toLowerCase();
  const normalizedSuggestion = suggestion.toLowerCase();
  const maximumDistance = normalizedWord.length >= 8 ? 2 : 1;
  return transpositionAwareDistance(normalizedWord, normalizedSuggestion) <= maximumDistance;
}

function transpositionAwareDistance(left: string, right: string): number {
  const rows = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let row = 0; row <= left.length; row += 1) rows[row][0] = row;
  for (let column = 0; column <= right.length; column += 1) rows[0][column] = column;

  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + substitutionCost,
      );
      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        rows[row][column] = Math.min(rows[row][column], rows[row - 2][column - 2] + 1);
      }
    }
  }

  return rows[left.length][right.length];
}

function lineIndexAtOffset(text: string, offset: number): number {
  return text.slice(0, Math.max(0, offset)).split(/\r?\n/).length - 1;
}

function deduplicateDetails(details: SourceQualityDetail[]): SourceQualityDetail[] {
  const seen = new Set<string>();
  return details.filter((detail) => {
    const key = `${detail.label}|${detail.sourceFileUrl}|${detail.sourceLine}|${detail.marker}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
