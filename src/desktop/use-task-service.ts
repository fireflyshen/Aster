import { getPreferenceValues } from "@raycast/api";
import { useState } from "react";
import { resolveConnection, type TaskwarriorPreferences } from "../core/connection/settings.ts";
import { createTaskService, type TaskService } from "../core/tasks/service.ts";

export function useTaskService(provided?: TaskService) {
  // Freeze the connection for this view; edits must target the list's source.
  const [service] = useState(
    () => provided ?? createTaskService(resolveConnection(getPreferenceValues<TaskwarriorPreferences>())),
  );
  return service;
}
