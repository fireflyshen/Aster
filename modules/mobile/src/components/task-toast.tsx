import { Toast } from "radix-ui";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TaskToast({
  open,
  onOpenChange,
  project,
  onView,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: string;
  onView: () => void;
}) {
  return (
    <Toast.Provider duration={4500} swipeDirection="down">
      <Toast.Root
        open={open}
        onOpenChange={onOpenChange}
        className="flex items-center gap-5 rounded-[8px] bg-[#252525] px-4 py-3 text-[13px] text-[#ddd] shadow-[0_4px_20px_#0003] data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
      >
        <Toast.Title className="min-w-0 flex-1 truncate">
          任务已添加到 <span className="underline underline-offset-2">{project || "收件箱"}</span>
        </Toast.Title>
        <Toast.Action altText="查看任务所在的项目" asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={onView}
            className="h-6 px-0 text-xs text-[#e48a80] hover:bg-transparent hover:text-white"
          >
            打开
          </Button>
        </Toast.Action>
        <Toast.Close asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="关闭提示"
            className="size-5 p-0 text-[#999] hover:bg-transparent hover:text-white"
          >
            <X className="size-4" />
          </Button>
        </Toast.Close>
      </Toast.Root>
      <Toast.Viewport className="fixed bottom-20 left-4 z-[100] m-0 w-auto max-w-[calc(100vw-2rem)] list-none outline-none md:bottom-4" />
    </Toast.Provider>
  );
}
