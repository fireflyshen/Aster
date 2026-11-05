import { isVirtualTag } from "./options.ts";

export function tagName(value: unknown): string {
  if (typeof value !== "string" || !/^[\p{L}\p{N}_@.][\p{L}\p{N}_@.-]{0,59}$/u.test(value) || isVirtualTag(value))
    throw new Error(
      "Labels must contain 1–60 characters, without spaces, command characters, or reserved virtual tags.",
    );
  return value;
}

// Tokenize arguments, never a shell command. Only read-only filter atoms reach Taskwarrior.
export function filterArguments(expression: string): string[] {
  if (typeof expression !== "string" || !expression.trim() || expression.length > 1024 || /[\0\r\n]/.test(expression))
    throw new Error("Enter a filter query, up to 1024 characters.");
  const tokens: string[] = [];
  let word = "",
    quote = "",
    started = false;
  const flush = () => {
    if (started) tokens.push(word);
    word = "";
    started = false;
  };
  for (let i = 0; i < expression.length; i++) {
    const c = expression[i];
    if (quote) {
      if (c === "\\" && expression[i + 1] === quote) word += expression[++i];
      else if (c === quote) quote = "";
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (/\s/.test(c)) flush();
    else if (c === "(" || c === ")") {
      flush();
      tokens.push(c);
    } else {
      word += c;
      started = true;
    }
  }
  flush();
  if (quote) throw new Error("Close the quotes in the query.");
  let depth = 0,
    needsTerm = true;
  const result = tokens.map((token) => {
    if (token === "(") {
      depth++;
      needsTerm = true;
      return token;
    }
    if (token === ")") {
      if (!depth || needsTerm) throw new Error("Check the parentheses in the query.");
      depth--;
      needsTerm = false;
      return token;
    }
    if (/^(and|or|xor)$/i.test(token)) {
      if (needsTerm) throw new Error("Add a filter condition on both sides of each operator.");
      needsTerm = true;
      return token.toLowerCase();
    }
    if (token.startsWith("@")) token = "+" + token.slice(1);
    if (
      !/^[+-][\p{L}\p{N}_@.][\p{L}\p{N}_@.-]{0,79}$/u.test(token) &&
      !/^(?!rc(?:\.|:))[a-z][a-z0-9_]*(?:\.[a-z]+)?:[^\0\r\n]*$/i.test(token)
    )
      throw new Error(`Unsupported “${token}”. Use +label, attribute:value, and / or, and parentheses.`);
    needsTerm = false;
    return token;
  });
  if (depth || needsTerm) throw new Error("Incomplete query. Check the conditions and parentheses.");
  return result;
}
