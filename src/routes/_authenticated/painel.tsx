import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Sparkles, ArrowUpRight } from "lucide-react";
import { addDays, differenceInCalendarDays, endOfWeek, format, isWithinInterval, parseISO, startOfDay, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PageHeader, Stat } from "@/components/PageHeader";
import { GoalCard } from "@/components/GoalCard";
import { Dropzone } from "@/components/despejo/Dropzone";
import { useTable, EVENT_KINDS, isExtraAssessment } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/painel")({
  head: () => ({ meta: [{ title: "Painel — CITidiano" }, { name: "description", content: "O resumo da sua semana." }, { property: "og:title", content: "Painel — CITidiano" }, { property: "og:description", content: "O resumo da sua semana." }] }),
  component: Painel,
});

const RECS = [
  { t: "Comece a revisão de Cálculo hoje", d: "Sua P1 está chegando. Blocos de 50 min com pausas de 10 rendem mais do que uma maratona na véspera." },
  { t: "Encaixe a academia na terça e quinta", d: "Seus dias com menos compromissos fixos são ótimos para bater a meta de 3x na semana." },
  { t: "Proteja um horário para o projeto da EJ", d: "Reserve 2h sem notificações antes da reunião de sexta para chegar com entregas prontas." },
];

function Painel() {
  const navigate = useNavigate();
  const { data: assessments = [] } = useTable("assessments");
  const { data: events = [] } = useTable("events");
  const { data: subjects = [] } = useTable("subjects");
  const { data: goals = [] } = useTable("goals");
  const today = startOfDay(new Date());
  const week = { start: startOfWeek(today, { weekStartsOn: 1 }), end: endOfWeek(today, { weekStartsOn: 1 }) };
  const subj = (id: string | null) => subjects.find((s) => s.id === id);

  const upcoming = [
    ...assessments.map((a) => ({ id: a.id, title: a.name, sub: subj(a.subject_id)?.name, color: subj(a.subject_id)?.color, date: parseISO(a.date), kind: isExtraAssessment(a) ? "Final / 2ª chamada" : "Avaliação" })),
    ...events.filter((e) => e.kind === "prova" || e.kind === "entrega").map((e) => ({ id: e.id, title: e.title, sub: subj(e.subject_id)?.name, color: subj(e.subject_id)?.color, date: parseISO(e.starts_at), kind: EVENT_KINDS[e.kind] })),
  ].filter((x) => x.date >= today && x.date <= addDays(today, 30)).sort((a, b) => +a.date - +b.date);
  const thisWeek = upcoming.filter((x) => isWithinInterval(x.date, week)).length;
  const eventsWeek = events.filter((e) => isWithinInterval(parseISO(e.starts_at), week)).length;
  const goalsDone = goals.filter((g) => Number(g.done) >= (g.kind === "weekly" ? g.times_per_week ?? 1 : Number(g.target_hours ?? 1))).length;

  return (
    <>
      <PageHeader eyebrow={format(today, "EEEE, d 'de' MMMM", { locale: ptBR })} title={<>Sua semana, <strong className="font-bold">em perspectiva.</strong></>} />
      <div className="mb-12">
        <div className="mb-3 flex items-baseline justify-between"><p className="eyebrow">Área de despejo</p><Link to="/despejo" className="text-sm font-semibold text-primary-deep">Ver histórico e revisões</Link></div>
        <Dropzone compact onDone={() => navigate({ to: "/despejo" })} />
      </div>
      <div className="mb-14 grid grid-cols-2 gap-8 border-y py-8 md:grid-cols-4">
        <Stat value={thisWeek} label={thisWeek === 1 ? "prova/entrega esta semana" : "provas e entregas esta semana"} />
        <Stat value={eventsWeek} label="compromissos na semana" />
        <Stat value={<>{goalsDone}<span className="text-muted-foreground">/{goals.length}</span></>} label="metas concluídas" />
        <Stat value={subjects.length} label="disciplinas ativas" />
      </div>

      <div className="grid gap-12 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <div className="mb-4 flex items-baseline justify-between"><p className="eyebrow">Próximas provas e entregas</p><Link to="/calendario" className="text-sm font-semibold text-primary-deep">Ver calendário</Link></div>
          {upcoming.length === 0 ? <p className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground">Nada nos próximos 30 dias. <Link to="/disciplinas" className="font-semibold text-primary-deep">Cadastre avaliações</Link>.</p> : (
            <ul className="divide-y rounded-2xl border">
              {upcoming.slice(0, 6).map((x) => {
                const n = differenceInCalendarDays(x.date, today);
                return (
                  <li key={x.kind + x.id} className="flex items-center gap-4 p-4">
                    <span className="h-10 w-1 rounded-full" style={{ background: x.color ?? "currentColor" }} />
                    <div className="flex-1"><div className="font-semibold">{x.title}</div><div className="text-sm text-muted-foreground">{x.kind}{x.sub && ` · ${x.sub}`} · {format(x.date, "EEE, d MMM", { locale: ptBR })}</div></div>
                    <div className="text-right"><div className="text-2xl font-bold tracking-tighter">{n === 0 ? "Hoje" : n}</div>{n > 0 && <div className="font-mono text-[10px] uppercase text-muted-foreground">{n === 1 ? "dia" : "dias"}</div>}</div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="eyebrow mb-4 mt-12">Metas da semana</p>
          {goals.length === 0 ? <p className="text-sm text-muted-foreground">Sem metas. <Link to="/calendario" className="font-semibold text-primary-deep">Crie uma</Link>.</p> :
            <div className="grid gap-3 sm:grid-cols-2">{goals.map((g) => <GoalCard key={g.id} g={g} subject={subj(g.subject_id)} />)}</div>}
        </section>

        <aside className="lg:col-span-2">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-primary p-[1px] shadow-glow">
            <div className="rounded-[calc(1.5rem-1px)] bg-background p-6">
              <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary-deep" /><p className="eyebrow">Recomendações</p></div>
              <h3 className="mt-3 text-2xl font-light">O que fazer <strong className="font-bold">agora.</strong></h3>
              <ul className="mt-6 space-y-5">
                {RECS.map((r, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="font-mono text-xs text-primary-deep">0{i + 1}</span>
                    <div><div className="font-semibold">{r.t}</div><p className="text-sm text-muted-foreground">{r.d}</p></div>
                  </li>
                ))}
              </ul>
              <p className="mt-6 flex items-center gap-1 text-xs text-muted-foreground"><ArrowUpRight className="h-3 w-3" /> Exemplo — em breve geradas por IA a partir da sua rotina.</p>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
