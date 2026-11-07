import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  focusProject,
  inProject,
  projectStatus,
  type ProjectStatus,
} from "@core/workspace/focus";
import type { Organization } from "@core/workspace/organization";
import { cn } from "cn";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ProjectTree } from "./project-tree";

const statusTabs = [
  { value: "all", label: "All" },
  { value: "active", label: "Focus" },
  { value: "later", label: "Later" },
  { value: "completed", label: "Completed" },
] as const;

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
      const state = projectStatus(data.projects?.find((p) => p.name === name));
      return mode === "later"
        ? !focusProject(name, data.projects) &&
            (state === "later" ||
              (state === "completed" &&
                Object.entries(data.projectCounts || {}).some(
                  ([child, count]) => inProject(child, name) && count > 0,
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
        <div
          role="tablist"
          aria-label="Project status"
          className="mb-4 inline-flex items-center gap-1 rounded-lg bg-muted/70 p-1"
        >
          {statusTabs.map((tab) => (
            <Button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={status === tab.value}
              variant="ghost"
              size="xs"
              onClick={() => setStatus(tab.value)}
              className={cn(
                "h-7 rounded-md px-2.5 text-xs font-medium transition-colors",
                status === tab.value
                  ? "bg-background text-foreground shadow-2xs hover:bg-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </Button>
          ))}
        </div>
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
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {search.trim()
              ? "No matching projects found."
              : mode === "later"
                ? "No projects waiting in Later."
                : "No projects yet."}
          </p>
          {!search.trim() && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={onAdd}
              className="mt-1 gap-1.5"
            >
              <Plus className="size-3.5" />
              New project
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
