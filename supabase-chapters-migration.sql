create table if not exists public.book_chapters (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  chapter_number integer not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, chapter_number)
);

alter table public.book_chapters enable row level security;

create policy "Published book chapters are readable by everyone"
  on public.book_chapters for select
  using (
    exists (
      select 1 from public.books
      where books.id = book_chapters.book_id
      and books.publication_status = 'published'
    )
  );

create policy "Authors can publish chapters for their own books"
  on public.book_chapters for insert
  with check (
    auth.uid() = author_id
    and exists (
      select 1 from public.books
      join public.profiles on profiles.id = books.author_id
      where books.id = book_chapters.book_id
      and books.author_id = auth.uid()
      and profiles.role = 'author'
    )
  );

create policy "Authors can update their own chapters"
  on public.book_chapters for update
  using (auth.uid() = author_id)
  with check (
    auth.uid() = author_id
    and exists (
      select 1 from public.books
      join public.profiles on profiles.id = books.author_id
      where books.id = book_chapters.book_id
      and books.author_id = auth.uid()
      and profiles.role = 'author'
    )
  );
