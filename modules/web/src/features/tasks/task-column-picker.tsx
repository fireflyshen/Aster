import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  taskColumnId,
  UNSECTIONED,
  type BoardState,
} from "@core/workspace/board";
import type { Task } from "@shared/tasks";

/** A touch/keyboard alternative to dragging, using the same board mutation. */
export function TaskColumnPicker({
  task,
  board,
  project,
  disabled,
  onMove,
}: {
  task: Task;
  board: BoardState;
  project: string;
  disabled: boolean;
  onMove: (columnId: string) => void;
}) {
  const columns = board.columns.filter(
    (column) => (column.project || "") === project,
  );
  if (!columns.length) return null;
  const current = taskColumnId(task, board);
  const value = columns.some((column) => column.id === current)
    ? current
    : UNSECTIONED;
  return (
    <div className="border-b border-border/60 px-1.5 py-2">
      <Select value={value} disabled={disabled} onValueChange={onMove}>
        <SelectTrigger aria-label="移动到分区" className="w-full min-w-0">
          <span className="text-muted-foreground">移至</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNSECTIONED}>未分区</SelectItem>
          {columns.map((column) => (
            <SelectItem key={column.id} value={column.id}>
              {column.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
