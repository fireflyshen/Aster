import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { OrganizationManager } from "@/features/organization/organization-manager";
import { FocusOverview } from "@/features/projects/focus-overview";
import { ProjectManager } from "@/features/projects/project-manager";
import { taskDate } from "@core/tasks/quick-task";
import { defaultBoard, type BoardChange } from "@core/workspace/board";
import type { ProjectStatus } from "@core/workspace/focus";
import type {
    Organization,
    OrganizationChange,
    SavedFilter,
    SavedProject,
    SavedTag,
} from "@core/workspace/organization";
import type { Task, TaskInput, View } from "@shared/tasks";
import { Search, X } from "lucide-react";
import { lazy, Suspense, type MutableRefObject } from "react";
import type { TaskRenderFn } from "../hooks/use-task-renderer";
import type { ActiveEntry } from "../hooks/use-workspace-navigation";
import { ProjectInlineMeta } from "./project-inline-meta";
import { WorkspaceHeading } from "./workspace-header";

const TaskBoard = lazy(() =>
    import("@/features/tasks/task-board").then((module) => ({
        default: module.TaskBoard,
    })),
);

type WorkspaceContentProps = {
    searchOpen: boolean;
    query: string;
    onQueryChange: (value: string) => void;
    layout: "list" | "board";
    onLayoutChange: (layout: "list" | "board") => void;
    completeBehavior?: import("../hooks/use-workspace-navigation").CompleteBehavior;
    onCompleteBehaviorChange?: (
        next: import("../hooks/use-workspace-navigation").CompleteBehavior,
    ) => void;
    boardScroll: MutableRefObject<number>;
    view: View;
    now: Date;
    currentProject: string;
    organizationPage: boolean;
    projectsPage: boolean;
    specialPage: boolean;
    organization: Organization;
    organizationError: string;
    organizationReady: boolean;
    organizationSaving: boolean;
    organizationBlocked: boolean;
    busy: boolean;
    loading: boolean;
    loaded: boolean;
    needsCheck: boolean;
    notice: string;
    boardDisabled: boolean;
    tasks: Task[];
    topLevelVisible: Task[];
    filterProjects: string[];
    activeEntry?: ActiveEntry;
    activeItem?: SavedFilter | SavedTag;
    currentProjectRecord?: SavedProject;
    currentProjectFocus?: SavedProject;
    projectOutcome?: string;
    projectDescription?: string;
    viewCounts: Partial<Record<View, number>>;
    viewMenuOpen: boolean;
    setViewMenuOpen: (open: boolean) => void;
    editingHeaderOutcome: boolean;
    setEditingHeaderOutcome: (open: boolean) => void;
    headerOutcomeDraft: string;
    setHeaderOutcomeDraft: (value: string) => void;
    editingHeaderDesc: boolean;
    setEditingHeaderDesc: (open: boolean) => void;
    headerDescDraft: string;
    setHeaderDescDraft: (value: string) => void;
    onOpenFocusPicker: () => void;
    onSelectProject: (name: string) => void;
    onSelectView: (view: View) => void;
    onOpenEntry: (entry: ActiveEntry) => void;
    onOpenOrganization: () => void;
    onTransitionProject: (name: string, status: ProjectStatus) => void;
    onAddSubproject: (parentName: string) => void;
    onEditProject: (name: string) => void;
    onDeleteProject: (name: string) => void;
    onChangeOrganization: (change: OrganizationChange) => Promise<boolean>;
    onSaveProjectField: (
        name: string,
        patch: { outcome?: string; nextTask?: string },
    ) => Promise<boolean>;
    onLoadOrganization: () => Promise<Organization | undefined>;
    onClearOrganizationError: () => void;
    onChangeBoard: (change: BoardChange) => Promise<boolean>;
    onReloadBoard: () => Promise<Organization | undefined>;
    onReloadAll: () => Promise<Organization | undefined>;
    onRestoreEnergy: () => Promise<unknown>;
    onRescheduleOverdue: (overdueTasks: Task[]) => Promise<void>;
    onOpenEditor: (task?: Task, initial?: TaskInput) => void;
    onMoveTask: (
        task: Task,
        columnId: string,
        beforeUuid?: string | null,
        parentUuid?: string | null,
    ) => Promise<boolean>;
    onCreateTaskInView: (
        input: TaskInput & { taskDescription?: string },
        columnId?: string,
    ) => Promise<boolean>;
    renderTask: TaskRenderFn;
};

/** Renders workspace header, active alert notices, search bar, management pages, and unified task view. */
export function WorkspaceContent(props: WorkspaceContentProps) {
    const {
        searchOpen,
        query,
        onQueryChange,
        layout,
        onLayoutChange,
        boardScroll,
        completeBehavior,
        onCompleteBehaviorChange,
        view,
        now,
        currentProject,
        organizationPage,
        projectsPage,
        specialPage,
        organization,
        organizationError,
        organizationReady,
        organizationSaving,
        organizationBlocked,
        busy,
        loading,
        loaded,
        needsCheck,
        notice,
        boardDisabled,
        tasks,
        topLevelVisible,
        filterProjects,
        activeEntry,
        activeItem,
        currentProjectRecord,
        currentProjectFocus,
        projectOutcome,
        projectDescription,
        viewCounts,
        viewMenuOpen,
        setViewMenuOpen,
        editingHeaderOutcome,
        setEditingHeaderOutcome,
        headerOutcomeDraft,
        setHeaderOutcomeDraft,
        editingHeaderDesc,
        setEditingHeaderDesc,
        headerDescDraft,
        setHeaderDescDraft,
        onOpenFocusPicker,
        onSelectProject,
        onSelectView,
        onOpenEntry,
        onOpenOrganization,
        onTransitionProject,
        onAddSubproject,
        onEditProject,
        onDeleteProject,
        onChangeOrganization,
        onSaveProjectField,
        onLoadOrganization,
        onClearOrganizationError,
        onChangeBoard,
        onReloadBoard,
        onReloadAll,
        onRestoreEnergy,
        onRescheduleOverdue,
        onOpenEditor,
        onMoveTask,
        onCreateTaskInView,
        renderTask,
    } = props;

    return (
        <main className="workspace-frame pb-16 pt-2">
            {searchOpen && (
                <div className="mb-3 max-w-sm">
                    <InputGroup>
                        <InputGroupAddon>
                            <Search className="size-3.5 text-muted-foreground" />
                        </InputGroupAddon>
                        <InputGroupInput
                            id="task-search"
                            autoFocus
                            value={query}
                            onChange={(e) => onQueryChange(e.target.value)}
                            placeholder="搜索任务..."
                            aria-label="搜索任务"
                        />
                        {query && (
                            <InputGroupButton
                                size="icon-xs"
                                variant="ghost"
                                aria-label="清除搜索"
                                onClick={() => onQueryChange("")}
                            >
                                <X className="size-3.5" />
                            </InputGroupButton>
                        )}
                    </InputGroup>
                </div>
            )}

            <Tabs
                value={layout}
                onValueChange={(next) =>
                    onLayoutChange(next === "board" ? "board" : "list")
                }
            >
                <WorkspaceHeading
                    view={view}
                    now={now}
                    currentProject={currentProject}
                    organizationPage={organizationPage}
                    projectsPage={projectsPage}
                    specialPage={specialPage}
                    organizationReady={organizationReady}
                    organizationSaving={organizationSaving}
                    busy={busy}
                    activeEntry={
                        activeEntry
                            ? {
                                  kind: activeEntry.kind,
                                  id: activeEntry.item.id,
                              }
                            : undefined
                    }
                    activeItem={activeItem}
                    currentProjectFocus={currentProjectFocus}
                    projectOutcome={projectOutcome}
                    projectDescription={projectDescription}
                    viewCounts={viewCounts}
                    viewMenuOpen={viewMenuOpen}
                    setViewMenuOpen={setViewMenuOpen}
                    completeBehavior={completeBehavior}
                    onCompleteBehaviorChange={onCompleteBehaviorChange}
                    onSelectProject={onSelectProject}
                    onSelectView={onSelectView}
                    onTransitionProject={onTransitionProject}
                    onAddSubproject={onAddSubproject}
                    onStartEditDesc={() => {
                        setHeaderDescDraft(projectDescription || "");
                        setEditingHeaderDesc(true);
                    }}
                    onStartEditOutcome={() => {
                        setHeaderOutcomeDraft(projectOutcome || "");
                        setEditingHeaderOutcome(true);
                    }}
                    onEditProject={onEditProject}
                    onDeleteProject={onDeleteProject}
                    onManageOrganization={onOpenOrganization}
                />

                {currentProject && !organizationPage && (
                    <ProjectInlineMeta
                        currentProject={currentProject}
                        revision={organization.revision}
                        currentProjectRecord={currentProjectRecord}
                        isFocus={Boolean(currentProjectFocus)}
                        disabled={
                            busy || organizationSaving || !organizationReady
                        }
                        editingOutcome={editingHeaderOutcome}
                        setEditingOutcome={setEditingHeaderOutcome}
                        outcomeDraft={headerOutcomeDraft}
                        setOutcomeDraft={setHeaderOutcomeDraft}
                        editingDesc={editingHeaderDesc}
                        setEditingDesc={setEditingHeaderDesc}
                        descDraft={headerDescDraft}
                        setDescDraft={setHeaderDescDraft}
                        onSaveProject={onChangeOrganization}
                    />
                )}

                {notice && (
                    <Alert variant="destructive" className="mb-4">
                        <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span>{notice}</span>
                            <div className="flex items-center gap-2">
                                {/energy exhausted|精力已耗尽/i.test(
                                    notice,
                                ) && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-7 px-2.5 text-xs"
                                        disabled={organizationSaving}
                                        onClick={() => void onRestoreEnergy()}
                                    >
                                        恢复 +30 精力
                                    </Button>
                                )}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2.5 text-xs"
                                    disabled={loading || busy}
                                    onClick={() => void onReloadAll()}
                                >
                                    {needsCheck ? "刷新并检查" : "重试"}
                                </Button>
                            </div>
                        </AlertDescription>
                    </Alert>
                )}

                {organizationPage ? (
                    projectsPage ? (
                        <div className="space-y-8">
                            <FocusOverview
                                data={organization}
                                tasks={tasks}
                                loading={loading}
                                disabled={boardDisabled}
                                error={organizationError}
                                onChooseProject={onOpenFocusPicker}
                                onPause={(name) =>
                                    onTransitionProject(name, "later")
                                }
                                onComplete={(name) =>
                                    onTransitionProject(name, "completed")
                                }
                                onOpen={onSelectProject}
                                onEdit={onEditProject}
                                onAddTask={(name, nextDraft) =>
                                    onOpenEditor(undefined, {
                                        description: "",
                                        tags: [],
                                        ...(nextDraft || {}),
                                        project: name,
                                    })
                                }
                                onCreateTask={(input, name) =>
                                    onCreateTaskInView({
                                        ...input,
                                        project: name,
                                    })
                                }
                                onSelectNext={(name, nextUuid) =>
                                    void onSaveProjectField(name, {
                                        nextTask: nextUuid,
                                    })
                                }
                                onUpdateOutcome={(name, outcome) =>
                                    onSaveProjectField(name, { outcome })
                                }
                                renderTask={(task, extraActions) =>
                                    renderTask(task, extraActions, "list", 0)
                                }
                            />
                            <ProjectManager
                                data={organization}
                                projects={filterProjects}
                                error={organizationError}
                                loading={loading}
                                disabled={boardDisabled}
                                onOpen={onSelectProject}
                                onAdd={() => onEditProject("")}
                                onAddChild={onAddSubproject}
                                onEdit={onEditProject}
                                onDelete={onDeleteProject}
                                onStatus={onTransitionProject}
                                onReload={() => void onLoadOrganization()}
                            />
                        </div>
                    ) : (
                        <OrganizationManager
                            data={organization}
                            error={organizationError}
                            busy={organizationSaving}
                            loading={loading}
                            blocked={organizationBlocked || needsCheck}
                            onChange={onChangeOrganization}
                            onOpen={onOpenEntry}
                            onReload={onLoadOrganization}
                        />
                    )
                ) : (
                    <TabsContent value={layout} className="mt-0 min-w-0">
                        <Suspense
                            fallback={
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Spinner className="size-4" />
                                    {layout === "board"
                                        ? "加载看板…"
                                        : "加载列表…"}
                                </div>
                            }
                        >
                            <TaskBoard
                                layout={layout}
                                initialScrollLeft={boardScroll.current}
                                onScrollPositionChange={(position) => {
                                    boardScroll.current = position;
                                }}
                                tasks={topLevelVisible}
                                allTasks={tasks}
                                board={organization.board || defaultBoard()}
                                revision={organization.revision}
                                saving={organizationSaving}
                                blocked={
                                    organizationBlocked ||
                                    needsCheck ||
                                    !organizationReady
                                }
                                error={organizationError}
                                onChange={onChangeBoard}
                                onReload={onReloadBoard}
                                onClearError={onClearOrganizationError}
                                loading={loading}
                                loaded={loaded}
                                disabled={boardDisabled}
                                renderTask={renderTask}
                                onMove={(
                                    task,
                                    columnId,
                                    beforeUuid,
                                    parentUuid,
                                ) =>
                                    onMoveTask(
                                        task,
                                        columnId,
                                        beforeUuid,
                                        parentUuid,
                                    )
                                }
                                onCreateTask={onCreateTaskInView}
                                projects={filterProjects}
                                availableLabels={organization.tags}
                                project={currentProject}
                                defaultProject={currentProject}
                                defaultDue={
                                    view === "today" ? taskDate(new Date()) : ""
                                }
                                todaySplit={
                                    layout === "list" &&
                                    view === "today" &&
                                    !currentProject &&
                                    !activeEntry
                                }
                                preserveTaskOrder={
                                    view === "urgency" &&
                                    !currentProject &&
                                    !activeEntry
                                }
                                onRescheduleOverdue={
                                    layout === "list"
                                        ? onRescheduleOverdue
                                        : undefined
                                }
                                canAddTask={
                                    view !== "completed" &&
                                    (!activeEntry || activeEntry.kind === "tag")
                                }
                                canAddSection={
                                    view !== "completed" &&
                                    !(view === "urgency" && !currentProject) &&
                                    !activeEntry &&
                                    !(layout === "board"
                                        ? false
                                        : view === "today" && !currentProject)
                                }
                                hasSearch={Boolean(query.trim())}
                                onClearSearch={() => onQueryChange("")}
                                onAdd={(nextDraft) =>
                                    onOpenEditor(undefined, nextDraft)
                                }
                            />
                        </Suspense>
                    </TabsContent>
                )}
            </Tabs>
        </main>
    );
}
