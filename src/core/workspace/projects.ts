import { inProject } from "./focus.ts";

export const projectParent = (name: string) =>
  name.slice(0, Math.max(0, name.lastIndexOf(".")));
export const projectLeaf = (name: string) =>
  name.slice(name.lastIndexOf(".") + 1);
export const projectPath = (name: string) => name.split(".").join(" / ");
export const remapProject = (name: string, from: string, to: string) =>
  inProject(name, from) ? to + name.slice(from.length) : name;

export function validateProjectName(name: string) {
  if (
    !name.trim() ||
    name.length > 200 ||
    /[\0\r\n]/.test(name) ||
    name.split(".").some((part) => !part.trim())
  )
    throw new Error(
      "Use a project path with non-empty names, up to 200 characters.",
    );
}

export function projectNames(names: readonly string[]) {
  const all = new Set<string>();
  for (const name of names) {
    let path = name;
    while (path && !all.has(path)) {
      all.add(path);
      path = projectParent(path);
    }
  }
  return [...all].sort((a, b) => a.localeCompare(b));
}

export type ProjectRow = {
  name: string;
  label: string;
  parent: string;
  depth: number;
  hasChildren: boolean;
};

// Iterative traversal: the hierarchy has no fixed depth or recursive render limit.
export function projectTree(
  names: readonly string[],
  collapsed: ReadonlySet<string> = new Set(),
  matches?: ReadonlySet<string>,
) {
  const all = projectNames(names);
  const visible = matches && new Set(projectNames([...matches]));
  const children = new Map<string, string[]>();
  for (const name of all) {
    if (visible && !visible.has(name)) continue;
    const parent = projectParent(name);
    const siblings = children.get(parent) || [];
    siblings.push(name);
    children.set(parent, siblings);
  }
  const stack = [...(children.get("") || [])]
    .reverse()
    .map((name) => ({ name, depth: 0 }));
  const rows: ProjectRow[] = [];
  while (stack.length) {
    const { name, depth } = stack.pop()!;
    const branch = children.get(name) || [];
    rows.push({
      name,
      label: projectLeaf(name),
      parent: projectParent(name),
      depth,
      hasChildren: !!branch.length,
    });
    if (!collapsed.has(name) || matches)
      for (let index = branch.length - 1; index >= 0; index--)
        stack.push({ name: branch[index], depth: depth + 1 });
  }
  return rows;
}

export const projectTaskCount = (
  name: string,
  counts: Record<string, number> = {},
) =>
  Object.entries(counts).reduce(
    (sum, [path, count]) => sum + (inProject(path, name) ? count : 0),
    0,
  );
