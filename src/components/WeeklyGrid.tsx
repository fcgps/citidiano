import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { SLOT_KINDS, SLOT_KIND_COLORS, WEEKDAYS, hhmm, useInsert, useRemove, useTable, useUpdate, type Slot } from "@/lib/data";

// Grade semanal: aulas e compromissos que se repetem toda semana (tabela schedule_slots).
// É a base para o plano da semana sugerir horários livres.
export function WeeklyGrid() {
  const { data: slots = [], isLoading } = useTable("schedule_slots");
  const { data: subjects = [] } = useTable("subjects");
  const [editing, setEditing] = useState<Slot | "new" | null>(null);
  const [newDay, setNewDay] = useState(1);
  const today = ((new Date().getDay() + 6) % 7) + 1; // 1 = segunda
  const colorOf = (s: Slot) => subjects.find((x) => x.id === s.subject_id)?.color ?? SLOT_KIND_COLORS[s.kind] ?? "#64748B";

  return (
    <section className="mb-14">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Grade semanal</p>
          <h2 className="mt-2 text-2xl font-light">Sua rotina <strong className="font-bold">de toda semana</strong></h2>
          <p className="mt-1 text-sm text-muted-foreground">Aulas, treinos e reuniões fixas. Jogue um print da sua grade na <Link to="/despejo" className="font-semibold text-primary-deep">Área de despejo</Link> para preencher de uma vez.</p>
        </div>
        <Button variant="outline" className="rounded-full" onClick={() => { setNewDay(1); setEditing("new"); }}><Plus className="h-4 w-4" />Adicionar horário</Button>
      </div>

      {isLoading ? <p className="text-muted-foreground">Carregando…</p> : slots.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">Sua grade está vazia. Envie um print da grade de horários do SIGAA ou da sua planilha de rotina na Área de despejo.</div>
      ) : (
        <div className="overflow-x-auto rounded-3xl border">
          <div className="grid min-w-[880px] grid-cols-7">
            {[1, 2, 3, 4, 5, 6, 7].map((wd) => {
              const list = slots.filter((s) => s.weekday === wd).sort((a, b) => a.start_time.localeCompare(b.start_time));
              return (
                <div key={wd} className={cn("flex min-h-40 flex-col border-r last:border-r-0", wd === today && "bg-accent/40")}>
                  <div className="flex items-center justify-between border-b p-3">
                    <span className={cn("font-mono text-[10px] uppercase tracking-widest", wd === today ? "font-bold text-primary-deep" : "text-muted-foreground")}>{WEEKDAYS[wd]}</span>
                    <button onClick={() => { setNewDay(wd); setEditing("new"); }} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Adicionar na ${WEEKDAYS[wd]}`}><Plus className="h-3.5 w-3.5" /></button>
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-2">
                    {list.map((s) => (
                      <button key={s.id} onClick={() => setEditing(s)} className="rounded-xl p-2.5 text-left text-xs text-white shadow-sm transition hover:brightness-110" style={{ background: colorOf(s) }}>
                        <div className="font-mono text-[10px] opacity-90">{hhmm(s.start_time)}–{hhmm(s.end_time)}</div>
                        <div className="font-semibold leading-snug">{s.title}</div>
                        {s.location && <div className="opacity-80">{s.location}</div>}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <SlotDialog slot={editing} defaultDay={newDay} onClose={() => setEditing(null)} />
    </section>
  );
}

function SlotDialog({ slot, defaultDay, onClose }: { slot: Slot | "new" | null; defaultDay: number; onClose: () => void }) {
  const open = slot !== null;
  const initial = slot && slot !== "new" ? slot : null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{initial ? "Editar horário" : "Novo horário na grade"}</DialogTitle></DialogHeader>
        {open && <SlotForm key={initial?.id ?? `new-${defaultDay}`} initial={initial} defaultDay={defaultDay} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function SlotForm({ initial, defaultDay, onDone }: { initial: Slot | null; defaultDay: number; onDone: () => void }) {
  const { data: subjects = [] } = useTable("subjects");
  const ins = useInsert("schedule_slots");
  const upd = useUpdate("schedule_slots");
  const rm = useRemove("schedule_slots");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [subject, setSubject] = useState(initial?.subject_id ?? "");
  const [kind, setKind] = useState(initial?.kind ?? "aula");
  const [weekday, setWeekday] = useState(initial?.weekday ?? defaultDay);
  const [start, setStart] = useState(hhmm(initial?.start_time) || "08:00");
  const [end, setEnd] = useState(hhmm(initial?.end_time) || "10:00");
  const [location, setLocation] = useState(initial?.location ?? "");
  const field = "h-10 w-full rounded-md border bg-background px-3 text-sm";

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (end <= start) return;
    const row = { title: title.trim().slice(0, 100), subject_id: subject || null, kind, weekday, start_time: start, end_time: end, location: location.trim().slice(0, 100) || null };
    if (initial) await upd.mutateAsync({ id: initial.id, ...row });
    else await ins.mutateAsync(row);
    onDone();
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="space-y-1.5"><Label>Disciplina</Label>
        <select className={field} value={subject} onChange={(e) => { const id = e.target.value; setSubject(id); const s = subjects.find((x) => x.id === id); if (s && !title.trim()) setTitle(s.name); if (id) setKind("aula"); }}>
          <option value="">Nenhuma (treino, CITi, outro)</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="space-y-1.5"><Label>Nome</Label><Input required maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Cálculo 1, Academia, Reunião CITi" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5"><Label>Tipo</Label><select className={field} value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(SLOT_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="space-y-1.5"><Label>Dia</Label><select className={field} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>{WEEKDAYS.slice(1).map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></div>
        <div className="space-y-1.5"><Label>Início</Label><Input type="time" required value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Fim</Label><Input type="time" required value={end} onChange={(e) => setEnd(e.target.value)} /></div>
      </div>
      {end <= start && <p className="text-xs text-destructive">O fim precisa ser depois do início.</p>}
      <div className="space-y-1.5"><Label>Local</Label><Input maxLength={100} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Opcional (ex.: Grad 3, sala D-004)" /></div>
      <div className="flex items-center justify-between gap-3">
        {initial ? <button type="button" onClick={async () => { await rm.mutateAsync(initial.id); onDone(); }} className="flex items-center gap-1.5 text-sm text-destructive hover:underline"><Trash2 className="h-4 w-4" />Remover da grade</button> : <span />}
        <Button type="submit" className="rounded-full" disabled={ins.isPending || upd.isPending || end <= start}>Salvar</Button>
      </div>
    </form>
  );
}
