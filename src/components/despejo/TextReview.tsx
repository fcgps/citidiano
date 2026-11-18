import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EVENT_KINDS, useTable, type Dump } from "@/lib/data";
import { discardDump } from "@/components/despejo/Review";
import { addSuggestion, moveSuggestion, removeSuggestion, weekDates } from "@/lib/plan-cache";

// Ações que a IA pode propor a partir de um texto (ver interpretText em despejo.functions.ts)
type Action =
  | { type: "create_event"; label: string; title: string; kind: string; date: string; time: string; subject_id: string | null }
  | { type: "move_event"; label: string; event_id: string; date: string; time: string }
  | { type: "delete_event"; label: string; event_id: string }
  | { type: "create_assessment"; label: string; subject_id: string; name: string; date: string; kind: string; topics: string | null }
  | { type: "move_assessment"; label: string; assessment_id: string; date: string }
  | { type: "create_goal"; label: string; title: string; kind: string; times_per_week: number | null; target_hours: number | null; subject_id: string | null; deadline: string | null }
  | { type: "move_suggestion"; label: string; ref: string; date: string }
  | { type: "remove_suggestion"; label: string; ref: string }
  | { type: "add_suggestion"; label: string; date: string; title: string; suggestion_type: string; subject_id: string | null; note: string | null };

const SUGGESTION_TYPES = ["estudo", "treino", "descanso", "citi", "outro"] as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const ASSESSMENT_KINDS = ["prova", "mini-prova", "entrega", "seminario", "extra"];

export function TextReview({ dump }: { dump: Dump }) {
  const r = (dump.result as any) ?? {};
  const reply: string = r.reply ?? "";
  const qc = useQueryClient();
  const { data: subjects = [] } = useTable("subjects");
  const { data: events = [] } = useTable("events");
  const { data: assessments = [] } = useTable("assessments");
  const [saving, setSaving] = useState(false);
  // Sugestões do plano da semana que foram enviadas junto com a mensagem
  const planWeekStart: string | null = r.plan?.week ?? null;
  const planItems: { ref: string; date: string; title: string }[] = Array.isArray(r.plan?.items) ? r.plan.items : [];
  const suggestion = (ref: string) => planItems.find((p) => p.ref === ref);
  const inPlanWeek = (date: string) => !!planWeekStart && weekDates(planWeekStart).includes(date);

  // Só mostra ações que apontam para coisas que realmente existem
  const valid = (a: Action) => {
    const subjOk = (id: string | null) => !id || subjects.some((s) => s.id === id);
    switch (a.type) {
      case "create_event": return !!a.title && DATE.test(a.date) && subjOk(a.subject_id);
      case "move_event": return events.some((e) => e.id === a.event_id) && DATE.test(a.date);
      case "delete_event": return events.some((e) => e.id === a.event_id);
      case "create_assessment": return subjects.some((s) => s.id === a.subject_id) && !!a.name && DATE.test(a.date);
      case "move_assessment": return assessments.some((x) => x.id === a.assessment_id) && DATE.test(a.date);
      case "create_goal": return !!a.title;
      case "move_suggestion": return !!suggestion(a.ref) && inPlanWeek(a.date);
      case "remove_suggestion": return !!suggestion(a.ref);
      case "add_suggestion": return !!a.title && inPlanWeek(a.date) && subjOk(a.subject_id);
      default: return false;
    }
  };
  const actions: Action[] = (Array.isArray(r.actions) ? r.actions : []).filter((a: Action) => a && typeof a.type === "string" && valid(a));
  const [on, setOn] = useState<boolean[]>(() => actions.map(() => true));
  const chosen = actions.filter((_, i) => on[i] ?? true);

  async function run(a: Action) {
    const at = (date: string, time?: string) => new Date(`${date}T${time && TIME.test(time) ? time : "12:00"}`).toISOString();
    let res: { error: { message: string } | null };
    switch (a.type) {
      case "create_event":
        res = await supabase.from("events").insert({ title: a.title.slice(0, 120), kind: EVENT_KINDS[a.kind] ? a.kind : "outro", starts_at: at(a.date, a.time), subject_id: a.subject_id || null });
        break;
      case "move_event":
        res = await supabase.from("events").update({ starts_at: at(a.date, a.time) }).eq("id", a.event_id);
        break;
      case "delete_event":
        res = await supabase.from("events").delete().eq("id", a.event_id);
        break;
      case "create_assessment":
        res = await supabase.from("assessments").insert({ subject_id: a.subject_id, name: a.name.slice(0, 120), date: a.date, kind: ASSESSMENT_KINDS.includes(a.kind) ? a.kind : "prova", topics: a.topics || null });
        break;
      case "move_assessment":
        res = await supabase.from("assessments").update({ date: a.date }).eq("id", a.assessment_id);
        break;
      case "create_goal": {
        const weekly = a.kind !== "hours";
        res = await supabase.from("goals").insert({ title: a.title.slice(0, 120), kind: weekly ? "weekly" : "hours", times_per_week: weekly ? Math.max(1, Math.round(a.times_per_week ?? 1)) : null, target_hours: weekly ? null : Math.max(1, a.target_hours ?? 1), subject_id: a.subject_id || null, deadline: a.deadline && DATE.test(a.deadline) ? a.deadline : null });
        break;
      }
      // Sugestões do plano: mexe só no plano salvo (continuam sendo sugestões, nada vai para o calendário)
      case "move_suggestion": {
        const s = suggestion(a.ref)!;
        if (!(await moveSuggestion(planWeekStart!, s, a.date))) throw new Error("Não achei essa sugestão no plano. Refaça o plano e tente de novo.");
        return;
      }
      case "remove_suggestion": {
        const s = suggestion(a.ref)!;
        if (!(await removeSuggestion(planWeekStart!, s))) throw new Error("Não achei essa sugestão no plano. Refaça o plano e tente de novo.");
        return;
      }
      case "add_suggestion": {
        const type = (SUGGESTION_TYPES as readonly string[]).includes(a.suggestion_type) ? (a.suggestion_type as (typeof SUGGESTION_TYPES)[number]) : "outro";
        if (!(await addSuggestion(planWeekStart!, { date: a.date, title: a.title, type, subject_id: a.subject_id || null, note: a.note || null }))) throw new Error("Não achei o plano dessa semana. Monte o plano e tente de novo.");
        return;
      }
      default:
        return;
    }
    if (res.error) throw new Error(res.error.message);
  }

  async function apply() {
    setSaving(true);
    try {
      for (const a of chosen) await run(a);
      const summary = chosen.length ? chosen.map((a) => a.label).join(" · ") : reply;
      await supabase.from("dumps").update({ status: "done", summary: summary.slice(0, 500) }).eq("id", dump.id);
      qc.invalidateQueries();
      toast.success(chosen.length ? "Pronto! Sua agenda foi atualizada." : "Anotado!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui aplicar as mudanças.");
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-3 rounded-2xl bg-accent/60 p-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Sparkles className="h-4 w-4" /></div>
        <p className="text-sm leading-relaxed">{reply || "Entendi sua mensagem."}</p>
      </div>
      {actions.length > 0 && (
        <section>
          <p className="eyebrow mb-3">O que vou fazer</p>
          <div className="space-y-2">
            {actions.map((a, i) => {
              const checked = on[i] ?? true;
              return (
                <button key={i} onClick={() => setOn(actions.map((_, j) => (j === i ? !checked : on[j] ?? true)))} className={cn("flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm transition", checked ? "border-primary/60 bg-background" : "opacity-50")}>
                  <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-md border", checked && "border-primary bg-primary text-primary-foreground")}>{checked && <Check className="h-3.5 w-3.5" />}</span>
                  {a.label}
                </button>
              );
            })}
          </div>
        </section>
      )}
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="ghost" className="rounded-full" onClick={() => discardDump(dump, qc)}>Dispensar</Button>
        <Button className="rounded-full shadow-glow" disabled={saving} onClick={apply}>
          {saving ? "Aplicando…" : chosen.length ? `Aplicar ${chosen.length} ${chosen.length === 1 ? "mudança" : "mudanças"}` : "Ok, entendi"}
        </Button>
      </div>
    </div>
  );
}
