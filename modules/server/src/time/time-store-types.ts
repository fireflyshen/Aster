import type {
    Activity,
    ActivityPrecision,
    ActivityReviewReason,
    ActivityReviewState,
    ActivitySource,
    ActivityStopReason,
    OperationState,
    RuleSource,
    TimeEventKind,
    TimeWarning,
    TimingPlanStopBasis,
} from "../../../core/time/model.ts";

export class TimeStoreError extends Error {
    status: number;
    code: string;
    details?: Record<string, unknown>;

    constructor(
        status: number,
        code: string,
        message: string,
        details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = "TimeStoreError";
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export type TimeOperationRecord = {
    idempotencyKey: string;
    operationId: string;
    kind: string;
    inputHash: string;
    timeEpoch: number;
    taskDataEpoch: number;
    receivedAtMs: number;
    state: OperationState;
    targetActivityId?: string;
    targetTaskUuid?: string;
    preState?: Record<string, unknown>;
    dependencies?: OperationDependencies;
    effectiveAtMs?: number;
    externalDisposition?: string;
    undoneByOperationId?: string;
    receipt?: Record<string, unknown>;
    createdAtMs: number;
    updatedAtMs: number;
};

export type OperationDependencies = {
    taskUuids: string[];
    activityIds: string[];
    holdsTimerSlot: boolean;
};

export type ActivityMutationReceipt = {
    operationId: string;
    idempotencyKey: string;
    changed: boolean;
    activity: Activity;
    closedActivity?: Activity;
    warnings: TimeWarning[];
    sessionVersion: number;
    timeEpoch: number;
    taskDataEpoch: number;
    undo?: UndoMetadata;
};

export type ActivitySnapshotFields = {
    kind: Activity["kind"];
    title: string;
    categoryId: string;
    ruleVersion: number;
    ruleSource: RuleSource;
    taskUuid: string | null;
    projectSnapshot: string | null;
    startMs: number | null;
    endMs: number | null;
    suspendMs: number | null;
    confirmedThroughMs: number | null;
    reviewDueAtMs: number | null;
    reviewReason: ActivityReviewReason | null;
    timingPlanId: string | null;
    autoStopAtMs: number | null;
    autoStopBasis: TimingPlanStopBasis | null;
    limitVersion: number | null;
    timerStoppedAtMs: number | null;
    stopReason: ActivityStopReason | null;
    processedAtMs: number | null;
    windowStartMs: number | null;
    windowEndMs: number | null;
    targetDate: string | null;
    estimatedSeconds: number | null;
    precision: ActivityPrecision;
    source: ActivitySource;
    reviewState: ActivityReviewState;
    note: string | null;
    candidateKey: string | null;
};

export type UndoMetadata = {
    createdActivityId?: string;
    createdPostVersion?: number;
    modifiedActivities: Array<{
        id: string;
        expectedPostVersion: number;
        restore: ActivitySnapshotFields;
    }>;
    touchedTimer: boolean;
    expectedPostActiveActivityId: string | null;
    restoreActiveActivityId: string | null;
    sleepDecisionKey?: string;
};

export type MetaRow = {
    schema_version: number;
    initialized: number;
    enabled: number;
    time_epoch: number;
    task_data_epoch: number;
    restore_barrier_at: number;
    session_version: number;
    active_activity_id: string | null;
    cutover_at_ms: number | null;
    policy_version: number;
    policy_json: string;
    updated_at_ms: number;
};

export type ActivityRow = {
    id: string;
    version: number;
    kind: Activity["kind"];
    title: string;
    category_id: string;
    rule_version: number;
    rule_source: RuleSource;
    task_uuid: string | null;
    project_snapshot: string | null;
    start_ms: number | null;
    end_ms: number | null;
    suspend_ms: number | null;
    confirmed_through_ms: number | null;
    review_due_at_ms: number | null;
    review_reason: ActivityReviewReason | null;
    timing_plan_id: string | null;
    auto_stop_at_ms: number | null;
    auto_stop_basis: TimingPlanStopBasis | null;
    limit_version: number | null;
    timer_stopped_at_ms: number | null;
    stop_reason: ActivityStopReason | null;
    processed_at_ms: number | null;
    window_start_ms: number | null;
    window_end_ms: number | null;
    target_date: string | null;
    estimated_seconds: number | null;
    precision: ActivityPrecision;
    source: ActivitySource;
    review_state: ActivityReviewState;
    raw_input: string | null;
    note: string | null;
    timezone: string;
    import_batch_id: string | null;
    source_record_id: string | null;
    candidate_key: string | null;
    created_at_ms: number;
    updated_at_ms: number;
};

export type TimingPlanRow = {
    id: string;
    version: number;
    title: string;
    category_id: string | null;
    task_uuid: string | null;
    project_snapshot: string | null;
    tags_json: string | null;
    note: string | null;
    timezone: string;
    allowance_seconds: number | null;
    planned_start_at_ms: number | null;
    hard_stop_at_ms: number | null;
    archived_at_ms: number | null;
    created_at_ms: number;
    updated_at_ms: number;
};

export type TimeEventRow = {
    id: string;
    dedup_key: string;
    kind: TimeEventKind;
    activity_id: string | null;
    plan_id: string | null;
    title: string;
    message: string;
    occurred_at_ms: number;
    payload_json: string;
    acknowledged_at_ms: number | null;
    created_at_ms: number;
};

export type OperationRow = {
    idempotency_key: string;
    operation_id: string;
    kind: string;
    input_hash: string;
    time_epoch: number;
    task_data_epoch: number;
    received_at_ms: number;
    state: OperationState;
    target_activity_id: string | null;
    target_task_uuid: string | null;
    pre_state_json: string | null;
    dependencies_json: string | null;
    effective_at_ms: number | null;
    external_disposition: string | null;
    undone_by_operation_id: string | null;
    receipt_json: string | null;
    created_at_ms: number;
    updated_at_ms: number;
};

export type CreateTimeStoreOptions = {
    barrierPath?: string;
    enabled?: boolean;
    cutoverAtMs?: number;
    now?: () => number;
};
