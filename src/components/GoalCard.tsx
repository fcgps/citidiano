import { Target, Plus, Trash2 } from "lucide-react";
import { addDays, parseISO, startOfWeek } from "date-fns";
import { useInsert, useUpdate, useRemove, useTable, type Goal, type Subject } from "@/lib/data";

export function goalTarget(g: Goal) { return g.kind === "weekly" ? g.times_per_week ?? 1 : Number(g.target_hours ?? 1); }

const PHYSICAL_RE = /academia|treino|muscula|pelada|futebol|corrida|correr|nata[cç][aã]o|esporte|caminhada|bike|pedal|luta|crossfit|yoga|pilates/i;

// Meta semanal: cada "+" registra a atividade na agenda (hoje, agora). O progresso conta só
// os registros desta semana, então zera sozinho toda segunda, e o plano da semana enxerga o
// que já foi feito (ex.: academia 3x com 1 já feita → sugere só mais 2).
// Meta em horas: o "+" soma 1h ao total, como antes.
export function GoalCard({ g, subject }: { g: Goal; subject?: Subject | undefined }) {
  const up = useUpdate("goals"); const rm = useRemove("goals"); const ins = useInsert("events");
  const { data: events = [] } = useTable("events");
  const weekly = g.kind === "weekly";
  const target = goalTarget(g);
  const start = startOfWeek(new Date(), { weekStartsOn: 1 }), end = addDays(start, 7);
  const doneThisWeek = events.filter((e) => e.title === g.title && (e.kind === "treino" || e.kind === "estudo" || e.kind === "outro") && parseISO(e.starts_at) >= start && parseISO(e.starts_at) < end).length;
  const done = weekly ? doneThisWeek : Number(g.done);
  const pct = Math.min(100, (done / target) * 100);
  const unit = weekly ? "x" : "h";

  function add() {
    if (weekly) ins.mutate({ title: g.title, kind: PHYSICAL_RE.test(g.title) ? "treino" : g.subject_id ? "estudo" : "outro", starts_at: new Date().toISOString(), subject_id: g.subject_id });
    else up.mutate({ id: g.id, done: done + 1 });
  }

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
        {weekly ? `${target}x por semana · esta semana` : `${target}h no total`}
        {subject && ` · ${subject.name}`}
        {g.deadline && ` · até ${g.deadline.split("-").reverse().slice(0, 2).join("/")}`}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full bg-gradient-primary" style={{ width: `${pct}%` }} /></div>
        <span className="text-sm font-bold tabular-nums">{done}/{target}{unit}</span>
        <button onClick={add} disabled={ins.isPending} className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50" aria-label={weekly ? "Registrar que fiz hoje" : "Registrar 1h"} title={weekly ? "Registrar que fiz hoje" : "Registrar 1h"}><Plus className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
