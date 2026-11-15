export type DescriptionSegment =
    | { kind: "text"; text: string }
    | { kind: "link"; label: string; href: string };

const TOKEN_RE =
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+)/gi;
const TRAILING_PUNCT_RE = /[.,;:!?。，；：！？)）\]】]$/;

function splitBareUrl(rawUrl: string): { url: string; trailing: string } {
    let end = rawUrl.length;
    while (end > 0) {
        const ch = rawUrl[end - 1];
        if (TRAILING_PUNCT_RE.test(ch)) {
            if (ch === ")") {
                const candidate = rawUrl.slice(0, end);
                const opens = (candidate.match(/\(/g) || []).length;
                const closes = (candidate.match(/\)/g) || []).length;
                if (closes <= opens) {
                    break;
                }
            } else if (ch === "]") {
                const candidate = rawUrl.slice(0, end);
                const opens = (candidate.match(/\[/g) || []).length;
                const closes = (candidate.match(/\]/g) || []).length;
                if (closes <= opens) {
                    break;
                }
            }
            end -= 1;
            continue;
        }
        break;
    }
    return { url: rawUrl.slice(0, end), trailing: rawUrl.slice(end) };
}

function safeHttpUrl(rawUrl: string): URL | null {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
            return parsed;
        }
    } catch {
        return null;
    }
    return null;
}

/** Formats an HTTP(S) URL into a compact readable host/path label without scheme noise. */
export function compactUrlLabel(rawUrl: string): string {
    const parsed = safeHttpUrl(rawUrl);
    if (!parsed) return rawUrl;
    const pathname =
        parsed.pathname === "/" && !parsed.search && !parsed.hash
            ? ""
            : !parsed.search && !parsed.hash && parsed.pathname.endsWith("/")
              ? parsed.pathname.slice(0, -1)
              : parsed.pathname;
    return `${parsed.host}${pathname}${parsed.search}${parsed.hash}`;
}

/** Normalizes line endings and collapses excessive blank lines before display. */
export function normalizeDescriptionText(raw: string): string {
    return raw
        .replace(/\r\n?/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/** Splits description text into plain prose and validated HTTP(S) link segments. */
export function parseDescriptionSegments(raw: string): DescriptionSegment[] {
    const text = normalizeDescriptionText(raw);
    if (!text) return [];
    const out: DescriptionSegment[] = [];
    let cursor = 0;
    TOKEN_RE.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = TOKEN_RE.exec(text)) !== null) {
        const start = match.index;
        if (start > cursor) {
            out.push({ kind: "text", text: text.slice(cursor, start) });
        }
        if (match[1] !== undefined && match[2] !== undefined) {
            const parsed = safeHttpUrl(match[2]);
            if (parsed) {
                const label =
                    match[1].trim() || compactUrlLabel(parsed.toString());
                out.push({ kind: "link", label, href: match[2] });
            } else {
                out.push({ kind: "text", text: match[0] });
            }
            cursor = TOKEN_RE.lastIndex;
            continue;
        }

        const bare = match[3] || "";
        const { url, trailing } = splitBareUrl(bare);
        const parsed = safeHttpUrl(url);
        if (parsed) {
            out.push({
                kind: "link",
                label: compactUrlLabel(url),
                href: url,
            });
            if (trailing) {
                out.push({ kind: "text", text: trailing });
            }
        } else {
            out.push({ kind: "text", text: match[0] });
        }
        cursor = TOKEN_RE.lastIndex;
    }

    if (cursor < text.length) {
        out.push({ kind: "text", text: text.slice(cursor) });
    }
    return out;
}

/** Collapses multi-line notes and raw URLs into a crisp single-line preview for list rows and board cards. */
export function formatDescriptionPreview(raw: string): string {
    const normalized = normalizeDescriptionText(raw);
    if (!normalized) return "";
    const lines = normalized
        .split("\n")
        .map((line) => {
            const cleaned = line
                .trim()
                .replace(/^(?:#{1,6}|>|[-*+])\s+/, "")
                .trim();
            if (!cleaned) return "";
            const rendered = parseDescriptionSegments(cleaned)
                .map((seg) => (seg.kind === "link" ? seg.label : seg.text))
                .join("")
                .replace(/\*\*([^*]+)\*\*/g, "$1")
                .replace(/`([^`]+)`/g, "$1")
                .replace(/[ \t]+/g, " ")
                .trim();
            return rendered;
        })
        .filter(Boolean);
    return lines.join(" · ");
}

/** Formats multi-line task descriptions as readable Markdown with clickable links and soft line breaks for Desktop detail views. */
export function formatMarkdownDescription(raw: string): string {
    const normalized = normalizeDescriptionText(raw);
    if (!normalized) return "";
    return normalized
        .split("\n\n")
        .map((paragraph) =>
            paragraph
                .split("\n")
                .map((line) =>
                    parseDescriptionSegments(line.trimEnd())
                        .map((seg) =>
                            seg.kind === "link"
                                ? `[${seg.label.replace(/\[/g, "\\[").replace(/\]/g, "\\]")}](${seg.href})`
                                : seg.text,
                        )
                        .join(""),
                )
                .join("  \n"),
        )
        .join("\n\n");
}
