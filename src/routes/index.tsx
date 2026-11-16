import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CITidiano — planejamento inteligente para universitários" },
      { name: "description", content: "Organize disciplinas, provas, metas e materiais num só lugar. Feito para quem concilia faculdade, EJ, estágio e academia." },
      { property: "og:title", content: "CITidiano — planejamento inteligente para universitários" },
      { property: "og:description", content: "Disciplinas, provas, metas e materiais num só lugar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 bg-gradient-soft" />
      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-5 py-6">
        <Logo />
        <Link to="/auth" className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-glow">Entrar</Link>
      </header>
      <section className="relative mx-auto max-w-6xl px-5 pb-24 pt-20 md:pt-32">
        <p className="eyebrow mb-6">Planejador para universitários</p>
        <h1 className="max-w-4xl text-5xl font-light leading-[1.02] md:text-7xl">
          Seu <strong className="font-extrabold">cotidiano</strong> inteiro,{" "}
          <strong className="font-extrabold text-gradient">planejado</strong> com inteligência.
        </h1>
        <p className="mt-8 max-w-xl text-lg text-muted-foreground">
          Provas, entregas, reuniões da EJ, estágio e academia — tudo num calendário só, com{" "}
          <strong className="text-foreground">metas flexíveis</strong> que se encaixam na sua semana.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link to="/auth" className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground shadow-glow">
            Começar agora <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-24 grid gap-10 border-t pt-10 sm:grid-cols-3">
          {[["4", "áreas: painel, disciplinas, calendário e materiais"], ["2", "tipos de agenda: compromissos fixos e metas"], ["1", "lugar para tudo da sua semana"]].map(([n, l]) => (
            <div key={l}><div className="text-6xl font-bold tracking-tighter">{n}</div><p className="mt-2 text-sm text-muted-foreground">{l}</p></div>
          ))}
        </div>
      </section>
    </div>
  );
}
