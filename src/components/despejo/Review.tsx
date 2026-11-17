import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Copy, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SUBJECT_COLORS, useTable, type Assessment, type Dump, type Subject, type Topic } from "@/lib/data";

const field = "h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";
const missing = "border-amber-400 bg-amber-50/60 dark:bg-amber-950/30";
export const KINDS: Record<string, string> = { prova: "Prova", "mini-prova": "Mini-prova", entrega: "Entrega", seminario: "Seminário", extra: "Final / 2ª chamada" };

function Missing({ show }: { show: boolean }) {
  return show ? <span className="ml-2 text-[11px] font-medium text-amber-600">A IA não identificou</span> : null;
}

async function finish(id: string, summary: string, qc: ReturnType<typeof useQueryClient>) {
  await supabase.from("dumps").update({ status: "done", summary }).eq("id", id);
  qc.invalidateQueries();
  toast.success(summary);
}

export async function discardDump(d: Pick<Dump, "id" | "path">, qc: ReturnType<typeof useQueryClient>, summary = "Descartado") {
  if (d.path) await supabase.storage.from("materiais").remove([d.path]);
  await supabase.from("dumps").update({ status: "discarded", summary }).eq("id", d.id);
  qc.invalidateQueries({ queryKey: ["dumps"] });
}

type DupAction = "skip" | "replace" | "create";
type A = { name: string; date: string; kind: string; topics: string; conflict: { note: string; options: string[] } | null; keep: boolean; dupAction: DupAction };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const brDate = (d: string) => d.split("-").reverse().join("/");

// Uma avaliação "já existe" se a disciplina tem outra na mesma data ou com o mesmo nome
function findDuplicate(x: A, existing: Assessment[]): Assessment | undefined {
  if (!x.name.trim() && !x.date) return undefined;
  return existing.find((a) => (x.date && a.date === x.date) || (x.name.trim() && norm(a.name) === norm(x.name)));
}

const DUP_LABELS: Record<DupAction, string> = { skip: "Manter a existente", replace: "Substituir pela nova", create: "Criar mesmo assim" };

export function CronogramaReview({ dump, subjects, topics }: { dump: Dump; subjects: Subject[]; topics: Topic[] }) {
  const c = (dump.result as any)?.cronograma ?? {};
  const qc = useQueryClient();
  const { data: allAssessments = [] } = useTable("assessments");
  const [name, setName] = useState<string>(c.subject_name ?? "");
  const [prof, setProf] = useState<string>(c.professor ?? "");
  const [items, setItems] = useState<A[]>((c.assessments ?? []).map((a: any) => ({ name: a.name ?? "", date: a.date ?? "", kind: KINDS[a.kind] ? a.kind : "prova", topics: a.topics ?? "", conflict: a.conflict?.options?.length ? a.conflict : null, keep: true, dupAction: "skip" as DupAction })));
  const [hols, setHols] = useState<{ date: string; description: string; keep: boolean }[]>((c.holidays ?? []).map((h: any) => ({ date: h.date ?? "", description: h.description ?? "Sem aula", keep: true })));
  const [tops, setTops] = useState<string>((c.topics ?? []).join("\n"));
  const [saving, setSaving] = useState(false);
  const existing = useMemo(() => subjects.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase()), [subjects, name]);
  const upd = (i: number, p: Partial<A>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const subjectAssessments = useMemo(() => (existing ? allAssessments.filter((a) => a.subject_id === existing.id) : []), [allAssessments, existing]);
  const dups = items.map((x) => findDuplicate(x, subjectAssessments));
  const dupCount = dups.filter((d, i) => d && items[i]!.keep).length;
  const conflicts: string[] = c.conflicts ?? [];

  async function save() {
    if (!name.trim()) { toast.error("Informe o nome da disciplina."); return; }
    const keep = items.filter((x) => x.keep);
    if (keep.some((x) => !x.name.trim() || !x.date)) { toast.error("Preencha nome e data de todas as avaliações marcadas (ou desmarque-as)."); return; }
    setSaving(true);
    try {
      let sid = existing?.id;
      if (sid) {
        if (prof.trim()) await supabase.from("subjects").update({ professor: prof.trim() }).eq("id", sid);
      } else {
        const { data, error } = await supabase.from("subjects").insert({ name: name.trim().slice(0, 120), professor: prof.trim() || null, color: SUBJECT_COLORS[subjects.length % SUBJECT_COLORS.length]! }).select("id").single();
        if (error) throw error; sid = data.id;
      }
      // Avaliações que já existem: manter (pula), substituir (atualiza) ou criar mesmo assim
      const kept = items.map((x, i) => ({ x, dup: dups[i] })).filter(({ x }) => x.keep);
      const toInsert = kept.filter(({ dup, x }) => !dup || x.dupAction === "create").map(({ x }) => x);
      const toReplace = kept.filter(({ dup, x }) => dup && x.dupAction === "replace");
      const skipped = kept.filter(({ dup, x }) => dup && x.dupAction === "skip").length;
      const row = (x: A) => ({ name: x.name.trim().slice(0, 120), date: x.date, kind: x.kind, topics: x.topics.trim() || null });
      if (toInsert.length) {
        const { error } = await supabase.from("assessments").insert(toInsert.map((x) => ({ subject_id: sid!, ...row(x) })));
        if (error) throw error;
      }
      for (const { x, dup } of toReplace) {
        const { error } = await supabase.from("assessments").update(row(x)).eq("id", dup!.id);
        if (error) throw error;
      }
      const hk = hols.filter((h) => h.keep && h.date);
      if (hk.length) await supabase.from("events").insert(hk.map((h) => ({ title: `${h.description || "Sem aula"} · ${name.trim()}`.slice(0, 120), kind: "feriado", starts_at: new Date(`${h.date}T12:00`).toISOString(), subject_id: sid! })));
      const have = new Set(topics.filter((t) => t.subject_id === sid).map((t) => t.name.toLowerCase()));
      const newT = [...new Set(tops.split("\n").map((t) => t.trim()).filter(Boolean))].filter((t) => !have.has(t.toLowerCase()));
      if (newT.length) await supabase.from("topics").insert(newT.map((t) => ({ subject_id: sid!, name: t.slice(0, 120) })));
      const parts = [`${toInsert.length} ${toInsert.length === 1 ? "avaliação adicionada" : "avaliações adicionadas"} ao calendário`];
      if (toReplace.length) parts.push(`${toReplace.length} ${toReplace.length === 1 ? "atualizada" : "atualizadas"}`);
      if (skipped) parts.push(`${skipped} já ${skipped === 1 ? "existia" : "existiam"}`);
      if (newT.length) parts.push(`${newT.length} tópicos`);
      if (hk.length) parts.push(`${hk.length} dias sem aula`);
      await finish(dump.id, `Cronograma de ${name.trim()} → ${parts.join(", ")}`, qc);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui salvar.");
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-8">
      {conflicts.length > 0 && (
        <div className="flex gap-3 rounded-2xl border border-amber-400 bg-amber-50/60 p-4 text-sm dark:bg-amber-950/30">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
          <div><p className="font-semibold">A IA encontrou informações conflitantes</p><ul className="mt-1 list-disc pl-4 text-muted-foreground">{conflicts.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        </div>
      )}
      {dupCount > 0 && (
        <div className="flex gap-3 rounded-2xl border border-sky-300 bg-sky-50/60 p-4 text-sm dark:bg-sky-950/30">
          <Copy className="h-5 w-5 shrink-0 text-sky-600" />
          <div><p className="font-semibold">{dupCount} {dupCount === 1 ? "avaliação parece já estar" : "avaliações parecem já estar"} no seu calendário</p><p className="mt-1 text-muted-foreground">Por padrão vamos manter as que você já tem. Você pode substituir ou criar mesmo assim em cada uma abaixo.</p></div>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">Disciplina<Missing show={!c.subject_name} />
          <input className={cn(field, "mt-1.5", !name && missing)} value={name} onChange={(e) => setName(e.target.value)} />
          <span className="mt-1 block text-xs text-muted-foreground">{existing ? "Já cadastrada — vamos atualizar." : name ? "Nova disciplina será criada." : ""}</span>
        </label>
        <label className="block text-sm font-medium">Professor(a)<Missing show={!c.professor} />
          <input className={cn(field, "mt-1.5", !prof && missing)} value={prof} onChange={(e) => setProf(e.target.value)} />
        </label>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between"><p className="eyebrow">Avaliações ({items.filter((x) => x.keep).length})</p>
          <button className="flex items-center gap-1 text-sm font-semibold text-primary-deep" onClick={() => setItems([...items, { name: "", date: "", kind: "prova", topics: "", conflict: null, keep: true, dupAction: "skip" }])}><Plus className="h-4 w-4" />Adicionar</button></div>
        {items.length === 0 && <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">A IA não encontrou avaliações neste documento.</p>}
        <div className="space-y-3">
          {items.map((x, i) => (
            <div key={i} className={cn("rounded-2xl border p-4", !x.keep && "opacity-50", x.conflict && "border-amber-400", dups[i] && x.keep && "border-sky-300")}>
              <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_auto]">
                <input className={cn(field, !x.name && missing)} placeholder="Nome" value={x.name} onChange={(e) => upd(i, { name: e.target.value })} />
                <input type="date" className={cn(field, !x.date && missing)} value={x.date} onChange={(e) => upd(i, { date: e.target.value })} />
                <select className={field} value={x.kind} onChange={(e) => upd(i, { kind: e.target.value })}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <button aria-label={x.keep ? "Ignorar" : "Incluir"} onClick={() => upd(i, { keep: !x.keep })} className="flex h-10 w-10 items-center justify-center rounded-xl border text-muted-foreground hover:text-foreground">{x.keep ? <Trash2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}</button>
              </div>
              <input className={cn(field, "mt-3")} placeholder="Assuntos cobrados" value={x.topics} onChange={(e) => upd(i, { topics: e.target.value })} />
              {!x.date && <p className="mt-2 text-xs text-amber-600">Data não identificada — preencha antes de salvar.</p>}
              {dups[i] && x.keep && (
                <div className="mt-3 rounded-xl bg-sky-50/60 p-3 text-sm dark:bg-sky-950/30">
                  <p className="flex items-center gap-2 font-medium"><Copy className="h-4 w-4 text-sky-600" />Já existe no seu calendário: “{dups[i]!.name}” em {brDate(dups[i]!.date)}</p>
                  <div className="mt-2 flex flex-wrap gap-2">{(Object.keys(DUP_LABELS) as DupAction[]).map((k) => (
                    <button key={k} onClick={() => upd(i, { dupAction: k })} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", x.dupAction === k ? "border-primary bg-primary text-primary-foreground" : "bg-background")}>{DUP_LABELS[k]}</button>
                  ))}</div>
                </div>
              )}
              {x.conflict && (
                <div className="mt-3 rounded-xl bg-amber-50/60 p-3 text-sm dark:bg-amber-950/30">
                  <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4 text-amber-600" />{x.conflict.note || "Datas diferentes no documento"}. Qual vale?</p>
                  <div className="mt-2 flex flex-wrap gap-2">{x.conflict.options.map((o) => (
                    <button key={o} onClick={() => upd(i, { date: o })} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", x.date === o ? "border-primary bg-primary text-primary-foreground" : "bg-background")}>{o.split("-").reverse().join("/")}</button>
                  ))}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {hols.length > 0 && (
        <section><p className="eyebrow mb-3">Feriados e dias sem aula</p>
          <div className="flex flex-wrap gap-2">{hols.map((h, i) => (
            <button key={i} onClick={() => setHols(hols.map((y, j) => (j === i ? { ...y, keep: !y.keep } : y)))} className={cn("flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm", !h.keep && "line-through opacity-50")}>
              {h.keep ? <Check className="h-3.5 w-3.5 text-primary-deep" /> : <X className="h-3.5 w-3.5" />}{h.date.split("-").reverse().join("/")} · {h.description}
            </button>
          ))}</div>
        </section>
      )}

      <section><p className="eyebrow mb-3">Tópicos da disciplina <span className="normal-case tracking-normal text-muted-foreground">(um por linha)</span></p>
        <textarea rows={5} className={cn("w-full rounded-xl border border-input bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring", !tops.trim() && missing)} value={tops} onChange={(e) => setTops(e.target.value)} />
      </section>

      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="ghost" className="rounded-full" onClick={() => discardDump(dump, qc)}>Descartar</Button>
        <Button className="rounded-full shadow-glow" disabled={saving} onClick={save}>{saving ? "Salvando…" : "Confirmar e salvar"}</Button>
      </div>
    </div>
  );
}

export function MaterialReview({ dump, subjects, topics }: { dump: Dump; subjects: Subject[]; topics: Topic[] }) {
  const m = (dump.result as any)?.material ?? {};
  const qc = useQueryClient();
  const validSid = subjects.some((s) => s.id === m.subject_id) ? m.subject_id : "";
  const [title, setTitle] = useState<string>(m.title ?? dump.file_name);
  const [sid, setSid] = useState<string>(validSid || (m.new_subject_name ? "__new" : ""));
  const [newSubject, setNewSubject] = useState<string>(m.new_subject_name ?? "");
  const validTid = topics.some((t) => t.id === m.topic_id && t.subject_id === validSid) ? m.topic_id : "";
  const [tid, setTid] = useState<string>(validTid || (m.new_topic_name ? "__new" : ""));
  const [newTopic, setNewTopic] = useState<string>(m.new_topic_name ?? "");
  const [saving, setSaving] = useState(false);
  const subjTopics = topics.filter((t) => t.subject_id === sid);

  async function save() {
    setSaving(true);
    try {
      let subjectId: string | null = sid && sid !== "__new" ? sid : null;
      let subjectName = subjects.find((s) => s.id === subjectId)?.name;
      if (sid === "__new") {
        if (!newSubject.trim()) { toast.error("Dê um nome à nova disciplina."); return; }
        const { data, error } = await supabase.from("subjects").insert({ name: newSubject.trim().slice(0, 120), color: SUBJECT_COLORS[subjects.length % SUBJECT_COLORS.length]! }).select("id").single();
        if (error) throw error; subjectId = data.id; subjectName = newSubject.trim();
      }
      let topicId: string | null = tid && tid !== "__new" ? tid : null;
      let topicName = topics.find((t) => t.id === topicId)?.name;
      if (tid === "__new" && subjectId && newTopic.trim()) {
        const { data, error } = await supabase.from("topics").insert({ subject_id: subjectId, name: newTopic.trim().slice(0, 120) }).select("id").single();
        if (error) throw error; topicId = data.id; topicName = newTopic.trim();
      }
      const { error } = await supabase.from("materials").insert({ name: (title.trim() || dump.file_name).slice(0, 200), path: dump.path, mime: dump.mime, size: dump.size, subject_id: subjectId, topic_id: topicId });
      if (error) throw error;
      await finish(dump.id, `“${title.trim()}” → materiais de ${subjectName ?? "uma disciplina"}${topicName ? ` · ${topicName}` : ""}`, qc);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui salvar.");
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-5">
      <label className="block text-sm font-medium">Título<input className={cn(field, "mt-1.5")} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">Disciplina<Missing show={!validSid && !m.new_subject_name} />
          <select className={cn(field, "mt-1.5", !sid && missing)} value={sid} onChange={(e) => { setSid(e.target.value); setTid(""); }}>
            <option value="" disabled>Escolha a disciplina</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value="__new">+ Criar nova disciplina</option>
          </select>
          {sid === "__new" && <input className={cn(field, "mt-2")} placeholder="Nome da nova disciplina" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} />}
          {sid === "__new" && m.new_subject_name && <span className="mt-1 block text-xs text-muted-foreground">Nenhuma disciplina sua combinou — sugerimos criar esta.</span>}
        </label>
        <label className="block text-sm font-medium">Tópico
          <select className={field + " mt-1.5"} value={tid} disabled={!sid} onChange={(e) => setTid(e.target.value)}>
            <option value="">Sem tópico</option>
            {subjTopics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            <option value="__new">+ Novo tópico</option>
          </select>
          {tid === "__new" && <input className={cn(field, "mt-2")} placeholder="Nome do tópico" value={newTopic} onChange={(e) => setNewTopic(e.target.value)} />}
        </label>
      </div>
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="ghost" className="rounded-full" onClick={() => discardDump(dump, qc)}>Descartar</Button>
        <Button className="rounded-full shadow-glow" disabled={saving || !sid || (sid === "__new" && !newSubject.trim())} onClick={save}><Check className="mr-1 h-4 w-4" />{saving ? "Salvando…" : "Confirmar"}</Button>
      </div>
    </div>
  );
}
