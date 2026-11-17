import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => data.user && navigate({ to: "/painel" }));
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) { toast.error("A senha precisa ter pelo menos 6 caracteres."); return; }
    setLoading(true);
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (error) { toast.error("E-mail ou senha inválidos."); return; }
      navigate({ to: "/painel" });
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + "/painel" } });
      setLoading(false);
      if (error) { toast.error(error.message); return; }
      if (data.session) navigate({ to: "/painel" }); else setSent(true);
    }
  }

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-gradient-primary p-12 md:flex md:flex-col md:justify-between">
        <Link to="/"><span className="text-xl font-extrabold text-primary-foreground">CITidiano</span></Link>
        <div>
          <p className="mb-4 font-mono text-xs uppercase tracking-[0.16em] text-primary-foreground/80">Faculdade · EJ · Estágio · Academia</p>
          <h2 className="text-5xl font-light leading-tight text-primary-foreground">Menos caos, <strong className="font-extrabold">mais rotina.</strong></h2>
        </div>
      </div>
      <div className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <Link to="/" className="md:hidden"><Logo /></Link>
          <p className="eyebrow mb-3 mt-8 md:mt-0">{mode === "login" ? "Bem-vindo de volta" : "Crie sua conta"}</p>
          <h1 className="text-4xl font-light">{mode === "login" ? <>Entrar no <strong className="font-bold">CITidiano</strong></> : <>Comece seu <strong className="font-bold">planejamento</strong></>}</h1>
          {sent ? (
            <div className="mt-8 rounded-xl border bg-accent p-5 text-sm text-accent-foreground">
              Enviamos um link de confirmação para <strong>{email}</strong>. Confirme seu e-mail para entrar.
            </div>
          ) : (
            <form onSubmit={submit} className="mt-8 space-y-4">
              <div className="space-y-1.5"><Label htmlFor="email">E-mail</Label><Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="pw">Senha</Label><Input id="pw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
              <Button type="submit" disabled={loading} className="h-11 w-full rounded-full font-semibold shadow-glow">{loading ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar conta"}</Button>
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
