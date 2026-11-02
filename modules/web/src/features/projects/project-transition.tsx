import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
    FOCUS_LIMIT,
    inProject,
    projectStatus,
    type ProjectFocusChange,
    type ProjectStatus,
} from "@core/workspace/focus";
import type { Organization, SavedProject } from "@core/workspace/organization";
import { useState } from "react";

export function ProjectTransition({
    project,
    status,
    data,
    busy,
    blocked,
    error,
    onClose,
    onReload,
    onSave,
}: {
    project: SavedProject;
    status: ProjectStatus;
    data: Organization;
    busy: boolean;
    blocked: boolean;
    error: string;
    onClose: () => void;
    onReload: () => Promise<Organization | undefined>;
    onSave: (change: ProjectFocusChange) => Promise<boolean>;
}) {
    const [revision, setRevision] = useState(data.revision);
    const [outcome, setOutcome] = useState(project.outcome || "");
    const [replacement, setReplacement] = useState("");
    const [reloading, setReloading] = useState(false);
    const active = (data.projects || []).filter(
        (item) =>
            item.name !== project.name && projectStatus(item) === "active",
    );
    const replace = status === "active" && active.length >= FOCUS_LIMIT;
    const unfinished = Object.entries(data.projectCounts || {}).reduce(
        (count, [name, value]) =>
            count + (inProject(name, project.name) ? value : 0),
        0,
    );
    const verb =
        status === "active"
            ? "Activate"
            : status === "later"
              ? "Pause"
              : "Complete";
    const locked = busy || blocked || reloading;
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open && !busy) onClose();
            }}
        >
            <DialogContent
                showCloseButton={!busy}
                className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[480px]"
                onEscapeKeyDown={(event) => {
                    if (busy) event.preventDefault();
                }}
                onPointerDownOutside={(event) => {
                    if (busy) event.preventDefault();
                }}
            >
                <DialogHeader className="shrink-0 border-b px-5 py-4 pr-14 text-left">
                    <DialogTitle className="text-base">
                        {verb} project
                    </DialogTitle>
                    <DialogDescription className="break-words">
                        {project.name}
                    </DialogDescription>
                </DialogHeader>
                <form
                    className="flex min-h-0 flex-col"
                    onSubmit={async (event) => {
                        event.preventDefault();
                        if (locked || (replace && !replacement)) return;
                        if (
                            await onSave({
                                revision,
                                kind: "project",
                                action: "status",
                                name: project.name,
                                status,
                                ...(status === "active"
                                    ? {
                                          outcome,
                                          ...(replacement
                                              ? { replaceProject: replacement }
                                              : {}),
                                      }
                                    : {}),
                                ...(status === "completed"
                                    ? { remaining: "keep" as const }
                                    : {}),
                            })
                        )
                            onClose();
                    }}
                >
                    <div className="min-h-0 space-y-5 overflow-y-auto p-5">
                        {status === "active" ? (
                            <>
                                <div className="space-y-2">
                                    <Label htmlFor="focus-outcome">
                                        Finish line
                                    </Label>
                                    <Textarea
                                        id="focus-outcome"
                                        value={outcome}
                                        onChange={(event) =>
                                            setOutcome(event.target.value)
                                        }
                                        disabled={locked}
                                        maxLength={500}
                                        placeholder="What result would make this project complete?"
                                        className="min-h-24 text-base md:text-sm"
                                        required
                                    />
                                </div>
                                {replace && (
                                    <div className="space-y-2">
                                        <Label htmlFor="focus-replace">
                                            Pause a project to make room
                                        </Label>
                                        <Select
                                            value={replacement}
                                            onValueChange={setReplacement}
                                            disabled={locked}
                                        >
                                            <SelectTrigger
                                                id="focus-replace"
                                                className="w-full"
                                            >
                                                <SelectValue placeholder="Choose one of your three active projects" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {active.map((item) => (
                                                    <SelectItem
                                                        key={item.name}
                                                        value={item.name}
                                                    >
                                                        {item.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <p className="text-xs leading-5 text-muted-foreground">
                                            Its tasks and board positions will
                                            be kept in Later.
                                        </p>
                                    </div>
                                )}
                            </>
                        ) : (
                            <p className="text-sm leading-6 text-muted-foreground">
                                {status === "later"
                                    ? "This project will leave Focus. Its tasks and board positions will stay in Later."
                                    : `${unfinished ? `${unfinished} unfinished task${unfinished === 1 ? "" : "s"} will stay in this project and remain available in Later. ` : ""}You are confirming the result, not completing its tasks. No task status or board position will change.`}
                            </p>
                        )}
                        {error && (
                            <Alert variant="destructive">
                                <AlertDescription>
                                    {error}
                                    <Button
                                        type="button"
                                        variant="link"
                                        className="h-auto p-0 text-current"
                                        disabled={busy || reloading}
                                        onClick={async () => {
                                            setReloading(true);
                                            try {
                                                const latest = await onReload();
                                                if (latest) {
                                                    setRevision(
                                                        latest.revision,
                                                    );
                                                    setReplacement("");
                                                }
                                            } finally {
                                                setReloading(false);
                                            }
                                        }}
                                    >
                                        Reload and review
                                    </Button>
                                </AlertDescription>
                            </Alert>
                        )}
                    </div>
                    <footer className="flex shrink-0 justify-end gap-2 border-t px-5 py-4">
                        <Button
                            type="button"
                            variant="secondary"
                            disabled={busy}
                            onClick={onClose}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={
                                locked ||
                                (status === "active" && !outcome.trim()) ||
                                (replace && !replacement)
                            }
                        >
                            {busy ? (
                                <Spinner />
                            ) : replace ? (
                                "Pause and activate"
                            ) : (
                                `${verb} project`
                            )}
                        </Button>
                    </footer>
                </form>
            </DialogContent>
        </Dialog>
    );
}
