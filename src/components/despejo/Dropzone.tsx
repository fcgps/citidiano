import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUp, Sparkles, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { analyzeDump, interpretText } from "@/lib/despejo.functions";
import { discardDump } from "@/components/despejo/Review";
import { currentWeek, loadPlanSuggestions } from "@/lib/plan-cache";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STEPS = ["Guardando seu arquivo…", "Lendo o documento…", "Descobrindo se é cronograma ou material…", "Organizando as informações…"];
const TEXT_STEPS = ["Lendo sua mensagem…", "Olhando sua agenda…", "Pensando no melhor plano…"];
const EXAMPLES = ["Prova de DS adiada uma semana", "Não quero estudar cálculo hoje", "Quero ir pra academia 3x na semana", "Reunião do projeto do CITi quinta às 19h"];
const OK_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];

export function Dropzone({ compact = false, onDone }: { compact?: boolean; onDone?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [over, setOver] = useState(false);
  const qc = useQueryClient();
  const analyze = useServerFn(analyzeDump);
  const interpret = useServerFn(interpretText);
  const [text, setText] = useState("");
  const [textMode, setTextMode] = useState(false);
  // Item em análise agora (para poder cancelar) e se o usuário cancelou
  const current = useRef<{ id: string; path: string } | null>(null);
  // Cada envio ganha um número; cancelar "invalida" o envio atual, e o resultado dele é ignorado
  const runId = useRef(0);

  async function cancel() {
    runId.current++;
    const c = current.current;
    current.current = null;
    setBusy(null);
    setTextMode(false);
    if (c) await discardDump(c, qc, "Cancelado");
    toast("Análise cancelada.");
  }

  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 3500);
    return () => clearInterval(t);
  }, [busy]);

  async function sendText() {
    const t = text.trim();
    if (!t || busy) return;
    setTextMode(true);
    setBusy(t.length > 60 ? `${t.slice(0, 60)}…` : t);
    const my = ++runId.current;
    current.current = null;
    try {
      // Vai junto o plano da semana, para a IA poder mover sugestões em vez de criar eventos
      const week = currentWeek();
      const plan = { week, items: await loadPlanSuggestions(week) };
      const { data: row, error } = await supabase.from("dumps").insert({ path: "", file_name: t.slice(0, 200), doc_type: "texto", result: { text: t.slice(0, 1000), plan } }).select("id").single();
      if (error || !row) throw new Error("Não consegui registrar sua mensagem.");
      if (runId.current !== my) { await discardDump({ id: row.id, path: "" }, qc, "Cancelado"); return; }
      current.current = { id: row.id, path: "" };
      qc.invalidateQueries({ queryKey: ["dumps"] });
      const r = await interpret({ data: { id: row.id } });
      if (runId.current !== my) return;
      if (!r.ok) toast.error(r.error); else { toast.success("A IA respondeu! Confira a sugestão."); setText(""); }
      onDone?.();
    } catch (e) {
      if (runId.current === my) toast.error(e instanceof Error ? e.message : "Algo deu errado. Tente de novo.");
    } finally {
      if (runId.current === my) { current.current = null; setBusy(null); setTextMode(false); }
      qc.invalidateQueries({ queryKey: ["dumps"] });
    }
  }

  async function handle(list: FileList | null) {
    const f = list?.[0];
    if (!f || busy) return;
    if (!OK_TYPES.includes(f.type)) { toast.error("Envie um PDF ou uma imagem (PNG, JPG, WEBP)."); return; }
    if (f.size > 15e6) { toast.error("Arquivo grande demais — o máximo é 15 MB."); return; }
    setBusy(f.name);
    const my = ++runId.current;
    current.current = null;
    try {
      const { data: u } = await supabase.auth.getUser();
      const path = `${u.user!.id}/${crypto.randomUUID()}-${f.name.replace(/[^\w.\-]/g, "_")}`;
      const up = await supabase.storage.from("materiais").upload(path, f, { contentType: f.type });
      if (up.error) throw new Error("Não consegui salvar o arquivo. Tente de novo.");
      const { data: row, error } = await supabase.from("dumps").insert({ path, file_name: f.name.slice(0, 200), mime: f.type, size: f.size }).select("id").single();
      if (error || !row) throw new Error("Não consegui registrar o arquivo.");
      if (runId.current !== my) { await discardDump({ id: row.id, path }, qc, "Cancelado"); return; }
      current.current = { id: row.id, path };
      qc.invalidateQueries({ queryKey: ["dumps"] });
      const r = await analyze({ data: { id: row.id } });
      if (runId.current !== my) return;
      if (!r.ok) toast.error(r.error); else toast.success("Pronto! Revise o que a IA encontrou.");
      onDone?.();
    } catch (e) {
      if (runId.current === my) toast.error(e instanceof Error ? e.message : "Algo deu errado. Tente de novo.");
    } finally {
      if (runId.current === my) { current.current = null; setBusy(null); }
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
              <p className="mt-4 text-xl font-semibold">{textMode ? TEXT_STEPS[Math.min(step, TEXT_STEPS.length - 1)] : STEPS[step]}</p>
              <p className="mt-1 truncate text-sm text-muted-foreground">{busy}</p>
              <div className="mx-auto mt-5 h-1.5 max-w-xs overflow-hidden rounded-full bg-muted"><div className="h-full bg-gradient-primary transition-all duration-700" style={{ width: `${((step + 1) / (textMode ? TEXT_STEPS.length : STEPS.length)) * 100}%` }} /></div>
              <Button variant="ghost" size="sm" className="mt-4 rounded-full text-muted-foreground" onClick={cancel}><X className="mr-1 h-4 w-4" />Cancelar</Button>
            </>
          ) : (
            <>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent"><UploadCloud className="h-7 w-7 text-primary-deep" /></div>
              <p className={cn("mt-4 font-light", compact ? "text-2xl" : "text-3xl md:text-4xl")}>Jogue <strong className="font-bold">qualquer arquivo</strong> aqui.</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Cronograma do SIGAA, slides, lista de exercícios, foto do quadro… a IA descobre o que é e organiza para você.</p>
              <Button className="mt-5 rounded-full shadow-glow" onClick={() => input.current?.click()}>Escolher arquivo</Button>
              <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">PDF ou imagem · até 15 MB</p>

              <div className="mx-auto mt-6 max-w-xl text-left">
                <div className="mb-2 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />ou escreva<span className="h-px flex-1 bg-border" /></div>
                <form onSubmit={(e) => { e.preventDefault(); sendText(); }} className="flex items-end gap-2 rounded-2xl border bg-background p-2 focus-within:ring-2 focus-within:ring-ring">
                  <textarea
                    rows={1}
                    maxLength={1000}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendText(); } }}
                    placeholder="Ex.: prova de DS adiada uma semana"
                    className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
                  />
                  <Button type="submit" size="icon" className="shrink-0 rounded-full" disabled={!text.trim()} aria-label="Enviar"><ArrowUp className="h-4 w-4" /></Button>
                </form>
                {!compact && (
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    {EXAMPLES.map((ex) => <button key={ex} type="button" onClick={() => setText(ex)} className="rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary-deep">{ex}</button>)}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <input ref={input} type="file" hidden accept=".pdf,image/png,image/jpeg,image/webp,image/heic" onChange={(e) => handle(e.target.files)} />
    </div>
  );
}
