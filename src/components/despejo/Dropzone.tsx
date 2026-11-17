import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { analyzeDump } from "@/lib/despejo.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STEPS = ["Guardando seu arquivo…", "Lendo o documento…", "Descobrindo se é cronograma ou material…", "Organizando as informações…"];
const OK_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];

export function Dropzone({ compact = false, onDone }: { compact?: boolean; onDone?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [over, setOver] = useState(false);
  const qc = useQueryClient();
  const analyze = useServerFn(analyzeDump);

  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 3500);
    return () => clearInterval(t);
  }, [busy]);

  async function handle(list: FileList | null) {
    const f = list?.[0];
    if (!f || busy) return;
    if (!OK_TYPES.includes(f.type)) { toast.error("Envie um PDF ou uma imagem (PNG, JPG, WEBP)."); return; }
    if (f.size > 15e6) { toast.error("Arquivo grande demais — o máximo é 15 MB."); return; }
    setBusy(f.name);
    try {
      const { data: u } = await supabase.auth.getUser();
      const path = `${u.user!.id}/${crypto.randomUUID()}-${f.name.replace(/[^\w.\-]/g, "_")}`;
      const up = await supabase.storage.from("materiais").upload(path, f, { contentType: f.type });
      if (up.error) throw new Error("Não consegui salvar o arquivo. Tente de novo.");
      const { data: row, error } = await supabase.from("dumps").insert({ path, file_name: f.name.slice(0, 200), mime: f.type, size: f.size }).select("id").single();
      if (error || !row) throw new Error("Não consegui registrar o arquivo.");
      qc.invalidateQueries({ queryKey: ["dumps"] });
      const r = await analyze({ data: { id: row.id } });
      if (!r.ok) toast.error(r.error); else toast.success("Pronto! Revise o que a IA encontrou.");
      onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Algo deu errado. Tente de novo.");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
      qc.invalidateQueries({ queryKey: ["dumps"] });
    }
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files); }}
      className={cn("relative overflow-hidden rounded-3xl bg-gradient-primary p-[1.5px] shadow-glow transition", over && "scale-[1.01]")}
    >
      <div className={cn("relative rounded-[calc(1.5rem-1.5px)] bg-background text-center", compact ? "p-6" : "p-10 md:p-14")}>
        <div className="pointer-events-none absolute inset-0 bg-gradient-soft opacity-70" />
        <div className="relative">
          {busy ? (
            <>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent"><Sparkles className="h-7 w-7 animate-pulse text-primary-deep" /></div>
              <p className="mt-4 text-xl font-semibold">{STEPS[step]}</p>
              <p className="mt-1 truncate text-sm text-muted-foreground">{busy}</p>
              <div className="mx-auto mt-5 h-1.5 max-w-xs overflow-hidden rounded-full bg-muted"><div className="h-full bg-gradient-primary transition-all duration-700" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
            </>
          ) : (
            <>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent"><UploadCloud className="h-7 w-7 text-primary-deep" /></div>
              <p className={cn("mt-4 font-light", compact ? "text-2xl" : "text-3xl md:text-4xl")}>Jogue <strong className="font-bold">qualquer arquivo</strong> aqui.</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Cronograma do SIGAA, slides, lista de exercícios, foto do quadro… a IA descobre o que é e organiza para você.</p>
              <Button className="mt-5 rounded-full shadow-glow" onClick={() => input.current?.click()}>Escolher arquivo</Button>
              <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">PDF ou imagem · até 15 MB</p>
            </>
          )}
        </div>
      </div>
      <input ref={input} type="file" hidden accept=".pdf,image/png,image/jpeg,image/webp,image/heic" onChange={(e) => handle(e.target.files)} />
    </div>
  );
}
