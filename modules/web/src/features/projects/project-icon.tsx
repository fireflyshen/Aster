import { itemColor, type SavedProject } from "@core/workspace/organization";
import { Hash } from "lucide-react";
import { createContext, useContext, useMemo, type ReactNode } from "react";

const ProjectColors = createContext<ReadonlyMap<string, string>>(new Map());

export function ProjectColorsProvider({
  projects,
  children,
}: {
  projects: SavedProject[];
  children: ReactNode;
}) {
  const colors = useMemo(
    () =>
      new Map(
        projects.map((project) => [
          project.name,
          itemColor(project.color || "gray"),
        ]),
      ),
    [projects],
  );
  return <ProjectColors value={colors}>{children}</ProjectColors>;
}

export function ProjectIcon({
  name,
  className = "size-4 shrink-0",
}: {
  name: string;
  className?: string;
}) {
  const color = useContext(ProjectColors).get(name) || itemColor("gray");
  return (
    <Hash
      className={className}
      style={{ color }}
      strokeWidth={1.5}
      aria-hidden
    />
  );
}
