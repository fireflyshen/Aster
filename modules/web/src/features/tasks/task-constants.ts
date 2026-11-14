export type TaskPriority = "H" | "M" | "L" | "";

export type PriorityOption = {
    value: TaskPriority;
    selectValue: "H" | "M" | "L" | "none";
    quickWord: "p1" | "p2" | "p3" | "p4";
    label: string;
    short: string;
    color: string;
    textClass: string;
    iconClass: string;
    chipClass: string;
};

/** Priority levels aligned to Todoist visual tokens (P1-P4). */
export const PRIORITIES: PriorityOption[] = [
    {
        value: "H",
        selectValue: "H",
        quickWord: "p1",
        label: "优先级 1",
        short: "P1",
        color: "var(--priority-1)",
        textClass: "text-(--priority-1)",
        iconClass: "fill-(--priority-1)/18 text-(--priority-1)",
        chipClass:
            "border-(--priority-1)/38 bg-(--priority-1)/10 text-(--priority-1) hover:bg-(--priority-1)/16",
    },
    {
        value: "M",
        selectValue: "M",
        quickWord: "p2",
        label: "优先级 2",
        short: "P2",
        color: "var(--priority-2)",
        textClass: "text-(--priority-2)",
        iconClass: "fill-(--priority-2)/18 text-(--priority-2)",
        chipClass:
            "border-(--priority-2)/38 bg-(--priority-2)/10 text-(--priority-2) hover:bg-(--priority-2)/16",
    },
    {
        value: "L",
        selectValue: "L",
        quickWord: "p3",
        label: "优先级 3",
        short: "P3",
        color: "var(--priority-3)",
        textClass: "text-(--priority-3)",
        iconClass: "fill-(--priority-3)/18 text-(--priority-3)",
        chipClass:
            "border-(--priority-3)/38 bg-(--priority-3)/10 text-(--priority-3) hover:bg-(--priority-3)/16",
    },
    {
        value: "",
        selectValue: "none",
        quickWord: "p4",
        label: "优先级 4",
        short: "优先级",
        color: "var(--priority-4)",
        textClass: "text-muted-foreground",
        iconClass: "text-(--priority-4)",
        chipClass: "border-input text-muted-foreground",
    },
];

export function priorityOption(value?: string): PriorityOption {
    const normalized = value === "none" ? "" : value || "";
    return (
        PRIORITIES.find((item) => item.value === normalized) || PRIORITIES[3]
    );
}
