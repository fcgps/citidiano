import { Target, Plus, Trash2 } from "lucide-react";
import { useUpdate, useRemove, type Goal, type Subject } from "@/lib/data";

export function goalTarget(g: Goal) { return g.kind === "weekly" ? g.times_per_week ?? 1 : Number(g.target_hours ?? 1); }

export function GoalCard({ g, subject }: { g: Goal; subject?: Subject }) {
  const up = useUpdate("goals"); const rm = useRemove("goals");
  const target = goalTarget(g); const done = Number(g.done);
  const pct = Math.min(100, (done / target) * 100);
  const unit = g.kind === "weekly" ? "x" : "h";
  return (
    <div className="group rounded-2xl border-2 border-dashed border-primary/40 bg-accent/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary-deep" />
          <span className="font-semibold leading-tight">{g.title}</span>
        </div>
        <button onClick={() => rm.mutate(g.id)} className="text-muted-foreground opacity-0 group-hover:opacity-100" aria-label="Excluir"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
      <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        {g.kind === "weekly" ? `${target}x por semana` : `${target}h no total`}
        {subject && ` · ${subject.name}`}
        {g.deadline && ` · até ${g.deadline.split("-").reverse().slice(0, 2).join("/")}`}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full bg-gradient-primary" style={{ width: `${pct}%` }} /></div>
        <span className="text-sm font-bold tabular-nums">{done}/{target}{unit}</span>
        <button onClick={() => up.mutate({ id: g.id, done: done + 1 })} className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-label="Registrar progresso"><Plus className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
