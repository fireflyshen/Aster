import { getPreferenceValues } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import type { Connection } from "../core/connection/settings.ts";
import {
  createSshWorkspaceClient,
  createWorkspaceClient,
} from "../core/workspace/client.ts";

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
  return { ...result, client: configuration.client };
}
