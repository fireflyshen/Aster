import { Icon, List } from "@raycast/api";
import { visibleBuiltinFilters } from "../../../core/workspace/builtin-filters.ts";
import {
    focusProject,
    isCompletedProject,
} from "../../../core/workspace/focus.ts";
import {
    itemColor,
    type Organization,
} from "../../../core/workspace/organization.ts";
import { projectPath, projectTree } from "../../../core/workspace/projects.ts";
import { VIEWS } from "../lib/task-list-model";

interface TaskViewDropdownProps {
    filter: string;
    onChange: (value: string) => void;
    organization: Organization | undefined;
    tags: string[];
    projects: string[];
}

/** Raycast search-bar dropdown selecting core views, favorites, Taskwarrior filters, labels, or projects. */
export function TaskViewDropdown({
    filter,
    onChange,
    organization,
    tags,
    projects,
}: TaskViewDropdownProps) {
    const customFilters = organization?.filters || [];
    const builtinFilters = visibleBuiltinFilters(
        organization?.builtinFilterPrefs,
    );
    const favoriteFilters = [
        ...customFilters.filter((item) => item.favorite),
        ...builtinFilters.filter((item) => item.favorite),
    ];
    const remainingCustomFilters = customFilters.filter(
        (item) => !item.favorite,
    );
    const remainingBuiltinFilters = builtinFilters.filter(
        (item) => !item.favorite,
    );
    const favoriteTagNames = new Set(
        (organization?.tags || [])
            .filter((item) => item.favorite)
            .map((item) => item.name),
    );
    const favoriteTags = tags.filter((tag) => favoriteTagNames.has(tag));
    const otherTags = tags.filter((tag) => !favoriteTagNames.has(tag));
    const orgProjects = organization?.projects;
    const projectRows = projectTree(projects).filter(
        (row) =>
            filter === `project:${row.name}` ||
            !isCompletedProject(row.name, orgProjects),
    );
    const focusRows = projectRows.filter(
        (row) => !!focusProject(row.name, orgProjects),
    );
    const laterRows = projectRows.filter(
        (row) => !focusProject(row.name, orgProjects),
    );

    const renderProjectItem = (name: string) => (
        <List.Dropdown.Item
            key={`project:${name}`}
            title={projectPath(name)}
            value={`project:${name}`}
            icon={{
                source: Icon.Hashtag,
                tintColor: itemColor(
                    orgProjects?.find((project) => project.name === name)
                        ?.color || "gray",
                ),
            }}
        />
    );

    return (
        <List.Dropdown
            tooltip="Switch View (⌘P)"
            value={filter}
            onChange={onChange}
        >
            <List.Dropdown.Section title="Views">
                {VIEWS.map((view) => (
                    <List.Dropdown.Item
                        key={view.id}
                        title={view.title}
                        value={view.id}
                    />
                ))}
            </List.Dropdown.Section>
            {filter === "expression" ? (
                <List.Dropdown.Item
                    title="Custom Filter"
                    value="expression"
                    icon={Icon.Filter}
                />
            ) : null}
            {favoriteFilters.length > 0 || favoriteTags.length > 0 ? (
                <List.Dropdown.Section title="Favorites">
                    {favoriteFilters.map((item) => (
                        <List.Dropdown.Item
                            key={`fav-filter:${item.id}`}
                            title={item.name}
                            value={`filter:${item.id}`}
                            icon={{
                                source: Icon.Star,
                                tintColor: itemColor(item.color),
                            }}
                        />
                    ))}
                    {favoriteTags.map((tag) => (
                        <List.Dropdown.Item
                            key={`fav-tag:${tag}`}
                            title={`#${tag}`}
                            value={`tag:${tag}`}
                            icon={{
                                source: Icon.Tag,
                                tintColor: itemColor(
                                    organization?.tags.find(
                                        (item) => item.name === tag,
                                    )?.color || "gray",
                                ),
                            }}
                        />
                    ))}
                </List.Dropdown.Section>
            ) : null}
            {remainingCustomFilters.length ? (
                <List.Dropdown.Section title="Saved Filters">
                    {remainingCustomFilters
                        .slice()
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((item) => (
                            <List.Dropdown.Item
                                key={item.id}
                                title={item.name}
                                value={`filter:${item.id}`}
                                icon={{
                                    source: Icon.Filter,
                                    tintColor: itemColor(item.color),
                                }}
                            />
                        ))}
                </List.Dropdown.Section>
            ) : null}
            {remainingBuiltinFilters.length ? (
                <List.Dropdown.Section title="Built-in Filters">
                    {remainingBuiltinFilters.map((item) => (
                        <List.Dropdown.Item
                            key={item.id}
                            title={item.name}
                            value={`filter:${item.id}`}
                            icon={{
                                source: Icon.Filter,
                                tintColor: itemColor(item.color),
                            }}
                        />
                    ))}
                </List.Dropdown.Section>
            ) : null}
            {otherTags.length ? (
                <List.Dropdown.Section title="Labels">
                    {otherTags.map((tag) => (
                        <List.Dropdown.Item
                            key={tag}
                            title={`#${tag}`}
                            value={`tag:${tag}`}
                            icon={{
                                source: Icon.Tag,
                                tintColor: itemColor(
                                    organization?.tags.find(
                                        (item) => item.name === tag,
                                    )?.color || "gray",
                                ),
                            }}
                        />
                    ))}
                </List.Dropdown.Section>
            ) : null}
            {focusRows.length ? (
                <List.Dropdown.Section title="Focus Projects">
                    {focusRows.map((row) => renderProjectItem(row.name))}
                </List.Dropdown.Section>
            ) : null}
            {laterRows.length ? (
                <List.Dropdown.Section title="Later Projects">
                    {laterRows.map((row) => renderProjectItem(row.name))}
                </List.Dropdown.Section>
            ) : null}
        </List.Dropdown>
    );
}
