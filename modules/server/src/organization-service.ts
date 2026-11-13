import type { createTaskService } from "../../core/tasks/service.ts";
import { isVirtualTag } from "../../core/tasks/options.ts";
import { loadTimewarriorIntervals } from "../../core/tasks/timewarrior.ts";
import { calculateEnergy } from "../../core/workspace/energy.ts";
import type {
  OrganizationChange,
  SavedFilter,
} from "../../core/workspace/organization.ts";
import { projectNames } from "../../core/workspace/projects.ts";
import { createOrganizationStore } from "./organization-store.ts";

export function createOrganizationService(
  service: ReturnType<typeof createTaskService>,
  path: string,
) {
  const organization = createOrganizationStore(path);
  async function readWorkspace() {
    const [data, tasks, nativeProjects, timing] = await Promise.all([
      organization.read(),
      service.filterTasks("status.not:deleted"),
      service.loadProjects(),
      loadTimewarriorIntervals(service.connection).then(
        (intervals) => ({ available: true, intervals }),
        () => ({ available: false, intervals: [] }),
      ),
    ]);
    // _tags also returns configured suggestions such as nonag and nocal.
    // Only task-backed labels and explicitly saved labels are manageable here.
    const actualTags = [...new Set(tasks.flatMap((task) => task.tags))].filter(
      (name) => !isVirtualTag(name),
    );
    const pending = tasks.filter(
      (task) => task.status === "pending" || task.status === "waiting",
    );
    const tags = new Map(
      data.tags.map((tag) => [tag.name, { ...tag, count: 0 }]),
    );
    for (const name of actualTags) {
      if (!tags.has(name))
        tags.set(name, {
          id: `tag:${name}`,
          name,
          color: "gray",
          favorite: false,
          count: 0,
        });
    }
    for (const task of pending)
      for (const name of task.tags) {
        if (!tags.has(name))
          tags.set(name, {
            id: `tag:${name}`,
            name,
            color: "gray",
            favorite: false,
            count: 0,
          });
        tags.get(name)!.count++;
      }
    const projectCounts: Record<string, number> = Object.create(null);
    for (const task of pending)
      if (task.project)
        projectCounts[task.project] = (projectCounts[task.project] || 0) + 1;
    const result = {
      ...data,
      projects: projectNames([
        ...nativeProjects,
        ...tasks.flatMap((task) => (task.project ? [task.project] : [])),
        ...(data.projects || []).map((project) => project.name),
      ])
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({
          ...data.projects?.find((project) => project.name === name),
          name,
          description:
            data.projects?.find((project) => project.name === name)
              ?.description || "",
        })),
      projectCounts,
      tags: [...tags.values()].sort((a, b) => a.name.localeCompare(b.name)),
      timing: {
        available: timing.available,
        ...(!timing.available
          ? {
              error:
                "Timer history unavailable. Refresh before starting a task or changing energy.",
            }
          : {}),
      },
      energy: timing.available
        ? calculateEnergy(tasks, timing.intervals, data.energyState)
        : undefined,
    };
    return { data: result, tasks, actualTags, intervals: timing.intervals };
  }
  async function loadOrganization() {
    return (await readWorkspace()).data;
  }
  async function change(input: unknown) {
    if (!input || typeof input !== "object")
      throw new Error("Invalid request format");
    const value = input as OrganizationChange;
    if (value.kind === "filter" && value.action === "save")
      await service.filterTasks((value.item as SavedFilter)?.expression);
    const {
      data: available,
      tasks,
      actualTags,
      intervals,
    } = await readWorkspace();
    if (value.kind === "energy" && !available.timing.available)
      throw new Error(
        "Timer history unavailable. Refresh before changing energy.",
      );
    const saved = await organization.change(
      value,
      available.tags,
      (old, next) =>
        actualTags.includes(old.name)
          ? service.changeTag(old.name, next?.name)
          : Promise.resolve(),
      {
        tasks,
        intervals,
        projectRecords: available.projects,
        projects: available.projects.map((project) => project.name),
        changeProject: service.changeProject,
      },
    );
    if (value.kind === "board")
      return {
        ...saved,
        projects: available.projects,
        tags: available.tags,
        projectCounts: available.projectCounts,
        energy: available.energy,
        timing: available.timing,
      };
    try {
      return await loadOrganization();
    } catch (error) {
      throw Object.assign(error as Error, { outcome: "unknown" });
    }
  }
  return {
    load: loadOrganization,
    snapshot: organization.read,
    restorePlacement: organization.restorePlacement,
    workspace: loadOrganization,
    change,
  };
}
