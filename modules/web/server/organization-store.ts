import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  colors,
  type Organization,
  type OrganizationChange,
  type SavedFilter,
  type SavedTag,
} from "../shared/organization.ts";
import { filterArguments, tagName } from "../../../src/core/tasks/filter.ts";

const empty = (): Organization => ({ revision: 0, filters: [], tags: [] });
export function createOrganizationStore(path: string) {
  let queue: Promise<unknown> = Promise.resolve();
  async function read(): Promise<Organization> {
    try {
      const data = JSON.parse(await readFile(path, "utf8"));
      if (!Number.isInteger(data.revision) || !Array.isArray(data.filters) || !Array.isArray(data.tags))
        throw new Error("The filters and labels file is invalid. Check the data file.");
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
      throw error;
    }
  }
  function change(
    input: OrganizationChange,
    available: SavedTag[],
    effect: (oldTag: SavedTag, next?: SavedTag) => Promise<unknown>,
  ) {
    const operation = queue
      .catch(() => undefined)
      .then(async () => {
        const data = await read();
        if (input.revision !== data.revision)
          throw Object.assign(new Error("Changed in another window. Reload before saving. Your draft is kept."), {
            status: 409,
          });
        if (!["filter", "tag"].includes(input.kind) || !["save", "delete"].includes(input.action))
          throw new Error("Unsupported action");
        const item = input.item;
        if (!item || typeof item.id !== "string" || item.id.length > 160) throw new Error("Invalid item");
        const list = input.kind === "filter" ? data.filters : data.tags;
        const old = (input.kind === "tag" ? available : list).find((x) => x.id === item.id);
        let next: SavedFilter | SavedTag | undefined;
        if (input.action === "save") {
          if (
            typeof item.name !== "string" ||
            !item.name.trim() ||
            item.name.trim().length > 60 ||
            /[\0\r\n]/.test(item.name)
          )
            throw new Error("Name must contain 1–60 characters.");
          if (!colors.some((c) => c.id === item.color) || typeof item.favorite !== "boolean")
            throw new Error("Choose a valid color and favorite setting.");
          if (
            (input.kind === "tag" ? available : list).some(
              (x) => x.id !== item.id && x.name.toLocaleLowerCase() === item.name.trim().toLocaleLowerCase(),
            )
          )
            throw new Error("This name already exists.");
          next = { id: old?.id || randomUUID(), name: item.name.trim(), color: item.color, favorite: item.favorite };
          if (input.kind === "tag") tagName(next.name);
          else {
            const filter = item as SavedFilter;
            if (typeof filter.description !== "string" || filter.description.length > 500)
              throw new Error("Description must be 500 characters or fewer.");
            filterArguments(filter.expression);
            next = { ...next, description: filter.description, expression: filter.expression.trim() };
          }
        } else if (!old) throw new Error("This item no longer exists. Reload to continue.");
        if (input.kind === "tag" && old && (input.action === "delete" || next?.name !== old.name))
          await effect(old, next);
        const updated = list.filter((x) => x.id !== item.id && x.name !== old?.name);
        if (next) updated.push(next);
        if (input.kind === "filter") data.filters = updated as SavedFilter[];
        else {
          data.tags = updated as SavedTag[];
          if (old && next && old.name !== next.name)
            data.filters = data.filters.map((filter) => ({
              ...filter,
              expression: filterArguments(filter.expression)
                .map((token) =>
                  token === `+${old.name}` ? `+${next.name}` : token === `-${old.name}` ? `-${next.name}` : token,
                )
                .map((token) => (/\s/.test(token) ? JSON.stringify(token) : token))
                .join(" "),
            }));
        }
        data.revision++;
        await mkdir(dirname(path), { recursive: true });
        const temporary = path + "." + randomUUID() + ".tmp";
        try {
          await writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
          await rename(temporary, path);
        } catch (error) {
          throw Object.assign(error as Error, { outcome: "unknown" });
        }
        return data;
      });
    queue = operation;
    return operation;
  }
  return { read, change };
}
