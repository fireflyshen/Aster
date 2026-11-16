import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

export type StateHistorySource = "auto" | "web" | "mcp" | "tui" | "migration";

export interface StateHistoryEntry {
  at: string;
  uuid: string;
  from: string | null;
  to: string;
  source: StateHistorySource;
  actor?: string;
  reason?: string;
  waitReason?: string;
  checkDate?: string;
}

export type AppendStateHistoryInput = Omit<StateHistoryEntry, "at"> & {
  at?: string;
};

/** Manages the append-only `state-history.jsonl` audit log. */
export function createStateHistoryStore(filePath: string) {
  let queue: Promise<unknown> = Promise.resolve();

  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.catch(() => undefined).then(fn);
    queue = next;
    return next;
  }

  async function append(
    input: AppendStateHistoryInput,
  ): Promise<StateHistoryEntry> {
    const entry: StateHistoryEntry = {
      at: input.at || new Date().toISOString(),
      uuid: input.uuid,
      from: input.from,
      to: input.to,
      source: input.source,
      ...(input.actor ? { actor: input.actor } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.waitReason ? { waitReason: input.waitReason } : {}),
      ...(input.checkDate ? { checkDate: input.checkDate } : {}),
    };
    await serial(async () => {
      await mkdir(dirname(filePath), { recursive: true });
      await appendFile(filePath, `${JSON.stringify(entry)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
    });
    return entry;
  }

  async function read(options?: {
    uuid?: string;
    limit?: number;
  }): Promise<StateHistoryEntry[]> {
    const uuidFilter = options?.uuid?.trim();
    const limit = Math.max(
      1,
      Math.min(
        500,
        Number.isFinite(options?.limit) ? Number(options?.limit) : 50,
      ),
    );
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const entries: StateHistoryEntry[] = [];
    const lines = raw.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
      const line = lines[i]?.trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as StateHistoryEntry;
        if (!parsed || typeof parsed.uuid !== "string") continue;
        if (uuidFilter && parsed.uuid !== uuidFilter) continue;
        entries.push(parsed);
      } catch {
        // Ignore malformed trailing lines safely without breaking audit reads.
      }
    }
    return entries;
  }

  async function replaceAll(entries: StateHistoryEntry[]): Promise<void> {
    await serial(async () => {
      await mkdir(dirname(filePath), { recursive: true });
      const tmp = `${filePath}.${randomUUID()}.tmp`;
      const content = entries.map((entry) => JSON.stringify(entry)).join("\n");
      await writeFile(tmp, content ? `${content}\n` : "", { mode: 0o600 });
      await rename(tmp, filePath);
    });
  }

  async function readAll(): Promise<StateHistoryEntry[]> {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const entries: StateHistoryEntry[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as StateHistoryEntry;
        if (parsed && typeof parsed.uuid === "string") {
          entries.push(parsed);
        }
      } catch {
        // Ignore malformed lines safely.
      }
    }
    return entries;
  }

  return {
    filePath,
    append,
    read,
    readAll,
    replaceAll,
  };
}

export type StateHistoryStore = ReturnType<typeof createStateHistoryStore>;
