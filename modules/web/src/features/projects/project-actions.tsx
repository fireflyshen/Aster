import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Check,
    Ellipsis,
    Pause,
    Pencil,
    Play,
    Plus,
    Trash2,
} from "lucide-react";
import { useState } from "react";

export function ProjectActions({
    name,
    disabled,
    onEdit,
    onDelete,
    status,
    onStatus,
    onAddChild,
}: {
    name: string;
    onAddChild?: (name: string) => void;
    status?: import("@core/workspace/focus").ProjectStatus;
    onStatus?: (
        name: string,
        status: import("@core/workspace/focus").ProjectStatus,
    ) => void;
    disabled: boolean;
    onEdit: (name: string) => void;
    onDelete: (name: string) => void;
}) {
    const [open, setOpen] = useState(false);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    aria-label={`Project options: ${name}`}
                    className="shrink-0 text-muted-foreground"
                >
                    <Ellipsis className="size-4" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="end"
                className="w-48 p-1"
                onCloseAutoFocus={(event) => {
                    if (
                        document.querySelector(
                            '[role="dialog"], [role="alertdialog"]',
                        )
                    )
                        event.preventDefault();
                }}
            >
                {onStatus && (
                    <>
                        <Button
                            variant="ghost"
                            className="h-9 w-full justify-start font-normal"
                            onClick={() => {
                                setOpen(false);
                                onStatus(
                                    name,
                                    status === "active" ? "later" : "active",
                                );
                            }}
                        >
                            {status === "active" ? (
                                <Pause className="size-4" />
                            ) : (
                                <Play className="size-4" />
                            )}
                            {status === "active"
                                ? "Pause project"
                                : "Activate project"}
                        </Button>
                        {status !== "completed" && (
                            <Button
                                variant="ghost"
                                className="h-9 w-full justify-start font-normal"
                                onClick={() => {
                                    setOpen(false);
                                    onStatus(name, "completed");
                                }}
                            >
                                <Check className="size-4" />
                                Complete project
                            </Button>
                        )}
                    </>
                )}
                {onAddChild && (
                    <Button
                        variant="ghost"
                        className="h-9 w-full justify-start font-normal"
                        onClick={() => {
                            setOpen(false);
                            onAddChild(name);
                        }}
                    >
                        <Plus className="size-4" />
                        Add subproject
                    </Button>
                )}
                <Button
                    variant="ghost"
                    className="h-9 w-full justify-start font-normal"
                    onClick={() => {
                        setOpen(false);
                        onEdit(name);
                    }}
                >
                    <Pencil className="size-4" />
                    Edit project
                </Button>
                <Button
                    variant="ghost"
                    className="h-9 w-full justify-start font-normal text-destructive"
                    onClick={() => {
                        setOpen(false);
                        onDelete(name);
                    }}
                >
                    <Trash2 className="size-4" />
                    Delete project
                </Button>
            </PopoverContent>
        </Popover>
    );
}
