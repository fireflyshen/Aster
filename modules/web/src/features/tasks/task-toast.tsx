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
                className="flex items-center gap-3 rounded-lg bg-primary px-3 py-2 text-[13px] text-primary-foreground shadow-lg data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
            >
                <Toast.Title className="min-w-0 flex-1 truncate">
                    {message}
                </Toast.Title>
                <Toast.Action altText={actionDescription} asChild>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onAction}
                        disabled={disabled}
                        className="h-9 px-2 text-xs text-primary-foreground hover:bg-primary-foreground/10 md:h-8"
                    >
                        {actionLabel}
                    </Button>
                </Toast.Action>
                <Toast.Close asChild>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Dismiss notification"
                        className="size-9 p-0 text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground md:size-8"
                    >
                        <X className="size-4" />
                    </Button>
                </Toast.Close>
            </Toast.Root>
            <Toast.Viewport className="fixed bottom-20 left-4 z-[100] m-0 w-auto max-w-[calc(100vw-2rem)] list-none outline-none md:bottom-4" />
        </Toast.Provider>
    );
}
