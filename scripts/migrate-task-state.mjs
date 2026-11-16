#!/usr/bin/env node
/**
 * Migrates existing open Taskwarrior tasks and `organization.json` descriptions
 * into the Aster task state machine schema.
 *
 * Usage:
 *   node scripts/migrate-task-state.mjs [options]
 *
 * Options:
 *   --dry-run             Preview changes without writing (default)
 *   --apply               Apply Taskwarrior UDA updates, org descriptions, and state history
 *   --org <path>          Path to organization.json (env: ORGANIZATION_FILE, default: data/organization.json)
 *   --state-log <path>    Path to state-history.jsonl (env: STATE_LOG_FILE)
 *   --habits-db <path>    Path to habits.sqlite (env: HABITS_DB_FILE)
 *   --task-command <cmd>  Taskwarrior executable (env: TASK_COMMAND, default: task)
 *   --taskrc <path>       Taskrc path (env: TASKRC)
 *   --ssh-target <host>   Optional SSH host target (env: SSH_TARGET)
 *   --help                Show usage help
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DOING_LIMIT = 5;
const VALID_STATES = new Set([
  "planned",
  "doing",
  "scheduled",
  "waiting",
  "parked",
]);

const STATE_SCHEMA = {
  "uda.state.type": "string",
  "uda.state.label": "状态",
  "uda.state.values": "planned,doing,scheduled,waiting,parked,",
  "uda.waitreason.type": "string",
  "uda.waitreason.label": "等待原因",
  "uda.statechanged.type": "date",
  "uda.statechanged.label": "状态变更时间",
  "urgency.uda.state.doing.coefficient": "6.0",
  "urgency.uda.state.parked.coefficient": "-6.0",
};

const READ_OVERRIDES = [
  "rc.json.array=on",
  "rc.color=off",
  "rc.verbose=nothing",
  "rc.gc=off",
  "rc.hooks=off",
];

const WRITE_OVERRIDES = [
  "rc.confirmation=off",
  "rc.recurrence.confirmation=no",
];

function parseArgs(argv) {
  const opts = {
    apply: false,
    orgFile: process.env.ORGANIZATION_FILE || "data/organization.json",
    stateLogFile: process.env.STATE_LOG_FILE || "",
    habitsDbFile: process.env.HABITS_DB_FILE || "",
    taskCommand: process.env.TASK_COMMAND || "task",
    taskrc: process.env.TASKRC ?? "",
    sshTarget: process.env.SSH_TARGET ?? "",
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") opts.apply = true;
    else if (arg === "--dry-run") opts.apply = false;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--org" && i + 1 < argv.length) opts.orgFile = argv[++i];
    else if (arg === "--state-log" && i + 1 < argv.length)
      opts.stateLogFile = argv[++i];
    else if (arg === "--habits-db" && i + 1 < argv.length)
      opts.habitsDbFile = argv[++i];
    else if (arg === "--task-command" && i + 1 < argv.length)
      opts.taskCommand = argv[++i];
    else if (arg === "--taskrc" && i + 1 < argv.length) opts.taskrc = argv[++i];
    else if (arg === "--ssh-target" && i + 1 < argv.length)
      opts.sshTarget = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  opts.orgFile = resolve(opts.orgFile);
  const dataDir = dirname(opts.orgFile);
  opts.stateLogFile = resolve(
    opts.stateLogFile || resolve(dataDir, "state-history.jsonl"),
  );
  opts.habitsDbFile = resolve(
    opts.habitsDbFile || resolve(dataDir, "habits.sqlite"),
  );
  if (!opts.taskrc && opts.sshTarget) {
    opts.taskrc = "/etc/taskwarrior/taskrc";
  }
  return opts;
}

function shellQuote(arg) {
  return `'${String(arg).replace(/'/g, `'"'"'`)}'`;
}

function formatTwTimestamp(date = new Date()) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function parseTwDate(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  const compact = trimmed.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
  );
  if (compact) {
    const [, y, m, d, hh, mm, ss] = compact;
    const ms = Date.parse(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`);
    return Number.isNaN(ms) ? null : ms;
  }
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : ms;
}

function sanitizeWaitReason(raw) {
  return String(raw || "")
    .replace(/[\r\n\0]+/g, " ")
    .trim()
    .slice(0, 200);
}

function buildTaskArgs(opts, commandArgs) {
  const schemaArgs = Object.entries(STATE_SCHEMA).map(
    ([key, value]) => `rc.${key}=${value}`,
  );
  const base = [];
  if (opts.taskrc) base.push(`rc:${opts.taskrc}`);
  base.push(...schemaArgs, ...commandArgs);
  return base;
}

async function runTask(opts, commandArgs) {
  const fullArgs = buildTaskArgs(opts, commandArgs);
  if (opts.sshTarget) {
    const remoteCmd = [opts.taskCommand, ...fullArgs].map(shellQuote).join(" ");
    const { stdout } = await execFileAsync("ssh", [opts.sshTarget, remoteCmd], {
      maxBuffer: 20 * 1024 * 1024,
    });
    return stdout;
  }
  const { stdout } = await execFileAsync(opts.taskCommand, fullArgs, {
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

async function loadHabitTaskUuids(habitsDbFile) {
  const uuids = new Set();
  try {
    await readFile(habitsDbFile);
  } catch (err) {
    if (err && err.code === "ENOENT") return uuids;
    return uuids;
  }
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(habitsDbFile, { readOnly: true });
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => r.name);
      if (tables.includes("habits")) {
        for (const row of db
          .prepare(
            "SELECT task_uuid FROM habits WHERE task_uuid IS NOT NULL AND task_uuid != ''",
          )
          .all()) {
          uuids.add(row.task_uuid);
        }
      }
      if (tables.includes("habit_instances")) {
        for (const row of db
          .prepare(
            "SELECT task_uuid FROM habit_instances WHERE task_uuid IS NOT NULL AND task_uuid != ''",
          )
          .all()) {
          uuids.add(row.task_uuid);
        }
      }
    } finally {
      db.close();
    }
  } catch {
    // Non-fatal: fall back cleanly to project.category checks only
  }
  return uuids;
}

function buildHabitProjectSet(projects = []) {
  const set = new Set();
  for (const project of projects) {
    if (project?.category === "habit" && project.name) {
      set.add(project.name);
    }
  }
  return set;
}

function isHabitProject(projectName, habitProjects) {
  if (!projectName) return false;
  const parts = String(projectName).split(".");
  for (let i = parts.length; i >= 1; i--) {
    if (habitProjects.has(parts.slice(0, i).join("."))) {
      return true;
    }
  }
  return false;
}

/**
 * Strips leading `等待：...` / `搁置` prefix line from an org description
 * and extracts the migrated state + optional waitReason.
 */
function parseDescriptionPrefix(description) {
  if (typeof description !== "string" || !description.trim()) return null;
  const lines = description.split(/\r?\n/);
  const first = lines[0]?.trim() || "";
  const restLines = lines.slice(1);
  while (restLines.length > 0 && restLines[0].trim() === "") {
    restLines.shift();
  }
  const remaining = restLines.join("\n").trim();

  const waitMatch = first.match(/^等待[：:]\s*(.+)$/);
  if (waitMatch) {
    const reason = sanitizeWaitReason(waitMatch[1]);
    if (reason) {
      return {
        state: "waiting",
        waitReason: reason,
        nextDescription: remaining,
      };
    }
  }
  const parkMatch = first.match(/^搁置(?:[：:]\s*(.*))?$/);
  if (parkMatch) {
    return {
      state: "parked",
      waitReason: undefined,
      nextDescription: remaining,
    };
  }
  return null;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      [
        "Aster task state machine migration (dry-run by default)",
        "",
        "Options:",
        "  --dry-run             Preview changes without writing (default)",
        "  --apply               Write Taskwarrior state UDAs, org descriptions & history",
        "  --org <path>          organization.json path",
        "  --state-log <path>    state-history.jsonl path",
        "  --habits-db <path>    habits.sqlite path",
        "  --task-command <cmd>  task binary (default: task)",
        "  --taskrc <path>       taskrc path",
        "  --ssh-target <host>   SSH host for remote Taskwarrior",
      ].join("\n"),
    );
    return;
  }

  let orgRaw;
  let org;
  try {
    orgRaw = await readFile(opts.orgFile, "utf8");
    org = JSON.parse(orgRaw);
  } catch (err) {
    throw new Error(
      `Failed to read organization file ${opts.orgFile}: ${err.message}`,
    );
  }

  const exportText = await runTask(opts, [
    "(",
    "status:pending",
    "or",
    "status:waiting",
    ")",
    ...READ_OVERRIDES,
    "export",
  ]);
  const allOpenTasks = JSON.parse(exportText || "[]");
  const habitProjects = buildHabitProjectSet(org.projects);
  const habitUuids = await loadHabitTaskUuids(opts.habitsDbFile);
  const subtasksMap =
    org.subtasks && typeof org.subtasks === "object" ? org.subtasks : {};
  const descriptionsMap =
    org.descriptions && typeof org.descriptions === "object"
      ? { ...org.descriptions }
      : {};

  const nowMs = Date.now();
  const openByUuid = new Map(allOpenTasks.map((t) => [t.uuid, t]));
  const alreadyMigrated = [];
  const skippedHabits = [];
  const pendingRoots = [];
  const pendingChildren = [];
  const fixedPlan = new Map(); // uuid -> plan object

  for (const task of allOpenTasks) {
    if (
      habitUuids.has(task.uuid) ||
      isHabitProject(task.project, habitProjects)
    ) {
      skippedHabits.push(task);
      continue;
    }
    const existingState =
      typeof task.state === "string" && VALID_STATES.has(task.state.trim())
        ? task.state.trim()
        : null;
    if (existingState) {
      alreadyMigrated.push({ task, state: existingState });
      continue;
    }

    const prefix = parseDescriptionPrefix(descriptionsMap[task.uuid]);
    if (prefix) {
      fixedPlan.set(task.uuid, {
        task,
        state: prefix.state,
        waitReason: prefix.waitReason,
        scheduled: undefined,
        clearWait: false,
        nextDescription: prefix.nextDescription,
        descriptionChanged: true,
        reason: "description_prefix",
      });
      continue;
    }

    const waitMs = parseTwDate(task.wait);
    if (task.status === "waiting" || (waitMs !== null && waitMs > nowMs)) {
      fixedPlan.set(task.uuid, {
        task,
        state: "scheduled",
        scheduled: task.wait || formatTwTimestamp(new Date(nowMs)),
        clearWait: true,
        reason: "future_wait",
      });
      continue;
    }

    const parentUuid = subtasksMap[task.uuid];
    if (parentUuid && openByUuid.has(parentUuid)) {
      pendingChildren.push({ task, parentUuid });
    } else {
      pendingRoots.push(task);
    }
  }

  const existingDoingCount = alreadyMigrated.filter(
    (entry) => entry.state === "doing",
  ).length;
  let remainingDoingSlots = Math.max(0, DOING_LIMIT - existingDoingCount);

  pendingRoots.sort((a, b) => {
    const dueA = parseTwDate(a.due);
    const dueB = parseTwDate(b.due);
    if (dueA !== null && dueB !== null && dueA !== dueB) return dueA - dueB;
    if (dueA !== null && dueB === null) return -1;
    if (dueA === null && dueB !== null) return 1;
    const urgA = Number(a.urgency || 0);
    const urgB = Number(b.urgency || 0);
    if (urgA !== urgB) return urgB - urgA;
    return String(a.description || "").localeCompare(
      String(b.description || ""),
    );
  });

  for (const task of pendingRoots) {
    const state = remainingDoingSlots > 0 ? "doing" : "planned";
    if (state === "doing") remainingDoingSlots--;
    fixedPlan.set(task.uuid, {
      task,
      state,
      reason: state === "doing" ? "top_urgency_root" : "default_planned",
    });
  }

  const resolveState = (uuid, visited = new Set()) => {
    if (visited.has(uuid)) return "planned";
    visited.add(uuid);
    const direct = fixedPlan.get(uuid);
    if (direct) return direct.state;
    const existing = openByUuid.get(uuid)?.state;
    if (typeof existing === "string" && VALID_STATES.has(existing.trim())) {
      return existing.trim();
    }
    const parent = subtasksMap[uuid];
    if (parent && openByUuid.has(parent)) {
      return resolveState(parent, visited);
    }
    return "planned";
  };

  for (const { task, parentUuid } of pendingChildren) {
    const inheritedState = resolveState(parentUuid);
    const plan = {
      task,
      state: inheritedState,
      inheritedFrom: parentUuid,
      reason: "subtask_inherit",
    };
    if (inheritedState === "scheduled") {
      const parentPlan = fixedPlan.get(parentUuid);
      const sched =
        parentPlan?.scheduled || openByUuid.get(parentUuid)?.scheduled;
      if (sched) plan.scheduled = sched;
    }
    fixedPlan.set(task.uuid, plan);
  }

  const counts = {
    doing: 0,
    planned: 0,
    scheduled: 0,
    waiting: 0,
    parked: 0,
    alreadyMigrated: alreadyMigrated.length,
    skippedHabits: skippedHabits.length,
  };
  const doingList = [];

  for (const { task, state } of alreadyMigrated) {
    counts[state] = (counts[state] || 0) + 1;
    if (state === "doing") doingList.push({ task, existing: true });
  }
  const plannedWrites = Array.from(fixedPlan.values());
  for (const plan of plannedWrites) {
    counts[plan.state] = (counts[plan.state] || 0) + 1;
    if (plan.state === "doing")
      doingList.push({ task: plan.task, existing: false });
  }

  console.log(
    `\nAster 任务状态机迁移 (${opts.apply ? "APPLY 模式" : "DRY-RUN 预览"})\n`,
  );
  console.log(`组织文件: ${opts.orgFile}`);
  console.log(`历史日志: ${opts.stateLogFile}`);
  console.log(`打开任务总数: ${allOpenTasks.length}`);
  console.log(
    `状态统计: doing=${counts.doing}, planned=${counts.planned}, scheduled=${counts.scheduled}, waiting=${counts.waiting}, parked=${counts.parked}`,
  );
  console.log(
    `待迁移任务: ${plannedWrites.length} (已迁移跳过: ${counts.alreadyMigrated}, 习惯任务跳过: ${counts.skippedHabits})`,
  );
  console.log("\n处理中 (doing) 列表:");
  if (doingList.length === 0) {
    console.log("  (无)");
  } else {
    for (const item of doingList) {
      const dueStr = item.task.due ? ` due=${item.task.due}` : "";
      const tag = item.existing ? "已存在" : "新迁入";
      console.log(
        `  - [${tag}] ${item.task.uuid}  ${item.task.description}${dueStr} (urg=${Number(item.task.urgency || 0).toFixed(2)})`,
      );
    }
  }

  if (!opts.apply) {
    console.log(
      "\n[DRY-RUN] 未写入任何修改。确认无误后建议先备份再使用 `--apply` 执行迁移：",
    );
    console.log(
      "  node scripts/migrate-task-state.mjs --apply --org " + opts.orgFile,
    );
    return;
  }

  if (plannedWrites.length === 0) {
    console.log("\n所有非习惯打开任务均已存在有效状态，无需写入（幂等完成）。");
    return;
  }

  const timestampCompact = formatTwTimestamp(new Date(nowMs));
  const backupFile = resolve(
    dirname(opts.orgFile),
    `pre-state-migration-${timestampCompact}.json`,
  );
  await mkdir(dirname(backupFile), { recursive: true });
  await writeFile(
    backupFile,
    JSON.stringify(
      {
        createdAt: new Date(nowMs).toISOString(),
        orgFile: opts.orgFile,
        openTasks: allOpenTasks,
        organization: org,
      },
      null,
      2,
    ),
    { encoding: "utf8", mode: 0o600 },
  );
  console.log(`\n已创建迁移前快照备份: ${backupFile}`);

  let orgDescriptionsUpdated = false;
  const historyLines = [];
  const changedAtIso = new Date(nowMs).toISOString();

  for (const plan of plannedWrites) {
    const modArgs = [plan.task.uuid, "modify", `state:${plan.state}`];
    if (plan.waitReason) {
      modArgs.push(`waitreason:${plan.waitReason}`);
    }
    if (plan.scheduled) {
      modArgs.push(`scheduled:${plan.scheduled}`);
    }
    if (plan.clearWait) {
      modArgs.push("wait:");
    }
    modArgs.push(`statechanged:${timestampCompact}`, ...WRITE_OVERRIDES);

    await runTask(opts, modArgs);

    if (plan.descriptionChanged) {
      if (plan.nextDescription) {
        descriptionsMap[plan.task.uuid] = plan.nextDescription;
      } else {
        delete descriptionsMap[plan.task.uuid];
      }
      orgDescriptionsUpdated = true;
    }

    historyLines.push(
      JSON.stringify({
        at: changedAtIso,
        uuid: plan.task.uuid,
        from: null,
        to: plan.state,
        source: "migration",
        reason: plan.reason,
        ...(plan.waitReason ? { waitReason: plan.waitReason } : {}),
        ...(plan.scheduled ? { checkDate: plan.scheduled } : {}),
      }),
    );
  }

  if (orgDescriptionsUpdated) {
    const nextOrg = {
      ...org,
      descriptions: descriptionsMap,
      revision: Number(org.revision || 0) + 1,
    };
    const tmpFile = resolve(
      dirname(opts.orgFile),
      `.${basename(opts.orgFile)}.migrate.tmp`,
    );
    await writeFile(tmpFile, `${JSON.stringify(nextOrg, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tmpFile, opts.orgFile);
    console.log("已更新 organization.json 描述与 revision。");
  }

  if (historyLines.length > 0) {
    await mkdir(dirname(opts.stateLogFile), { recursive: true });
    const existingHistory = await readFile(opts.stateLogFile, "utf8").catch(
      (err) => (err?.code === "ENOENT" ? "" : Promise.reject(err)),
    );
    const prefix =
      existingHistory && !existingHistory.endsWith("\n") ? "\n" : "";
    await writeFile(
      opts.stateLogFile,
      `${existingHistory}${prefix}${historyLines.join("\n")}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    console.log(
      `已追加 ${historyLines.length} 条迁移记录至 ${opts.stateLogFile}。`,
    );
  }

  console.log("\n迁移完成。");
}

main().catch((err) => {
  console.error(`Migration failed: ${err?.message || err}`);
  process.exitCode = 1;
});
