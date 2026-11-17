import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check, LogOut, Monitor, Moon, Settings, Sun, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { getTheme, setTheme, type Theme } from "@/lib/theme";
import { clearPerAccountCache, forgetAccount, listAccounts, type SavedAccount } from "@/lib/accounts";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const initials = (email: string) => {
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase() || "?";
};

function Avatar({ email, size = "md" }: { email: string; size?: "sm" | "md" }) {
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-gradient-primary font-bold text-primary-foreground", size === "md" ? "h-9 w-9 text-sm" : "h-7 w-7 text-[11px]")}>
      {initials(email)}
    </span>
  );
}

export function AccountMenu({ email, userId }: { email: string; userId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [others, setOthers] = useState<SavedAccount[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const refresh = () => setOthers(listAccounts().filter((a) => a.user_id !== userId));
  useEffect(refresh, [userId]);

  async function resetData() {
    await qc.cancelQueries();
    qc.clear();
    clearPerAccountCache();
  }

  async function switchTo(a: SavedAccount) {
    const { error } = await supabase.auth.setSession({ access_token: a.access_token, refresh_token: a.refresh_token });
    if (error) {
      forgetAccount(a.user_id);
      refresh();
      toast.error(`A sessão de ${a.email} expirou. Entre de novo com "Adicionar conta".`);
      return;
    }
    await resetData();
    toast.success(`Agora você está em ${a.email}`);
    navigate({ to: "/painel", replace: true });
  }

  async function addAccount() {
    // "local": sai só deste navegador, sem invalidar a sessão salva desta conta
    await resetData();
    await supabase.auth.signOut({ scope: "local" });
    navigate({ to: "/auth", replace: true });
  }

  async function signOut() {
    forgetAccount(userId);
    await resetData();
    await supabase.auth.signOut({ scope: "local" });
    navigate({ to: "/auth", replace: true });
  }

  return (
    <>
      <DropdownMenu onOpenChange={(open) => open && refresh()}>
        <DropdownMenuTrigger className="rounded-full outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring" aria-label="Sua conta">
          <Avatar email={email} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="flex items-center gap-3 py-2 font-normal">
            <Avatar email={email} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{email}</div>
              <div className="text-xs text-muted-foreground">Conta atual</div>
            </div>
          </DropdownMenuLabel>
          {others.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Trocar de conta</DropdownMenuLabel>
              {others.map((a) => (
                <DropdownMenuItem key={a.user_id} onSelect={() => switchTo(a)} className="gap-3">
                  <Avatar email={a.email} size="sm" /><span className="truncate">{a.email}</span>
                </DropdownMenuItem>
              ))}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSettingsOpen(true)} className="gap-3"><Settings className="h-4 w-4" />Configurações</DropdownMenuItem>
          <DropdownMenuItem onSelect={addAccount} className="gap-3"><UserPlus className="h-4 w-4" />Adicionar conta</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={signOut} className="gap-3 text-destructive focus:text-destructive"><LogOut className="h-4 w-4" />Sair</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} email={email} />
    </>
  );
}

const THEMES: { id: Theme; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "Claro", icon: Sun },
  { id: "dark", label: "Escuro", icon: Moon },
  { id: "system", label: "Igual ao sistema", icon: Monitor },
];

function SettingsDialog({ open, onOpenChange, email }: { open: boolean; onOpenChange: (o: boolean) => void; email: string }) {
  const [theme, setThemeState] = useState<Theme>("light");
  useEffect(() => { if (open) setThemeState(getTheme()); }, [open]);
  const choose = (t: Theme) => { setTheme(t); setThemeState(t); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Configurações</DialogTitle></DialogHeader>
        <section>
          <p className="eyebrow mb-3">Tema</p>
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map((t) => (
              <button key={t.id} onClick={() => choose(t.id)} className={cn("relative flex flex-col items-center gap-2 rounded-2xl border p-4 text-sm transition", theme === t.id ? "border-primary bg-accent font-semibold text-accent-foreground" : "text-muted-foreground hover:text-foreground")}>
                {theme === t.id && <Check className="absolute right-2 top-2 h-3.5 w-3.5 text-primary-deep" />}
                <t.icon className="h-5 w-5" />{t.label}
              </button>
            ))}
          </div>
        </section>
        <section className="mt-2">
          <p className="eyebrow mb-2">Conta</p>
          <p className="text-sm text-muted-foreground">Conectado como <span className="font-medium text-foreground">{email}</span></p>
        </section>
      </DialogContent>
    </Dialog>
  );
}
