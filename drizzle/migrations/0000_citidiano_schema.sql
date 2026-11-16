CREATE TABLE public.subjects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL DEFAULT auth.uid(), name text NOT NULL, professor text, color text NOT NULL DEFAULT '#00C853', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.assessments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL DEFAULT auth.uid(), subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE, name text NOT NULL, date date NOT NULL, topics text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL DEFAULT auth.uid(), title text NOT NULL, kind text NOT NULL DEFAULT 'outro', starts_at timestamptz NOT NULL, ends_at timestamptz, subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.goals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL DEFAULT auth.uid(), title text NOT NULL, kind text NOT NULL DEFAULT 'weekly', times_per_week int, target_hours numeric, done numeric NOT NULL DEFAULT 0, deadline date, subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.materials (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL DEFAULT auth.uid(), subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL, name text NOT NULL, path text NOT NULL, mime text, size bigint, created_at timestamptz NOT NULL DEFAULT now());
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['subjects','assessments','events','goals','materials'] LOOP
EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
EXECUTE format('CREATE POLICY "own_rows" ON public.%I FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', t);
END LOOP; END $$;
CREATE POLICY "own_files_select" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'materiais' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "own_files_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'materiais' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "own_files_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'materiais' AND (storage.foldername(name))[1] = auth.uid()::text);