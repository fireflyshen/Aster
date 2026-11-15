import assert from "node:assert/strict";
import test from "node:test";
import {
    compactUrlLabel,
    formatDescriptionPreview,
    formatMarkdownDescription,
    parseDescriptionSegments,
} from "../tasks/description.ts";

test("compactUrlLabel strips scheme noise and trailing slash while keeping queries", () => {
    assert.equal(
        compactUrlLabel("https://hanxiaomax.github.io/Learncpp_CN/"),
        "hanxiaomax.github.io/Learncpp_CN",
    );
    assert.equal(compactUrlLabel("https://example.com/"), "example.com");
    assert.equal(
        compactUrlLabel("https://example.com/search/?q=1#top"),
        "example.com/search/?q=1#top",
    );
});

test("parseDescriptionSegments cleanly separates CJK punctuation and preserves balanced URL parentheses", () => {
    const segments = parseDescriptionSegments(
        "教材《Learn C++ 中文版》\nhttps://hanxiaomax.github.io/Learncpp_CN/（打不开用 Gitee: https://gitee.com/johannlee/Learncpp_CN）",
    );
    assert.deepEqual(segments, [
        { kind: "text", text: "教材《Learn C++ 中文版》\n" },
        {
            kind: "link",
            label: "hanxiaomax.github.io/Learncpp_CN",
            href: "https://hanxiaomax.github.io/Learncpp_CN/",
        },
        { kind: "text", text: "（打不开用 Gitee: " },
        {
            kind: "link",
            label: "gitee.com/johannlee/Learncpp_CN",
            href: "https://gitee.com/johannlee/Learncpp_CN",
        },
        { kind: "text", text: "）" },
    ]);

    const wiki = parseDescriptionSegments(
        "参考 (https://en.wikipedia.org/wiki/C_(programming_language)).",
    );
    assert.deepEqual(wiki, [
        { kind: "text", text: "参考 (" },
        {
            kind: "link",
            label: "en.wikipedia.org/wiki/C_(programming_language)",
            href: "https://en.wikipedia.org/wiki/C_(programming_language)",
        },
        { kind: "text", text: ")." },
    ]);

    const markdown = parseDescriptionSegments(
        "见 [LearnCpp 中文版](https://hanxiaomax.github.io/Learncpp_CN/) 章节 4.6",
    );
    assert.deepEqual(markdown, [
        { kind: "text", text: "见 " },
        {
            kind: "link",
            label: "LearnCpp 中文版",
            href: "https://hanxiaomax.github.io/Learncpp_CN/",
        },
        { kind: "text", text: " 章节 4.6" },
    ]);
});

test("formatDescriptionPreview flattens multi-line URLs and markdown into a clean single-line summary", () => {
    assert.equal(
        formatDescriptionPreview(
            "教材《Learn C++ 中文版》\n\n\nhttps://hanxiaomax.github.io/Learncpp_CN/",
        ),
        "教材《Learn C++ 中文版》 · hanxiaomax.github.io/Learncpp_CN",
    );
    assert.equal(
        formatDescriptionPreview(
            "- **必看**：[中文教材](https://hanxiaomax.github.io/Learncpp_CN/)\n> 用 `g++` 编译",
        ),
        "必看：中文教材 · 用 g++ 编译",
    );
});

test("formatMarkdownDescription preserves soft line breaks and converts raw URLs into compact markdown links", () => {
    assert.equal(
        formatMarkdownDescription(
            "教材《Learn C++ 中文版》\nhttps://hanxiaomax.github.io/Learncpp_CN/",
        ),
        "教材《Learn C++ 中文版》  \n[hanxiaomax.github.io/Learncpp_CN](https://hanxiaomax.github.io/Learncpp_CN/)",
    );
});
