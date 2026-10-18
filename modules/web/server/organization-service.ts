import type { createTaskService } from "../../../src/core/tasks/service.ts";
import { createOrganizationStore } from "./organization-store.ts";
import type { OrganizationChange, SavedFilter } from "../shared/organization.ts";

export function createOrganizationService(service: ReturnType<typeof createTaskService>, path: string) {
  const organization = createOrganizationStore(path);
  async function loadOrganization() {
    const [data, actualTags, pending] = await Promise.all([
      organization.read(),
      service.loadTags(),
      service.loadTasks(),
    ]);
    const tags = new Map(data.tags.map((tag) => [tag.name, { ...tag, count: 0 }]));
    for (const name of actualTags) {
      if (!tags.has(name)) tags.set(name, { id: `tag:${name}`, name, color: "gray", favorite: false, count: 0 });
    }
    for (const task of pending)
      for (const name of task.tags) {
        if (!tags.has(name)) tags.set(name, { id: `tag:${name}`, name, color: "gray", favorite: false, count: 0 });
        tags.get(name)!.count++;
      }
    const projectCounts: Record<string, number> = Object.create(null);
    for (const task of pending) if (task.project) projectCounts[task.project] = (projectCounts[task.project] || 0) + 1;
    return {
      ...data,
      projectCounts,
      tags: [...tags.values()].sort((a, b) => a.name.localeCompare(b.name)),
      actualTags,
    };
  }
  async function change(input: unknown) {
    if (!input || typeof input !== "object") throw new Error("Invalid request format");
    const value = input as OrganizationChange;
    if (value.kind === "filter" && value.action === "save")
      await service.filterTasks((value.item as SavedFilter)?.expression);
    const available = await loadOrganization();
    await organization.change(value, available.tags, (old, next) =>
      available.actualTags.includes(old.name) ? service.changeTag(old.name, next?.name) : Promise.resolve(),
    );
    try {
      const { actualTags: _, ...data } = await loadOrganization();
      return data;
    } catch (error) {
      throw Object.assign(error as Error, { outcome: "unknown" });
    }
  }
  return { load: loadOrganization, change };
}
