import { join, resolve } from "node:path";
import type { TaskService } from "../../../core/tasks/service.ts";
import { runMaintenanceBackup } from "../recovery/maintenance-backup.ts";

/** Resolves the live TaskChampion SQLite path from env, Taskwarrior config, or default VPS location. */
export async function resolveTaskchampionDbPath(
  service: Pick<TaskService, "dataDirectory">,
): Promise<string | undefined> {
  if (process.env.TASKCHAMPION_DB) return resolve(process.env.TASKCHAMPION_DB);
  try {
    const dir = (await service.dataDirectory()).trim();
    if (dir) return join(dir, "taskchampion.sqlite3");
  } catch {
    // Fall back cleanly if Taskwarrior data directory cannot be queried.
  }
  return "/var/lib/taskwarrior/taskchampion.sqlite3";
}

function readCliArg(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < argv.length) {
    return argv[idx + 1];
  }
  return undefined;
}

/** Handles `--maintenance-backup` CLI invocations and exits the process if handled. */
export async function runCliMaintenanceIfRequested(options: {
  argv?: string[];
  service: Pick<TaskService, "dataDirectory">;
  identity: string;
  dataDir: string;
  organizationFile: string;
  recoveryFile: string;
  timeFile: string;
  stateLogFile?: string;
  timeEnabled: boolean;
}): Promise<boolean> {
  const argv = options.argv ?? process.argv;
  if (!argv.includes("--maintenance-backup")) {
    return false;
  }

  const backupId =
    readCliArg(argv, "--backup-id") ||
    process.env.BACKUP_ID ||
    `maint-${Date.now()}`;
  const releaseId =
    readCliArg(argv, "--release-id") || process.env.RELEASE_ID || backupId;
  const taskchampionDbPath = await resolveTaskchampionDbPath(options.service);
  try {
    const result = await runMaintenanceBackup({
      backupId,
      releaseId,
      sourceIdentity: options.identity,
      dataDir: options.dataDir,
      organizationFile: options.organizationFile,
      recoveryFile: options.recoveryFile,
      timeFile: options.timeFile,
      stateLogFile: options.stateLogFile,
      taskchampionDbPath,
      timeEnabled: options.timeEnabled,
      allowUninitializedTime: argv.includes("--allow-uninitialized-time"),
    });
    process.stdout.write(JSON.stringify(result) + "\n");
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
