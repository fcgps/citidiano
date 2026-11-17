// Contas salvas neste navegador, para trocar de conta sem digitar a senha de novo.
// Guardamos a sessão de cada conta (como o próprio Supabase já faz com a conta atual).
import type { Session } from "@supabase/supabase-js";

export type SavedAccount = { user_id: string; email: string; access_token: string; refresh_token: string };
const KEY = "citidiano.contas";

export function listAccounts(): SavedAccount[] {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
}

function save(list: SavedAccount[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 5))); } catch { /* ignora */ }
}

// Chamado sempre que o Supabase entrega uma sessão nova (login ou token renovado)
export function rememberSession(session: Session) {
  const acc: SavedAccount = { user_id: session.user.id, email: session.user.email ?? "Conta", access_token: session.access_token, refresh_token: session.refresh_token };
  save([acc, ...listAccounts().filter((a) => a.user_id !== acc.user_id)]);
}

export function forgetAccount(userId: string) {
  save(listAccounts().filter((a) => a.user_id !== userId));
}

// Dados guardados por navegador que são de uma conta só (plano da semana, filtros)
export function clearPerAccountCache() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith("citidiano.plano.") || k === "citidiano.calendario.filtros").forEach((k) => localStorage.removeItem(k));
  } catch { /* ignora */ }
}
