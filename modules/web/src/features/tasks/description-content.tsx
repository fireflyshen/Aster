import { parseDescriptionSegments } from "@core/tasks/description";
import { cn } from "cn";

type FormattedDescriptionProps = {
    text: string;
    className?: string;
};

/** Renders task/project descriptions with clean wrapping and directly clickable links that do not trigger parent edit handlers. */
export function FormattedDescription({
    text,
    className,
}: FormattedDescriptionProps) {
    const segments = parseDescriptionSegments(text);
    return (
        <span className={cn("whitespace-pre-wrap break-words", className)}>
            {segments.map((segment, index) =>
                segment.kind === "link" ? (
                    <a
                        key={`${segment.href}-${index}`}
                        href={segment.href}
                        title={segment.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="text-(--priority-3) underline decoration-(--priority-3)/35 underline-offset-[3px] transition-colors hover:decoration-(--priority-3) [overflow-wrap:anywhere]"
                    >
                        {segment.label}
                    </a>
                ) : (
                    <span key={index}>{segment.text}</span>
                ),
            )}
        </span>
    );
}
