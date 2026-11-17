import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MODEL = "gemini-3.5-flash";
// Modelo reserva, usado quando o principal está sobrecarregado (erros 500/503)
const FALLBACK_MODEL = "gemini-3.5-flash-lite";
// thinkingLevel "low": a IA "pensa" menos antes de responder → respostas bem mais rápidas.
// (O padrão do 3.5 Flash é "medium", que pode demorar demais para um planejador.)

// As atualizações de status abaixo usam .eq("status", "analyzing"): se o usuário
// cancelou a análise no meio, o resultado da IA é simplesmente ignorado.

// Chama o Gemini sem deixar o usuário esperando demais (total ~45 s):
// 1) tenta o modelo principal por pouco tempo; 2) se demorar ou o Google estiver
// sobrecarregado (429/500/503), vai direto para o modelo reserva, que costuma
// estar livre quando o principal está congestionado.
const TOTAL_MS = 45_000;

async function callGemini(key: string, body: unknown, firstMs = 20_000): Promise<Response> {
  const started = Date.now();
  const timeout = () => new Response(JSON.stringify({ error: "timeout" }), { status: 504 });
  const attempt = async (model: string, maxMs: number) => {
    const left = Math.min(maxMs, TOTAL_MS - (Date.now() - started));
    if (left < 3_000) return timeout();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), left);
    try {
      return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (ctrl.signal.aborted) return timeout();
      throw e;
    } finally {
      clearTimeout(t);
    }
  };
  const transient = (r: Response) => [429, 500, 503, 504].includes(r.status);
  const first = await attempt(MODEL, firstMs);
  if (!transient(first)) return first;
  console.warn("Gemini principal falhou", first.status, "→ usando modelo reserva");
  const alt = await attempt(FALLBACK_MODEL, TOTAL_MS);
  return alt.status === 404 ? first : alt;
}

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function prompt(today: string, catalog: string) {
  return `Você é o assistente do CITidiano, um planejador para universitários brasileiros. Hoje é ${today}.
Analise o arquivo anexado e responda SOMENTE com JSON válido, sem markdown.

Primeiro identifique o tipo:
- "cronograma": cronograma, ementa ou plano de ensino de uma disciplina (ex.: SIGAA).
- "material": material de estudo (slides, lista de exercícios, resumo, prova antiga etc.).
- "desconhecido": nenhum dos dois.

Disciplinas e tópicos já cadastrados pelo usuário (id: nome — tópicos):
${catalog || "(nenhuma)"}

Formato:
{
  "type": "cronograma" | "material" | "desconhecido",
  "reason": "frase curta explicando o que é o arquivo",
  "cronograma": null | {
    "subject_name": string|null,
    "professor": string|null,
    "assessments": [{"name": string, "date": "YYYY-MM-DD"|null, "kind": "prova"|"mini-prova"|"entrega"|"seminario"|"extra", "topics": string|null, "conflict": null | {"note": string, "options": ["YYYY-MM-DD", ...]}}],
    "holidays": [{"date": "YYYY-MM-DD", "description": string}],
    "topics": [string],
    "conflicts": [string]
  },
  "material": null | {
    "title": "título curto (até 60 caracteres)",
    "subject_id": "id existente ou null",
    "topic_id": "id existente ou null",
    "new_subject_name": "nome sugerido se nenhuma disciplina combinar, senão null",
    "new_topic_name": "nome de tópico sugerido se nenhum combinar, senão null"
  }
}
Regras: datas sem ano assumem o semestre atual (ano de hoje; se o mês já passou muito e o documento parece do próximo semestre, use o ano coerente). Use null para o que não estiver no documento — nunca invente. Se a mesma avaliação aparecer com datas diferentes, preencha "conflict" com as opções e coloque em "date" a mais provável. Assuntos cobrados em "topics" como texto curto. Use kind "extra" para provas finais, segunda chamada, reposição e exame final (na UFPE, "Exercício Escolar Final" ou "EE Final" também é final): elas só acontecem para quem precisa.`;
}

export const analyzeDump = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (typeof d?.id !== "string") throw new Error("id inválido");
    return d;
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const fail = async (msg: string) => {
      await sb.from("dumps").update({ status: "error", error: msg }).eq("id", data.id).eq("status", "analyzing");
      return { ok: false as const, error: msg };
    };
    const { data: dump } = await sb.from("dumps").select("*").eq("id", data.id).single();
    if (!dump) return { ok: false as const, error: "Item não encontrado." };
    const key = process.env["GEMINI_API_KEY"];
    if (!key) return fail("A chave da IA não está configurada.");

    const { data: file, error: dlErr } = await sb.storage.from("materiais").download(dump.path);
    if (dlErr || !file) return fail("Não consegui abrir o arquivo enviado.");

    const [{ data: subjects }, { data: topics }] = await Promise.all([
      sb.from("subjects").select("id,name"),
      sb.from("topics").select("id,name,subject_id"),
    ]);
    const catalog = (subjects ?? []).map((s) => {
      const t = (topics ?? []).filter((x) => x.subject_id === s.id).map((x) => `${x.id}: ${x.name}`).join("; ");
      return `- ${s.id}: ${s.name}${t ? ` — tópicos: ${t}` : ""}`;
    }).join("\n");
    const today = new Date().toISOString().slice(0, 10);

    let res: Response;
    try {
      res = await callGemini(key, {
        contents: [{ role: "user", parts: [
          { inline_data: { mime_type: dump.mime || file.type, data: toBase64(await file.arrayBuffer()) } },
          { text: prompt(today, catalog) },
        ] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1, thinkingConfig: { thinkingLevel: "low" } },
      });
    } catch (e) {
      console.error(e);
      return fail("Não consegui falar com a IA. Tente de novo em instantes.");
    }
    if (!res.ok) {
      console.error("Gemini", res.status, await res.text());
      if (res.status === 429 || res.status === 503) return fail("A IA do Google está sobrecarregada agora. Tente de novo em um minuto.");
      if (res.status === 504) return fail("A IA demorou demais para responder. Tente de novo em instantes.");
      if (res.status === 400) return fail("A IA não conseguiu ler este arquivo. Ele pode estar corrompido ou ser grande demais.");
      if (res.status === 403 || res.status === 401) return fail("A chave da IA foi recusada. Verifique a chave do Gemini.");
      return fail(`A IA teve um problema ao analisar o arquivo (erro ${res.status}). Tente de novo.`);
    }
    const body = (await res.json()) as any;
    const text: string = body?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
    let parsed: any;
    try { parsed = JSON.parse(text.replace(/^```json\s*|```$/g, "")); } catch { return fail("A IA respondeu de um jeito inesperado. Tente de novo."); }
    if (parsed?.type === "desconhecido" || !["cronograma", "material"].includes(parsed?.type)) {
      await sb.from("dumps").update({ status: "error", doc_type: "desconhecido", result: parsed, error: "Não parece um cronograma nem material de estudo." }).eq("id", data.id).eq("status", "analyzing");
      return { ok: false as const, error: "Não parece um cronograma nem material de estudo." };
    }
    await sb.from("dumps").update({ status: "review", doc_type: parsed.type, result: parsed, error: null }).eq("id", data.id).eq("status", "analyzing");
    return { ok: true as const };
  });

// ---------------------------------------------------------------------------
// Comandos em texto na Área de despejo
// Ex.: "prova de DS adiada uma semana", "não quero estudar cálculo hoje",
// "quero ir pra academia 3x na semana". A IA devolve uma resposta curta e uma
// lista de ações que o usuário confirma antes de aplicar.
// ---------------------------------------------------------------------------

const TZ = "America/Sao_Paulo";
// Mesmo critério de isExtraAssessment (src/lib/data.ts): finais, 2ª chamada, reposição
const isExtra = (a: { kind: string; name: string }) => a.kind === "extra" || /\bfina(l|is)\b|segunda chamada|2[ªa]\.?\s*chamada|reposi[cç][aã]o/i.test(a.name);
const isoDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const localDateTime = (iso: string) => {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d);
  const wd = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "short" }).format(d);
  return `${isoDay(d)} (${wd}) ${time}`;
};

function textPrompt(text: string, ctx: string, now: string, today: string) {
  return `Você é o assistente do CITidiano, um planejador para universitários brasileiros que também fazem outras coisas (empresa júnior CITi, estágio, academia).
Agora é ${now} (fuso de Brasília). Hoje é ${today}.

O usuário escreveu na Área de despejo:
"""${text}"""

Agenda e dados do usuário (use SOMENTE estes ids; nunca invente ids):
${ctx}

Decida o que fazer e responda SOMENTE com JSON válido, sem markdown, no formato:
{
  "reply": "resposta curta em português (no máximo 3 frases), amigável, explicando o PORQUÊ das sugestões",
  "actions": [ ...zero ou mais ações abaixo... ]
}

Ações possíveis (cada uma com "label": frase curta descrevendo a ação, ex.: "Mover Prova 2 de DS para 26/11"):
- {"type":"create_event","label":string,"title":string,"kind":"prova"|"entrega"|"citi"|"reuniao"|"estudo"|"treino"|"outro","date":"YYYY-MM-DD","time":"HH:MM","subject_id":string|null}
- {"type":"move_event","label":string,"event_id":string,"date":"YYYY-MM-DD","time":"HH:MM"}
- {"type":"delete_event","label":string,"event_id":string}
- {"type":"create_assessment","label":string,"subject_id":string,"name":string,"date":"YYYY-MM-DD","kind":"prova"|"mini-prova"|"entrega"|"seminario"|"extra","topics":string|null}
- {"type":"move_assessment","label":string,"assessment_id":string,"date":"YYYY-MM-DD"}
- {"type":"create_goal","label":string,"title":string,"kind":"weekly"|"hours","times_per_week":number|null,"target_hours":number|null,"subject_id":string|null,"deadline":"YYYY-MM-DD"|null}
- {"type":"move_suggestion","label":string,"ref":string,"date":"YYYY-MM-DD"}   (mover uma sugestão do plano da semana para outro dia da mesma semana)
- {"type":"remove_suggestion","label":string,"ref":string}
- {"type":"add_suggestion","label":string,"date":"YYYY-MM-DD","title":string,"suggestion_type":"estudo"|"treino"|"descanso"|"citi"|"outro","subject_id":string|null,"note":string|null}   (nova sugestão no plano da semana, sem ir para o calendário)

Regras:
- Se o usuário falar de algo que está nas "Sugestões do plano da semana" (ex.: "muda a academia de quarta para quinta", "tira o estudo de sábado"), use move_suggestion/remove_suggestion com o ref da lista. NÃO crie evento no calendário para isso: continua sendo sugestão. Só crie eventos quando for um compromisso novo com dia definido.
- Avaliações marcadas [extra] são finais, segunda chamada ou reposição: só acontecem para quem precisa. Quando o usuário perguntar sobre "provas" (próxima, última, quantas), considere só as regulares; cite as extras à parte, se for útil.
- Perguntas sobre a agenda ("quando é minha próxima prova?", "o que tenho essa semana?"): responda com datas e dias da semana a partir dos dados acima, sem propor ações.
- Datas relativas ("sexta que vem", "adiada uma semana", "amanhã") são calculadas a partir de hoje ou da data atual do item.
- Avisos de mudança ("prova adiada", "professor passou atividade para sexta") viram move_*/create_* sobre os itens existentes. Demandas, reuniões e entregas do CITi/empresa júnior usam kind "citi".
- Se o usuário não quer estudar algo hoje: veja se há prova dessa disciplina nos próximos dias. Se a prova estiver longe, aceite e redistribua (mova os eventos de estudo de hoje ou crie sessões em outros dias). Se estiver perto (até 4 dias), negocie com gentileza: sugira uma sessão curta hoje e o resto depois, explicando o motivo.
- Metas de rotina (academia, leitura etc.) viram create_goal. Ao distribuir treinos, prefira dias com menos provas/compromissos e diga isso na resposta (ex.: "4x nesta semana porque a próxima tem 2 provas").
- Dúvidas simples de rotina ou treino: responda de forma geral e prática; se fizer sentido, sugira um horário (create_event kind "treino"). Se houver dor ou lesão, recomende procurar um profissional. Não monte planos de treino detalhados.
- Se o pedido for ambíguo (ex.: não dá para saber qual prova), pergunte na "reply" e não proponha ações.
- Nunca proponha ações sobre ids que não estão na lista. No máximo 8 ações.`;
}

export const interpretText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (typeof d?.id !== "string") throw new Error("id inválido");
    return d;
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const fail = async (msg: string) => {
      await sb.from("dumps").update({ status: "error", error: msg }).eq("id", data.id).eq("status", "analyzing");
      return { ok: false as const, error: msg };
    };
    const { data: dump } = await sb.from("dumps").select("*").eq("id", data.id).single();
    if (!dump) return { ok: false as const, error: "Item não encontrado." };
    const text = String((dump.result as any)?.text ?? dump.file_name).slice(0, 1000);
    // Sugestões do plano da semana (vêm do navegador junto com a mensagem)
    const planInfo = (dump.result as any)?.plan as { week: string; items: { ref: string; date: string; title: string; type: string }[] } | undefined;
    const planItems = Array.isArray(planInfo?.items) ? planInfo!.items.slice(0, 40) : [];
    const fromPlanBox = (dump.result as any)?.source === "plano"; // escrito na caixa de ajustes do plano
    const key = process.env["GEMINI_API_KEY"];
    if (!key) return fail("A chave da IA não está configurada.");

    const now = new Date();
    const today = isoDay(now);
    const from = isoDay(new Date(now.getTime() - 14 * 864e5));
    const to = isoDay(new Date(now.getTime() + 150 * 864e5));
    const [{ data: subjects }, { data: assessments }, { data: events }, { data: goals }] = await Promise.all([
      sb.from("subjects").select("id,name"),
      sb.from("assessments").select("id,name,date,kind,subject_id").gte("date", from).lte("date", to).order("date"),
      sb.from("events").select("id,title,kind,starts_at,subject_id").gte("starts_at", new Date(now.getTime() - 864e5).toISOString()).lte("starts_at", new Date(now.getTime() + 60 * 864e5).toISOString()).order("starts_at"),
      sb.from("goals").select("id,title,kind,times_per_week,target_hours,deadline,subject_id"),
    ]);
    const sName = (id: string | null) => (subjects ?? []).find((s) => s.id === id)?.name ?? "";
    const ctx = [
      "Disciplinas:", ...((subjects ?? []).map((s) => `- ${s.id}: ${s.name}`)), (subjects ?? []).length ? "" : "(nenhuma)",
      "Avaliações:", ...((assessments ?? []).map((a) => `- ${a.id}: ${a.date} [${isExtra(a) ? "extra" : a.kind}] ${a.name} — ${sName(a.subject_id)}`)), (assessments ?? []).length ? "" : "(nenhuma)",
      "Compromissos (próximos 60 dias):", ...((events ?? []).map((e) => `- ${e.id}: ${localDateTime(e.starts_at)} [${e.kind}] ${e.title}${e.subject_id ? ` — ${sName(e.subject_id)}` : ""}`)), (events ?? []).length ? "" : "(nenhum)",
      "Metas flexíveis:", ...((goals ?? []).map((g) => `- ${g.id}: ${g.title} (${g.kind === "weekly" ? `${g.times_per_week}x/semana` : `${g.target_hours}h`})`)), (goals ?? []).length ? "" : "(nenhuma)",
      "Sugestões do plano da semana (NÃO estão no calendário; são só sugestões da IA):", ...planItems.map((p) => `- ${p.ref}: ${p.date} [${p.type}] ${p.title}`), planItems.length ? "" : "(nenhuma)",
    ].join("\n");
    const nowLabel = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(now);

    let res: Response;
    try {
      const hint = fromPlanBox && planInfo?.week
        ? `\n\nIMPORTANTE: esta mensagem foi escrita na caixa "ajustar o plano da semana" (semana que começa em ${planInfo.week}). Ajustes de estudo, treino, descanso e rotina devem ser feitos no PLANO com move_suggestion, remove_suggestion e add_suggestion (datas dentro dessa semana), não no calendário. Só use ações de calendário se o usuário informar um compromisso real e novo (prova, entrega, reunião).`
        : "";
      res = await callGemini(key, {
        contents: [{ role: "user", parts: [{ text: textPrompt(text, ctx, nowLabel, today) + hint }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.3, thinkingConfig: { thinkingLevel: "low" } },
      }, 15_000);
    } catch (e) {
      console.error(e);
      return fail("Não consegui falar com a IA. Tente de novo em instantes.");
    }
    if (!res.ok) {
      console.error("Gemini", res.status, await res.text());
      if (res.status === 429 || res.status === 503) return fail("A IA do Google está sobrecarregada agora. Tente de novo em um minuto.");
      if (res.status === 504) return fail("A IA demorou demais para responder. Tente de novo em instantes.");
      if (res.status === 403 || res.status === 401) return fail("A chave da IA foi recusada. Verifique a chave do Gemini.");
      return fail(`A IA teve um problema ao entender sua mensagem (erro ${res.status}). Tente de novo.`);
    }
    const body = (await res.json()) as any;
    const out: string = body?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
    let parsed: any;
    try { parsed = JSON.parse(out.replace(/^```json\s*|```$/g, "")); } catch { return fail("A IA respondeu de um jeito inesperado. Tente de novo."); }
    const actions = Array.isArray(parsed?.actions) ? parsed.actions.slice(0, 8) : [];
    await sb.from("dumps").update({ status: "review", doc_type: "texto", result: { text, reply: String(parsed?.reply ?? ""), actions, plan: planInfo ?? null }, error: null }).eq("id", data.id).eq("status", "analyzing");
    return { ok: true as const };
  });

// ---------------------------------------------------------------------------
// Plano da semana (Painel)
// A IA olha a semana pedida + as duas seguintes e monta um quadro de segunda a
// domingo: compromissos fixos (provas, entregas, CITi) e sugestões de estudo,
// treino e descanso, cada uma com o motivo. Ainda sem horários.
// ---------------------------------------------------------------------------

export type PlanItem = { title: string; type: "prova" | "entrega" | "citi" | "estudo" | "treino" | "descanso" | "outro"; fixed: boolean; subject_id: string | null; note: string | null; edited?: boolean };
type KeepItem = { date: string; title: string; type: string; subject_id: string | null; note: string | null };
// Metas de atividade física (para conferir quantos treinos o plano sugere)
const PHYSICAL_RE = /academia|treino|muscula|pelada|futebol|corrida|correr|nata[cç][aã]o|esporte|exerc[ií]cio f[ií]sico|caminhada|bike|pedal|luta|crossfit|yoga|pilates/i;
const normTitle = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
export type PlanDay = { date: string; load: "leve" | "media" | "pesada"; items: PlanItem[] };
export type WeekPlan = { headline: string; recommendations: { title: string; reason: string }[]; days: PlanDay[] };

const PLAN_TYPES = ["prova", "entrega", "citi", "estudo", "treino", "descanso", "outro"];
const addDaysIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function planPrompt(weekStart: string, today: string, ctx: string, keep: KeepItem[]) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i));
  return `Você é o assistente do CITidiano, um planejador para universitários que também fazem empresa júnior (CITi), estágio e academia.
Hoje é ${today}. Monte o plano da semana de ${days[0]} (segunda) a ${days[6]} (domingo).

Dados do usuário (próximas 3 semanas a partir de ${days[0]}):
${ctx}

Responda SOMENTE com JSON válido, sem markdown:
{
  "headline": "uma frase curta resumindo a semana (ex.: 'Semana pesada: 2 provas — foco em Álgebra até quarta')",
  "recommendations": [{"title": "ação curta", "reason": "por quê, em uma frase, citando datas/provas"}],
  "days": [{"date": "YYYY-MM-DD", "load": "leve"|"media"|"pesada", "items": [{"title": string, "type": "prova"|"entrega"|"citi"|"estudo"|"treino"|"descanso"|"outro", "fixed": boolean, "subject_id": string|null, "note": string|null}]}]
}

Regras:
- "days" tem exatamente 7 dias, nas datas ${days.join(", ")}, nessa ordem.
- Itens fixed=true são SOMENTE compromissos que existem nos dados desta semana (provas, mini-provas, entregas, listas, demandas do CITi, reuniões, treinos/estudos já marcados). Nunca invente compromissos fixos. Não inclua aulas.
- Avaliações [extra] (final, 2ª chamada) entram como fixed com note "Só se precisar".
- Itens fixed=false são suas sugestões: blocos de estudo antes das provas (comece com antecedência, aumente perto da prova, cite os assuntos cobrados quando houver), treinos para cumprir as metas semanais, tempo para demandas do CITi antes dos prazos, e descanso.
- Treinos e esportes já marcados na agenda (compromissos [treino], ex.: pelada, futebol, corrida) CONTAM para metas de atividade física da mesma semana: se a meta é academia 3x e já há 1 pelada marcada, sugira só mais 2. Diga isso na recomendação.
- Distribua as metas semanais (ex.: academia 3x) olhando também as semanas seguintes: se a próxima semana for pesada, adiante treinos nesta; em dias de prova, prefira descanso ou treino leve. Explique isso nas recomendações.
- Não coloque sugestões em dias que já passaram (antes de ${today}); neles, mantenha só os fixos.
- No máximo 4 itens por dia. Deixe pelo menos um dia leve. "note" curta (até 80 caracteres) explicando o motivo da sugestão; null nos fixos sem observação.
- "subject_id" só com ids da lista de disciplinas; null quando não se aplica.
- "recommendations": de 2 a 4 itens, os mais importantes da semana.
- CONSISTÊNCIA: o quadro e as recomendações precisam dizer a mesma coisa. Se a recomendação diz "academia 2x", o quadro tem exatamente 2 sugestões de academia. Confira antes de responder.${keep.length ? `

Sugestões que o usuário já ajustou à mão (elas serão mantidas exatamente nesses dias; NÃO as repita no JSON e planeje o resto em volta delas, contando-as nas metas):
${keep.map((k) => `- ${k.date} [${k.type}] ${k.title}`).join("\n")}` : ""}`;
}

export const planWeek = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { weekStart: string; keep?: KeepItem[] }) => {
    if (typeof d?.weekStart !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.weekStart)) throw new Error("semana inválida");
    const keep = (Array.isArray(d.keep) ? d.keep : []).slice(0, 30).filter((k) => k && typeof k.title === "string" && typeof k.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k.date));
    return { weekStart: d.weekStart, keep };
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const key = process.env["GEMINI_API_KEY"];
    if (!key) return { ok: false as const, error: "A chave da IA não está configurada." };

    const from = data.weekStart;
    const to = addDaysIso(from, 20);
    const [{ data: subjects }, { data: assessments }, { data: events }, { data: goals }] = await Promise.all([
      sb.from("subjects").select("id,name"),
      sb.from("assessments").select("id,name,date,kind,subject_id,topics").gte("date", from).lte("date", to).order("date"),
      sb.from("events").select("id,title,kind,starts_at,subject_id").gte("starts_at", `${from}T00:00:00-03:00`).lte("starts_at", `${to}T23:59:59-03:00`).order("starts_at"),
      sb.from("goals").select("id,title,kind,times_per_week,target_hours,deadline,subject_id,done"),
    ]);
    const sName = (id: string | null) => (subjects ?? []).find((s) => s.id === id)?.name ?? "";
    const ctx = [
      "Disciplinas:", ...((subjects ?? []).map((s) => `- ${s.id}: ${s.name}`)),
      "", "Avaliações:", ...((assessments ?? []).map((a) => `- ${a.date} [${isExtra(a) ? "extra" : a.kind}] ${a.name} — ${sName(a.subject_id)} (subject_id ${a.subject_id})${a.topics ? ` — assuntos: ${a.topics}` : ""}`)),
      "", "Compromissos:", ...((events ?? []).filter((e) => e.kind !== "feriado").map((e) => `- ${localDateTime(e.starts_at)} [${e.kind}] ${e.title}${e.subject_id ? ` — ${sName(e.subject_id)} (subject_id ${e.subject_id})` : ""}`)),
      "", "Feriados/dias sem aula:", ...((events ?? []).filter((e) => e.kind === "feriado").map((e) => `- ${isoDay(new Date(e.starts_at))} ${e.title}`)),
      "", "Metas flexíveis:", ...((goals ?? []).map((g) => `- ${g.title}: ${g.kind === "weekly" ? `${g.times_per_week}x por semana` : `${g.target_hours}h no total${g.deadline ? ` até ${g.deadline}` : ""} (feito: ${g.done}h)`}${g.subject_id ? ` — ${sName(g.subject_id)}` : ""}`)),
    ].join("\n");

    let res: Response;
    try {
      res = await callGemini(key, {
        contents: [{ role: "user", parts: [{ text: planPrompt(from, isoDay(new Date()), ctx, data.keep) }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.4, thinkingConfig: { thinkingLevel: "low" } },
      });
    } catch (e) {
      console.error(e);
      return { ok: false as const, error: "Não consegui falar com a IA. Tente de novo em instantes." };
    }
    if (!res.ok) {
      console.error("Gemini", res.status, await res.text());
      if (res.status === 429 || res.status === 503) return { ok: false as const, error: "A IA do Google está sobrecarregada agora. Tente de novo em um minuto." };
      if (res.status === 504) return { ok: false as const, error: "A IA demorou demais para responder. Tente de novo em instantes." };
      return { ok: false as const, error: `A IA teve um problema ao montar seu plano (erro ${res.status}).` };
    }
    const body = (await res.json()) as any;
    const out: string = body?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
    let parsed: any;
    try { parsed = JSON.parse(out.replace(/^```json\s*|```$/g, "")); } catch { return { ok: false as const, error: "A IA respondeu de um jeito inesperado. Tente de novo." }; }

    // Limpa a resposta: sempre 7 dias na ordem certa, tipos válidos, ids existentes
    const validSubject = (id: unknown) => (typeof id === "string" && (subjects ?? []).some((s) => s.id === id) ? id : null);
    const today = isoDay(new Date());
    const days: PlanDay[] = Array.from({ length: 7 }, (_, i) => {
      const date = addDaysIso(from, i);
      const past = date < today; // dias que já passaram: só compromissos fixos, nunca sugestões
      const d = (Array.isArray(parsed?.days) ? parsed.days : []).find((x: any) => x?.date === date) ?? {};
      const items: PlanItem[] = (Array.isArray(d.items) ? d.items : []).slice(0, 5).filter((it: any) => it && typeof it.title === "string" && (!past || it.fixed)).map((it: any) => ({
        title: String(it.title).slice(0, 80),
        type: PLAN_TYPES.includes(it.type) ? it.type : "outro",
        fixed: !!it.fixed,
        subject_id: validSubject(it.subject_id),
        note: typeof it.note === "string" && it.note.trim() ? it.note.slice(0, 120) : null,
      }));
      // Sugestões ajustadas pelo usuário voltam exatamente para o dia escolhido (e tiram duplicatas da IA nesse dia)
      const kept: PlanItem[] = data.keep.filter((k) => k.date === date).map((k) => ({ title: k.title.slice(0, 80), type: (PLAN_TYPES.includes(k.type) ? k.type : "outro") as PlanItem["type"], fixed: false, subject_id: validSubject(k.subject_id), note: k.note ? String(k.note).slice(0, 120) : null, edited: true }));
      const keptTitles = new Set(kept.map((k) => normTitle(k.title)));
      const merged = [...items.filter((it) => it.fixed || !keptTitles.has(normTitle(it.title))), ...kept];
      return { date, load: ["leve", "media", "pesada"].includes(d.load) ? d.load : "media", items: merged };
    });

    // Treinos: fixos + ajustados pelo usuário + sugeridos pela IA não podem passar da meta semanal
    const target = (goals ?? []).filter((g) => g.kind === "weekly" && PHYSICAL_RE.test(g.title)).reduce((n, g) => n + (g.times_per_week ?? 0), 0);
    if (target > 0) {
      const all = days.flatMap((d) => d.items);
      let allowed = Math.max(0, target - all.filter((it) => it.type === "treino" && (it.fixed || it.edited)).length);
      for (const d of days) {
        d.items = d.items.filter((it) => {
          if (it.type !== "treino" || it.fixed || it.edited) return true;
          if (allowed > 0) { allowed--; return true; }
          return false;
        });
      }
    }
    const plan: WeekPlan = {
      headline: String(parsed?.headline ?? "").slice(0, 160),
      recommendations: (Array.isArray(parsed?.recommendations) ? parsed.recommendations : []).slice(0, 4).filter((r: any) => r?.title).map((r: any) => ({ title: String(r.title).slice(0, 100), reason: String(r.reason ?? "").slice(0, 220) })),
      days,
    };
    return { ok: true as const, plan };
  });
