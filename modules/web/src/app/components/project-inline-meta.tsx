import { Button } from "@/components/ui/button";
import { FormattedDescription } from "@/features/tasks/description-content";
import type {
    OrganizationChange,
    SavedProject,
} from "@core/workspace/organization";
import { Pencil, Target } from "lucide-react";

type ProjectInlineMetaProps = {
    currentProject: string;
    revision: number;
    currentProjectRecord?: SavedProject;
    isFocus: boolean;
    disabled: boolean;
    editingOutcome: boolean;
    setEditingOutcome: (open: boolean) => void;
    outcomeDraft: string;
    setOutcomeDraft: (value: string) => void;
    editingDesc: boolean;
    setEditingDesc: (open: boolean) => void;
    descDraft: string;
    setDescDraft: (value: string) => void;
    onSaveProject: (change: OrganizationChange) => Promise<boolean>;
};

/** Inline editor for project finish-line outcome and project notes below the view heading. */
export function ProjectInlineMeta({
    currentProject,
    revision,
    currentProjectRecord,
    isFocus,
    disabled,
    editingOutcome,
    setEditingOutcome,
    outcomeDraft,
    setOutcomeDraft,
    editingDesc,
    setEditingDesc,
    descDraft,
    setDescDraft,
    onSaveProject,
}: ProjectInlineMetaProps) {
    const projectOutcome = currentProjectRecord?.outcome;
    const projectDescription = currentProjectRecord?.description;

    const saveOutcome = (nextValue: string) => {
        const next = nextValue.trim();
        setEditingOutcome(false);
        if (next === (projectOutcome || "").trim()) return;
        if (isFocus && !next) return;
        void onSaveProject({
            kind: "project",
            action: "save",
            revision,
            originalName: currentProject,
            item: {
                name: currentProject,
                description: projectDescription || "",
                outcome: next,
                nextTask: currentProjectRecord?.nextTask || "",
                color: currentProjectRecord?.color,
            },
        });
    };

    const saveDescription = (nextValue: string) => {
        const next = nextValue.trim();
        setEditingDesc(false);
        if (next === (projectDescription || "").trim()) return;
        void onSaveProject({
            kind: "project",
            action: "save",
            revision,
            originalName: currentProject,
            item: {
                name: currentProject,
                description: next,
                outcome: projectOutcome,
                nextTask: currentProjectRecord?.nextTask || "",
                color: currentProjectRecord?.color,
            },
        });
    };

    return (
        <div className="-mt-3 mb-6 space-y-1.5">
            {(projectOutcome || isFocus || editingOutcome) &&
                (editingOutcome ? (
                    <form
                        onSubmit={(event) => {
                            event.preventDefault();
                            saveOutcome(outcomeDraft);
                        }}
                        className="flex items-center gap-2 rounded-lg border border-border/80 bg-background px-2.5 py-1 shadow-2xs focus-within:border-primary/60"
                    >
                        <Target
                            className="size-3.5 shrink-0 text-muted-foreground"
                            strokeWidth={1.8}
                        />
                        <input
                            type="text"
                            autoFocus
                            value={outcomeDraft}
                            maxLength={500}
                            disabled={disabled}
                            placeholder="完成这个项目需要达成什么结果？"
                            onChange={(event) =>
                                setOutcomeDraft(event.target.value)
                            }
                            onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                    event.preventDefault();
                                    setEditingOutcome(false);
                                }
                            }}
                            className="min-w-0 flex-1 bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/60"
                        />
                        <div className="flex shrink-0 items-center gap-1">
                            <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                onClick={() => setEditingOutcome(false)}
                                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                            >
                                取消
                            </Button>
                            <Button
                                type="submit"
                                size="xs"
                                className="h-6 px-2.5 text-xs"
                            >
                                保存
                            </Button>
                        </div>
                    </form>
                ) : (
                    <div className="group/target -ml-2.5 flex items-start gap-1.5 rounded-lg px-2.5 py-0.5 text-sm leading-6 text-foreground/85 transition-colors hover:bg-(--row-hover)">
                        <Target
                            className="mt-1 size-3.5 shrink-0 text-muted-foreground"
                            strokeWidth={1.8}
                        />
                        <div
                            onClick={() => {
                                setOutcomeDraft(projectOutcome || "");
                                setEditingOutcome(true);
                            }}
                            className="min-w-0 flex-1 cursor-pointer select-text transition-colors hover:text-foreground"
                        >
                            {projectOutcome ? (
                                <FormattedDescription text={projectOutcome} />
                            ) : (
                                <span className="italic text-muted-foreground/60">
                                    设定目标
                                </span>
                            )}
                        </div>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            disabled={disabled}
                            onClick={() => {
                                setOutcomeDraft(projectOutcome || "");
                                setEditingOutcome(true);
                            }}
                            className="size-6 shrink-0 opacity-0 transition-opacity group-hover/target:opacity-100 hover:bg-muted"
                            aria-label="编辑目标"
                            title="编辑目标"
                        >
                            <Pencil className="size-3 text-muted-foreground" />
                        </Button>
                    </div>
                ))}

            {editingDesc ? (
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        saveDescription(descDraft);
                    }}
                    className="space-y-1.5 rounded-lg border border-border/80 bg-background p-2.5 shadow-2xs focus-within:border-primary/60"
                >
                    <textarea
                        autoFocus
                        rows={3}
                        ref={(el) => {
                            if (el) {
                                el.style.height = "auto";
                                el.style.height = `${Math.max(72, el.scrollHeight)}px`;
                            }
                        }}
                        value={descDraft}
                        maxLength={2000}
                        disabled={disabled}
                        placeholder="添加项目备注、背景或说明…"
                        onInput={(event) => {
                            const el = event.currentTarget;
                            el.style.height = "auto";
                            el.style.height = `${Math.max(72, el.scrollHeight)}px`;
                        }}
                        onChange={(event) => setDescDraft(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Escape") {
                                event.preventDefault();
                                setEditingDesc(false);
                            } else if (
                                event.key === "Enter" &&
                                (event.metaKey || event.ctrlKey)
                            ) {
                                event.preventDefault();
                                event.currentTarget.form?.requestSubmit();
                            }
                        }}
                        className="w-full resize-y bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60"
                    />
                    <div className="flex items-center justify-between pt-0.5">
                        <span className="text-[11px] text-muted-foreground/60">
                            ⌘ Enter 保存 · Esc 取消
                        </span>
                        <div className="flex items-center gap-1.5">
                            <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                onClick={() => setEditingDesc(false)}
                                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                            >
                                取消
                            </Button>
                            <Button
                                type="submit"
                                size="xs"
                                className="h-6 px-2.5 text-xs"
                            >
                                保存
                            </Button>
                        </div>
                    </div>
                </form>
            ) : (
                <div className="group/desc -ml-2.5 flex items-start gap-2 rounded-lg px-2.5 py-0.5 transition-colors hover:bg-(--row-hover)">
                    <div
                        onClick={() => {
                            setDescDraft(projectDescription || "");
                            setEditingDesc(true);
                        }}
                        className="min-w-0 flex-1 cursor-pointer select-text text-sm leading-relaxed text-muted-foreground transition-colors hover:text-foreground/90"
                    >
                        {projectDescription ? (
                            <FormattedDescription text={projectDescription} />
                        ) : (
                            <span className="italic text-muted-foreground/60">
                                + 添加项目备注或说明…
                            </span>
                        )}
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={disabled}
                        onClick={() => {
                            setDescDraft(projectDescription || "");
                            setEditingDesc(true);
                        }}
                        className="size-6 shrink-0 opacity-0 transition-opacity group-hover/desc:opacity-100 hover:bg-muted"
                        aria-label="编辑描述"
                        title="编辑描述"
                    >
                        <Pencil className="size-3 text-muted-foreground" />
                    </Button>
                </div>
            )}
        </div>
    );
}
