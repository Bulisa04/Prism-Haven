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
