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

/** Single source of truth for Todoist-aligned priority levels (P1-P4). */
export const PRIORITIES: PriorityOption[] = [
  {
    value: "H",
    selectValue: "H",
    quickWord: "p1",
    label: "优先级 1",
    short: "P1",
    color: "#d1453b",
    textClass: "text-[#d1453b]",
    iconClass: "fill-[#d1453b]/20 text-[#d1453b]",
    chipClass:
      "border-[#d1453b]/40 bg-[#d1453b]/10 text-[#d1453b] hover:bg-[#d1453b]/18",
  },
  {
    value: "M",
    selectValue: "M",
    quickWord: "p2",
    label: "优先级 2",
    short: "P2",
    color: "#eb8909",
    textClass: "text-[#eb8909]",
    iconClass: "fill-[#eb8909]/20 text-[#eb8909]",
    chipClass:
      "border-[#eb8909]/40 bg-[#eb8909]/10 text-[#eb8909] hover:bg-[#eb8909]/18",
  },
  {
    value: "L",
    selectValue: "L",
    quickWord: "p3",
    label: "优先级 3",
    short: "P3",
    color: "#246fe0",
    textClass: "text-[#246fe0]",
    iconClass: "fill-[#246fe0]/20 text-[#246fe0]",
    chipClass:
      "border-[#246fe0]/40 bg-[#246fe0]/10 text-[#246fe0] hover:bg-[#246fe0]/18",
  },
  {
    value: "",
    selectValue: "none",
    quickWord: "p4",
    label: "优先级 4",
    short: "优先级",
    color: "#888888",
    textClass: "text-muted-foreground",
    iconClass: "text-[#888888]",
    chipClass: "border-input text-muted-foreground",
  },
];

export function priorityOption(value?: string): PriorityOption {
  const normalized = value === "none" ? "" : value || "";
  return PRIORITIES.find((item) => item.value === normalized) || PRIORITIES[3];
}
