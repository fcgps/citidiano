import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, BookOpen, CalendarDays, FolderOpen, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: Shell,
});

const nav = [
  { to: "/painel", label: "Painel", icon: LayoutDashboard },
  { to: "/disciplinas", label: "Disciplinas", icon: BookOpen },
  { to: "/calendario", label: "Calendário", icon: CalendarDays },
  { to: "/materiais", label: "Materiais", icon: FolderOpen },
] as const;

function Shell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  async function signOut() {
    await qc.cancelQueries(); qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link to="/painel"><Logo /></Link>
          <nav className="hidden items-center gap-1 rounded-full border p-1 md:flex">
            {nav.map((n) => (
              <Link key={n.to} to={n.to} className="rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
                activeProps={{ className: "bg-primary !text-primary-foreground shadow-glow" }}>
                {n.label}
              </Link>
            ))}
          </nav>
          <button onClick={signOut} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sair</span>
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 pb-28 pt-10 md:pb-16"><Outlet /></main>
      <nav className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-4 rounded-2xl border bg-background/95 p-1 shadow-lg backdrop-blur md:hidden">
        {nav.map((n) => (
          <Link key={n.to} to={n.to} className="flex flex-col items-center gap-0.5 rounded-xl py-2 text-[11px] text-muted-foreground"
            activeProps={{ className: "bg-accent !text-accent-foreground" }}>
            <n.icon className="h-5 w-5" />{n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
