// Plano da semana guardado no navegador (um por semana).
// Usado pelo quadro do Painel e pelos comandos do Despejo ("muda a academia de quarta para quinta").
import { addDays, format, parseISO, startOfWeek } from "date-fns";
import type { PlanItem, WeekPlan } from "@/lib/despejo.functions";

export type CachedPlan = { plan: WeekPlan; sig: string; at: string };
export type SuggestionRef = { ref: string; date: string; title: string; type: PlanItem["type"] };

export const PLAN_EVENT = "citidiano:plano"; // avisa o quadro que o plano mudou
const KEY = (week: string) => `citidiano.plano.${week}`;

export const currentWeek = () => format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
export const weekDates = (week: string) => Array.from({ length: 7 }, (_, i) => format(addDays(parseISO(week), i), "yyyy-MM-dd"));

export function readPlan(week: string): CachedPlan | null {
  try { const raw = localStorage.getItem(KEY(week)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export function writePlan(week: string, c: CachedPlan) {
  try { localStorage.setItem(KEY(week), JSON.stringify(c)); } catch { /* sem localStorage: segue sem salvar */ }
  try { window.dispatchEvent(new CustomEvent(PLAN_EVENT, { detail: week })); } catch { /* ignora */ }
}

// Sugestões (não fixas) do plano, com uma referência estável para a IA citar
export function planSuggestions(week: string): SuggestionRef[] {
  const c = readPlan(week);
  if (!c) return [];
  return c.plan.days.flatMap((d) => d.items.filter((it) => !it.fixed).map((it, i) => ({ ref: `${d.date}#${i}`, date: d.date, title: it.title, type: it.type })));
}

// Altera o plano salvo. Itens mexidos pelo usuário ficam marcados como "edited":
// continuam sendo sugestões e são mantidos quando o plano é refeito.
function update(week: string, fn: (plan: WeekPlan) => boolean): boolean {
  const c = readPlan(week);
  if (!c) return false;
  const plan: WeekPlan = JSON.parse(JSON.stringify(c.plan));
  if (!fn(plan)) return false;
  writePlan(week, { ...c, plan });
  return true;
}

const findSuggestion = (plan: WeekPlan, date: string, title: string) => {
  const day = plan.days.find((d) => d.date === date);
  const idx = day ? day.items.findIndex((it) => !it.fixed && it.title === title) : -1;
  return day && idx >= 0 ? { day, idx } : null;
};

export function moveSuggestion(week: string, from: { date: string; title: string }, toDate: string) {
  return update(week, (plan) => {
    const hit = findSuggestion(plan, from.date, from.title);
    const target = plan.days.find((d) => d.date === toDate);
    if (!hit || !target) return false;
    const [item] = hit.day.items.splice(hit.idx, 1);
    target.items.push({ ...item!, edited: true });
    return true;
  });
}

export function removeSuggestion(week: string, from: { date: string; title: string }) {
  return update(week, (plan) => {
    const hit = findSuggestion(plan, from.date, from.title);
    if (!hit) return false;
    hit.day.items.splice(hit.idx, 1);
    return true;
  });
}

// Sugestões que o usuário ajustou: enviadas ao refazer o plano para serem mantidas
export function editedSuggestions(week: string) {
  const c = readPlan(week);
  if (!c) return [];
  return c.plan.days.flatMap((d) => d.items.filter((it) => !it.fixed && it.edited).map((it) => ({ date: d.date, title: it.title, type: it.type, subject_id: it.subject_id, note: it.note })));
}
