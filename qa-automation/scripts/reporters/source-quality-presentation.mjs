const SOURCE_CODES = new Set(["POSSIBLE_TYPO", "WRITING_GRAMMAR", "MARKDOWN_FORMATTING"]);
const ADVICE_FIELDS = new Set(["suggestion", "suggestions", "correctedText", "replacement", "replacementText", "replaceWith", "action"]);
export const SOURCE_QUALITY_PRESENTATION = Object.freeze({ mode: "location-only", showReplacement: false, showFixAdvice: false });

function stripAdvice(value) {
  if (Array.isArray(value)) return value.map(stripAdvice);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !ADVICE_FIELDS.has(key)).map(([key, entry]) => [key, stripAdvice(entry)]));
  return value;
}

function rewriteDiagnostics(value, oldErrors, message) {
  if (typeof value === "string") {
    for (const error of oldErrors) if (error) value = value.split(error).join(message);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => rewriteDiagnostics(entry, oldErrors, message));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .map(([key, entry]) => [key, rewriteDiagnostics(entry, oldErrors, message)]));
  return value;
}

export function locationOnlyExport(original) {
  const data = structuredClone(original);
  data.presentation = { ...(data.presentation || {}), sourceQuality: { ...SOURCE_QUALITY_PRESENTATION } };
  for (const item of data.items) {
    item.issues = item.issues.map((issue) => {
      if (!SOURCE_CODES.has(issue.code)) return issue;
      const updated = stripAdvice(issue);
      updated.presentation = { ...SOURCE_QUALITY_PRESENTATION };
      if (issue.code === "POSSIBLE_TYPO") {
        updated.problem = `The highlighted word${issue.findingCount === 1 ? " may be" : "s may be"} misspelled. The exact source lines and lab locations are shown.`;
      }
      updated.affectedItems = (updated.affectedItems || []).map((entry) => ({ ...entry,
        detail: [entry.location ? `Found in ${entry.location}` : "", entry.sourceLine ? `Markdown line ${entry.sourceLine}` : "",
          entry.sourceText ? `Source: ${entry.sourceText}` : ""].filter(Boolean).join(" / "),
        presentation: { ...SOURCE_QUALITY_PRESENTATION } }));
      return updated;
    });
    item.evidence = (item.evidence || []).map((evidence) => {
      if (!SOURCE_CODES.has(evidence.classification?.code)) return evidence;
      const issues = item.issues.filter((issue) =>
        ((issue.file && issue.file === evidence.file) || (issue.section && issue.section === evidence.section)));
      const message = `Source-quality evidence, location-only presentation.\n${JSON.stringify(issues, null, 2)}`;
      const updated = rewriteDiagnostics(evidence, evidence.errors || [], message);
      updated.errors = [message];
      updated.bugSummary = message;
      updated.presentation = { ...SOURCE_QUALITY_PRESENTATION };
      return updated;
    });
  }
  return data;
}
