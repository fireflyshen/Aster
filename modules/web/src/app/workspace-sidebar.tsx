import { WorkspaceNavigation } from "./workspace-navigation";
import { Button } from "@/components/ui/button";
import { FilterIcon, LabelIcon, OrganizationIcon } from "@/components/icons";
import { itemColor, type Organization, type SavedFilter, type SavedTag } from "@shared/organization";
import type { View } from "@shared/tasks";
import { Asterisk, CalendarDays, CircleCheck, Clock3, Hash, Inbox, PanelLeft, Plus } from "lucide-react";

export const views: Record<View, string> = {
  pending: "Inbox",
  today: "Today",
  waiting: "Waiting",
  completed: "Completed",
};
const viewIcons = { pending: Inbox, today: CalendarDays, waiting: Clock3, completed: CircleCheck };

type WorkspaceSidebarProps = {
  navOpen: boolean;
  onOpenChange: (open: boolean) => void;
  view: View;
  currentProject: string;
  organizationPage: boolean;
  organization: Organization;
  hasActiveItem: boolean;
  activeEntry?: { kind: "filter" | "tag"; id: string };
  projects: string[];
  busy: boolean;
  needsCheck: boolean;
  organizationSaving: boolean;
  connectionLabel: string;
  onAdd: () => void;
  onEntry: (entry: { kind: "filter" | "tag"; item: SavedFilter | SavedTag }) => void;
  onView: (view: View) => void;
  onProject: (project: string) => void;
  onOrganization: () => void;
};

export function WorkspaceSidebar({
  navOpen,
  onOpenChange,
  view,
  currentProject,
  organizationPage,
  organization,
  activeEntry,
  hasActiveItem,
  projects,
  busy,
  needsCheck,
  organizationSaving,
  connectionLabel,
  onAdd,
  onEntry,
  onView,
  onProject,
  onOrganization,
}: WorkspaceSidebarProps) {
  return (
    <WorkspaceNavigation open={navOpen} onOpenChange={onOpenChange}>
      <div className="mb-5 flex h-8 items-center gap-2 px-3 text-sm font-semibold">
        <Asterisk className="size-5 text-primary" strokeWidth={1.6} />
        Aster
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Collapse sidebar"
          className="ml-auto text-muted-foreground"
          onClick={() => onOpenChange(false)}
        >
          <PanelLeft className="size-4" />
        </Button>
      </div>
      <Button
        variant="ghost"
        onClick={onAdd}
        disabled={busy || needsCheck}
        aria-keyshortcuts="Q"
        className="mb-3 h-9 w-full justify-start gap-2.5 px-3 font-medium text-primary"
      >
        <Plus className="size-5" />
        Add task<kbd className="ml-auto font-sans text-xs text-muted-foreground">Q</kbd>
      </Button>
      <nav aria-label="Task views" className="space-y-0.5">
        {(Object.entries(views) as [View, string][]).map(([value, label]) => {
          const Icon = viewIcons[value];
          return (
            <Button
              key={value}
              variant="navigation"
              disabled={busy || organizationSaving}
              aria-current={
                view === value && !currentProject && !organizationPage && !hasActiveItem ? "page" : undefined
              }
              onClick={() => {
                onView(value);
                if (innerWidth < 768) onOpenChange(false);
              }}
            >
              <Icon className="size-[18px]" />
              {label}
            </Button>
          );
        })}
        <Button
          variant="navigation"
          aria-current={organizationPage ? "page" : undefined}
          disabled={busy || organizationSaving}
          onClick={() => {
            onOrganization();
            if (innerWidth < 768) onOpenChange(false);
          }}
        >
          <OrganizationIcon className="size-[18px]" />
          Filters & labels
        </Button>
      </nav>
      {!![...organization.filters, ...organization.tags].filter((item) => item.favorite).length && (
        <>
          <p className="mt-7 mb-2 px-3 text-xs font-medium text-muted-foreground">Favorites</p>
          <nav aria-label="Favorites" className="space-y-0.5">
            {organization.filters
              .filter((item) => item.favorite)
              .map((item) => (
                <Button
                  key={item.id}
                  variant="navigation"
                  disabled={busy || organizationSaving}
                  aria-current={!organizationPage && activeEntry?.id === item.id ? "page" : undefined}
                  onClick={() => onEntry({ kind: "filter", item })}
                >
                  <FilterIcon className="size-[18px]" style={{ color: itemColor(item.color) }} />
                  <span className="truncate">{item.name}</span>
                </Button>
              ))}
            {organization.tags
              .filter((item) => item.favorite)
              .map((item) => (
                <Button
                  key={item.id}
                  variant="navigation"
                  disabled={busy || organizationSaving}
                  aria-current={!organizationPage && activeEntry?.id === item.id ? "page" : undefined}
                  onClick={() => onEntry({ kind: "tag", item })}
                >
                  <LabelIcon className="size-[18px]" style={{ color: itemColor(item.color) }} />
                  <span className="truncate">{item.name}</span>
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">{item.count || ""}</span>
                </Button>
              ))}
          </nav>
        </>
      )}
      <p className="mt-7 mb-2 px-3 text-xs font-medium text-muted-foreground">Projects</p>
      <nav aria-label="Project" className="flex-1 space-y-0.5">
        {projects.map((name) => (
          <Button
            key={name}
            variant="navigation"
            aria-current={currentProject === name && !organizationPage && !hasActiveItem ? "page" : undefined}
            disabled={busy || organizationSaving}
            onClick={() => {
              onProject(name);
              if (innerWidth < 768) onOpenChange(false);
            }}
          >
            <Hash className="size-[18px]" strokeWidth={1.5} />
            <span className="truncate">{name}</span>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {organization.projectCounts?.[name] || ""}
            </span>
          </Button>
        ))}
      </nav>
      <p className="mt-6 px-3 pb-2 text-xs text-muted-foreground">{connectionLabel}</p>
    </WorkspaceNavigation>
  );
}
