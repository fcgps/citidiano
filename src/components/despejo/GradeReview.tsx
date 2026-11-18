import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SLOT_KINDS, SUBJECT_COLORS, WEEKDAYS, useTable, type Dump, type Subject } from "@/lib/data";
import { discardDump } from "@/components/despejo/Review";

// Revisão de uma grade semanal lida pela IA (ex.: print da planilha "Rotina semanal")
type Row = { keep: boolean; title: string; subject: string; newSubject: string; kind: string; weekday: number; start: string; end: string; location: string };
const TIME = /^\d{2}:\d{2}$/;

export function GradeReview({ dump, subjects }: { dump: Dump; subjects: Subject[] }) {
  const g = ((dump.result as any)?.grade ?? {}) as { slots?: any[]; ignored?: string[] };
  const qc = useQueryClient();
  const { data: current = [] } = useTable("schedule_slots");
  const [replace, setReplace] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<Row[]>(() => (g.slots ?? []).map((x) => {
    const sid = subjects.some((s) => s.id === x?.subject_id) ? x.subject_id : "";
    return {
      keep: true,
      title: String(x?.title ?? ""),
      subject: sid || (x?.new_subject_name ? "__new" : ""),
      newSubject: String(x?.new_subject_name ?? ""),
      kind: SLOT_KINDS[x?.kind] ? x.kind : "aula",
      weekday: Number(x?.weekday) >= 1 && Number(x?.weekday) <= 7 ? Number(x.weekday) : 1,
      start: TIME.test(x?.start) ? x.start : "",
      end: TIME.test(x?.end) ? x.end : "",
      location: String(x?.location ?? ""),
    };
  }));
  const upd = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const kept = rows.filter((r) => r.keep);
  const invalid = kept.some((r) => !r.title.trim() || !TIME.test(r.start) || !TIME.test(r.end) || r.end <= r.start || (r.subject === "__new" && !r.newSubject.trim()));
  const field = "h-9 w-full rounded-md border bg-background px-2 text-sm";

  async function save() {
    setSaving(true);
    try {
      // Cria as disciplinas novas uma vez só (mesmo nome = mesma disciplina)
      const created = new Map<string, string>();
      let colorIdx = subjects.length;
      for (const r of kept.filter((r) => r.subject === "__new")) {
        const name = r.newSubject.trim().slice(0, 100);
        const key = name.toLowerCase();
        if (created.has(key)) continue;
        const existing = subjects.find((s) => s.name.toLowerCase() === key);
        if (existing) { created.set(key, existing.id); continue; }
        const { data, error } = await supabase.from("subjects").insert({ name, color: SUBJECT_COLORS[colorIdx++ % SUBJECT_COLORS.length]! }).select("id").single();
        if (error) throw error;
        created.set(key, data.id);
      }
      if (replace && current.length) {
        const { error } = await supabase.from("schedule_slots").delete().in("id", current.map((c) => c.id));
        if (error) throw error;
      }
      const { error } = await supabase.from("schedule_slots").insert(kept.map((r) => ({
        title: r.title.trim().slice(0, 100),
        subject_id: r.subject === "__new" ? created.get(r.newSubject.trim().toLowerCase()) ?? null : r.subject || null,
        kind: r.kind,
        weekday: r.weekday,
        start_time: r.start,
        end_time: r.end,
        location: r.location.trim().slice(0, 100) || null,
      })));
      if (error) throw error;
      await supabase.from("dumps").update({ status: "done", summary: `Grade semanal → ${kept.length} ${kept.length === 1 ? "horário" : "horários"}${created.size ? ` · ${created.size} disciplina(s) nova(s)` : ""}` }).eq("id", dump.id);
      qc.invalidateQueries();
      toast.success("Grade semanal salva! Veja em Disciplinas.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui salvar a grade.");
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className={cn("grid gap-2 rounded-2xl border p-3 md:grid-cols-[auto_1.4fr_1.2fr_0.8fr_0.9fr_0.7fr_0.7fr_auto]", !r.keep && "opacity-50")}>
            <input type="checkbox" checked={r.keep} onChange={(e) => upd(i, { keep: e.target.checked })} className="mt-2.5 h-4 w-4 accent-[var(--color-primary)]" aria-label="Manter" />
            <input className={field} value={r.title} onChange={(e) => upd(i, { title: e.target.value })} placeholder="Nome" />
            <div>
              <select className={field} value={r.subject} onChange={(e) => upd(i, { subject: e.target.value })}>
                <option value="">Sem disciplina</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value="__new">+ Nova disciplina…</option>
              </select>
              {r.subject === "__new" && <input className={cn(field, "mt-1")} value={r.newSubject} onChange={(e) => upd(i, { newSubject: e.target.value })} placeholder="Nome da disciplina" />}
            </div>
            <select className={field} value={r.kind} onChange={(e) => upd(i, { kind: e.target.value })}>{Object.entries(SLOT_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select className={field} value={r.weekday} onChange={(e) => upd(i, { weekday: Number(e.target.value) })}>{WEEKDAYS.slice(1).map((d, j) => <option key={d} value={j + 1}>{d}</option>)}</select>
            <input type="time" className={cn(field, !TIME.test(r.start) && "border-amber-400")} value={r.start} onChange={(e) => upd(i, { start: e.target.value })} />
            <input type="time" className={cn(field, (!TIME.test(r.end) || r.end <= r.start) && "border-amber-400")} value={r.end} onChange={(e) => upd(i, { end: e.target.value })} />
            <button onClick={() => setRows(rows.filter((_, j) => j !== i))} className="mt-1 justify-self-end rounded p-1.5 text-muted-foreground hover:text-destructive" aria-label="Remover"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <button onClick={() => setRows([...rows, { keep: true, title: "", subject: "", newSubject: "", kind: "aula", weekday: 1, start: "", end: "", location: "" }])} className="flex items-center gap-1 text-sm font-semibold text-primary-deep"><Plus className="h-4 w-4" />Adicionar horário</button>
      </div>

      {(g.ignored ?? []).length > 0 && (
        <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground"><strong className="text-foreground">Ficaram de fora</strong> (não se repetem toda semana): {(g.ignored ?? []).join(" · ")}. Se forem compromissos com data, escreva no Despejo que eles vão para o calendário.</p>
      )}

      {current.length > 0 && (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="h-4 w-4" />Substituir minha grade atual ({current.length} {current.length === 1 ? "horário" : "horários"})</label>
      )}

      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="ghost" className="rounded-full" onClick={() => discardDump(dump, qc)}>Descartar</Button>
        <Button className="rounded-full shadow-glow" disabled={saving || invalid || kept.length === 0} onClick={save}><Check className="mr-1 h-4 w-4" />{saving ? "Salvando…" : `Salvar ${kept.length} ${kept.length === 1 ? "horário" : "horários"}`}</Button>
      </div>
      {invalid && <p className="text-right text-xs text-amber-600">Confira os campos em amarelo: todo horário precisa de nome, início e fim.</p>}
    </div>
  );
}
