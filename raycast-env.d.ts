/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Connection Mode - Choose local Taskwarrior 3 or a remote Linux VPS over SSH. */
  "connectionMode": "ssh" | "local",
  /** SSH Target - SSH host alias or user@host. Port and keys come from your system SSH config. */
  "sshTarget": string,
  /** Remote Task Command - SSH only: absolute path to Taskwarrior 3 on the VPS. */
  "remoteTaskCommand": string,
  /** Remote Taskrc - SSH only: absolute taskrc path. Clear to use the remote user’s default configuration. */
  "remoteTaskrc": string,
  /** Local Task Command - Local mode only: Taskwarrior 3 executable on macOS or inside WSL. */
  "taskCommand": string,
  /** WSL Distribution - Local Windows mode only: WSL distribution containing Taskwarrior 3. */
  "wslDistribution": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `my-tasks` command */
  export type MyTasks = ExtensionPreferences & {}
  /** Preferences accessible in the `quick-add` command */
  export type QuickAdd = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `my-tasks` command */
  export type MyTasks = {}
  /** Arguments passed to the `quick-add` command */
  export type QuickAdd = {}
}

