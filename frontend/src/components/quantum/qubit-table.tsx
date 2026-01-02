import { Badge } from "@/components/ui/badge";
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
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
      <div className="grid grid-cols-12 gap-0 border-b border-border bg-muted/30 px-4 py-2 text-xs font-semibold text-muted-foreground">
        <div className="col-span-2">Qubit</div>
        <div className="col-span-2">Status</div>
        <div className="col-span-1 text-right">T1</div>
        <div className="col-span-1 text-right">T2</div>
        <div className="col-span-2 text-right">1Q Fidelity</div>
        <div className="col-span-2 text-right">2Q Fidelity</div>
        <div className="col-span-1 text-right">Readout</div>
        <div className="col-span-1 text-right">Drift</div>
      </div>

      {rows.map((r) => (
        <div
          key={r.id}
          className="grid grid-cols-12 items-center px-4 py-2 text-sm hover:bg-muted/40"
        >
          <div className="col-span-2 font-medium">{r.id}</div>
          <div className="col-span-2">{statusBadge(r.status)}</div>

          <div className="col-span-1 text-right tabular-nums">
            {round(r.t1, 1)}µs
          </div>
          <div className="col-span-1 text-right tabular-nums">
            {round(r.t2, 1)}µs
          </div>
          <div className="col-span-2 text-right tabular-nums">
            {round(r.gate1q, 3)}%
          </div>
          <div className="col-span-2 text-right tabular-nums">
            {round(r.gate2q, 3)}%
          </div>
          <div className="col-span-1 text-right tabular-nums">
            {round(r.readout, 3)}%
          </div>

          <div className="col-span-1 text-right tabular-nums">
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
      ))}
    </div>
  );
}
