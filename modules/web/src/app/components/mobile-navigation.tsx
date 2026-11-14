import { CalendarDays, FolderOpen, Inbox, Menu, Plus } from "lucide-react";
import type { View } from "@shared/tasks";

/** Mobile shortcuts use the same navigation and task actions as the sidebar. */
export function MobileNavigation({
    view,
    projectsPage,
    disabled,
    navigationDisabled,
    onView,
    onProjects,
    onMenu,
    onAdd,
}: {
    view?: View;
    projectsPage: boolean;
    disabled: boolean;
    navigationDisabled: boolean;
    onView: (view: View) => void;
    onProjects: () => void;
    onMenu: () => void;
    onAdd: () => void;
}) {
    return (
        <nav className="mobile-navigation" aria-label="常用导航">
            <button
                type="button"
                aria-current={view === "today" ? "page" : undefined}
                disabled={navigationDisabled}
                onClick={() => onView("today")}
            >
                <CalendarDays aria-hidden="true" />
                <span>今天</span>
            </button>
            <button
                type="button"
                aria-current={view === "pending" ? "page" : undefined}
                disabled={navigationDisabled}
                onClick={() => onView("pending")}
            >
                <Inbox aria-hidden="true" />
                <span>收件箱</span>
            </button>
            <button
                type="button"
                className="mobile-capture"
                aria-label="快速添加任务"
                disabled={disabled}
                onClick={onAdd}
            >
                <Plus aria-hidden="true" />
                <span>添加</span>
            </button>
            <button
                type="button"
                aria-current={projectsPage ? "page" : undefined}
                disabled={navigationDisabled}
                onClick={onProjects}
            >
                <FolderOpen aria-hidden="true" />
                <span>项目</span>
            </button>
            <button
                type="button"
                aria-label="打开全部导航"
                aria-haspopup="dialog"
                onClick={onMenu}
            >
                <Menu aria-hidden="true" />
                <span>浏览</span>
            </button>
        </nav>
    );
}
