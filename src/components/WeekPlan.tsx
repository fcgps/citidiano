import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { addDays, format, isBefore, isSameDay, parseISO, startOfDay, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowUp, ChevronLeft, ChevronRight, Dumbbell, Loader2, Moon, Pencil, RotateCw, Sparkles, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { TextReview } from "@/components/despejo/TextReview";
import { discardDump } from "@/components/despejo/Review";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTable, hhmm } from "@/lib/data";
import { interpretText, planWeek, type PlanItem } from "@/lib/despejo.functions";
// O plano fica guardado no navegador por semana; se a agenda mudar, oferecemos refazer.
import { PLAN_EVENT, loadPlan, loadPlanSuggestions, editedSuggestions, moveSuggestion, readPlan as readCache, removeSuggestion, writePlan as writeCache, type CachedPlan as Cached } from "@/lib/plan-cache";

const TYPE_LABEL: Record<PlanItem["type"], string> = { prova: "Prova", entrega: "Entrega", citi: "CITi", estudo: "Estudo", treino: "Treino", descanso: "Descanso", outro: "Compromisso" };
const TYPE_COLOR: Partial<Record<PlanItem["type"], string>> = { citi: "#66CC00", treino: "#FF7A1A", descanso: "#94A3B8" };
// Carga do dia calculada a partir do que está no dia (e não pela IA), para
// acompanhar quando uma sugestão é movida, removida ou adicionada.
const WEIGHT_FIXED: Record<string, number> = { prova: 3, entrega: 2, citi: 2, treino: 1, estudo: 1, outro: 1, descanso: 0 };
const WEIGHT_SUGGESTION: Record<string, number> = { estudo: 1.5, citi: 1.5, treino: 1, outro: 1, prova: 1, entrega: 1, descanso: -0.5 };
function dayLoad(items: PlanItem[]): "leve" | "media" | "pesada" {
  const score = items.reduce((n, it) => n + ((it.fixed ? WEIGHT_FIXED : WEIGHT_SUGGESTION)[it.type] ?? 1) * (it.fixed && /s[oó] se precisar/i.test(it.note ?? "") ? 0.3 : 1), 0);
  return score < 2.5 ? "leve" : score < 5 ? "media" : "pesada";
}

const LOAD: Record<string, { label: string; cls: string }> = {
  leve: { label: "Leve", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  media: { label: "Média", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  pesada: { label: "Pesada", cls: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300" },
};

export function WeekPlan() {
  const generate = useServerFn(planWeek);
  const { data: subjects = [] } = useTable("subjects");
  const { data: assessments = [], isSuccess: aOk } = useTable("assessments");
  const { data: events = [], isSuccess: eOk } = useTable("events");
  const { data: goals = [], isSuccess: gOk } = useTable("goals");
  const { data: slots = [], isSuccess: sOk } = useTable("schedule_slots");
  const loaded = aOk && eOk && gOk && sOk;
  const [showClasses, setShowClasses] = useState(true);

  const today = startOfDay(new Date());
  const [offset, setOffset] = useState(0); // 0 = esta semana, 1 = próxima
  const weekStart = addDays(startOfWeek(today, { weekStartsOn: 1 }), offset * 7);
  const week = format(weekStart, "yyyy-MM-dd");

  // "Assinatura" da agenda da semana: se mudar, o plano salvo está desatualizado
  const sig = useMemo(() => {
    const end = addDays(weekStart, 21);
    const inRange = (d: Date) => d >= weekStart && d <= end;
    return [
      ...assessments.filter((a) => inRange(parseISO(a.date))).map((a) => `${a.id}${a.date}${a.name}`),
      ...events.filter((e) => inRange(parseISO(e.starts_at))).map((e) => `${e.id}${e.starts_at}${e.title}`),
      ...goals.map((g) => `${g.id}${g.times_per_week}${g.target_hours}`),
      ...slots.map((g) => `${g.id}${g.weekday}${g.start_time}${g.end_time}`),
    ].sort().join("|");
  }, [assessments, events, goals, slots, week]);

  const [cached, setCached] = useState<Cached | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoTried = useRef<Set<string>>(new Set());
  const weekRef = useRef(week);
  weekRef.current = week;

  async function run() {
    if (busy) return;
    const w = week; // a semana pode mudar enquanto a IA responde
    setBusy(true);
    setError(null);
    try {
      // Sugestões que o usuário mexeu à mão são mantidas no plano novo
      const r = await generate({ data: { weekStart: w, keep: editedSuggestions(w) } });
      if (!r.ok) { if (weekRef.current === w) { setError(r.error); toast.error(r.error); } return; }
      const c = { plan: r.plan, sig, at: new Date().toISOString() };
      writeCache(w, c);
      if (weekRef.current === w) setCached(c);
    } catch {
      setError("Não consegui montar o plano agora.");
    } finally { setBusy(false); }
  }

  // Ao abrir (ou trocar de semana): usa o plano salvo; se não houver, gera um automaticamente uma vez
  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    setCached(readCache(week)); // mostra na hora o que já está neste navegador...
    setError(null);
    loadPlan(week).then((c) => { // ...e confere a versão salva na conta
      if (!alive) return;
      setCached(c);
      if (!c && !autoTried.current.has(week)) { autoTried.current.add(week); run(); }
    }).catch(() => { /* sem conexão: fica com a cópia local */ });
    return () => { alive = false; };
  }, [loaded, week]);

  // Recarrega quando o plano muda (setas do quadro ou um comando no Despejo)
  useEffect(() => {
    const onChange = () => setCached(readCache(weekRef.current));
    window.addEventListener(PLAN_EVENT, onChange);
    return () => window.removeEventListener(PLAN_EVENT, onChange);
  }, []);

  const move = (date: string, title: string, delta: number) => {
    const days = cached?.plan.days ?? [];
    const i = days.findIndex((d) => d.date === date);
    const target = days[i + delta];
    if (target) moveSuggestion(week, { date, title }, target.date);
  };

  const plan = cached?.plan;
  const outdated = !!cached && cached.sig !== sig;
  const subj = (id: string | null) => subjects.find((s) => s.id === id);
  const colorOf = (it: PlanItem) => TYPE_COLOR[it.type] ?? subj(it.subject_id)?.color ?? "#0F5132";

  return (
    <section className="mb-14">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary-deep" /><p className="eyebrow">Plano da semana · feito pela IA</p></div>
          <h2 className="mt-2 text-2xl font-light md:text-3xl">
            {offset === 0 ? "Esta semana" : "Próxima semana"}{" "}
            <strong className="font-bold">{format(weekStart, "d MMM", { locale: ptBR })} – {format(addDays(weekStart, 6), "d MMM", { locale: ptBR })}</strong>
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setOffset(0)} disabled={offset === 0} className="rounded-full border p-2 disabled:opacity-30" aria-label="Esta semana"><ChevronLeft className="h-4 w-4" /></button>
          <button onClick={() => setOffset(1)} disabled={offset === 1} className="rounded-full border p-2 disabled:opacity-30" aria-label="Próxima semana"><ChevronRight className="h-4 w-4" /></button>
          <button onClick={run} disabled={busy || !loaded} className="flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}{plan ? "Refazer plano" : "Montar plano"}
          </button>
        </div>
      </div>

      {outdated && !busy && (
        <button onClick={run} className="mb-4 w-full rounded-2xl border border-amber-300 bg-amber-50/70 p-3 text-left text-sm dark:bg-amber-950/30">
          <strong>Sua agenda mudou</strong> desde que este plano foi feito. <span className="font-semibold text-primary-deep">Refazer agora →</span>
        </button>
      )}

      {busy && !plan && (
        <div className="flex items-center justify-center gap-3 rounded-3xl border border-dashed p-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary-deep" /> Olhando suas provas, entregas e metas para montar a semana…
        </div>
      )}
      {!busy && !plan && error && (
        <div className="rounded-3xl border border-dashed p-8 text-center text-sm text-muted-foreground">{error} <button onClick={run} className="font-semibold text-primary-deep">Tentar de novo</button></div>
      )}

      {plan && (
        <div className={cn("transition-opacity", busy && "opacity-50")}>
          {(plan.headline || plan.recommendations.length > 0) && (
            <div className="mb-5 rounded-3xl bg-gradient-primary p-[1px] shadow-glow">
              <div className="rounded-[calc(1.5rem-1px)] bg-background p-5 md:p-6">
                {plan.headline && <p className="text-lg font-semibold">{plan.headline}</p>}
                {plan.recommendations.length > 0 && (
                  <ul className="mt-4 grid gap-4 md:grid-cols-2">
                    {plan.recommendations.map((r, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="font-mono text-xs text-primary-deep">0{i + 1}</span>
                        <div><div className="font-semibold">{r.title}</div><p className="text-sm text-muted-foreground">{r.reason}</p></div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Quadro da semana, no estilo de uma planilha de rotina: uma coluna por dia */}
          <div className="overflow-x-auto rounded-3xl border">
            <div className="grid min-w-[880px] grid-cols-7">
              {plan.days.map((d, dayIdx) => {
                const date = parseISO(d.date);
                const isToday = isSameDay(date, today);
                const past = isBefore(date, today);
                const load = LOAD[dayLoad(d.items)]!;
                const wd = ((date.getDay() + 6) % 7) + 1;
                const classes = slots.filter((g) => g.weekday === wd).sort((a, b) => a.start_time.localeCompare(b.start_time));
                return (
                  <div key={d.date} className={cn("flex min-h-56 flex-col border-r last:border-r-0", isToday && "bg-accent/40", past && "opacity-50")}>
                    <div className={cn("border-b p-3", isToday && "border-primary")}>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{format(date, "EEEE", { locale: ptBR }).split("-")[0]}</span>
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", load.cls)}>{load.label}</span>
                      </div>
                      <div className={cn("text-xl font-bold", isToday && "text-primary-deep")}>{format(date, "d/MM")}</div>
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-2">
                      {/* Aulas e horários fixos da grade, discretos, só para dar contexto */}
                      {showClasses && classes.length > 0 && (
                        <div className="space-y-0.5 rounded-lg bg-muted/60 p-1.5">
                          {classes.map((g) => (
                            <div key={g.id} className="flex gap-1.5 truncate text-[10px] text-muted-foreground" title={g.title}>
                              <span className="font-mono">{hhmm(g.start_time)}</span><span className="truncate">{g.title}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {d.items.length === 0 && <p className="p-2 text-xs italic text-muted-foreground">{past ? "—" : "Livre"}</p>}
                      {d.items.map((it, i) => {
                        const color = colorOf(it);
                        const s = subj(it.subject_id);
                        return it.fixed ? (
                          <div key={i} className="rounded-xl p-2.5 text-xs text-white shadow-sm" style={{ background: color }} title={it.note ?? undefined}>
                            <div className="flex justify-between font-mono text-[9px] uppercase tracking-widest opacity-80"><span>{TYPE_LABEL[it.type]}</span>{it.start && <span>{it.start}{it.end ? `–${it.end}` : ""}</span>}</div>
                            <div className="font-semibold leading-snug">{it.title}</div>
                            {it.note && <div className="mt-1 opacity-90">{it.note}</div>}
                          </div>
                        ) : (
                          <div key={i} className="group/s relative rounded-xl border border-dashed bg-background p-2.5 text-xs" style={{ borderColor: color, boxShadow: `inset 3px 0 0 ${color}` }}>
                            <div className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                              {it.type === "treino" ? <Dumbbell className="h-3 w-3" /> : it.type === "descanso" ? <Moon className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                              Sugestão · {TYPE_LABEL[it.type]}
                              {it.edited && <span className="ml-auto flex items-center gap-0.5 normal-case tracking-normal" title="Você ajustou esta sugestão"><Pencil className="h-2.5 w-2.5" /></span>}
                            </div>
                            {/* Mover para o dia anterior/seguinte ou remover. Continua sendo sugestão. */}
                            {!past && (
                              <div className="absolute -top-2.5 right-1 hidden items-center gap-0.5 rounded-full border bg-background px-1 shadow-sm group-hover/s:flex">
                                <button onClick={() => move(d.date, it.title, -1)} disabled={dayIdx === 0 || isBefore(parseISO(plan.days[dayIdx - 1]!.date), today)} className="rounded-full p-0.5 hover:bg-muted disabled:opacity-30" aria-label="Mover para o dia anterior"><ChevronLeft className="h-3 w-3" /></button>
                                <button onClick={() => move(d.date, it.title, 1)} disabled={dayIdx === 6} className="rounded-full p-0.5 hover:bg-muted disabled:opacity-30" aria-label="Mover para o dia seguinte"><ChevronRight className="h-3 w-3" /></button>
                                <button onClick={() => removeSuggestion(week, { date: d.date, title: it.title })} className="rounded-full p-0.5 hover:bg-muted" aria-label="Remover sugestão"><X className="h-3 w-3" /></button>
                              </div>
                            )}
                            {it.start && <div className="font-mono text-[10px] font-semibold" style={{ color }}>{it.start}{it.end ? `–${it.end}` : ""}</div>}
                            <div className="font-semibold leading-snug">{it.title}</div>
                            {s && it.type === "estudo" && <div className="text-[10px] text-muted-foreground">{s.name}</div>}
                            {it.note && <div className="mt-1 text-muted-foreground">{it.note}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-2"><span className="h-3 w-5 rounded bg-primary-deep" /> Compromisso fixo</span>
            <span className="flex items-center gap-2"><span className="h-3 w-5 rounded border border-dashed border-primary" /> Sugestão da IA (passe o mouse para mover ou remover)</span>
            {slots.length > 0 ? (
              <button onClick={() => setShowClasses((v) => !v)} className="underline-offset-2 hover:underline">{showClasses ? "Esconder" : "Mostrar"} aulas da grade</button>
            ) : (
              <span>Cadastre sua grade semanal em Disciplinas para o plano sugerir horários.</span>
            )}
            {cached && <span className="ml-auto">Gerado {format(parseISO(cached.at), "dd/MM 'às' HH:mm")}</span>}
          </div>
          <PlanTweak week={week} />
        </div>
      )}
    </section>
  );
}

// Caixa logo abaixo do quadro para pedir mudanças no plano em texto livre.
// Usa a mesma IA dos comandos do Despejo, avisando que o pedido é sobre o plano:
// estudo/treino/descanso mudam só no plano (continuam sugestões).
const TWEAK_EXAMPLES = ["Não quero estudar no sábado", "Coloca mais um estudo de Cálculo na quinta", "Troca a academia de quarta para quinta"];

function PlanTweak({ week }: { week: string }) {
  const qc = useQueryClient();
  const interpret = useServerFn(interpretText);
  const { data: dumps = [] } = useTable("dumps");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [dumpId, setDumpId] = useState<string | null>(null);
  const runId = useRef(0);
  const dump = dumpId ? dumps.find((d) => d.id === dumpId) : undefined;

  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    const my = ++runId.current;
    setBusy(true);
    setDumpId(null);
    try {
      const plan = { week, items: await loadPlanSuggestions(week) };
      const { data: row, error } = await supabase.from("dumps").insert({ path: "", file_name: t.slice(0, 200), doc_type: "texto", result: { text: t.slice(0, 1000), plan, source: "plano" } }).select("id").single();
      if (error || !row) throw new Error("Não consegui registrar seu pedido.");
      if (runId.current !== my) { await discardDump({ id: row.id, path: "" }, qc, "Cancelado"); return; }
      setDumpId(row.id);
      const r = await interpret({ data: { id: row.id } });
      if (runId.current !== my) return;
      await qc.invalidateQueries({ queryKey: ["dumps"] });
      if (!r.ok) toast.error(r.error); else setText("");
    } catch (e) {
      if (runId.current === my) toast.error(e instanceof Error ? e.message : "Algo deu errado. Tente de novo.");
    } finally {
      if (runId.current === my) setBusy(false);
    }
  }

  async function cancel() {
    runId.current++;
    setBusy(false);
    if (dumpId) await discardDump({ id: dumpId, path: "" }, qc, "Cancelado");
    setDumpId(null);
  }

  return (
    <div className="mt-6 rounded-3xl border bg-background/80 p-4 md:p-5">
      <p className="eyebrow mb-2">Quer mudar algo no plano?</p>
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2 rounded-2xl border bg-background p-2 focus-within:ring-2 focus-within:ring-ring">
        <textarea
          rows={1}
          maxLength={1000}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ex.: não quero estudar no sábado"
          className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none disabled:opacity-60"
        />
        {busy ? (
          <Button type="button" variant="ghost" size="sm" className="shrink-0 rounded-full" onClick={cancel}><X className="mr-1 h-4 w-4" />Cancelar</Button>
        ) : (
          <Button type="submit" size="icon" className="shrink-0 rounded-full" disabled={!text.trim()} aria-label="Enviar"><ArrowUp className="h-4 w-4" /></Button>
        )}
      </form>
      {busy && <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin text-primary-deep" />Ajustando seu plano…</p>}
      {!busy && !dump && (
        <div className="mt-3 flex flex-wrap gap-2">
          {TWEAK_EXAMPLES.map((ex) => <button key={ex} type="button" onClick={() => setText(ex)} className="rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary-deep">{ex}</button>)}
        </div>
      )}
      {!busy && dump?.status === "review" && (
        <div className="mt-4"><TextReview dump={dump} /></div>
      )}
      {!busy && dump?.status === "error" && <p className="mt-3 text-sm text-destructive">{dump.error}</p>}
    </div>
  );
}
