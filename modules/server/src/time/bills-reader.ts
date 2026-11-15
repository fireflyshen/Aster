import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BillExpenseItem } from "../../../core/time/model.ts";

const FALLBACK_FX_CENTS_PER_UNIT: Record<string, number> = {
  CNY: 100,
  USD: 720,
  GBP: 920,
  EUR: 780,
  HKD: 92,
  JPY: 5,
  SGD: 530,
};

function unescapeBeanString(raw: string): string {
  return raw.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function collectBeanFiles(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectBeanFiles(full, out);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".bean") &&
      entry.name !== "index.bean"
    ) {
      out.push(full);
    }
  }
}

export function resolveBillsJournalDir(explicitBillsDir?: string): string | null {
  const candidates: string[] = [];
  if (explicitBillsDir) {
    candidates.push(explicitBillsDir);
  }
  if (process.env.ASTER_BILLS_DIR) {
    candidates.push(process.env.ASTER_BILLS_DIR);
  }
  if (!explicitBillsDir) {
    candidates.push(resolve(process.cwd(), "..", "Bills"));
    const siblingFromModule = fileURLToPath(
      new URL("../../../../../Bills", import.meta.url),
    );
    candidates.push(siblingFromModule);
  }

  for (const base of candidates) {
    if (!base) continue;
    const journalDir = existsSync(join(base, "journal"))
      ? join(base, "journal")
      : base;
    if (existsSync(journalDir)) {
      return journalDir;
    }
  }
  return null;
}

type ParsedPosting = {
  account: string;
  amount: number;
  currency: string;
  inlineCnyTotal?: number;
  inlineCnyRate?: number;
};

function parseInlinePrice(tail: string): {
  inlineCnyTotal?: number;
  inlineCnyRate?: number;
} {
  const totalMatch = tail.match(/@@\s*([-+]?\d+(?:\.\d+)?)\s*CNY\b/);
  if (totalMatch) {
    const val = Number(totalMatch[1]);
    if (Number.isFinite(val)) return { inlineCnyTotal: Math.abs(val) };
  }
  const rateMatch = tail.match(/@\s*([-+]?\d+(?:\.\d+)?)\s*CNY\b/);
  if (rateMatch) {
    const val = Number(rateMatch[1]);
    if (Number.isFinite(val)) return { inlineCnyRate: Math.abs(val) };
  }
  return {};
}

function toCnyCents(
  posting: ParsedPosting,
  counterCnyTotal: number | undefined,
): number {
  if (posting.currency === "CNY") {
    return Math.round(posting.amount * 100);
  }
  if (posting.inlineCnyTotal !== undefined) {
    return Math.round(posting.inlineCnyTotal * 100);
  }
  if (posting.inlineCnyRate !== undefined) {
    return Math.round(posting.amount * posting.inlineCnyRate * 100);
  }
  if (counterCnyTotal !== undefined) {
    return Math.round(counterCnyTotal * 100);
  }
  const fx = FALLBACK_FX_CENTS_PER_UNIT[posting.currency] ?? 100;
  return Math.round(posting.amount * fx);
}

const TX_HEADER_RE =
  /^(\d{4}-\d{2}-\d{2})\s+[*!]\s+"((?:[^"\\]|\\.)*)"(?:\s+"((?:[^"\\]|\\.)*)")?(.*)$/;
const META_RE = /^\s+([a-zA-Z0-9_-]+):\s*"((?:[^"\\]|\\.)*)"/;
const POSTING_RE =
  /^\s+((?:Expenses|Assets|Liabilities|Equity|Income):[A-Za-z0-9:_-]+)\s+([-+]?\d+(?:\.\d+)?)\s+([A-Z]{2,8})\b(.*)$/;

function parseBeanFileExpenses(filePath: string): BillExpenseItem[] {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const lines = content.split(/\r?\n/);
  const items: BillExpenseItem[] = [];
  const shortFile = basename(filePath);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const header = line.match(TX_HEADER_RE);
    if (!header) {
      i += 1;
      continue;
    }

    const startLine = i + 1;
    const date = header[1];
    const payee = unescapeBeanString(header[2]);
    const narration = header[3] ? unescapeBeanString(header[3]) : "";
    const rest = header[4] ?? "";
    const tags: string[] = [];
    for (const m of rest.matchAll(/#([A-Za-z0-9_-]+)/g)) {
      if (m[1]) tags.push(m[1]);
    }

    const meta: Record<string, string> = Object.create(null);
    const expensePostings: ParsedPosting[] = [];
    const cnyCounterPostings: number[] = [];

    i += 1;
    while (i < lines.length && (/^\s+/.test(lines[i]) || lines[i].trim() === "")) {
      const sub = lines[i];
      if (sub.trim() === "") {
        i += 1;
        break;
      }
      if (sub.trimStart().startsWith(";")) {
        i += 1;
        continue;
      }
      const metaMatch = sub.match(META_RE);
      if (metaMatch) {
        meta[metaMatch[1]] = unescapeBeanString(metaMatch[2]);
        i += 1;
        continue;
      }
      const postMatch = sub.match(POSTING_RE);
      if (postMatch) {
        const account = postMatch[1];
        const amount = Number(postMatch[2]);
        const currency = postMatch[3];
        const tail = postMatch[4] ?? "";
        if (Number.isFinite(amount)) {
          if (account.startsWith("Expenses:") && amount > 0) {
            expensePostings.push({
              account,
              amount,
              currency,
              ...parseInlinePrice(tail),
            });
          } else if (
            !account.startsWith("Expenses:") &&
            currency === "CNY" &&
            amount < 0
          ) {
            cnyCounterPostings.push(Math.abs(amount));
          }
        }
      }
      i += 1;
    }

    if (expensePostings.length === 0) continue;

    const singleCounterCny =
      expensePostings.length === 1 && cnyCounterPostings.length === 1
        ? cnyCounterPostings[0]
        : undefined;
    const source = meta.source || "Bills";
    const txId = meta.tx_id || `${shortFile}:${startLine}`;
    const payTime = meta.pay_time || date;
    const note = meta.note;

    expensePostings.forEach((posting, idx) => {
      const suffix = expensePostings.length > 1 ? `#${idx + 1}` : "";
      const txKey = `${source}:${txId}${suffix}`;
      items.push({
        txKey,
        source,
        txId: `${txId}${suffix}`,
        payTime,
        date,
        payee,
        narration,
        account: posting.account,
        amount: posting.amount,
        currency: posting.currency,
        cnyAmountCents: toCnyCents(posting, singleCounterCny),
        tags,
        ...(note ? { note } : {}),
        journalFile: shortFile,
        lineNumber: startLine,
      });
    });
  }

  return items;
}

export function listBillExpenses(options?: {
  billsDir?: string;
  fromDate?: string;
  toDate?: string;
  q?: string;
  limit?: number;
}): { available: boolean; expenses: BillExpenseItem[] } {
  const dir = resolveBillsJournalDir(options?.billsDir);
  if (!dir) {
    return { available: false, expenses: [] };
  }

  const files: string[] = [];
  collectBeanFiles(dir, files);
  files.sort((a, b) => b.localeCompare(a));

  const query = options?.q?.trim().toLowerCase();
  const fromDate = options?.fromDate?.trim();
  const toDate = options?.toDate?.trim();
  const limit = Math.max(1, Math.min(500, options?.limit ?? 100));

  const matched: BillExpenseItem[] = [];
  for (const file of files) {
    // Quick prune on YYYY-MM.bean filenames when date filter is supplied
    const nameMatch = basename(file).match(/^(\d{4}-\d{2})\.bean$/);
    if (nameMatch) {
      const monthPrefix = nameMatch[1];
      if (fromDate && `${monthPrefix}-31` < fromDate) continue;
      if (toDate && `${monthPrefix}-01` > toDate) continue;
    }

    const parsed = parseBeanFileExpenses(file);
    for (const item of parsed) {
      if (fromDate && item.date < fromDate) continue;
      if (toDate && item.date > toDate) continue;
      if (query) {
        const haystack = [
          item.payee,
          item.narration,
          item.account,
          item.source,
          item.txId,
          item.note ?? "",
          ...item.tags,
        ]
          .join("\n")
          .toLowerCase();
        if (!haystack.includes(query)) continue;
      }
      matched.push(item);
    }
  }

  matched.sort(
    (a, b) =>
      b.payTime.localeCompare(a.payTime) || b.lineNumber - a.lineNumber,
  );
  return {
    available: true,
    expenses: matched.slice(0, limit),
  };
}
