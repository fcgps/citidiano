// Plano da semana: salvo na conta (tabela week_plans) e espelhado no navegador.
// O espelho local deixa as leituras instantâneas; toda mudança também vai para o banco,
// então o plano e os ajustes acompanham o usuário em outro aparelho.
import { addDays, format, parseISO, startOfWeek } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { PlanItem, WeekPlan } from "@/lib/despejo.functions";

export type CachedPlan = { plan: WeekPlan; sig: string; at: string };
export type SuggestionRef = { ref: string; date: string; title: string; type: PlanItem["type"] };

export const PLAN_EVENT = "citidiano:plano"; // avisa o quadro que o plano mudou

// A cópia no navegador é separada POR CONTA: sem isso, entrar com outra conta no mesmo
// navegador reaproveitava (e até enviava para a conta nova) o plano da conta anterior.
let currentUser: string | null = null;
try {
  supabase.auth.getSession().then(({ data }) => { currentUser = data.session?.user.id ?? null; });
  supabase.auth.onAuthStateChange((_e, session) => { currentUser = session?.user.id ?? null; });
} catch { /* fora do navegador */ }
async function ensureUser() {
  if (!currentUser) { const { data } = await supabase.auth.getSession(); currentUser = data.session?.user.id ?? null; }
  return currentUser;
}
const KEY = (week: string) => (currentUser ? `citidiano.plano.${currentUser}.${week}` : null);

export const currentWeek = () => format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
export const weekDates = (week: string) => Array.from({ length: 7 }, (_, i) => format(addDays(parseISO(week), i), "yyyy-MM-dd"));

// ---- espelho local -------------------------------------------------------
export function readPlan(week: string): CachedPlan | null {
  const key = KEY(week);
  if (!key) return null;
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function writeLocal(week: string, c: CachedPlan) {
  const key = KEY(week);
  if (key) { try { localStorage.setItem(key, JSON.stringify(c)); } catch { /* sem localStorage */ } }
  try { window.dispatchEvent(new CustomEvent(PLAN_EVENT, { detail: week })); } catch { /* ignora */ }
}

// ---- banco ---------------------------------------------------------------
async function saveRemote(week: string, c: CachedPlan) {
  const { error } = await supabase.from("week_plans").upsert(
    { week_start: week, plan: c.plan as unknown as Json, sig: c.sig, generated_at: c.at, updated_at: new Date().toISOString() },
    { onConflict: "user_id,week_start" },
  );
  if (error) console.error("Não consegui salvar o plano na conta:", error.message);
}

// Busca o plano da conta; se só existir no navegador (plano antigo), envia para a conta
export async function loadPlan(week: string): Promise<CachedPlan | null> {
  await ensureUser();
  const { data, error } = await supabase.from("week_plans").select("plan,sig,generated_at").eq("week_start", week).maybeSingle();
  if (!error && data) {
    const c: CachedPlan = { plan: data.plan as unknown as WeekPlan, sig: data.sig, at: data.generated_at };
    writeLocal(week, c);
    return c;
  }
  const local = readPlan(week);
  if (local && !error) void saveRemote(week, local);
  return local;
}

export function writePlan(week: string, c: CachedPlan) {
  writeLocal(week, c);
  void saveRemote(week, c);
}

// Sugestões (não fixas) do plano, com uma referência estável para a IA citar
export async function loadPlanSuggestions(week: string): Promise<SuggestionRef[]> {
  await ensureUser();
  const c = readPlan(week) ?? (await loadPlan(week).catch(() => null));
  if (!c) return [];
  return c.plan.days.flatMap((d) => d.items.filter((it) => !it.fixed).map((it, i) => ({ ref: `${d.date}#${i}`, date: d.date, title: it.title, type: it.type })));
}

// Altera o plano. Itens mexidos pelo usuário ficam marcados como "edited":
// continuam sendo sugestões e são mantidos quando o plano é refeito.
async function update(week: string, fn: (plan: WeekPlan) => boolean): Promise<boolean> {
  await ensureUser();
  const c = readPlan(week) ?? (await loadPlan(week).catch(() => null));
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

export function moveSuggestion(week: string, from: { date: string; title: string }, toDate: string, time?: { start: string | null; end: string | null }) {
  return update(week, (plan) => {
    const hit = findSuggestion(plan, from.date, from.title);
    const target = plan.days.find((d) => d.date === toDate);
    if (!hit || !target) return false;
    const [item] = hit.day.items.splice(hit.idx, 1);
    // Em outro dia o horário antigo pode não servir: só mantém se um novo for informado
    const moved: PlanItem = { ...item!, edited: true, start: time?.start ?? (toDate === from.date ? item!.start ?? null : null), end: time?.end ?? (toDate === from.date ? item!.end ?? null : null) };
    target.items.push(moved);
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

export function addSuggestion(week: string, item: { date: string; title: string; type: PlanItem["type"]; subject_id: string | null; note: string | null; start?: string | null; end?: string | null }) {
  return update(week, (plan) => {
    const day = plan.days.find((d) => d.date === item.date);
    if (!day) return false;
    day.items.push({ title: item.title.slice(0, 80), type: item.type, fixed: false, subject_id: item.subject_id, note: item.note, edited: true, start: item.start ?? null, end: item.end ?? null });
    return true;
  });
}

// Sugestões que o usuário ajustou: enviadas ao refazer o plano para serem mantidas
export function editedSuggestions(week: string) {
  const c = readPlan(week);
  if (!c) return [];
  return c.plan.days.flatMap((d) => d.items.filter((it) => !it.fixed && it.edited).map((it) => ({ date: d.date, title: it.title, type: it.type, subject_id: it.subject_id, note: it.note, start: it.start ?? null, end: it.end ?? null })));
}
