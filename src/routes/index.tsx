import { createFileRoute, Link } from "@tanstack/react-router";

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
      {/* Degradê verde dos dois lados */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(55% 75% at 0% 45%, oklch(0.74 0.2 150 / 0.55), transparent 70%), radial-gradient(55% 75% at 100% 45%, oklch(0.74 0.2 150 / 0.55), transparent 70%)",
        }}
      />

      {/* Logo grande no centro + botão de entrar */}
      <section className="relative flex min-h-[60vh] flex-col items-center justify-end px-5 pb-16 pt-20 text-center">
        <img src="/logo-escura.png" alt="CITidiano" className="h-24 w-auto drop-shadow-sm sm:h-32 md:h-44" />
        <Link to="/auth" className="mt-12 inline-flex items-center justify-center rounded-full bg-primary px-16 py-5 text-xl font-semibold text-primary-foreground shadow-glow transition hover:brightness-105">
          Entrar
        </Link>
      </section>

      {/* Textos abaixo */}
      <section className="relative mx-auto max-w-5xl px-5 pb-20 text-center">
        <p className="eyebrow mb-6">Planejador para universitários</p>
        <h2 className="mx-auto max-w-4xl text-4xl font-light leading-[1.05] md:text-6xl">
          Seu <strong className="font-extrabold">cotidiano</strong> inteiro,{" "}
          <strong className="font-extrabold text-gradient">planejado</strong> com inteligência.
        </h2>
        <p className="mx-auto mt-8 max-w-xl text-lg text-muted-foreground">
          Provas, entregas, reuniões da EJ, estágio e academia — tudo num lugar só, com{" "}
          <strong className="text-foreground">metas flexíveis</strong> que se encaixam na sua semana.
        </p>
      </section>
    </div>
  );
}
