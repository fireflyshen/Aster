import type { TimeReceipt } from "./time-api";

export type LedgerMutation = <T extends TimeReceipt | Record<string, unknown>>(
  label: string,
  action: () => Promise<T>,
  options?: { undoable?: boolean; onError?: (message: string) => void },
) => Promise<T | undefined>;
