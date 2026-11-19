import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { addDays, differenceInCalendarDays, endOfWeek, format, isWithinInterval, parseISO, startOfDay, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PageHeader, Stat } from "@/components/PageHeader";
import { GoalCard } from "@/components/GoalCard";
import { Dropzone } from "@/components/despejo/Dropzone";
import { WeekPlan } from "@/components/WeekPlan";
import { useTable, EVENT_KINDS, isExtraAssessment } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/painel")({
  head: () => ({ meta: [{ title: "Painel — CITidiano" }, { name: "description", content: "O resumo da sua semana." }, { property: "og:title", content: "Painel — CITidiano" }, { property: "og:description", content: "O resumo da sua semana." }] }),
  component: Painel,
});

function Painel() {
  const navigate = useNavigate();
  const { data: assessments = [] } = useTable("assessments");
  const { data: allEvents = [] } = useTable("events");
  const events = allEvents.filter((e) => e.kind !== "registro"); // registros das metas ("+") não aparecem
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
  // Meta semanal: conta os registros desta semana na agenda (mesmo critério do cartão da meta)
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }), weekEnd = addDays(weekStart, 7);
  const doneThisWeek = (title: string) => allEvents.filter((e) => e.kind === "registro" && e.title === title && parseISO(e.starts_at) >= weekStart && parseISO(e.starts_at) < weekEnd).length;
  const goalsDone = goals.filter((g) => (g.kind === "weekly" ? doneThisWeek(g.title) >= (g.times_per_week ?? 1) : Number(g.done) >= Number(g.target_hours ?? 1))).length;

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

      <WeekPlan />

      <div className="grid gap-12 lg:grid-cols-2">
        <section>
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
        </section>

        <section>
          <p className="eyebrow mb-4">Metas da semana</p>
          {goals.length === 0 ? <p className="text-sm text-muted-foreground">Sem metas. <Link to="/calendario" className="font-semibold text-primary-deep">Crie uma</Link>.</p> :
            <div className="grid gap-3 sm:grid-cols-2">{goals.map((g) => <GoalCard key={g.id} g={g} subject={subj(g.subject_id)} />)}</div>}
        </section>

      </div>
    </>
  );
}
