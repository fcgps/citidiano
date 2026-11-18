import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { User } from "@supabase/supabase-js";
import { CalendarRange, FileUp, MessageSquareText, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Boas-vindas: aparece uma vez só, para quem acabou de criar a conta.
// Conta "nova" = criada há menos de 1 dia. Fechou (no X, fora da janela ou num botão)? Não aparece mais,
// nem em outro aparelho: a marca fica salva na própria conta (user_metadata).
const NEW_ACCOUNT_MS = 24 * 60 * 60 * 1000;
const KEY = (id: string) => `citidiano.boasvindas.${id}`;

const STEPS = [
  { icon: FileUp, title: "Jogue o cronograma de uma disciplina", text: "PDF ou print do SIGAA na Área de despejo. A IA monta as provas e entregas no calendário." },
  { icon: CalendarRange, title: "Mande um print da sua grade de horários", text: "Também no Despejo. Com a grade, o plano sugere horários livres para estudar e treinar." },
  { icon: MessageSquareText, title: "Escreva como falaria", text: "“Quero ir pra academia 3x na semana” ou “prova de DS adiada uma semana”. Você confirma antes de mudar." },
  { icon: Sparkles, title: "Veja o plano da semana no Painel", text: "A IA distribui estudo, treino e descanso conforme a carga de cada dia." },
];

export function WelcomeDialog({ user }: { user: User }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const isNew = Date.now() - new Date(user.created_at).getTime() < NEW_ACCOUNT_MS;
    let seen = !!user.user_metadata?.welcome_seen;
    try { seen = seen || localStorage.getItem(KEY(user.id)) === "1"; } catch { /* ignora */ }
    if (isNew && !seen) setOpen(true);
  }, [user.id]);

  function dismiss() {
    setOpen(false);
    try { localStorage.setItem(KEY(user.id), "1"); } catch { /* ignora */ }
    void supabase.auth.updateUser({ data: { welcome_seen: true } });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <img src="/logo-escura.png" alt="CITidiano" className="mb-2 h-10 w-auto self-start" />
          <DialogTitle className="text-2xl font-light">Bem-vindo! <strong className="font-bold">Vamos montar sua semana.</strong></DialogTitle>
          <DialogDescription>Em poucos minutos o CITidiano já sabe suas provas, sua grade e suas metas.</DialogDescription>
        </DialogHeader>
        <ol className="mt-2 space-y-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-primary-deep"><s.icon className="h-4 w-4" /></span>
              <div>
                <p className="font-semibold"><span className="mr-1.5 font-mono text-xs text-primary-deep">0{i + 1}</span>{s.title}</p>
                <p className="text-sm text-muted-foreground">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" className="rounded-full" onClick={dismiss}>Explorar sozinho</Button>
          <Button className="rounded-full shadow-glow" onClick={() => { dismiss(); navigate({ to: "/despejo" }); }}>Começar pelo Despejo</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
