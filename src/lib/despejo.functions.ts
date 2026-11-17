import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MODEL = "gemini-2.5-flash";

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
    "assessments": [{"name": string, "date": "YYYY-MM-DD"|null, "kind": "prova"|"mini-prova"|"entrega"|"seminario", "topics": string|null, "conflict": null | {"note": string, "options": ["YYYY-MM-DD", ...]}}],
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
Regras: datas sem ano assumem o semestre atual (ano de hoje; se o mês já passou muito e o documento parece do próximo semestre, use o ano coerente). Use null para o que não estiver no documento — nunca invente. Se a mesma avaliação aparecer com datas diferentes, preencha "conflict" com as opções e coloque em "date" a mais provável. Assuntos cobrados em "topics" como texto curto.`;
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
      await sb.from("dumps").update({ status: "error", error: msg }).eq("id", data.id);
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
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [
            { inline_data: { mime_type: dump.mime || file.type, data: toBase64(await file.arrayBuffer()) } },
            { text: prompt(today, catalog) },
          ] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
        }),
      });
    } catch (e) {
      console.error(e);
      return fail("Não consegui falar com a IA. Tente de novo em instantes.");
    }
    if (!res.ok) {
      console.error("Gemini", res.status, await res.text());
      if (res.status === 429) return fail("A IA está sobrecarregada agora. Tente de novo em um minuto.");
      if (res.status === 400) return fail("A IA não conseguiu ler este arquivo. Ele pode estar corrompido ou ser grande demais.");
      if (res.status === 403 || res.status === 401) return fail("A chave da IA foi recusada. Verifique a chave do Gemini.");
      return fail("A IA teve um problema ao analisar o arquivo. Tente de novo.");
    }
    const body = (await res.json()) as any;
    const text: string = body?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
    let parsed: any;
    try { parsed = JSON.parse(text.replace(/^```json\s*|```$/g, "")); } catch { return fail("A IA respondeu de um jeito inesperado. Tente de novo."); }
    if (parsed?.type === "desconhecido" || !["cronograma", "material"].includes(parsed?.type)) {
      await sb.from("dumps").update({ status: "error", doc_type: "desconhecido", result: parsed, error: "Não parece um cronograma nem material de estudo." }).eq("id", data.id);
      return { ok: false as const, error: "Não parece um cronograma nem material de estudo." };
    }
    await sb.from("dumps").update({ status: "review", doc_type: parsed.type, result: parsed, error: null }).eq("id", data.id);
    return { ok: true as const };
  });
