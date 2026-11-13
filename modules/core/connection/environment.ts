import path from "node:path";

export function prependExecutableDirectories(
  currentPath: string | undefined,
  executables: Array<string | undefined>,
  platform: NodeJS.Platform = process.platform,
): string {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const delimiter = platform === "win32" ? ";" : ":";
  const directories = executables.flatMap((executable) => {
    const value = executable?.trim();
    return value && pathApi.isAbsolute(value) ? [pathApi.dirname(value)] : [];
  });
  const existing = currentPath?.split(delimiter).filter(Boolean) ?? [];

  return [...new Set([...directories, ...existing])].join(delimiter);
}
