# Prompts guardados para o Lovable

Prompts prontos para colar no chat do Lovable quando houver créditos.
Pela regra do projeto (AGENTS.md), mudanças no banco de dados são feitas pelo Lovable.

---

## 1. Sincronizar o plano da semana entre aparelhos

**Por quê:** hoje o plano da semana (e os ajustes feitos nele) fica guardado só no
navegador (`src/lib/plan-cache.ts`, via localStorage). No celular ou em outro
navegador, o plano é gerado de novo e os ajustes se perdem.

**Depois que o Lovable criar a tabela:** trocar `readPlan`/`writePlan` em
`src/lib/plan-cache.ts` para ler e gravar na tabela `week_plans` (o resto do app
já usa só essas funções).

**Prompt (copiar a partir daqui):**

```
Crie APENAS uma tabela nova no banco de dados, sem alterar nenhuma tela nem código do app (eu adapto o código depois).

Tabela public.week_plans — guarda o plano da semana gerado pela IA para cada usuário:
- id uuid primary key default gen_random_uuid()
- user_id uuid not null default auth.uid()
- week_start date not null  (segunda-feira da semana)
- plan jsonb not null  (o plano: headline, recommendations e days)
- sig text not null default ''  (assinatura da agenda usada para gerar o plano)
- generated_at timestamptz not null default now()
- updated_at timestamptz not null default now()
- restrição única em (user_id, week_start)

Segurança: habilite RLS e crie uma política para que cada usuário só leia, crie, altere e apague as próprias linhas (auth.uid() = user_id), com os mesmos GRANTs das outras tabelas do app (authenticated e service_role).

Depois, atualize os tipos do Supabase do projeto (src/integrations/supabase/types.ts) para incluir a tabela.
```
