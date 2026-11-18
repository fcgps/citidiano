import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Apaga a conta do usuário logado e todos os dados dele.
// As tabelas não têm ligação direta com a conta (auth.users), então os dados são
// apagados um a um antes; depois o login é removido com a chave de serviço (só no servidor).
export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { confirm: string }) => {
    if (d?.confirm !== "APAGAR") throw new Error("Confirmação inválida.");
    return d;
  })
  .handler(async ({ context }) => {
    const sb = context.supabase; // cliente do próprio usuário: só enxerga as linhas dele
    const userId = context.userId;

    // 1) Arquivos guardados (materiais e itens da Área de despejo)
    const [{ data: mats }, { data: dumps }] = await Promise.all([
      sb.from("materials").select("path"),
      sb.from("dumps").select("path"),
    ]);
    const paths = [...new Set([...(mats ?? []), ...(dumps ?? [])].map((r) => r.path).filter(Boolean))];
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await supabaseAdmin.storage.from("materiais").remove(paths.slice(i, i + 100));
      if (error) console.error("Apagar arquivos:", error.message);
    }

    // 2) Dados do app (ordem: o que depende de disciplinas antes das disciplinas)
    const tables = ["dumps", "materials", "topics", "assessments", "events", "goals", "schedule_slots", "week_plans", "subjects"] as const;
    for (const t of tables) {
      const { error } = await sb.from(t).delete().eq("user_id", userId);
      if (error) return { ok: false as const, error: `Não consegui apagar seus dados (${t}). Nada da conta foi removido.` };
    }

    // 3) O login
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      console.error("Apagar usuário:", error.message);
      return { ok: false as const, error: "Seus dados foram apagados, mas não consegui remover o login. Tente de novo." };
    }
    return { ok: true as const };
  });
