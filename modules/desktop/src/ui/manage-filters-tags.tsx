import {
    Action,
    ActionPanel,
    Alert,
    confirmAlert,
    Form,
    Icon,
    Keyboard,
    List,
    showToast,
    Toast,
    useNavigation,
} from "@raycast/api";
import { FormValidation, useForm } from "@raycast/utils";
import { useState } from "react";
import type { WorkspaceClient } from "../../../core/workspace/client.ts";
import {
    type Color as AsterColor,
    colors,
    itemColor,
    type Organization,
    type SavedFilter,
    type SavedTag,
} from "../../../core/workspace/organization.ts";
import { toneColor } from "./palette";

function FilterOrTagForm({
    kind,
    item,
    revision,
    workspace,
    onUpdated,
}: {
    kind: "filter" | "tag";
    item?: SavedFilter | SavedTag;
    revision: number;
    workspace: WorkspaceClient;
    onUpdated: (next: Organization) => Promise<void> | void;
}) {
    const { pop } = useNavigation();
    const [busy, setBusy] = useState(false);
    const existingFilter =
        kind === "filter" ? (item as SavedFilter) : undefined;
    const { handleSubmit, itemProps } = useForm<{
        name: string;
        color: string;
        favorite: boolean;
        expression: string;
        description: string;
    }>({
        initialValues: {
            name: item?.name || "",
            color: item?.color || "gray",
            favorite: item?.favorite || false,
            expression: existingFilter?.expression || "status:pending",
            description: existingFilter?.description || "",
        },
        validation: {
            name: FormValidation.Required,
            ...(kind === "filter"
                ? { expression: FormValidation.Required }
                : {}),
        },
        async onSubmit(values) {
            if (busy) return;
            setBusy(true);
            try {
                const next = await workspace.change({
                    revision,
                    kind,
                    action: "save",
                    item:
                        kind === "filter"
                            ? {
                                  id: item?.id || "",
                                  name: values.name.trim(),
                                  color: (values.color || "gray") as AsterColor,
                                  favorite: values.favorite,
                                  expression: values.expression.trim(),
                                  description: values.description.trim(),
                              }
                            : {
                                  id: item?.id || "",
                                  name: values.name.trim(),
                                  color: (values.color || "gray") as AsterColor,
                                  favorite: values.favorite,
                              },
                });
                await onUpdated(next);
                await showToast({
                    style: Toast.Style.Success,
                    title: item
                        ? `${kind === "filter" ? "Filter" : "Label"} updated`
                        : `${kind === "filter" ? "Filter" : "Label"} created`,
                });
                pop();
            } catch (error) {
                await showToast({
                    style: Toast.Style.Failure,
                    title: "Could Not Save",
                    message:
                        error instanceof Error ? error.message : String(error),
                });
            } finally {
                setBusy(false);
            }
        },
    });

    return (
        <Form
            isLoading={busy}
            navigationTitle={`${item ? "Edit" : "New"} ${kind === "filter" ? "Filter" : "Label"}`}
            actions={
                <ActionPanel>
                    <Action.SubmitForm title="Save" onSubmit={handleSubmit} />
                </ActionPanel>
            }
        >
            <Form.TextField
                title="Name"
                placeholder={
                    kind === "filter" ? "e.g. High Impact" : "e.g. deep-work"
                }
                autoFocus
                {...itemProps.name}
            />
            <Form.Dropdown title="Color" {...itemProps.color}>
                {colors.map((swatch) => (
                    <Form.Dropdown.Item
                        key={swatch.id}
                        value={swatch.id}
                        title={swatch.name}
                        icon={{
                            source: Icon.CircleFilled,
                            tintColor: swatch.value,
                        }}
                    />
                ))}
            </Form.Dropdown>
            <Form.Checkbox
                label="Favorite in Sidebar / Views"
                {...itemProps.favorite}
            />
            {kind === "filter" ? (
                <>
                    <Form.TextField
                        title="Filter Expression"
                        placeholder="status:pending +READY"
                        {...itemProps.expression}
                    />
                    <Form.TextArea
                        title="Description"
                        placeholder="Optional description"
                        {...itemProps.description}
                    />
                </>
            ) : null}
        </Form>
    );
}

/** Raycast screen for creating, editing, favoriting, and deleting shared Filters & Labels. */
export function ManageFiltersAndTags({
    workspace,
    initial,
    onSaved,
}: {
    workspace: WorkspaceClient;
    initial: Organization;
    onSaved: () => Promise<unknown>;
}) {
    const [org, setOrg] = useState(initial);
    const [busy, setBusy] = useState(false);

    async function applyUpdated(next: Organization) {
        setOrg(next);
        await onSaved();
    }

    async function toggleFavorite(
        kind: "filter" | "tag",
        item: SavedFilter | SavedTag,
    ) {
        if (busy) return;
        setBusy(true);
        try {
            const next = await workspace.change({
                revision: org.revision,
                kind,
                action: "save",
                item: { ...item, favorite: !item.favorite },
            });
            await applyUpdated(next);
        } catch (error) {
            await showToast({
                style: Toast.Style.Failure,
                title: "Could Not Update Favorite",
                message: error instanceof Error ? error.message : String(error),
            });
        } finally {
            setBusy(false);
        }
    }

    async function removeItem(
        kind: "filter" | "tag",
        item: SavedFilter | SavedTag,
    ) {
        const confirmed = await confirmAlert({
            title: `Delete ${kind === "filter" ? "filter" : "label"} “${item.name}”?`,
            message: "Tasks themselves will not be deleted.",
            primaryAction: {
                title: "Delete",
                style: Alert.ActionStyle.Destructive,
            },
        });
        if (!confirmed) return;
        setBusy(true);
        try {
            const next = await workspace.change({
                revision: org.revision,
                kind,
                action: "delete",
                item,
            });
            await applyUpdated(next);
            await showToast({ style: Toast.Style.Success, title: "Deleted" });
        } catch (error) {
            await showToast({
                style: Toast.Style.Failure,
                title: "Could Not Delete",
                message: error instanceof Error ? error.message : String(error),
            });
        } finally {
            setBusy(false);
        }
    }

    const createActions = (
        <ActionPanel.Section>
            <Action.Push
                title="New Filter…"
                icon={Icon.Filter}
                shortcut={Keyboard.Shortcut.Common.New}
                target={
                    <FilterOrTagForm
                        kind="filter"
                        revision={org.revision}
                        workspace={workspace}
                        onUpdated={applyUpdated}
                    />
                }
            />
            <Action.Push
                title="New Label…"
                icon={Icon.Tag}
                target={
                    <FilterOrTagForm
                        kind="tag"
                        revision={org.revision}
                        workspace={workspace}
                        onUpdated={applyUpdated}
                    />
                }
            />
        </ActionPanel.Section>
    );

    return (
        <List
            isLoading={busy}
            navigationTitle="Manage Filters & Labels"
            searchBarPlaceholder="Search filters or labels"
        >
            <List.Section
                title="Saved Filters"
                subtitle={String(org.filters.length)}
            >
                {org.filters.map((item) => (
                    <List.Item
                        key={item.id}
                        title={item.name}
                        subtitle={item.expression}
                        icon={{
                            source: Icon.Filter,
                            tintColor: itemColor(item.color),
                        }}
                        accessories={
                            item.favorite
                                ? [
                                      {
                                          icon: {
                                              source: Icon.Star,
                                              tintColor: toneColor("favorite"),
                                          },
                                          tooltip: "Favorite",
                                      },
                                  ]
                                : undefined
                        }
                        actions={
                            <ActionPanel>
                                <Action.Push
                                    title="Edit Filter"
                                    icon={Icon.Pencil}
                                    target={
                                        <FilterOrTagForm
                                            kind="filter"
                                            item={item}
                                            revision={org.revision}
                                            workspace={workspace}
                                            onUpdated={applyUpdated}
                                        />
                                    }
                                />
                                <Action
                                    title={
                                        item.favorite
                                            ? "Remove Favorite"
                                            : "Mark Favorite"
                                    }
                                    icon={Icon.Star}
                                    onAction={() =>
                                        toggleFavorite("filter", item)
                                    }
                                />
                                <Action
                                    title="Delete Filter"
                                    icon={Icon.Trash}
                                    style={Action.Style.Destructive}
                                    onAction={() => removeItem("filter", item)}
                                />
                                {createActions}
                            </ActionPanel>
                        }
                    />
                ))}
            </List.Section>
            <List.Section title="Labels" subtitle={String(org.tags.length)}>
                {org.tags.map((item) => (
                    <List.Item
                        key={item.id}
                        title={item.name}
                        icon={{
                            source: Icon.Tag,
                            tintColor: itemColor(item.color),
                        }}
                        accessories={[
                            ...(item.favorite
                                ? [
                                      {
                                          icon: {
                                              source: Icon.Star,
                                              tintColor: toneColor("favorite"),
                                          },
                                          tooltip: "Favorite",
                                      },
                                  ]
                                : []),
                            ...(item.count !== undefined
                                ? [{ text: `${item.count}` }]
                                : []),
                        ]}
                        actions={
                            <ActionPanel>
                                <Action.Push
                                    title="Edit Label"
                                    icon={Icon.Pencil}
                                    target={
                                        <FilterOrTagForm
                                            kind="tag"
                                            item={item}
                                            revision={org.revision}
                                            workspace={workspace}
                                            onUpdated={applyUpdated}
                                        />
                                    }
                                />
                                <Action
                                    title={
                                        item.favorite
                                            ? "Remove Favorite"
                                            : "Mark Favorite"
                                    }
                                    icon={Icon.Star}
                                    onAction={() => toggleFavorite("tag", item)}
                                />
                                <Action
                                    title="Delete Label"
                                    icon={Icon.Trash}
                                    style={Action.Style.Destructive}
                                    onAction={() => removeItem("tag", item)}
                                />
                                {createActions}
                            </ActionPanel>
                        }
                    />
                ))}
            </List.Section>
            {org.filters.length === 0 && org.tags.length === 0 ? (
                <List.EmptyView
                    title="No Saved Filters or Labels"
                    description="Create one to organize views across Web, Raycast, and TUI."
                    actions={<ActionPanel>{createActions}</ActionPanel>}
                />
            ) : null}
        </List>
    );
}
