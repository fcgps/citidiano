import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";

type T = Database["public"]["Tables"];
export type Subject = T["subjects"]["Row"];
export type Assessment = T["assessments"]["Row"];
export type EventRow = T["events"]["Row"];
export type Goal = T["goals"]["Row"];
export type Material = T["materials"]["Row"];
export type Topic = T["topics"]["Row"];
export type Dump = T["dumps"]["Row"];
export type Slot = T["schedule_slots"]["Row"];
type TableName = "subjects" | "assessments" | "events" | "goals" | "materials" | "topics" | "dumps" | "schedule_slots";

const orderBy: Record<TableName, string> = {
  subjects: "name", assessments: "date", events: "starts_at", goals: "created_at", materials: "created_at", topics: "name", dumps: "created_at", schedule_slots: "start_time",
};

export function useTable<K extends TableName>(table: K) {
  return useQuery({
    queryKey: [table],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)(table).select("*").order(orderBy[table]);
      if (error) throw error;
      return data as unknown as T[K]["Row"][];
    },
  });
}

export function useInsert<K extends TableName>(table: K) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: T[K]["Insert"]) => {
      const { error } = await (supabase.from as any)(table).insert(row as never);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [table] }); toast.success("Salvo!"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdate<K extends TableName>(table: K) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & T[K]["Update"]) => {
      const { error } = await (supabase.from as any)(table).update(patch as never).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [table] }),
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRemove(table: TableName) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from as any)(table).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(),
    onError: (e: Error) => toast.error(e.message),
  });
}

export const EVENT_KINDS: Record<string, string> = {
  prova: "Prova", entrega: "Entrega", citi: "Demanda CITi", reuniao: "Reunião", estudo: "Estudo", treino: "Treino", feriado: "Sem aula", outro: "Outro",
};
// Provas finais, segunda chamada e reposição: só acontecem para quem precisa.
// Vale o tipo "extra" ou, para avaliações antigas, um nome que indique isso.
const EXTRA_RE = /\bfina(l|is)\b|segunda chamada|2[ªa]\.?\s*chamada|reposi[cç][aã]o/i;
export const isExtraAssessment = (a: { kind: string; name: string }) => a.kind === "extra" || EXTRA_RE.test(a.name);

export const ASSESSMENT_KINDS: Record<string, string> = { prova: "Prova", "mini-prova": "Mini-prova", entrega: "Entrega", seminario: "Seminário", extra: "Final / 2ª chamada" };
const MINI_RE = /mini[\s-]?prova/i;
const LISTA_RE = /\blistas?\b|\baps\b|atividade/i;
// Rótulo curto para mostrar avaliações (pelo tipo ou, nas antigas, pelo nome)
export function assessmentTag(a: { kind: string; name: string }): { key: "extra" | "mini" | "lista" | "entrega" | "prova"; label: string } {
  if (isExtraAssessment(a)) return { key: "extra", label: "Final / 2ª ch." };
  if (a.kind === "mini-prova" || MINI_RE.test(a.name)) return { key: "mini", label: "Mini-prova" };
  if (LISTA_RE.test(a.name)) return { key: "lista", label: "Lista / APS" };
  if (a.kind === "entrega" || a.kind === "seminario") return { key: "entrega", label: a.kind === "seminario" ? "Seminário" : "Entrega" };
  return { key: "prova", label: "Prova" };
}

export const SUBJECT_COLORS = ["#00C853", "#0EA5A4", "#06B6D4", "#2563EB", "#6366F1", "#A855F7", "#EC4899", "#EF4444", "#F97316", "#F59E0B", "#65A30D", "#111827"];
