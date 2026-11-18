# Prompts guardados para o Lovable

Pela regra do projeto (AGENTS.md), mudanças no banco de dados são feitas pelo Lovable.
Todo o resto é feito direto no código.

---

## Último prompt: tabelas do plano da semana e da grade semanal

**Por quê:**
- `week_plans`: hoje o plano da semana (e os ajustes nele) fica só no navegador
  (`src/lib/plan-cache.ts`). Com a tabela, ele acompanha o usuário no celular.
- `schedule_slots`: grade semanal fixa (aulas e compromissos que se repetem toda
  semana, com horário). Base para o plano passar a sugerir horários livres.

**Depois que o Lovable criar:** `git pull`. O código do app é adaptado fora do
Lovable (`plan-cache.ts` passa a usar `week_plans`; nova tela da grade usa `schedule_slots`).

**Prompt (copiar a partir daqui):**

```
Crie APENAS duas tabelas novas no banco de dados. Não altere nenhuma tela, componente ou código do app: eu adapto o código depois.

1) public.week_plans — plano da semana gerado pela IA, um por usuário e semana:
- id uuid primary key default gen_random_uuid()
- user_id uuid not null default auth.uid()
- week_start date not null   (segunda-feira da semana)
- plan jsonb not null
- sig text not null default ''
- generated_at timestamptz not null default now()
- updated_at timestamptz not null default now()
- unique (user_id, week_start)

2) public.schedule_slots — grade semanal fixa (aulas e compromissos que se repetem toda semana):
- id uuid primary key default gen_random_uuid()
- user_id uuid not null default auth.uid()
- subject_id uuid null references public.subjects(id) on delete cascade
- title text not null
- kind text not null default 'aula'   (ex.: aula, citi, treino, outro)
- weekday smallint not null check (weekday between 1 and 7)   (1 = segunda ... 7 = domingo)
- start_time time not null
- end_time time not null
- location text null
- created_at timestamptz not null default now()

Nas duas tabelas, siga o mesmo padrão das tabelas que já existem: habilite RLS com uma política para o usuário ler, criar, alterar e apagar só as próprias linhas (auth.uid() = user_id), e dê GRANT SELECT, INSERT, UPDATE, DELETE para authenticated e GRANT ALL para service_role.

No fim, atualize os tipos do Supabase (src/integrations/supabase/types.ts) para incluir as duas tabelas. Não faça mais nenhuma mudança.
```
