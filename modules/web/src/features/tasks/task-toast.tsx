import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { Toast } from "radix-ui";
import type { ReactNode } from "react";

export function TaskToast({
  open,
  onOpenChange,
  message,
  actionLabel,
  actionDescription,
  onAction,
  disabled = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: ReactNode;
  actionLabel: string;
  actionDescription: string;
  onAction: () => void;
  disabled?: boolean;
}) {
  return (
    <Toast.Provider duration={4500} swipeDirection="down">
      <Toast.Root
        open={open}
        onOpenChange={onOpenChange}
        className="flex items-center gap-3.5 rounded-[10px] border border-white/10 bg-[#232631] px-3.5 py-2.5 text-[13px] text-[#eef1f8] shadow-[0_10px_28px_rgba(14,17,28,0.45)] dark:border-[#393d4b] dark:bg-[#282c38] data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-4 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-2 duration-200"
      >
        <Toast.Title className="min-w-0 flex-1 font-normal text-[#eef1f8]">
          {message}
        </Toast.Title>
        <Toast.Action altText={actionDescription} asChild>
          <button
            type="button"
            onClick={onAction}
            disabled={disabled}
            className="cursor-pointer rounded px-1.5 py-0.5 text-[13px] font-semibold text-[#95b3f2] transition-colors hover:bg-white/8 hover:text-[#b4caf7] focus:outline-none"
          >
            {actionLabel}
          </button>
        </Toast.Action>
        <Toast.Close asChild>
          <button
            type="button"
            aria-label="关闭通知"
            className="flex size-6 cursor-pointer items-center justify-center rounded text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="size-3.5" />
          </button>
        </Toast.Close>
      </Toast.Root>
      <Toast.Viewport className="fixed bottom-4 left-4 z-[1000] m-0 w-auto max-w-[calc(100vw-2rem)] list-none outline-none" />
    </Toast.Provider>
  );
}
