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
type TableName = "subjects" | "assessments" | "events" | "goals" | "materials" | "topics" | "dumps";

const orderBy: Record<TableName, string> = {
  subjects: "name", assessments: "date", events: "starts_at", goals: "created_at", materials: "created_at", topics: "name", dumps: "created_at",
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

export const SUBJECT_COLORS = ["#00C853", "#0EA5A4", "#2563EB", "#F59E0B", "#EF4444", "#A855F7", "#111827"];
