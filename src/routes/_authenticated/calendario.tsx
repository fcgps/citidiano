import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { addDays, addMonths, addWeeks, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, parseISO, startOfMonth, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PageHeader } from "@/components/PageHeader";
import { GoalCard } from "@/components/GoalCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useTable, useInsert, useRemove, EVENT_KINDS } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/calendario")({
  head: () => ({ meta: [{ title: "Calendário — CITidiano" }, { name: "description", content: "Compromissos fixos e metas flexíveis da sua semana." }, { property: "og:title", content: "Calendário — CITidiano" }, { property: "og:description", content: "Compromissos e metas." }] }),
  component: Calendario,
});

type Item = { id: string; title: string; date: Date; time?: string; color: string; kind: string; source: "event" | "assessment" };

const sel = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

function EventDialog() {
  const [open, setOpen] = useState(false);
  const { data: subjects = [] } = useTable("subjects");
  const [f, setF] = useState({ title: "", kind: "prova", date: "", time: "08:00", subject_id: "" });
  const ins = useInsert("events");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button className="rounded-full shadow-glow"><Plus className="h-4 w-4" /> Compromisso</Button></DialogTrigger>
      <DialogContent><DialogHeader><DialogTitle>Compromisso fixo</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); await ins.mutateAsync({ title: f.title.trim().slice(0, 120), kind: f.kind, starts_at: new Date(`${f.date}T${f.time}`).toISOString(), subject_id: f.subject_id || null }); setOpen(false); }}>
          <div className="space-y-1.5"><Label>Título</Label><Input required maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Reunião de diretoria" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Tipo</Label><select className={sel} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(EVENT_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className="space-y-1.5"><Label>Disciplina</Label><select className={sel} value={f.subject_id} onChange={(e) => setF({ ...f, subject_id: e.target.value })}><option value="">—</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div className="space-y-1.5"><Label>Data</Label><Input required type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Hora</Label><Input required type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></div>
          </div>
          <Button type="submit" className="w-full rounded-full">Salvar</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GoalDialog() {
  const [open, setOpen] = useState(false);
  const { data: subjects = [] } = useTable("subjects");
  const [f, setF] = useState({ title: "", kind: "weekly", n: "3", deadline: "", subject_id: "" });
  const ins = useInsert("goals");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" className="rounded-full border-dashed border-primary/60"><Plus className="h-4 w-4" /> Meta flexível</Button></DialogTrigger>
      <DialogContent><DialogHeader><DialogTitle>Meta flexível</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); const n = Math.max(1, Number(f.n) || 1); await ins.mutateAsync({ title: f.title.trim().slice(0, 120), kind: f.kind, times_per_week: f.kind === "weekly" ? Math.round(n) : null, target_hours: f.kind === "hours" ? n : null, deadline: f.deadline || null, subject_id: f.subject_id || null }); setOpen(false); }}>
          <div className="space-y-1.5"><Label>Meta</Label><Input required maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Academia" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Tipo</Label><select className={sel} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="weekly">Frequência semanal</option><option value="hours">Total de horas</option></select></div>
            <div className="space-y-1.5"><Label>{f.kind === "weekly" ? "Vezes por semana" : "Horas"}</Label><Input type="number" min={1} max={200} value={f.n} onChange={(e) => setF({ ...f, n: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Disciplina</Label><select className={sel} value={f.subject_id} onChange={(e) => setF({ ...f, subject_id: e.target.value })}><option value="">—</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div className="space-y-1.5"><Label>Prazo (opcional)</Label><Input type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></div>
          </div>
          <Button type="submit" className="w-full rounded-full">Salvar</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Chip({ it, compact }: { it: Item; compact?: boolean }) {
  const rm = useRemove("events");
  return (
    <div className="group flex items-start justify-between gap-1 rounded-lg px-2 py-1.5 text-xs text-background" style={{ background: it.color }}>
      <div className="min-w-0">
        {!compact && <div className="font-mono text-[10px] uppercase opacity-80">{it.time ?? "Dia todo"} · {EVENT_KINDS[it.kind] ?? it.kind}</div>}
        <div className="truncate font-semibold">{it.title}</div>
      </div>
      {it.source === "event" && !compact && <button onClick={() => rm.mutate(it.id)} className="opacity-0 group-hover:opacity-100" aria-label="Excluir"><Trash2 className="h-3 w-3" /></button>}
    </div>
  );
}

function Calendario() {
  const [view, setView] = useState<"week" | "month">("week");
  const [cursor, setCursor] = useState(new Date());
  const { data: events = [] } = useTable("events");
  const { data: assessments = [] } = useTable("assessments");
  const { data: subjects = [] } = useTable("subjects");
  const { data: goals = [] } = useTable("goals");
  const subj = (id: string | null) => subjects.find((s) => s.id === id);

  const items: Item[] = useMemo(() => [
    ...events.map((e) => { const d = parseISO(e.starts_at); return { id: e.id, title: e.title, date: d, time: format(d, "HH:mm"), color: subj(e.subject_id)?.color ?? "#0F5132", kind: e.kind, source: "event" as const }; }),
    ...assessments.map((a) => ({ id: a.id, title: `${a.name} · ${subj(a.subject_id)?.name ?? ""}`, date: parseISO(a.date), color: subj(a.subject_id)?.color ?? "#00C853", kind: a.kind === "seminario" || a.kind === "entrega" ? "entrega" : "prova", source: "assessment" as const })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime()), [events, assessments, subjects]);

  const start = view === "week" ? startOfWeek(cursor, { weekStartsOn: 1 }) : startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
  const end = view === "week" ? endOfWeek(cursor, { weekStartsOn: 1 }) : endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
  const days: Date[] = []; for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  const move = (n: number) => setCursor(view === "week" ? addWeeks(cursor, n) : addMonths(cursor, n));
  const today = new Date();

  return (
    <>
      <PageHeader eyebrow="Calendário" title={<>Sua agenda, <strong className="font-bold">fixa e flexível.</strong></>} action={<div className="flex flex-wrap gap-2"><GoalDialog /><EventDialog /></div>} />

      <section className="mb-10">
        <p className="eyebrow mb-3">Metas flexíveis</p>
        {goals.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma meta. Ex: "Academia 3x por semana".</p> :
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{goals.map((g) => <GoalCard key={g.id} g={g} subject={subj(g.subject_id)} />)}</div>}
      </section>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="rounded-full" onClick={() => move(-1)} aria-label="Anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" className="rounded-full" onClick={() => move(1)} aria-label="Próximo"><ChevronRight className="h-4 w-4" /></Button>
          <h2 className="ml-2 text-xl font-bold capitalize">{view === "week" ? `${format(start, "d MMM", { locale: ptBR })} – ${format(end, "d MMM", { locale: ptBR })}` : format(cursor, "MMMM yyyy", { locale: ptBR })}</h2>
        </div>
        <div className="flex rounded-full border p-1 text-sm">
          {(["week", "month"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-full px-4 py-1 font-medium ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{v === "week" ? "Semana" : "Mês"}</button>
          ))}
        </div>
      </div>

      {view === "week" ? (
        <div className="grid gap-3 md:grid-cols-7">
          {days.map((d) => {
            const list = items.filter((i) => isSameDay(i.date, d));
            const isToday = isSameDay(d, today);
            return (
              <div key={d.toISOString()} className={`min-h-32 rounded-2xl border p-3 ${isToday ? "border-primary bg-accent/40" : ""}`}>
                <div className="mb-2 flex items-baseline gap-2 md:block">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{format(d, "EEE", { locale: ptBR })}</div>
                  <div className={`text-2xl font-bold ${isToday ? "text-primary-deep" : ""}`}>{format(d, "d")}</div>
                </div>
                <div className="space-y-1.5">{list.map((i) => <Chip key={i.source + i.id} it={i} />)}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border">
          <div className="grid grid-cols-7 border-b bg-muted">{["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((w) => <div key={w} className="p-2 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{w}</div>)}</div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const list = items.filter((i) => isSameDay(i.date, d));
              return (
                <div key={d.toISOString()} className={`min-h-20 border-b border-r p-1.5 md:min-h-28 ${isSameMonth(d, cursor) ? "" : "bg-muted/50 text-muted-foreground"}`}>
                  <div className={`mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${isSameDay(d, today) ? "bg-primary text-primary-foreground" : ""}`}>{format(d, "d")}</div>
                  <div className="hidden space-y-1 md:block">{list.slice(0, 3).map((i) => <Chip key={i.source + i.id} it={i} compact />)}{list.length > 3 && <div className="text-[10px] text-muted-foreground">+{list.length - 3}</div>}</div>
                  <div className="flex gap-0.5 md:hidden">{list.map((i) => <span key={i.source + i.id} className="h-1.5 w-1.5 rounded-full" style={{ background: i.color }} />)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="mt-6 flex flex-wrap gap-5 text-xs text-muted-foreground">
        <span className="flex items-center gap-2"><span className="h-3 w-5 rounded bg-primary-deep" /> Compromisso fixo (cor da disciplina)</span>
        <span className="flex items-center gap-2"><span className="h-3 w-5 rounded border-2 border-dashed border-primary/60" /> Meta flexível</span>
      </div>
    </>
  );
}
