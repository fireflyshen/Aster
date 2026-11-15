import { getPreferenceValues } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect, useState } from "react";
import type { Connection } from "../../../core/connection/settings.ts";
import {
  mergeTimerSnapshot,
  snapshotLiveStatus,
  type TrackedTimerSnapshot,
} from "../../../core/time/snapshot.ts";
import {
  createSshWorkspaceClient,
  createWorkspaceClient,
} from "../../../core/workspace/client.ts";

export function useWorkspace(connection: Connection) {
  const [configuration] = useState(() => {
    const address = getPreferenceValues<{
      webWorkspaceUrl?: string;
    }>().webWorkspaceUrl?.trim();
    if (address === "") return {};
    try {
      if (
        connection.kind === "ssh" &&
        (!address || address === "auto" || address === "http://localhost:4180")
      )
        return { client: createSshWorkspaceClient(connection) };
      return {
        client: createWorkspaceClient(
          !address || address === "auto" ? "http://localhost:4180" : address,
          connection,
        ),
      };
    } catch (error) {
      return { error: error as Error };
    }
  });
  const result = usePromise(
    async () => {
      if (configuration.error) throw configuration.error;
      return configuration.client?.load();
    },
    [],
    { onError: () => undefined },
  );

  const [trackedSnapshot, setTrackedSnapshot] =
    useState<TrackedTimerSnapshot | null>(null);
  const [monoNow, setMonoNow] = useState(() => performance.now());

  useEffect(() => {
    const incoming = result.data?.timerSnapshot;
    if (!incoming) return;
    const mono = performance.now();
    setTrackedSnapshot((prev) => mergeTimerSnapshot(prev, incoming, mono));
    setMonoNow(mono);
  }, [result.data?.timerSnapshot]);

  const canTick = snapshotLiveStatus(trackedSnapshot, monoNow).canTick;
  useEffect(() => {
    if (!canTick) return;
    const id = setInterval(() => {
      setMonoNow(performance.now());
    }, 15_000);
    return () => clearInterval(id);
  }, [canTick]);

  return {
    ...result,
    client: configuration.client,
    trackedSnapshot,
    monoNow,
  };
}
