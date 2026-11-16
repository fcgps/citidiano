import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Image as ImageIcon, Presentation, Upload, Trash2, Download, File } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { useTable, type Material } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/materiais")({
  head: () => ({ meta: [{ title: "Materiais — CITidiano" }, { name: "description", content: "Seus PDFs, slides e imagens por disciplina." }, { property: "og:title", content: "Materiais — CITidiano" }, { property: "og:description", content: "Materiais por disciplina." }] }),
  component: Materiais,
});

function Icon({ mime }: { mime: string | null }) {
  const c = "h-5 w-5 text-primary-deep";
  if (mime?.startsWith("image/")) return <ImageIcon className={c} />;
  if (mime === "application/pdf") return <FileText className={c} />;
  if (mime?.includes("presentation") || mime?.includes("powerpoint")) return <Presentation className={c} />;
  return <File className={c} />;
}
const size = (b: number | null) => (b ? (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`) : "");

function Materiais() {
  const { data: subjects = [] } = useTable("subjects");
  const { data: files = [] } = useTable("materials");
  const [subjectId, setSubjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    for (const f of Array.from(list)) {
      if (f.size > 20e6) { toast.error(`${f.name}: máximo 20 MB`); continue; }
      const path = `${u.user!.id}/${crypto.randomUUID()}-${f.name.replace(/[^\w.\-]/g, "_")}`;
      const { error } = await supabase.storage.from("materiais").upload(path, f, { contentType: f.type });
      if (error) { toast.error(error.message); continue; }
      await supabase.from("materials").insert({ name: f.name.slice(0, 200), path, mime: f.type, size: f.size, subject_id: subjectId || null });
    }
    setBusy(false); if (input.current) input.current.value = "";
    qc.invalidateQueries({ queryKey: ["materials"] }); toast.success("Arquivos enviados!");
  }
  async function open(m: Material) {
    const { data, error } = await supabase.storage.from("materiais").createSignedUrl(m.path, 60);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank");
  }
  async function remove(m: Material) {
    await supabase.storage.from("materiais").remove([m.path]);
    await supabase.from("materials").delete().eq("id", m.id);
    qc.invalidateQueries({ queryKey: ["materials"] });
  }

  const groups = [...subjects.map((s) => ({ key: s.id, name: s.name, color: s.color })), { key: "", name: "Sem disciplina", color: "#9CA3AF" }]
    .map((g) => ({ ...g, files: files.filter((f) => (f.subject_id ?? "") === g.key) })).filter((g) => g.files.length);

  return (
    <>
      <PageHeader eyebrow="Materiais" title={<>Seus arquivos, <strong className="font-bold">no lugar certo.</strong></>} desc="Envie PDFs, slides e imagens. Em breve, a IA vai classificá-los automaticamente." />
      <div className="mb-10 rounded-2xl border-2 border-dashed p-8 text-center"
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
        <Upload className="mx-auto h-8 w-8 text-primary-deep" />
        <p className="mt-3 font-semibold">Arraste arquivos aqui ou escolha do computador</p>
        <div className="mx-auto mt-4 flex max-w-md flex-col gap-2 sm:flex-row">
          <select className="h-10 flex-1 rounded-full border border-input bg-background px-4 text-sm" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">Sem disciplina</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Button className="rounded-full shadow-glow" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Enviando…" : "Escolher arquivos"}</Button>
        </div>
        <input ref={input} type="file" multiple hidden accept=".pdf,image/*,.ppt,.pptx,.key,.odp,.doc,.docx" onChange={(e) => upload(e.target.files)} />
      </div>
      {groups.length === 0 ? <p className="text-muted-foreground">Nenhum material enviado ainda.</p> : (
        <div className="space-y-10">
          {groups.map((g) => (
            <section key={g.key || "none"}>
              <div className="mb-3 flex items-center gap-3"><span className="h-3 w-3 rounded-full" style={{ background: g.color }} /><h2 className="text-xl font-bold">{g.name}</h2><span className="eyebrow">{g.files.length} arquivo(s)</span></div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.files.map((m) => (
                  <div key={m.id} className="group flex items-center gap-3 rounded-xl border p-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent"><Icon mime={m.mime} /></div>
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{m.name}</div><div className="text-xs text-muted-foreground">{size(m.size)}</div></div>
                    <button onClick={() => open(m)} aria-label="Abrir" className="text-muted-foreground hover:text-foreground"><Download className="h-4 w-4" /></button>
                    <button onClick={() => remove(m)} aria-label="Excluir" className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
