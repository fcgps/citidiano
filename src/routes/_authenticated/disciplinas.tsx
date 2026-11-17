import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { differenceInCalendarDays, format, parseISO, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  useTable, useInsert, useRemove, useUpdate, SUBJECT_COLORS, ASSESSMENT_KINDS, assessmentTag,
  type Assessment, type Material, type Subject,
} from "@/lib/data";

export const Route = createFileRoute("/_authenticated/disciplinas")({
  head: () => ({ meta: [{ title: "Disciplinas — CITidiano" }, { name: "description", content: "Suas disciplinas e avaliações." }, { property: "og:title", content: "Disciplinas — CITidiano" }, { property: "og:description", content: "Suas disciplinas e avaliações." }] }),
  component: Disciplinas,
});

const TAG_STYLE: Record<string, string> = {
  prova: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  mini: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  lista: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  entrega: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  extra: "bg-muted text-muted-foreground",
};

const daysLabel = (n: number) => (n === 0 ? "hoje" : n === 1 ? "amanhã" : `em ${n} dias`);

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  // O seletor "Outra" dispara a cada movimento do mouse: só salva quando a pessoa para
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {SUBJECT_COLORS.map((c) => (
        <button type="button" key={c} onClick={() => onChange(c)} aria-label={c} className={cn("h-7 w-7 rounded-full ring-offset-2 ring-offset-background", value.toLowerCase() === c.toLowerCase() && "ring-2 ring-ring")} style={{ background: c }} />
      ))}
      <label className="flex h-7 cursor-pointer items-center gap-1 rounded-full border px-2 text-xs text-muted-foreground" title="Escolher outra cor">
        Outra
        <input type="color" defaultValue={value} onChange={(e) => { const v = e.target.value; clearTimeout(timer.current); timer.current = setTimeout(() => onChange(v), 400); }} className="h-4 w-4 cursor-pointer border-0 bg-transparent p-0" />
      </label>
    </div>
  );
}

function SubjectDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(""); const [prof, setProf] = useState(""); const [color, setColor] = useState<string>(SUBJECT_COLORS[0]!);
  const ins = useInsert("subjects");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button className="rounded-full shadow-glow"><Plus className="h-4 w-4" /> Nova disciplina</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Nova disciplina</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); await ins.mutateAsync({ name: name.trim().slice(0, 100), professor: prof.trim().slice(0, 100) || null, color }); setOpen(false); setName(""); setProf(""); }}>
          <div className="space-y-1.5"><Label>Nome</Label><Input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Cálculo 1" /></div>
          <div className="space-y-1.5"><Label>Professor(a)</Label><Input maxLength={100} value={prof} onChange={(e) => setProf(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Cor</Label><ColorPicker value={color} onChange={setColor} /></div>
          <Button type="submit" className="w-full rounded-full" disabled={ins.isPending}>Salvar</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Cartão: só o resumo do que importa (próximas provas, listas e entregas)
// ---------------------------------------------------------------------------
function SubjectCard({ s, onOpen }: { s: Subject; onOpen: () => void }) {
  const { data: all = [] } = useTable("assessments");
  const { data: materials = [] } = useTable("materials");
  const today = startOfDay(new Date());
  const mine = all.filter((a) => a.subject_id === s.id);
  const next = mine
    .map((a) => ({ a, n: differenceInCalendarDays(parseISO(a.date), today), tag: assessmentTag(a) }))
    .filter((x) => x.n >= 0 && x.tag.key !== "extra")
    .sort((x, y) => x.n - y.n)
    .slice(0, 3);
  const nMaterials = materials.filter((m) => m.subject_id === s.id).length;

  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())} className="group relative w-full cursor-pointer overflow-hidden rounded-2xl border bg-card p-6 text-left transition hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: s.color }} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-2xl font-bold group-hover:underline">{s.name}</h3>
          {s.professor && <p className="text-sm text-muted-foreground">Prof. {s.professor}</p>}
        </div>
        <ChevronRight className="mt-2 h-5 w-5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" />
      </div>

      <p className="eyebrow mb-2 mt-6">Próximas</p>
      {next.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nada marcado pela frente.</p>
      ) : (
        <ul className="space-y-2">
          {next.map(({ a, n, tag }) => (
            <li key={a.id} className="flex items-center gap-3">
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", TAG_STYLE[tag.key])}>{tag.label}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.name}</span>
              <span className={cn("shrink-0 font-mono text-xs", n <= 3 ? "font-semibold text-destructive" : "text-muted-foreground")}>{daysLabel(n)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-5 text-xs text-muted-foreground">{mine.length} {mine.length === 1 ? "avaliação" : "avaliações"} no cronograma · {nMaterials} {nMaterials === 1 ? "material" : "materiais"}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Painel lateral: tudo da disciplina (dados, cronograma completo e materiais)
// ---------------------------------------------------------------------------
function AssessmentForm({ subjectId, initial, onDone }: { subjectId: string; initial?: Assessment; onDone: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [date, setDate] = useState(initial?.date ?? "");
  const [kind, setKind] = useState(initial?.kind && ASSESSMENT_KINDS[initial.kind] ? initial.kind : "prova");
  const [topics, setTopics] = useState(initial?.topics ?? "");
  const ins = useInsert("assessments");
  const upd = useUpdate("assessments");
  const field = "h-9 rounded-md border bg-background px-2 text-sm";
  async function submit(e: FormEvent) {
    e.preventDefault();
    const row = { name: name.trim().slice(0, 100), date, kind, topics: topics.trim().slice(0, 1000) || null };
    if (initial) await upd.mutateAsync({ id: initial.id, ...row });
    else await ins.mutateAsync({ subject_id: subjectId, ...row });
    onDone();
  }
  return (
    <form className="space-y-2 rounded-xl bg-muted p-3" onSubmit={submit}>
      <div className="flex flex-wrap gap-2">
        <Input required placeholder="P1" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} className="min-w-32 flex-1" />
        <Input required type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={field}>{Object.entries(ASSESSMENT_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <Textarea placeholder="Assuntos cobrados" maxLength={1000} value={topics} onChange={(e) => setTopics(e.target.value)} rows={2} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>Cancelar</Button>
        <Button size="sm" type="submit" disabled={ins.isPending || upd.isPending}>{initial ? "Salvar" : "Adicionar"}</Button>
      </div>
    </form>
  );
}

function SubjectSheet({ s, onClose }: { s: Subject; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: all = [] } = useTable("assessments");
  const { data: materials = [] } = useTable("materials");
  const { data: topics = [] } = useTable("topics");
  const updS = useUpdate("subjects");
  const rmS = useRemove("subjects");
  const rmA = useRemove("assessments");
  const [name, setName] = useState(s.name);
  const [prof, setProf] = useState(s.professor ?? "");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const today = startOfDay(new Date());

  const dirty = name.trim() !== s.name || (prof.trim() || null) !== (s.professor ?? null);
  const list = all.filter((a) => a.subject_id === s.id).sort((a, b) => a.date.localeCompare(b.date));
  const files = materials.filter((m) => m.subject_id === s.id);
  const myTopics = topics.filter((t) => t.subject_id === s.id);
  const groups = [...myTopics.map((t) => ({ key: t.id, name: t.name })), { key: "", name: "Sem tópico" }]
    .map((g) => ({ ...g, files: files.filter((f) => (f.topic_id ?? "") === g.key) }))
    .filter((g) => g.files.length);

  async function saveInfo() {
    if (!name.trim()) { toast.error("O nome não pode ficar vazio."); return; }
    await updS.mutateAsync({ id: s.id, name: name.trim().slice(0, 100), professor: prof.trim().slice(0, 100) || null });
    toast.success("Disciplina atualizada.");
  }
  async function open(m: Material) {
    const { data, error } = await supabase.storage.from("materiais").createSignedUrl(m.path, 60);
    if (error) { toast.error(error.message); return; }
    window.open(data.signedUrl, "_blank");
  }
  async function removeFile(m: Material) {
    if (!confirm(`Apagar "${m.name}"?`)) return;
    await supabase.storage.from("materiais").remove([m.path]);
    await supabase.from("materials").delete().eq("id", m.id);
    qc.invalidateQueries({ queryKey: ["materials"] });
  }

  return (
    <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
      <div className="absolute inset-x-0 top-0 h-1.5" style={{ background: s.color }} />
      <SheetHeader className="mt-2"><SheetTitle className="text-2xl font-bold">{s.name}</SheetTitle></SheetHeader>

      {/* Dados da disciplina */}
      <section className="mt-6 space-y-4">
        <p className="eyebrow">Dados</p>
        <div className="space-y-1.5"><Label>Nome</Label><Input maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Professor(a)</Label><Input maxLength={100} value={prof} onChange={(e) => setProf(e.target.value)} placeholder="Opcional" /></div>
        {dirty && <Button size="sm" className="rounded-full" onClick={saveInfo} disabled={updS.isPending}>Salvar alterações</Button>}
        <div className="space-y-1.5"><Label>Cor</Label><ColorPicker value={s.color} onChange={(color) => updS.mutate({ id: s.id, color })} /></div>
      </section>

      {/* Cronograma completo */}
      <section className="mt-10">
        <div className="mb-3 flex items-baseline justify-between"><p className="eyebrow">Cronograma · {list.length}</p>
          {!adding && <button onClick={() => { setAdding(true); setEditing(null); }} className="text-sm font-semibold text-primary-deep">+ Adicionar avaliação</button>}
        </div>
        {adding && <div className="mb-3"><AssessmentForm subjectId={s.id} onDone={() => setAdding(false)} /></div>}
        {list.length === 0 && !adding ? <p className="text-sm text-muted-foreground">Nenhuma avaliação. Jogue o cronograma do SIGAA na <Link to="/despejo" className="font-semibold text-primary-deep">Área de despejo</Link> ou adicione à mão.</p> : (
          <ul className="divide-y rounded-2xl border">
            {list.map((a) => {
              const n = differenceInCalendarDays(parseISO(a.date), today);
              const tag = assessmentTag(a);
              return editing === a.id ? (
                <li key={a.id} className="p-2"><AssessmentForm subjectId={s.id} initial={a} onDone={() => setEditing(null)} /></li>
              ) : (
                <li key={a.id} className={cn("group/a flex items-start gap-3 p-3", n < 0 && "opacity-50")}>
                  <div className="w-14 shrink-0 text-center"><div className="text-lg font-bold leading-none">{format(parseISO(a.date), "dd")}</div><div className="font-mono text-[10px] uppercase text-muted-foreground">{format(parseISO(a.date), "MMM", { locale: ptBR })}</div></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{a.name}</span><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", TAG_STYLE[tag.key])}>{tag.label}</span></div>
                    {a.topics && <p className="text-sm text-muted-foreground">{a.topics}</p>}
                    {n >= 0 && <p className="font-mono text-[11px] text-muted-foreground">{daysLabel(n)}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1 opacity-60 transition group-hover/a:opacity-100">
                    <button onClick={() => { setEditing(a.id); setAdding(false); }} className="rounded p-1 hover:bg-muted" aria-label="Editar"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => confirm(`Apagar "${a.name}"?`) && rmA.mutate(a.id)} className="rounded p-1 hover:bg-muted hover:text-destructive" aria-label="Apagar"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Materiais da disciplina */}
      <section className="mt-10">
        <div className="mb-3 flex items-baseline justify-between"><p className="eyebrow">Materiais · {files.length}</p></div>
        {files.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum material. Jogue slides e listas na <Link to="/despejo" className="font-semibold text-primary-deep">Área de despejo</Link> que a IA organiza aqui.</p> : (
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.key}>
                {myTopics.length > 0 && <p className="mb-1.5 text-xs font-semibold text-muted-foreground">{g.name}</p>}
                <ul className="divide-y rounded-2xl border">
                  {g.files.map((m) => (
                    <li key={m.id} className="group/m flex items-center gap-3 p-3">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <button onClick={() => open(m)} className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline">{m.name}</button>
                      <button onClick={() => removeFile(m)} className="rounded p-1 opacity-60 hover:bg-muted hover:text-destructive group-hover/m:opacity-100" aria-label="Apagar"><Trash2 className="h-3.5 w-3.5" /></button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-12 border-t pt-6">
        <button onClick={() => { if (confirm(`Excluir "${s.name}" com todas as avaliações?`)) { rmS.mutate(s.id); onClose(); } }} className="flex items-center gap-2 text-sm text-destructive hover:underline"><Trash2 className="h-4 w-4" />Excluir disciplina</button>
      </section>
    </SheetContent>
  );
}

function Disciplinas() {
  const { data = [], isLoading } = useTable("subjects");
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = data.find((s) => s.id === openId);
  return (
    <>
      <PageHeader eyebrow="Disciplinas" title={<>Tudo que você <strong className="font-bold">estuda</strong>, organizado.</>} action={<SubjectDialog />} />
      {isLoading ? <p className="text-muted-foreground">Carregando…</p> : data.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-12 text-center text-muted-foreground">Nenhuma disciplina ainda. Cadastre a primeira!</div>
      ) : <div className="grid gap-5 md:grid-cols-2">{data.map((s) => <SubjectCard key={s.id} s={s} onOpen={() => setOpenId(s.id)} />)}</div>}
      <Sheet open={!!opened} onOpenChange={(o) => !o && setOpenId(null)}>
        {opened && <SubjectSheet key={opened.id} s={opened} onClose={() => setOpenId(null)} />}
      </Sheet>
    </>
  );
}
