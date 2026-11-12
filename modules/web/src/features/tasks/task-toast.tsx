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
        className="flex items-center gap-4 rounded-lg border border-white/10 bg-[#202020] px-4 py-2.5 text-[14px] text-white shadow-[0_8px_24px_rgba(0,0,0,0.4)] data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-4 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-2 duration-200"
      >
        <Toast.Title className="min-w-0 flex-1 font-normal text-white">{message}</Toast.Title>
        <Toast.Action altText={actionDescription} asChild>
          <button
            type="button"
            onClick={onAction}
            disabled={disabled}
            className="text-[13px] font-semibold text-[#ff7066] hover:text-[#ff8a82] transition-colors cursor-pointer px-1 py-0.5 rounded focus:outline-none"
          >
            {actionLabel}
          </button>
        </Toast.Action>
        <Toast.Close asChild>
          <button
            type="button"
            aria-label="关闭通知"
            className="size-6 flex items-center justify-center rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="size-3.5" />
          </button>
        </Toast.Close>
      </Toast.Root>
      <Toast.Viewport className="fixed bottom-6 left-6 z-[1000] m-0 w-auto max-w-[calc(100vw-3rem)] list-none outline-none" />
    </Toast.Provider>
  );
}
