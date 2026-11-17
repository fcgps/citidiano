import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Palette, Plus, Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useTable, useInsert, useRemove, useUpdate, SUBJECT_COLORS, type Subject } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/disciplinas")({
  head: () => ({ meta: [{ title: "Disciplinas — CITidiano" }, { name: "description", content: "Suas disciplinas e avaliações." }, { property: "og:title", content: "Disciplinas — CITidiano" }, { property: "og:description", content: "Suas disciplinas e avaliações." }] }),
  component: Disciplinas,
});

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
          <div className="space-y-1.5"><Label>Cor</Label>
            <div className="flex flex-wrap gap-2">{SUBJECT_COLORS.map((c) => (
              <button type="button" key={c} onClick={() => setColor(c)} aria-label={c} className={`h-8 w-8 rounded-full ring-offset-2 ${color === c ? "ring-2 ring-ring" : ""}`} style={{ background: c }} />
            ))}</div>
          </div>
          <Button type="submit" className="w-full rounded-full" disabled={ins.isPending}>Salvar</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssessmentForm({ subjectId, onDone }: { subjectId: string; onDone: () => void }) {
  const [name, setName] = useState(""); const [date, setDate] = useState(""); const [topics, setTopics] = useState("");
  const ins = useInsert("assessments");
  return (
    <form className="mt-3 space-y-2 rounded-xl bg-muted p-3" onSubmit={async (e) => { e.preventDefault(); await ins.mutateAsync({ subject_id: subjectId, name: name.trim().slice(0, 100), date, topics: topics.trim().slice(0, 1000) || null }); onDone(); }}>
      <div className="flex gap-2"><Input required placeholder="P1" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /><Input required type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" /></div>
      <Textarea placeholder="Assuntos cobrados" maxLength={1000} value={topics} onChange={(e) => setTopics(e.target.value)} rows={2} />
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={onDone}>Cancelar</Button><Button size="sm" type="submit">Adicionar</Button></div>
    </form>
  );
}

function SubjectCard({ s }: { s: Subject }) {
  const { data: all = [] } = useTable("assessments");
  const rm = useRemove("subjects"); const rmA = useRemove("assessments");
  const upd = useUpdate("subjects");
  const [adding, setAdding] = useState(false);
  const [picking, setPicking] = useState(false);
  const setColor = (color: string) => upd.mutate({ id: s.id, color });
  // O seletor "Outra" dispara a cada movimento do mouse: salva só quando a pessoa para
  const colorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const setColorLater = (color: string) => { clearTimeout(colorTimer.current); colorTimer.current = setTimeout(() => setColor(color), 400); };
  const list = all.filter((a) => a.subject_id === s.id);
  return (
    <div className="group relative overflow-hidden rounded-2xl border bg-card p-6 transition hover:shadow-lg">
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: s.color }} />
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-2xl font-bold">{s.name}</h3>
          {s.professor && <p className="text-sm text-muted-foreground">Prof. {s.professor}</p>}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setPicking((v) => !v)} className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground" aria-label="Mudar cor">
            <span className="h-3 w-3 rounded-full" style={{ background: s.color }} /><Palette className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => confirm("Excluir disciplina e suas avaliações?") && rm.mutate(s.id)} className="text-muted-foreground opacity-0 transition group-hover:opacity-100" aria-label="Excluir"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>
      {picking && (
        <div className="mt-4 rounded-xl border p-3">
          <p className="eyebrow mb-2">Cor da disciplina</p>
          <div className="flex flex-wrap items-center gap-2">
            {SUBJECT_COLORS.map((c) => (
              <button key={c} onClick={() => setColor(c)} aria-label={c} className={`h-7 w-7 rounded-full ring-offset-2 ${s.color.toLowerCase() === c.toLowerCase() ? "ring-2 ring-ring" : ""}`} style={{ background: c }} />
            ))}
            <label className="flex h-7 cursor-pointer items-center gap-1 rounded-full border px-2 text-xs text-muted-foreground" title="Escolher outra cor">
              Outra
              <input type="color" defaultValue={s.color} onChange={(e) => setColorLater(e.target.value)} className="h-4 w-4 cursor-pointer border-0 bg-transparent p-0" />
            </label>
          </div>
        </div>
      )}
      <p className="eyebrow mb-2 mt-6">Avaliações · {list.length}</p>
      <ul className="divide-y">
        {list.map((a) => (
          <li key={a.id} className="flex items-start justify-between gap-3 py-2.5">
            <div>
              <div className="font-semibold">{a.name} <span className="font-mono text-xs font-normal text-muted-foreground">{format(parseISO(a.date), "dd MMM", { locale: ptBR })}</span></div>
              {a.topics && <p className="text-sm text-muted-foreground">{a.topics}</p>}
            </div>
            <button onClick={() => rmA.mutate(a.id)} className="text-muted-foreground hover:text-destructive" aria-label="Remover"><Trash2 className="h-3.5 w-3.5" /></button>
          </li>
        ))}
      </ul>
      {adding ? <AssessmentForm subjectId={s.id} onDone={() => setAdding(false)} /> :
        <button onClick={() => setAdding(true)} className="mt-2 text-sm font-semibold text-primary-deep">+ Adicionar avaliação</button>}
    </div>
  );
}

function Disciplinas() {
  const { data = [], isLoading } = useTable("subjects");
  return (
    <>
      <PageHeader eyebrow="Disciplinas" title={<>Tudo que você <strong className="font-bold">estuda</strong>, organizado.</>} action={<SubjectDialog />} />
      {isLoading ? <p className="text-muted-foreground">Carregando…</p> : data.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-12 text-center text-muted-foreground">Nenhuma disciplina ainda. Cadastre a primeira!</div>
      ) : <div className="grid gap-5 md:grid-cols-2">{data.map((s) => <SubjectCard key={s.id} s={s} />)}</div>}
    </>
  );
}
