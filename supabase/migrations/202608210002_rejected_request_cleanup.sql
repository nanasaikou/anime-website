begin;

create policy rejected_requests_delete_owner on public.rejected_friend_requests
for delete to authenticated using (owner_id = (select auth.uid()));

grant delete on public.rejected_friend_requests to authenticated;

commit;
