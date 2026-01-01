export default function MetricPill({
  label,
  value,
  unit,
  subtle,
}: {
  label: string;
  value: string;
  unit?: string;
  subtle?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between rounded-xl border bg-white/60 px-3 py-2 shadow-sm backdrop-blur-sm">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={"text-sm font-semibold " + (subtle ? "text-muted-foreground" : "text-foreground")}>
        {value}
        {unit ? <span className="ml-1 text-xs font-medium text-muted-foreground">{unit}</span> : null}
      </div>
    </div>
  );
}
