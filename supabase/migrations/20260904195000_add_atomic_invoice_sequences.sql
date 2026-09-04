create schema if not exists private;

alter table public.invoices
  add column if not exists project_sequence integer;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.invoices'::regclass
      and conname = 'invoices_project_sequence_positive'
  ) then
    alter table public.invoices
      add constraint invoices_project_sequence_positive
      check (project_sequence is null or project_sequence > 0) not valid;
  end if;
end;
$$;

create unique index if not exists invoices_project_sequence_unique
  on public.invoices (charge_to_project, project_sequence)
  where project_sequence is not null;

create table if not exists private.project_invoice_counters (
  project_code text primary key,
  last_sequence integer not null check (last_sequence >= 0),
  updated_at timestamptz not null default now()
);

create or replace function public.reserve_invoice_number(
  p_invoice_id bigint,
  p_project_code text,
  p_amount numeric,
  p_currency text
)
returns table (
  project_sequence integer,
  generated_invoice_id text
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_project_sequence integer;
  v_generated_invoice_id text;
  v_amount_part text;
begin
  if p_project_code is null or btrim(p_project_code) = '' then
    raise exception 'project code is required'
      using errcode = '22023';
  end if;

  select i.project_sequence, i.generated_invoice_id
    into v_project_sequence, v_generated_invoice_id
  from public.invoices as i
  where i.id = p_invoice_id
    and i.charge_to_project = p_project_code
  for update;

  if not found then
    raise exception 'invoice % does not belong to project %',
      p_invoice_id, p_project_code
      using errcode = 'P0002';
  end if;

  if v_project_sequence is not null then
    return query
      select v_project_sequence, v_generated_invoice_id;
    return;
  end if;

  insert into private.project_invoice_counters (project_code, last_sequence)
  select
    p_project_code,
    greatest(
      coalesce(max(i.project_sequence), 0),
      coalesce(max(
        case
          when left(
            i.generated_invoice_id,
            length(p_project_code) + 1
          ) = p_project_code || '-'
            and substring(
              i.generated_invoice_id
              from length(p_project_code) + 2
            ) ~ '^[0-9]+-'
          then substring(
            substring(
              i.generated_invoice_id
              from length(p_project_code) + 2
            )
            from '^([0-9]+)-'
          )::integer
          else 0
        end
      ), 0)
    )
  from public.invoices as i
  where i.charge_to_project = p_project_code
  on conflict (project_code) do nothing;

  update private.project_invoice_counters
  set last_sequence = last_sequence + 1,
      updated_at = now()
  where project_code = p_project_code
  returning last_sequence into v_project_sequence;

  if v_project_sequence is null then
    raise exception 'could not reserve an invoice number for project %',
      p_project_code;
  end if;

  v_amount_part := case
    when round(coalesce(p_amount, 0)) < 0
      then 'm' || abs(round(coalesce(p_amount, 0)))::text
    else round(coalesce(p_amount, 0))::text
  end;

  v_generated_invoice_id :=
    p_project_code
    || '-'
    || lpad(v_project_sequence::text, 4, '0')
    || '-'
    || v_amount_part
    || upper(btrim(coalesce(p_currency, '')));

  update public.invoices as i
  set project_sequence = v_project_sequence,
      generated_invoice_id = v_generated_invoice_id
  where i.id = p_invoice_id
    and i.charge_to_project = p_project_code;

  return query
    select v_project_sequence, v_generated_invoice_id;
end;
$function$;

revoke all on schema private from public;
revoke all on table private.project_invoice_counters from public;
revoke all on function public.reserve_invoice_number(bigint, text, numeric, text) from public;

grant usage on schema private to anon, authenticated;
grant select, insert, update on table private.project_invoice_counters to anon, authenticated;
grant select (id, charge_to_project, project_sequence, generated_invoice_id)
  on table public.invoices to anon, authenticated;
grant update (project_sequence, generated_invoice_id)
  on table public.invoices to anon, authenticated;
grant execute on function public.reserve_invoice_number(bigint, text, numeric, text)
  to anon, authenticated;
