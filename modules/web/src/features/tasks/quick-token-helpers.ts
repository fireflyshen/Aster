import type { QuickToken } from "@core/tasks/quick-task";
import type { SavedTag } from "@core/workspace/organization";

export type TriggerKind = "#" | "@";

/** Replaces all non-ignored quick tokens of `kind` with a single replacement expression. */
export function replaceQuickTokenKind(
  text: string,
  tokens: QuickToken[],
  kind: QuickToken["kind"],
  expression: string,
): string {
  const matches = tokens.filter((t) => t.kind === kind && !t.ignored);
  let value = text;
  for (const token of [...matches].reverse()) {
    value = value.slice(0, token.start) + value.slice(token.end);
  }
  const clean = value.replace(/\s{2,}/g, " ").trimEnd();
  if (!clean) return expression;
  return expression ? `${clean} ${expression}` : clean;
}

/** Removes a single parsed quick token span and normalizes adjacent spaces. */
export function removeQuickTokenSpan(text: string, token: QuickToken): string {
  return (text.slice(0, token.start) + text.slice(token.end))
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Extracts trailing `#project` or `@label` autocomplete candidates from composer text. */
export function findQuickTriggerSuggestions(
  text: string,
  projects: string[],
  availableLabels: SavedTag[],
) {
  const match = /(?:^|\s)([#@])([^\s#@]*)$/.exec(text);
  const triggerKind = (match?.[1] as TriggerKind | undefined) || null;
  const query = (match?.[2] || "").toLocaleLowerCase();

  const projectSuggestions =
    triggerKind === "#"
      ? projects
          .filter((p) => p.toLocaleLowerCase().includes(query))
          .slice(0, 6)
      : [];
  const labelSuggestions =
    triggerKind === "@"
      ? availableLabels
          .filter((l) => l.name.toLocaleLowerCase().includes(query))
          .slice(0, 6)
      : [];

  function replaceTrailingTrigger(tokenText: string): string {
    if (!match) return text;
    const prefixLen = match[0].length - (1 + (match[2]?.length || 0));
    const replaceStart = text.length - match[0].length + prefixLen;
    return `${text.slice(0, replaceStart)}${tokenText} `;
  }

  return {
    triggerKind,
    projectSuggestions,
    labelSuggestions,
    replaceTrailingTrigger,
  };
}
