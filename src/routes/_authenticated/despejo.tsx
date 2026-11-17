import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, CalendarCheck, FileText, Loader2, MessageSquare, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Dropzone } from "@/components/despejo/Dropzone";
import { CronogramaReview, MaterialReview, discardDump } from "@/components/despejo/Review";
import { TextReview } from "@/components/despejo/TextReview";
import { analyzeDump, interpretText } from "@/lib/despejo.functions";
import { useTable, type Dump } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/despejo")({
  head: () => ({ meta: [{ title: "Área de despejo — CITidiano" }, { name: "description", content: "Jogue qualquer arquivo e a IA organiza para você." }, { property: "og:title", content: "Área de despejo — CITidiano" }, { property: "og:description", content: "Jogue qualquer arquivo e a IA organiza." }] }),
  component: Despejo,
});

function Despejo() {
  const { data: dumps = [], isSuccess: dumpsLoaded } = useTable("dumps");
  const { data: subjects = [] } = useTable("subjects");
  const { data: topics = [] } = useTable("topics");
  const list = [...dumps].reverse();
  const pending = list.filter((d) => d.status === "review");
  const history = list.filter((d) => d.status !== "review");

  // Quando chega uma sugestão nova da IA, rola a página até ela
  const firstPending = useRef<HTMLElement>(null);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!dumpsLoaded) return;
    const ids = pending.map((d) => d.id);
    if (seen.current === null) { seen.current = new Set(ids); return; } // primeira carga: não rola
    const isNew = ids.some((id) => !seen.current!.has(id));
    ids.forEach((id) => seen.current!.add(id));
    if (isNew) firstPending.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [dumpsLoaded, pending.map((d) => d.id).join(",")]);

  return (
    <>
      <PageHeader eyebrow="Área de despejo" title={<>Jogue aqui. <strong className="font-bold">A IA organiza.</strong></>} desc="Cronogramas viram avaliações no calendário. Slides e listas vão para os materiais da disciplina certa. E você pode simplesmente escrever: “prova de DS adiada uma semana”." />
      <Dropzone />
      {pending.map((d, i) => (
        <section key={d.id} ref={i === 0 ? firstPending : undefined} className="mt-10 scroll-mt-24 rounded-3xl border bg-background p-6 md:p-8">
          <p className="eyebrow">{d.doc_type === "texto" ? "A IA sugere" : d.doc_type === "cronograma" ? "Revise o cronograma" : "Confirme o material"}</p>
          <h2 className="mb-6 mt-2 text-2xl font-light">{d.doc_type === "texto" ? `“${d.file_name}”` : d.file_name}</h2>
          {d.doc_type !== "texto" && (d.result as any)?.reason && <p className="-mt-5 mb-6 text-sm text-muted-foreground">{(d.result as any).reason}</p>}
          {d.doc_type === "texto" ? <TextReview dump={d} /> : d.doc_type === "cronograma" ? <CronogramaReview dump={d} subjects={subjects} topics={topics} /> : <MaterialReview dump={d} subjects={subjects} topics={topics} />}
        </section>
      ))}
      <section className="mt-14">
        <p className="eyebrow mb-4">Histórico</p>
        {history.length === 0 ? <p className="text-sm text-muted-foreground">Nada por aqui ainda. Que tal jogar o cronograma de uma disciplina?</p> : (
          <ul className="divide-y rounded-2xl border bg-background">{history.map((d) => <HistoryRow key={d.id} d={d} />)}</ul>
        )}
      </section>
    </>
  );
}

function HistoryRow({ d }: { d: Dump }) {
  const qc = useQueryClient();
  const analyze = useServerFn(analyzeDump);
  const interpret = useServerFn(interpretText);
  async function retry() {
    await supabase.from("dumps").update({ status: "analyzing", error: null }).eq("id", d.id);
    qc.invalidateQueries({ queryKey: ["dumps"] });
    const r = d.doc_type === "texto" ? await interpret({ data: { id: d.id } }) : await analyze({ data: { id: d.id } });
    if (!r.ok) toast.error(r.error);
    qc.invalidateQueries({ queryKey: ["dumps"] });
  }
  // Item que ficou "analisando" por mais de 3 min provavelmente travou (ex.: página fechada no meio)
  const stuck = d.status === "analyzing" && Date.now() - new Date(d.created_at).getTime() > 180_000;
  const icon = stuck ? <AlertCircle className="h-4 w-4 text-amber-600" /> : d.status === "analyzing" ? <Loader2 className="h-4 w-4 animate-spin text-primary-deep" /> : d.status === "error" ? <AlertCircle className="h-4 w-4 text-destructive" /> : d.doc_type === "texto" ? <MessageSquare className="h-4 w-4 text-primary-deep" /> : d.doc_type === "cronograma" ? <CalendarCheck className="h-4 w-4 text-primary-deep" /> : <FileText className="h-4 w-4 text-primary-deep" />;
  const text = stuck ? "Parece que a análise travou. Tente de novo ou remova." : d.status === "analyzing" ? "Analisando…" : d.status === "error" ? d.error : d.summary ?? d.status;
  return (
    <li className="flex items-center gap-4 p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{d.doc_type === "texto" ? `“${d.file_name}”` : d.file_name}</div>
        <div className={d.status === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{text}</div>
      </div>
      {(d.status === "error" || stuck) && d.doc_type !== "desconhecido" && <button onClick={retry} className="flex items-center gap-1 text-xs font-semibold text-primary-deep"><RotateCw className="h-3.5 w-3.5" />Tentar de novo</button>}
      {d.status === "analyzing" && !stuck && <button onClick={() => discardDump(d, qc, "Cancelado")} className="text-xs text-muted-foreground hover:text-foreground">Cancelar</button>}
      {(d.status === "error" || stuck) && <button onClick={() => discardDump(d, qc)} className="text-xs text-muted-foreground hover:text-foreground">Remover</button>}
      <span className="hidden font-mono text-[10px] uppercase text-muted-foreground sm:block">{formatDistanceToNow(new Date(d.created_at), { locale: ptBR, addSuffix: true })}</span>
    </li>
  );
}
