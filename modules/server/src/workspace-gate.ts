export function createWorkspaceGate() {
  let exclusive = false;
  let readers = 0;
  let drained: (() => void) | undefined;
  return {
    enter() {
      if (exclusive)
        throw Object.assign(
          new Error(
            "Workspace restoration in progress. Wait for it to finish, then refresh.",
          ),
          { status: 423 },
        );
      readers++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (--readers === 0) drained?.();
      };
    },
    async exclusive<T>(operation: () => Promise<T>) {
      if (exclusive)
        throw Object.assign(new Error("Another restore is in progress."), {
          status: 423,
        });
      exclusive = true;
      try {
        if (readers)
          await new Promise<void>((resolve) => {
            drained = resolve;
          });
        return await operation();
      } finally {
        exclusive = false;
        drained = undefined;
      }
    },
  };
}
