import type { TaskInput } from "../../../shared/tasks.ts";

export type QuickToken = {
  id: string;
  raw: string;
  start: number;
  end: number;
  kind: "project" | "tag" | "priority" | "due";
  value: string;
  label: string;
  ignored: boolean;
};

export function taskDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function dateValue(word: string, now: Date): Date | undefined {
  const clock = /^(.+?)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(word);
  if (clock) {
    const date = dateValue(clock[1], now);
    let hour = Number(clock[2]);
    const minute = Number(clock[3] || 0);
    if (!date || minute > 59 || (clock[4] ? hour < 1 || hour > 12 : hour > 23)) return;
    if (clock[4]) hour = (hour % 12) + (clock[4] === "pm" ? 12 : 0);
    date.setHours(hour, minute, 0, 0);
    return date;
  }
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  const relative: Record<string, number> = { 今天: 0, 明天: 1, 后天: 2, 大后天: 3, today: 0, tomorrow: 1 };
  if (Object.hasOwn(relative, word)) {
    date.setDate(date.getDate() + relative[word]);
    return date;
  }
  const days = /^(\d{1,3})天后$/.exec(word);
  if (days) {
    date.setDate(date.getDate() + Number(days[1]));
    return date;
  }
  if (word === "下周") {
    date.setDate(date.getDate() + ((8 - date.getDay()) % 7 || 7));
    return date;
  }
  const weekday = /^(下周|本周|周|星期)([一二三四五六日天])$/.exec(word);
  if (weekday) {
    const target = "日一二三四五六".indexOf(weekday[2] === "天" ? "日" : weekday[2]);
    const mondayOffset = (date.getDay() + 6) % 7;
    let delta = ((target + 6) % 7) - mondayOffset;
    if (weekday[1] === "下周" || (weekday[1] !== "本周" && delta < 0)) delta += 7;
    date.setDate(date.getDate() + delta);
    return date;
  }
  const exact = /^(\d{4})-(\d{2})-(\d{2})$/.exec(word);
  if (exact) {
    date.setFullYear(Number(exact[1]), Number(exact[2]) - 1, Number(exact[3]));
    if (date.getFullYear() === +exact[1] && date.getMonth() === +exact[2] - 1 && date.getDate() === +exact[3])
      return date;
  }
}

// Only recognized, space-separated expressions become fields. Everything else stays in the title.
export function parseQuickTask(
  text: string,
  { now = new Date(), ignored = [] }: { now?: Date; ignored?: string[] } = {},
) {
  const task: TaskInput = { description: "", project: "", due: "", priority: "", tags: [] };
  const tokens: QuickToken[] = [];
  const errors: string[] = [];
  const words: string[] = [];
  const occurrences = new Map<string, number>();
  for (const match of text.matchAll(
    /(?:today|tomorrow|今天|明天|后天|大后天|(?:下周|本周|周|星期)[一二三四五六日天]|(?:due:)?\d{4}-\d{2}-\d{2})(?:\s+(?:at\s+)?\d{1,2}(?::\d{2})?(?:am|pm)?)(?=\s|$)|[#@%](?:"[^"]*"|'[^']*'|[^\s]+)|"[^"]*"|'[^']*'|[^\s]+/gi,
  )) {
    const raw = match[0];
    const count = occurrences.get(raw) || 0;
    occurrences.set(raw, count + 1);
    const id = `${count}:${raw}`;
    const word = raw.toLowerCase();
    const unquote = (value: string) => value.replace(/^(["'])(.*)\1$/, "$2");
    let token: Omit<QuickToken, "id" | "raw" | "ignored" | "start" | "end"> | undefined;
    if (raw.startsWith("#") && raw.length > 1) {
      const value = unquote(raw.slice(1));
      token = { kind: "project", value, label: value };
    } else if (/^[@%].+/.test(raw)) {
      const value = unquote(raw.slice(1));
      token = { kind: "tag", value, label: value };
    } else if (/^p[1-4]$/.test(word)) {
      const value = ({ p1: "H", p2: "M", p3: "L", p4: "" } as Record<string, string>)[word];
      token = {
        kind: "priority",
        value,
        label: (
          { H: "High priority", M: "Medium priority", L: "Low priority", "": "No priority" } as Record<string, string>
        )[value],
      };
    } else {
      const date = dateValue(word.replace(/^due:/, ""), now);
      if (date) {
        const base = word.replace(/^due:/, "").split(/\s/)[0];
        const friendly = (
          {
            today: "Today",
            tomorrow: "Tomorrow",
            今天: "Today",
            明天: "Tomorrow",
            后天: "In 2 days",
            大后天: "In 3 days",
          } as Record<string, string>
        )[base];
        const withTime = /\s/.test(word);
        token = {
          kind: "due",
          value: taskDate(date),
          label:
            (friendly || new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date)) +
            (withTime
              ? ` ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
              : ""),
        };
      } else if (
        (word.startsWith("due:") ||
          /^\d{4}-\d{2}-\d{2}(?:\s|$)/.test(word) ||
          /^(?:today|tomorrow|今天|明天|后天|大后天|(?:下周|本周|周|星期)[一二三四五六日天])\s+(?:at\s+)?\d/.test(
            word,
          )) &&
        !ignored.includes(id)
      )
        errors.push(`Invalid date “${raw}”. Use YYYY-MM-DD.`);
    }
    if (!token) {
      words.push(unquote(raw));
      continue;
    }
    const disabled = ignored.includes(id);
    tokens.push({ ...token, id, raw, start: match.index, end: match.index + raw.length, ignored: disabled });
    if (disabled) {
      words.push(raw);
      continue;
    }
    if (token.kind === "tag") {
      if (!/^[\p{L}\p{N}_@.\-]{1,80}$/u.test(token.value))
        errors.push("Use letters, numbers, underscores, or hyphens for labels, up to 80 characters.");
      if (!task.tags.includes(token.value)) task.tags.push(token.value);
    } else {
      const field = token.kind === "due" ? "due" : token.kind;
      if (tokens.some((t) => t.id !== id && !t.ignored && t.kind === token.kind && t.value !== token.value))
        errors.push(`Specify only one ${{ due: "date", project: "project", priority: "priority" }[field]}.`);
      task[field] = token.value;
    }
  }
  task.description = words.join(" ").trim();
  if (task.description.length > 2000) errors.push("Task name must be 2000 characters or fewer.");
  if ((task.project?.length || 0) > 200) errors.push("Project name must be 200 characters or fewer.");
  if (task.tags.length > 30) errors.push("A task can have up to 30 labels.");
  return { task, tokens, errors: [...new Set(errors)] };
}
