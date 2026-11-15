import {
  compactUrlLabel,
  normalizeDescriptionText,
  parseDescriptionSegments,
} from "@core/tasks/description";
import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";

function inlineText(text: string): ReactNode[] {
  return parseDescriptionSegments(text).map((segment, index) => {
    if (segment.kind === "link") {
      const label =
        segment.label === compactUrlLabel(segment.href)
          ? new URL(segment.href).host
          : segment.label;
      return (
        <a
          key={index}
          href={segment.href}
          title={segment.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>{label}</span>
          <ExternalLink aria-hidden="true" />
        </a>
      );
    }
    return (
      <span key={index}>
        {segment.text
          .split(/(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|~~[^~]+~~|\*[^*]+\*)/g)
          .map((part, i) => {
            if (/^(\*\*|__)/.test(part))
              return <strong key={i}>{part.slice(2, -2)}</strong>;
            if (part.startsWith("`"))
              return <code key={i}>{part.slice(1, -1)}</code>;
            if (part.startsWith("~~"))
              return <del key={i}>{part.slice(2, -2)}</del>;
            if (part.startsWith("*"))
              return <em key={i}>{part.slice(1, -1)}</em>;
            return part;
          })}
      </span>
    );
  });
}

const BLOCK_START = /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|`{3,}|~{3,})/;

/** A safe text reader for notes: paragraphs, emphasis, lists, code and HTTP links. */
export function DescriptionReader({ text }: { text: string }) {
  const lines = normalizeDescriptionText(text).split("\n");
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[1]))
        code.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push(
        <pre key={blocks.length}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = line.match(/^\s*#{1,6}\s+(.+?)(?:\s+#+)?$/);
    if (heading) {
      blocks.push(
        <p className="description-reader-heading" key={blocks.length}>
          {inlineText(heading[1])}
        </p>,
      );
      i++;
      continue;
    }
    const list = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/);
    if (list) {
      const ordered = Boolean(list[2]);
      const pattern = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
      const items: ReactNode[] = [];
      let match: RegExpMatchArray | null;
      while (i < lines.length && (match = lines[i].match(pattern)))
        items.push(<li key={i++}>{inlineText(match[1])}</li>);
      blocks.push(
        ordered ? (
          <ol start={Number(list[2])} key={blocks.length}>
            {items}
          </ol>
        ) : (
          <ul key={blocks.length}>{items}</ul>
        ),
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]))
        quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(
        <blockquote key={blocks.length}>
          {inlineText(quote.join("\n"))}
        </blockquote>,
      );
      continue;
    }
    const paragraph = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i]))
      paragraph.push(lines[i++]);
    blocks.push(<p key={blocks.length}>{inlineText(paragraph.join("\n"))}</p>);
  }
  return <div className="description-reader">{blocks}</div>;
}
