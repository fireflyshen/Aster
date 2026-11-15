import {
    UNCATEGORIZED_CATEGORY_ID,
    type RuleSource,
    type TimePolicy,
} from "./model.ts";

export type ClassificationInput = {
    explicitCategoryId?: string;
    taskUuid?: string;
    project?: string;
    tags?: string[];
};

export type ClassificationResult = {
    categoryId: string;
    ruleSource: RuleSource;
    ruleVersion: number;
};

function normalizeProjectPattern(pattern: string): string {
    const trimmed = pattern.trim();
    if (trimmed.endsWith(".*")) {
        return trimmed.slice(0, -2);
    }
    return trimmed;
}

function projectMatchesPattern(project: string, pattern: string): boolean {
    const prefix = normalizeProjectPattern(pattern);
    if (!prefix) return false;
    return project === prefix || project.startsWith(`${prefix}.`);
}

function patternSpecificity(pattern: string): {
    segments: number;
    length: number;
} {
    const prefix = normalizeProjectPattern(pattern);
    if (!prefix) return { segments: 0, length: 0 };
    return {
        segments: prefix.split(".").length,
        length: prefix.length,
    };
}

/**
 * Resolves activity category following the strict precedence:
 * explicit -> task override -> longest project path segment match ->
 * prioritized tag rule -> uncategorized.
 */
export function resolveActivityCategory(
    policy: TimePolicy,
    input: ClassificationInput,
): ClassificationResult {
    const validCategories = new Set(policy.categories.map((c) => c.id));
    validCategories.add(UNCATEGORIZED_CATEGORY_ID);

    const validId = (id: string | undefined): string | undefined =>
        id && validCategories.has(id) ? id : undefined;

    const explicit = validId(input.explicitCategoryId?.trim());
    if (explicit) {
        return {
            categoryId: explicit,
            ruleSource: "explicit",
            ruleVersion: policy.policyVersion,
        };
    }

    if (input.taskUuid) {
        const override = validId(policy.taskOverrides[input.taskUuid]);
        if (override) {
            return {
                categoryId: override,
                ruleSource: "task_override",
                ruleVersion: policy.policyVersion,
            };
        }
    }

    const project = input.project?.trim();
    if (project) {
        let bestRule: {
            categoryId: string;
            segments: number;
            length: number;
        } | null = null;
        for (const rule of policy.projectRules) {
            const cat = validId(rule.categoryId);
            if (!cat || !projectMatchesPattern(project, rule.pattern)) continue;
            const spec = patternSpecificity(rule.pattern);
            if (
                !bestRule ||
                spec.segments > bestRule.segments ||
                (spec.segments === bestRule.segments &&
                    spec.length > bestRule.length)
            ) {
                bestRule = { categoryId: cat, ...spec };
            }
        }
        if (bestRule) {
            return {
                categoryId: bestRule.categoryId,
                ruleSource: "project_rule",
                ruleVersion: policy.policyVersion,
            };
        }
    }

    const tags = input.tags ?? [];
    if (tags.length > 0 && policy.tagRules.length > 0) {
        const tagSet = new Set(tags);
        const matched = policy.tagRules
            .filter((rule) => validId(rule.categoryId) && tagSet.has(rule.tag))
            .sort(
                (a, b) =>
                    b.priority - a.priority || a.tag.localeCompare(b.tag, "en"),
            );
        if (matched.length > 0) {
            return {
                categoryId: matched[0].categoryId,
                ruleSource: "tag_rule",
                ruleVersion: policy.policyVersion,
            };
        }
    }

    return {
        categoryId: UNCATEGORIZED_CATEGORY_ID,
        ruleSource: "uncategorized",
        ruleVersion: policy.policyVersion,
    };
}
