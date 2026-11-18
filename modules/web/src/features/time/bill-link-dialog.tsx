import { useI18n } from "@/app/language";
import type { BillExpenseItem, BillLink } from "@core/time/model";
import { Plus, Receipt, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { fetchBillExpenses, linkBillExpense } from "./time-api";
import { formatCurrencyCny } from "./time-format";

export function BillLinkDialog({
  open,
  onOpenChange,
  targetLabel,
  taskUuid,
  activityId,
  existingLinks,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetLabel: string;
  taskUuid?: string;
  activityId?: string;
  existingLinks: readonly BillLink[];
  onLinked: (link: BillLink) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [linkingKey, setLinkingKey] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [items, setItems] = useState<BillExpenseItem[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const handle = window.setTimeout(
      () => {
        setLoading(true);
        setError("");
        void fetchBillExpenses({
          q: query.trim() || undefined,
          limit: 60,
        })
          .then((res) => {
            if (cancelled) return;
            setAvailable(res.available);
            setItems(res.expenses);
          })
          .catch((err) => {
            if (cancelled) return;
            setError(err instanceof Error ? err.message : t("读取账单失败"));
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
      query ? 180 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, query]);

  const linkedKeys = new Set(existingLinks.map((link) => link.txKey));

  async function handleAttach(item: BillExpenseItem) {
    setLinkingKey(item.txKey);
    setError("");
    try {
      const res = await linkBillExpense({
        txKey: item.txKey,
        taskUuid,
        activityId,
        source: item.source,
        txId: item.txId,
        payTime: item.payTime,
        payee: item.payee,
        narration: item.narration,
        account: item.account,
        currency: item.currency,
        amount: item.amount,
        cnyAmountCents: item.cnyAmountCents,
      });
      await onLinked(res.link);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("关联账单失败"));
    } finally {
      setLinkingKey(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("关联 Bills 现金支出")}</DialogTitle>
          <DialogDescription>
            {t("为「")}
            {targetLabel}
            {t(
              "」关联实际支出；只读读取 Bills 流水，时间折算金额绝不会写入 Bills。",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("搜索商户、摘要、账户或金额…")}
              className="pl-8 text-xs"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          {!available ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {t(
                "未检测到可用的 Bills 账本目录（可用环境变量 `ASTER_BILLS_DIR` 或同级 `../Bills/journal` 目录）。",
              )}
            </p>
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Spinner className="size-3.5" />
              {t("正在检索 Bills 账单…")}
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {t("没有找到匹配的支出流水。")}
            </p>
          ) : (
            <div className="max-h-72 divide-y divide-border/40 overflow-y-auto rounded-md border border-border/50">
              {items.map((item) => {
                const already = linkedKeys.has(item.txKey);
                const foreignNote =
                  item.currency !== "CNY"
                    ? `${item.amount} ${item.currency} ≈ `
                    : "";
                return (
                  <div
                    key={item.txKey}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-(--row-hover)"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                          {item.date}
                        </span>
                        <span className="truncate font-medium text-foreground">
                          {item.payee || item.narration}
                        </span>
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {item.narration && item.narration !== item.payee
                          ? `${item.narration} · `
                          : ""}
                        {item.account}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-medium text-foreground tabular-nums">
                        {foreignNote}
                        {formatCurrencyCny(item.cnyAmountCents)}
                      </span>
                      <Button
                        type="button"
                        size="xs"
                        variant={already ? "ghost" : "outline"}
                        disabled={already || linkingKey === item.txKey}
                        onClick={() => void handleAttach(item)}
                      >
                        {already
                          ? t("已关联")
                          : linkingKey === item.txKey
                            ? t("关联中…")
                            : t("关联")}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LinkedBillsList({
  links,
  busy,
  onUnlink,
  onOpenPicker,
}: {
  links: readonly BillLink[];
  busy?: boolean;
  onUnlink: (linkId: string) => Promise<void> | void;
  onOpenPicker?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Receipt className="size-3.5" />
          <span>{t("关联现金支出（Bills 只读）")}</span>
        </div>
        {onOpenPicker && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            disabled={busy}
            onClick={onOpenPicker}
          >
            <Plus className="size-3" />
            {t("关联 Bills 账单")}
          </Button>
        )}
      </div>
      {links.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/70">
          {t(
            "暂无关联现金支出；如为某件事产生了购买支出，可关联进来对比时间成本。",
          )}
        </p>
      ) : (
        <div className="divide-y divide-border/35 rounded-md border border-border/45">
          {links.map((link) => (
            <div
              key={link.id}
              className="group flex items-center justify-between gap-3 px-2.5 py-1.5 text-xs"
            >
              <div className="min-w-0">
                <div className="truncate text-foreground">
                  {link.payee || link.narration}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {link.payTime.slice(0, 10)} · {link.account}
                  {link.currency !== "CNY"
                    ? ` · ${link.amount} ${link.currency}`
                    : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="font-medium text-foreground tabular-nums">
                  {formatCurrencyCny(link.cnyAmountCents)}
                </span>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={t("解除账单关联")}
                  className="size-6 text-muted-foreground md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                  disabled={busy}
                  onClick={() => void onUnlink(link.id)}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
