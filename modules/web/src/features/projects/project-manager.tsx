import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
    focusProject,
    inProject,
    projectStatus,
    type ProjectStatus,
} from "@core/workspace/focus";
import type { Organization } from "@core/workspace/organization";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ProjectTree } from "./project-tree";

export function ProjectManager({
    data,
    mode = "all",
    onStatus,
    projects,
    loading,
    disabled,
    error,
    onAdd,
    onAddChild,
    onOpen,
    onEdit,
    onDelete,
    onReload,
}: {
    data: Organization;
    mode?: "all" | "later";
    onStatus: (name: string, status: ProjectStatus) => void;
    projects: string[];
    loading: boolean;
    disabled: boolean;
    error: string;
    onAdd: () => void;
    onAddChild: (name: string) => void;
    onOpen: (name: string) => void;
    onEdit: (name: string) => void;
    onDelete: (name: string) => void;
    onReload: () => void;
}) {
    const [status, setStatus] = useState("all");
    const [search, setSearch] = useState("");
    const matches = projects
        .filter((name) => {
            const state = projectStatus(
                data.projects?.find((p) => p.name === name),
            );
            return mode === "later"
                ? !focusProject(name, data.projects) &&
                      (state === "later" ||
                          (state === "completed" &&
                              Object.entries(data.projectCounts || {}).some(
                                  ([child, count]) =>
                                      inProject(child, name) && count > 0,
                              )))
                : status === "all" || state === status;
        })
        .filter((name) =>
            [name, data.projects?.find((p) => p.name === name)?.description]
                .join(" ")
                .toLocaleLowerCase()
                .includes(search.trim().toLocaleLowerCase()),
        );
    return (
        <section aria-label="Manage projects">
            <div className="mb-5 flex items-center gap-3">
                <Input
                    aria-label="Search projects"
                    placeholder="Search projects"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="min-w-0 flex-1 shadow-none"
                />
                <Button onClick={onAdd} disabled={disabled}>
                    <Plus className="size-4" />
                    Add project
                </Button>
            </div>
            {mode === "all" && (
                <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger
                        aria-label="Project status"
                        className="mb-4 w-36"
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {["all", "active", "later", "completed"].map(
                            (value) => (
                                <SelectItem key={value} value={value}>
                                    {value[0].toUpperCase() + value.slice(1)}
                                </SelectItem>
                            ),
                        )}
                    </SelectContent>
                </Select>
            )}
            {error && (
                <Alert variant="destructive" className="mb-4">
                    <AlertDescription>
                        {error}
                        <Button
                            variant="link"
                            onClick={onReload}
                            className="h-auto p-0 text-current"
                        >
                            Reload
                        </Button>
                    </AlertDescription>
                </Alert>
            )}
            {loading ? (
                <div
                    role="status"
                    className="flex items-center gap-2 py-8 text-sm text-muted-foreground"
                >
                    <Spinner className="size-4" />
                    Loading projects…
                </div>
            ) : (
                <ProjectTree
                    names={projects}
                    data={data}
                    matches={
                        search.trim() || mode === "later" || status !== "all"
                            ? new Set(matches)
                            : undefined
                    }
                    disabled={disabled}
                    onOpen={onOpen}
                    onAddChild={onAddChild}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onStatus={onStatus}
                />
            )}
            {!loading && !matches.length && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                    {search.trim() ? "No projects found" : "No projects yet"}
                </p>
            )}
        </section>
    );
}
