create type public.account_role as enum ('reader', 'author');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  pen_name text not null,
  role public.account_role not null default 'reader',
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.books (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  submission_type text not null,
  book_genre text not null,
  lgbtq_category text,
  reader_filter text not null,
  story_tags text[] not null default '{}',
  body text not null,
  author_photo_url text,
  publication_status text not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.book_chapters (
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

create table public.community_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles(id) on delete set null,
  author_name text not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  parent_id uuid references public.post_comments(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.books enable row level security;
alter table public.book_chapters enable row level security;
alter table public.community_posts enable row level security;
alter table public.post_comments enable row level security;

create policy "Profiles are readable by everyone"
  on public.profiles for select
  using (true);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Published books are readable by everyone"
  on public.books for select
  using (publication_status = 'published');

create policy "Authors can publish their own books"
  on public.books for insert
  with check (
    auth.uid() = author_id
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'author'
    )
  );

create policy "Authors can update their own books"
  on public.books for update
  using (auth.uid() = author_id)
  with check (
    auth.uid() = author_id
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'author'
    )
  );

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

create policy "Community posts are readable by everyone"
  on public.community_posts for select
  using (true);

create policy "Signed in users can create community posts"
  on public.community_posts for insert
  with check (auth.uid() is not null);

create policy "Comments are readable by everyone"
  on public.post_comments for select
  using (true);

create policy "Signed in users can comment"
  on public.post_comments for insert
  with check (auth.uid() is not null);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, pen_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'pen_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data ->> 'role')::public.account_role, 'reader')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

insert into storage.buckets (id, name, public)
values ('author-avatars', 'author-avatars', true)
on conflict (id) do nothing;

create policy "Author avatars are publicly readable"
  on storage.objects for select
  using (bucket_id = 'author-avatars');

create policy "Signed in users can upload their own author avatar"
  on storage.objects for insert
  with check (
    bucket_id = 'author-avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Signed in users can update their own author avatar"
  on storage.objects for update
  using (
    bucket_id = 'author-avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

grant usage on schema public to anon, authenticated;

grant select on public.profiles to anon, authenticated;
grant update on public.profiles to authenticated;

grant select on public.books to anon, authenticated;
grant insert, update on public.books to authenticated;

grant select on public.book_chapters to anon, authenticated;
grant insert, update on public.book_chapters to authenticated;

grant select on public.community_posts to anon, authenticated;
grant insert on public.community_posts to authenticated;

grant select on public.post_comments to anon, authenticated;
grant insert on public.post_comments to authenticated;

grant usage, select on all sequences in schema public to authenticated;
