import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — CITidiano" },
      { name: "description", content: "Entre ou crie sua conta no CITidiano." },
      { property: "og:title", content: "Entrar — CITidiano" },
      { property: "og:description", content: "Entre ou crie sua conta no CITidiano." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Link de confirmação que falhou (expirado, já usado ou de um e-mail antigo): o sistema de
    // login avisa no endereço (#error=...&error_code=otp_expired). Antes isso era ignorado.
    try {
      const params = new URLSearchParams((window.location.hash || "").replace(/^#/, "") || window.location.search);
      const code = params.get("error_code") ?? params.get("error");
      if (code) {
        setMode("login");
        setUnconfirmed(true);
        toast.error(/expired|otp/i.test(code) || /expired/i.test(params.get("error_description") ?? "")
          ? "Esse link de confirmação expirou ou já foi usado. Digite seu e-mail abaixo e clique em \"Reenviar e-mail de confirmação\"; use sempre o e-mail mais recente."
          : "Não consegui confirmar seu e-mail por esse link. Peça um novo abaixo.");
        window.history.replaceState(null, "", window.location.pathname);
      }
    } catch { /* ignora */ }
    supabase.auth.getUser().then(({ data }) => data.user && navigate({ to: "/painel" }));
    // Quem chega pelo link de confirmação do e-mail entra sozinho assim que a sessão é lida da URL
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) navigate({ to: "/painel" });
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  async function resend() {
    const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: window.location.origin + "/auth" } });
    if (error) toast.error(/rate|limit/i.test(error.message) ? "Muitos e-mails enviados. Espere alguns minutos e tente de novo." : error.message);
    else toast.success("Enviamos um novo link de confirmação. Confira também o spam.");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) { toast.error("A senha precisa ter pelo menos 6 caracteres."); return; }
    setLoading(true);
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (error) {
        // Mostra o motivo real (antes, todo erro virava "e-mail ou senha inválidos")
        const msg = `${(error as { code?: string }).code ?? ""} ${error.message}`;
        if (/not.?confirmed/i.test(msg)) { setUnconfirmed(true); toast.error("Seu e-mail ainda não foi confirmado. Abra o link que enviamos ou peça um novo abaixo."); }
        else if (/rate|limit|too many/i.test(msg)) toast.error("Muitas tentativas seguidas. Espere alguns minutos e tente de novo.");
        else if (/invalid|credentials/i.test(msg)) toast.error("E-mail ou senha incorretos. Use o olho para conferir a senha.");
        else toast.error(error.message);
        return;
      }
      navigate({ to: "/painel" });
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + "/auth" } });
      setLoading(false);
      if (error) { toast.error(error.message); return; }
      if (data.session) navigate({ to: "/painel" }); else setSent(true);
    }
  }

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      {/* Metade verde: "papel de parede" com a logo repetida, inclinada e bem suave */}
      <div className="relative hidden overflow-hidden bg-gradient-primary md:block" aria-hidden>
        <div
          className="absolute -inset-1/2 -rotate-[18deg] opacity-25"
          style={{ backgroundImage: "url(/logo-padrao.png)", backgroundSize: "380px 200px", backgroundRepeat: "repeat" }}
        />
      </div>
      <div className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          {mode === "signup" && <p className="eyebrow mb-3">Crie sua conta</p>}
          {mode === "login" ? (
            <h1 className="flex flex-wrap items-center gap-x-3 gap-y-2 text-4xl font-light">Entrar no <Logo size="h-12" /></h1>
          ) : (
            <h1 className="text-4xl font-light">Comece seu <strong className="font-bold">planejamento</strong></h1>
          )}
          {sent ? (
            <div className="mt-8 rounded-xl border bg-accent p-5 text-sm text-accent-foreground">
              Enviamos um link de confirmação para <strong>{email}</strong>. Confirme seu e-mail para entrar.
            </div>
          ) : (
            <form onSubmit={submit} className="mt-8 space-y-4">
              <div className="space-y-1.5"><Label htmlFor="email">E-mail</Label><Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="pw">Senha</Label>
                <div className="relative">
                  <Input id="pw" type={showPw ? "text" : "password"} required value={password} onChange={(e) => setPassword(e.target.value)} className="pr-11" autoComplete={mode === "login" ? "current-password" : "new-password"} />
                  <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground" aria-label={showPw ? "Esconder senha" : "Mostrar senha"} title={showPw ? "Esconder senha" : "Mostrar senha"}>
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" disabled={loading} className="h-11 w-full rounded-full font-semibold shadow-glow">{loading ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar conta"}</Button>
              {unconfirmed && mode === "login" && (
                <button type="button" onClick={resend} className="w-full text-center text-sm font-semibold text-primary-deep hover:underline">Reenviar e-mail de confirmação</button>
              )}
            </form>
          )}
          <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setSent(false); }} className="mt-6 text-sm text-muted-foreground">
            {mode === "login" ? <>Não tem conta? <span className="font-semibold text-primary-deep">Cadastre-se</span></> : <>Já tem conta? <span className="font-semibold text-primary-deep">Entrar</span></>}
          </button>
        </div>
      </div>
    </div>
  );
}
