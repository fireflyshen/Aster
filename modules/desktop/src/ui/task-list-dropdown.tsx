import { Icon, List } from "@raycast/api";
import {
  type BoardState,
  unsectionedColumn,
} from "../../../core/workspace/board.ts";
import { itemColor, type Organization } from "../../../core/workspace/organization.ts";
import { projectPath, projectTree } from "../../../core/workspace/projects.ts";
import { VIEWS } from "./task-list-model";

interface TaskViewDropdownProps {
  filter: string;
  onChange: (value: string) => void;
  organization: Organization | undefined;
  board: BoardState;
  tags: string[];
  projects: string[];
}

/** Raycast search-bar dropdown selecting built-in views, saved filters, columns, tags, or projects. */
export function TaskViewDropdown({
  filter,
  onChange,
  organization,
  board,
  tags,
  projects,
}: TaskViewDropdownProps) {
  return (
    <List.Dropdown tooltip="View Tasks" value={filter} onChange={onChange}>
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
      {organization?.filters.length ? (
        <List.Dropdown.Section title="Saved Filters">
          {[...organization.filters]
            .sort(
              (a, b) =>
                Number(b.favorite) - Number(a.favorite) ||
                a.name.localeCompare(b.name),
            )
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
      {organization ? (
        <List.Dropdown.Section title="Board Columns">
          {[unsectionedColumn, ...board.columns].map((column) => (
            <List.Dropdown.Item
              key={column.id}
              title={column.name}
              value={`column:${column.id}`}
              icon={Icon.AppWindowGrid3x3}
            />
          ))}
        </List.Dropdown.Section>
      ) : null}
      {tags.length ? (
        <List.Dropdown.Section title="Labels">
          {tags.map((tag) => (
            <List.Dropdown.Item
              key={tag}
              title={tag}
              value={`tag:${tag}`}
              icon={{
                source: Icon.Tag,
                tintColor: itemColor(
                  organization?.tags.find((item) => item.name === tag)?.color ||
                    "gray",
                ),
              }}
            />
          ))}
        </List.Dropdown.Section>
      ) : null}
      {projects.length ? (
        <List.Dropdown.Section title="Projects">
          {projectTree(projects).map((row) => (
            <List.Dropdown.Item
              key={row.name}
              title={projectPath(row.name)}
              value={`project:${row.name}`}
              icon={{
                source: Icon.Hashtag,
                tintColor: itemColor(
                  organization?.projects?.find(
                    (project) => project.name === row.name,
                  )?.color || "gray",
                ),
              }}
            />
          ))}
        </List.Dropdown.Section>
      ) : null}
    </List.Dropdown>
  );
}
