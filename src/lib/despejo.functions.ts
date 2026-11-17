import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MODEL = "gemini-3.5-flash";
// Modelo reserva, usado quando o principal está sobrecarregado (erros 500/503)
const FALLBACK_MODEL = "gemini-3.5-flash-lite";
// thinkingLevel "low": a IA "pensa" menos antes de responder → respostas bem mais rápidas.
// (O padrão do 3.5 Flash é "medium", que pode demorar demais para um planejador.)

// As atualizações de status abaixo usam .eq("status", "analyzing"): se o usuário
// cancelou a análise no meio, o resultado da IA é simplesmente ignorado.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Chama o Gemini tentando de novo sozinho quando o Google está instável, sem
// deixar o usuário esperando demais: cada tentativa tem no máximo 25 s e o total
// fica em torno de 45 s. 429/500/503 ou demora → tenta de novo; depois, o modelo reserva.
const ATTEMPT_MS = 25_000;
const TOTAL_MS = 45_000;

async function callGemini(key: string, body: unknown): Promise<Response> {
  const started = Date.now();
  const timeout = () => new Response(JSON.stringify({ error: "timeout" }), { status: 504 });
  const attempt = async (model: string) => {
    const left = TOTAL_MS - (Date.now() - started);
    if (left < 3_000) return timeout();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), Math.min(ATTEMPT_MS, left));
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
  let res = await attempt(MODEL);
  if (!transient(res)) return res;
  await sleep(1500);
  res = await attempt(MODEL);
  if (!transient(res) || res.status === 429) return res;
  const alt = await attempt(FALLBACK_MODEL);
  return alt.ok || alt.status !== 404 ? alt : res;
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

Regras:
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
    ].join("\n");
    const nowLabel = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(now);

    let res: Response;
    try {
      res = await callGemini(key, {
        contents: [{ role: "user", parts: [{ text: textPrompt(text, ctx, nowLabel, today) }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.3, thinkingConfig: { thinkingLevel: "low" } },
      });
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
    await sb.from("dumps").update({ status: "review", doc_type: "texto", result: { text, reply: String(parsed?.reply ?? ""), actions }, error: null }).eq("id", data.id).eq("status", "analyzing");
    return { ok: true as const };
  });
