import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { LayoutDashboard, BookOpen, CalendarDays, FolderOpen, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { AccountMenu } from "@/components/AccountMenu";

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
  { to: "/despejo", label: "Despejo", icon: Sparkles },
  { to: "/disciplinas", label: "Disciplinas", icon: BookOpen },
  { to: "/calendario", label: "Calendário", icon: CalendarDays },
  { to: "/materiais", label: "Materiais", icon: FolderOpen },
] as const;

function Shell() {
  const { user } = Route.useRouteContext();
  return (
    <div className="relative min-h-screen overflow-x-clip bg-background">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-0 overflow-hidden">
        <div className="blob -right-40 -top-40 h-[28rem] w-[28rem]" />
        <div className="blob -bottom-48 -left-40 h-[26rem] w-[26rem] opacity-60" />
        <div className="blob right-[-10rem] top-[55%] h-72 w-72 opacity-40" />
      </div>
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        {/* Cabeçalho na largura toda: conta e logo encostados à esquerda, menu no centro */}
        <div className="grid h-16 w-full grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 md:px-6">
          <div className="flex items-center gap-3 justify-self-start">
            {/* Conta: configurações (tema), trocar/adicionar conta e sair */}
            <AccountMenu email={user.email ?? "Conta"} userId={user.id} />
            <Link to="/painel"><Logo /></Link>
          </div>
          <nav className="hidden items-center gap-1 rounded-full border p-1 md:flex">
            {nav.map((n) => (
              <Link key={n.to} to={n.to} className="rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
                activeProps={{ className: "bg-primary !text-primary-foreground shadow-glow" }}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div aria-hidden />
        </div>
      </header>
      <main className="relative mx-auto max-w-6xl px-5 pb-28 pt-10 md:pb-16"><Outlet /></main>
      <nav className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-5 rounded-2xl border bg-background/95 p-1 shadow-lg backdrop-blur md:hidden">
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
