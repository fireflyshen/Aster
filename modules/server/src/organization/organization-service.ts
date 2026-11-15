import type { createTaskService } from "../../../core/tasks/service.ts";
import { isVirtualTag } from "../../../core/tasks/options.ts";
import { loadTimewarriorIntervals } from "../../../core/tasks/timewarrior.ts";
import type { TimerSnapshot } from "../../../core/time/model.ts";
import {
    calculateEnergy,
    calculateTimeModeEnergy,
    type EnergySummary,
} from "../../../core/workspace/energy.ts";
import type {
    OrganizationChange,
    SavedFilter,
    WorkspaceTiming,
} from "../../../core/workspace/organization.ts";
import { projectNames } from "../../../core/workspace/projects.ts";
import { createOrganizationStore } from "./organization-store.ts";
import type { TimeStore } from "../time/time-store.ts";

export type OrganizationTimeBridge = {
    isEnabled: () => boolean;
    getEnergyInputs: TimeStore["getEnergyInputs"];
    getTimerSnapshot: TimeStore["getTimerSnapshot"];
};

export function createOrganizationService(
    service: ReturnType<typeof createTaskService>,
    path: string,
    timeBridge?: OrganizationTimeBridge,
) {
    const organization = createOrganizationStore(path);
    async function readWorkspace() {
        const timeActive = Boolean(timeBridge?.isEnabled());
        const [data, tasks, nativeProjects, legacyTiming] = await Promise.all([
            organization.read(),
            service.filterTasks("status.not:deleted"),
            service.loadProjects(),
            timeActive
                ? Promise.resolve({ available: true, intervals: [] })
                : loadTimewarriorIntervals(service.connection).then(
                      (intervals) => ({ available: true, intervals }),
                      () => ({ available: false, intervals: [] }),
                  ),
        ]);
        // _tags also returns configured suggestions such as nonag and nocal.
        // Only task-backed labels and explicitly saved labels are manageable here.
        const actualTags = [
            ...new Set(tasks.flatMap((task) => task.tags)),
        ].filter((name) => !isVirtualTag(name));
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
                projectCounts[task.project] =
                    (projectCounts[task.project] || 0) + 1;
        const taskUuids = tasks.map((task) => task.uuid);
        let timingInfo: WorkspaceTiming;
        let energy: EnergySummary | undefined;
        let timerSnapshot: TimerSnapshot | undefined;

        if (timeActive && timeBridge) {
            const inputs = timeBridge.getEnergyInputs();
            timerSnapshot = timeBridge.getTimerSnapshot({ taskUuids });
            if (!inputs.available) {
                timingInfo = {
                    available: false,
                    error: "Time ledger is temporarily unavailable while restoring. Retry shortly.",
                    backend: "time",
                    hardEnergyLimit: false,
                    timeEnabled: true,
                    timeAvailable: false,
                    timeError: "restoring",
                    energyPeriod: "06:00",
                };
            } else {
                energy = calculateTimeModeEnergy({
                    tasks,
                    activities: inputs.activities,
                    activeActivityId: inputs.activeActivityId,
                    timezone: inputs.timezone,
                    cutoverAtMs: inputs.cutoverAtMs,
                    importedRanges: inputs.importedRanges,
                    state: data.energyState,
                });
                timingInfo = {
                    available: true,
                    backend: "time",
                    hardEnergyLimit: false,
                    timeEnabled: true,
                    timeAvailable: true,
                    energyPeriod: `06:00 周期 (${inputs.timezone})`,
                    timezone: inputs.timezone,
                    historyComplete: energy.complete,
                };
            }
        } else {
            timingInfo = {
                available: legacyTiming.available,
                backend: "timewarrior",
                hardEnergyLimit: true,
                timeEnabled: false,
                timeAvailable: false,
                energyPeriod: "06:00",
                ...(!legacyTiming.available
                    ? {
                          error: "Timer history unavailable. Refresh before starting a task or changing energy.",
                      }
                    : {}),
            };
            energy = legacyTiming.available
                ? calculateEnergy(
                      tasks,
                      legacyTiming.intervals,
                      data.energyState,
                  )
                : undefined;
        }

        const result = {
            ...data,
            projects: projectNames([
                ...nativeProjects,
                ...tasks.flatMap((task) =>
                    task.project ? [task.project] : [],
                ),
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
            tags: [...tags.values()].sort((a, b) =>
                a.name.localeCompare(b.name),
            ),
            timing: timingInfo,
            energy,
            ...(timerSnapshot ? { timerSnapshot } : {}),
        };
        return {
            data: result,
            tasks,
            actualTags,
            intervals: legacyTiming.intervals,
        };
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
