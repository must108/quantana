import React, { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { round } from "@/lib/utils";

export type QubitRow = {
  id: string;
  status: "Healthy" | "Degraded" | "Critical";
  t1: number;
  t2: number;
  gate1q: number;
  gate2q: number;
  readout: number;
  driftScore: number;
};

function statusBadge(s: QubitRow["status"]) {
  if (s === "Healthy")
    return (
      <Badge className="border bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/20">
        Healthy
      </Badge>
    );
  if (s === "Degraded")
    return (
      <Badge className="border bg-amber-500/10 text-amber-600 dark:text-amber-300 border-amber-500/20">
        Degraded
      </Badge>
    );
  return (
    <Badge className="border bg-red-500/10 text-red-600 dark:text-red-300 border-red-500/20">
      Critical
    </Badge>
  );
}

export default function QubitTable({ rows }: { rows: QubitRow[] }) {
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const focusedRow = useMemo(() => {
    if (!focusedId) return null;
    return rows.find((r) => r.id === focusedId) ?? null;
  }, [focusedId, rows]);

  const cellBase =
    "px-4 py-2 text-sm transition-colors group-hover:bg-muted/40";

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
      {/* focus strip */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/20 px-4 py-2">
        <div className="text-xs font-semibold text-muted-foreground">
          Per-Qubit Metrics
        </div>

        <div className="flex items-center gap-2">
          {focusedRow ? (
            <>
              <Badge className="border bg-foreground text-background">
                Focused: {focusedRow.id}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                className="h-7 rounded-lg px-2 text-xs"
                onClick={() => setFocusedId(null)}
              >
                Clear
              </Button>
            </>
          ) : (
            <div className="text-xs text-muted-foreground">
              Click a row to focus
            </div>
          )}
        </div>
      </div>

      {/* scroll container */}
      <div className="max-h-[460px] overflow-auto">
        <div className="min-w-[980px]">
          {/* header (NOT sticky anymore) */}
          <div className="grid grid-cols-12 gap-0 border-b border-border bg-muted/30 text-xs font-semibold text-muted-foreground">
            <div className="col-span-2 px-4 py-2">Qubit</div>
            <div className="col-span-2 px-4 py-2">Status</div>
            <div className="col-span-1 px-4 py-2 text-right">T1</div>
            <div className="col-span-1 px-4 py-2 text-right">T2</div>
            <div className="col-span-2 px-4 py-2 text-right">1Q Fidelity</div>
            <div className="col-span-2 px-4 py-2 text-right">2Q Fidelity</div>
            <div className="col-span-1 px-4 py-2 text-right">Readout</div>
            <div className="col-span-1 px-4 py-2 text-right">Drift</div>
          </div>

          {/* rows */}
          {rows.map((r) => {
            const isFocused = focusedId === r.id;

            return (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => setFocusedId(r.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setFocusedId(r.id);
                  }
                }}
                className={[
                  "group grid grid-cols-12 items-center border-b border-border/60 last:border-b-0 outline-none",
                  "cursor-pointer select-none",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  isFocused
                    ? "bg-muted/35 ring-1 ring-primary/25"
                    : "bg-card",
                ].join(" ")}
              >
                <div className={"col-span-2 " + cellBase}>
                  <span className={isFocused ? "font-semibold" : "font-medium"}>
                    {r.id}
                  </span>
                </div>

                <div className={"col-span-2 " + cellBase}>
                  {statusBadge(r.status)}
                </div>

                <div className={"col-span-1 text-right tabular-nums " + cellBase}>
                  {round(r.t1, 1)}µs
                </div>

                <div className={"col-span-1 text-right tabular-nums " + cellBase}>
                  {round(r.t2, 1)}µs
                </div>

                <div className={"col-span-2 text-right tabular-nums " + cellBase}>
                  {round(r.gate1q, 3)}%
                </div>

                <div className={"col-span-2 text-right tabular-nums " + cellBase}>
                  {round(r.gate2q, 3)}%
                </div>

                <div className={"col-span-1 text-right tabular-nums " + cellBase}>
                  {round(r.readout, 3)}%
                </div>

                <div className={"col-span-1 text-right tabular-nums " + cellBase}>
                  <span
                    className={
                      r.driftScore > 2.2
                        ? "text-red-600 dark:text-red-300"
                        : r.driftScore > 1.6
                        ? "text-amber-600 dark:text-amber-300"
                        : "text-muted-foreground"
                    }
                  >
                    {round(r.driftScore, 2)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
