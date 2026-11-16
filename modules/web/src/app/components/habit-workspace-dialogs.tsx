import { HabitDetailDialog } from "@/features/habits/habit-detail-sheet";
import { HabitFormDialog } from "@/features/habits/habit-form-dialog";
import type { HabitsWorkspaceController } from "@/features/habits/habits-workspace";
import { currentLocalTodayDate } from "@/features/habits/task-habit-field";
import type { HabitListItem } from "@core/habits/model";
import type { SavedTag } from "@core/workspace/organization";

export type HabitWorkspaceDialogsProps = {
  habits: HabitsWorkspaceController;
  habitFormOpen: boolean;
  onHabitFormOpenChange: (open: boolean) => void;
  editingHabit: HabitListItem | null;
  onClearEditingHabit: () => void;
  onEditHabit: (habit: HabitListItem) => void;
  filterProjects: string[];
  availableLabels: SavedTag[];
};

/** Consolidates global habit creation/editing and heatmap detail dialogs. */
export function HabitWorkspaceDialogs({
  habits,
  habitFormOpen,
  onHabitFormOpenChange,
  editingHabit,
  onClearEditingHabit,
  onEditHabit,
  filterProjects,
  availableLabels,
}: HabitWorkspaceDialogsProps) {
  const fallbackHabit = habits.detailId
    ? (habits.allHabits.find((h) => h.id === habits.detailId) ??
      habits.habits.find((h) => h.id === habits.detailId) ??
      null)
    : null;

  return (
    <>
      <HabitFormDialog
        open={habitFormOpen}
        onOpenChange={(next) => {
          onHabitFormOpenChange(next);
          if (!next) onClearEditingHabit();
        }}
        editing={editingHabit}
        todayDate={habits.todayData?.todayDate || currentLocalTodayDate()}
        projects={filterProjects}
        availableLabels={availableLabels}
        busy={habits.busy}
        onCreate={habits.createHabit}
        onUpdate={habits.updateHabit}
      />

      <HabitDetailDialog
        open={Boolean(habits.detailId)}
        onOpenChange={(open) => {
          if (!open) habits.setDetailId(null);
        }}
        detail={habits.detailData}
        fallbackHabit={fallbackHabit}
        error={habits.detailError}
        onRetry={() => {
          if (habits.detailId) void habits.refreshDetail(habits.detailId);
        }}
        availableLabels={availableLabels}
        disabled={habits.busy}
        onEdit={(habit) => {
          habits.setDetailId(null);
          onEditHabit(habit);
        }}
        onSetStatus={(id, status) => void habits.setHabitStatus(id, status)}
        onDelete={habits.deleteHabit}
        onTogglePositive={(habitId, date, completed) =>
          void habits.togglePositive(habitId, date, completed)
        }
        onSetChecklistItem={(input) => void habits.setChecklistItem(input)}
        onSwitchPlan={(habitId, planId, date) =>
          void habits.switchPlan(habitId, planId, date)
        }
        onRecordNegative={(habitId, date, note) =>
          void habits.recordNegative(habitId, date, note)
        }
        onUndoNegative={(habitId, date, eventId) =>
          void habits.undoNegative(habitId, date, eventId)
        }
        onUpdateNegativeNote={(habitId, eventId, note, date) =>
          void habits.updateNegativeNote(habitId, eventId, note, date)
        }
        onSetDailyNote={(habitId, note, date) =>
          void habits.setDailyNote(habitId, note, date)
        }
      />
    </>
  );
}
