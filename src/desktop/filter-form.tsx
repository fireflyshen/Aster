import { Action, ActionPanel, Form, Icon, useNavigation } from "@raycast/api";
import { useState } from "react";
import { filterArguments } from "../core/tasks/filter.ts";

export function FilterForm({
    expression,
    onApply,
}: {
    expression: string;
    onApply: (value: string) => void;
}) {
    const [value, setValue] = useState(expression);
    const [error, setError] = useState<string>();
    const { pop } = useNavigation();
    return (
        <Form
            navigationTitle="Filter Tasks"
            actions={
                <ActionPanel>
                    <Action.SubmitForm
                        title="Apply Filter"
                        icon={Icon.Filter}
                        onSubmit={() => {
                            try {
                                filterArguments(value);
                                onApply(value.trim());
                                pop();
                            } catch (error) {
                                setError(
                                    error instanceof Error
                                        ? error.message
                                        : String(error),
                                );
                            }
                        }}
                    />
                </ActionPanel>
            }
        >
            <Form.TextField
                id="expression"
                title="Expression"
                placeholder="+focus and (due.before:tomorrow or priority:H)"
                value={value}
                onChange={(value) => {
                    setValue(value);
                    setError(undefined);
                }}
                error={error}
                autoFocus
            />
            <Form.Description text="Taskwarrior filter syntax. Use +label, project:Work, priority:H, and/or and parentheses. Applies to this view; manage saved filters in Aster web." />
        </Form>
    );
}
