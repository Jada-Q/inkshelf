-- 墨架 Inkshelf · Supabase schema
-- 在 Supabase SQL Editor 里整段运行即可建好所需的表、存储桶、RLS 策略与函数。

-- ── 书 ──
create table if not exists public.inkshelf_books (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  author text,
  format text not null check (format in ('epub','pdf')),
  file_path text not null,
  cover_path text,
  language text,
  status text not null default 'reading' check (status in ('want','reading','done')),
  percent real not null default 0,
  position text,
  file_size bigint,
  total_seconds integer not null default 0,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.inkshelf_books enable row level security;
create policy "inkshelf owner select" on public.inkshelf_books for select using (auth.uid() = owner);
create policy "inkshelf owner insert" on public.inkshelf_books for insert with check (auth.uid() = owner);
create policy "inkshelf owner update" on public.inkshelf_books for update using (auth.uid() = owner);
create policy "inkshelf owner delete" on public.inkshelf_books for delete using (auth.uid() = owner);

-- ── 阅读会话（计时真值源）──
create table if not exists public.inkshelf_sessions (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id uuid not null references public.inkshelf_books(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz not null default now(),
  seconds integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.inkshelf_sessions enable row level security;
create policy "inkshelf_sessions owner all" on public.inkshelf_sessions
  for all using (auth.uid() = owner) with check (auth.uid() = owner);
create index if not exists inkshelf_sessions_owner_started
  on public.inkshelf_sessions (owner, started_at desc);

-- 原子累加阅读秒数到 books.total_seconds
create or replace function public.inkshelf_add_reading_time(p_book uuid, p_seconds integer)
returns void language sql as $$
  update public.inkshelf_books
     set total_seconds = total_seconds + greatest(p_seconds, 0),
         updated_at = now()
   where id = p_book and owner = auth.uid();
$$;
grant execute on function public.inkshelf_add_reading_time(uuid, integer) to authenticated;

-- ── 私有存储桶（书文件 + 封面，路径 {uid}/{bookId}.{ext}）──
insert into storage.buckets (id, name, public)
values ('inkshelf-books', 'inkshelf-books', false)
on conflict (id) do nothing;

create policy "inkshelf storage select" on storage.objects
  for select using (bucket_id = 'inkshelf-books' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "inkshelf storage insert" on storage.objects
  for insert with check (bucket_id = 'inkshelf-books' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "inkshelf storage update" on storage.objects
  for update using (bucket_id = 'inkshelf-books' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "inkshelf storage delete" on storage.objects
  for delete using (bucket_id = 'inkshelf-books' and (storage.foldername(name))[1] = auth.uid()::text);

-- ── 划线/笔记 ──
create table if not exists public.inkshelf_highlights (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id uuid not null references public.inkshelf_books(id) on delete cascade,
  cfi text, page integer, quote text not null, color text not null default 'yellow', note text,
  created_at timestamptz not null default now()
);
alter table public.inkshelf_highlights enable row level security;
create policy "inkshelf_highlights owner all" on public.inkshelf_highlights for all using (auth.uid() = owner) with check (auth.uid() = owner);
create index if not exists inkshelf_highlights_owner_book on public.inkshelf_highlights (owner, book_id, created_at);

-- ── 生词库 ──
create table if not exists public.inkshelf_vocab (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id uuid references public.inkshelf_books(id) on delete set null,
  term text not null, translation text, context text,
  created_at timestamptz not null default now()
);
alter table public.inkshelf_vocab enable row level security;
create policy "inkshelf_vocab owner all" on public.inkshelf_vocab for all using (auth.uid() = owner) with check (auth.uid() = owner);
create index if not exists inkshelf_vocab_owner on public.inkshelf_vocab (owner, created_at desc);
