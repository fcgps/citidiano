CREATE TABLE public.topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.topics TO authenticated;
GRANT ALL ON public.topics TO service_role;
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own topics" ON public.topics FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.materials ADD COLUMN topic_id uuid REFERENCES public.topics(id) ON DELETE SET NULL;
ALTER TABLE public.assessments ADD COLUMN kind text NOT NULL DEFAULT 'prova';

CREATE TABLE public.dumps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  path text NOT NULL,
  file_name text NOT NULL,
  mime text,
  size bigint,
  status text NOT NULL DEFAULT 'analyzing',
  doc_type text,
  result jsonb,
  summary text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dumps TO authenticated;
GRANT ALL ON public.dumps TO service_role;
ALTER TABLE public.dumps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own dumps" ON public.dumps FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);