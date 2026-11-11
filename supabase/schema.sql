-- =====================================================================
-- Despacho — control de expedientes y acuerdos
-- Ejecutar completo en el SQL Editor de un proyecto de Supabase NUEVO
-- y exclusivo para el despacho.
--
-- Seguridad:
--  * Solo abogados dados de alta y ACTIVOS ven o modifican datos.
--  * Exige sesión con doble factor (aal2) en TODAS las lecturas/escrituras.
--  * El primer usuario que se registra queda como administrador activo;
--    los siguientes quedan inactivos hasta que un admin los active.
--  * Toda alta/cambio/baja queda en `bitacora`, que nadie puede editar.
--  * Los acuerdos y expedientes no se borran (solo admin puede).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tablas
create table if not exists public.abogados (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null unique,
  nombre     text not null default '',
  rol        text not null default 'abogado' check (rol in ('admin', 'abogado')),
  activo     boolean not null default false,
  creado_at  timestamptz not null default now()
);

create table if not exists public.expedientes (
  id              uuid primary key default gen_random_uuid(),
  numero          text not null check (length(trim(numero)) > 0),
  juzgado         text not null check (length(trim(juzgado)) > 0),
  materia         text not null default '',
  cliente         text not null check (length(trim(cliente)) > 0),
  contraparte     text not null default '',
  responsable_id  uuid references public.abogados (id),
  estado          text not null default 'activo' check (estado in ('activo', 'archivado')),
  notas           text not null default '',
  creado_por      uuid references public.abogados (id),
  creado_at       timestamptz not null default now(),
  actualizado_at  timestamptz not null default now(),
  unique (numero, juzgado)
);

create table if not exists public.acuerdos (
  id                  uuid primary key default gen_random_uuid(),
  expediente_id       uuid not null references public.expedientes (id) on delete restrict,
  fecha_publicacion   date,
  fecha_notificacion  date not null,
  descripcion         text not null check (length(trim(descripcion)) > 0),
  dias_termino        integer check (dias_termino is null or dias_termino between 1 and 365),
  surte_efectos       boolean not null default true,
  fecha_vencimiento   date,           -- null = acuerdo informativo, sin término
  responsable_id      uuid references public.abogados (id),
  estado              text not null default 'pendiente' check (estado in ('pendiente', 'atendido')),
  nota_atencion       text not null default '',
  atendido_por        uuid references public.abogados (id),
  atendido_at         timestamptz,
  creado_por          uuid references public.abogados (id),
  creado_at           timestamptz not null default now(),
  actualizado_at      timestamptz not null default now(),
  check (fecha_vencimiento is null or fecha_vencimiento >= fecha_notificacion)
);

create index if not exists acuerdos_pendientes_idx
  on public.acuerdos (fecha_vencimiento) where estado = 'pendiente';
create index if not exists acuerdos_expediente_idx on public.acuerdos (expediente_id);

create table if not exists public.dias_inhabiles (
  fecha   date primary key,
  motivo  text not null default ''
);

create table if not exists public.bitacora (
  id             bigint generated always as identity primary key,
  at             timestamptz not null default now(),
  usuario_id     uuid,
  usuario_email  text,
  tabla          text not null,
  registro_id    text,
  accion         text not null,
  antes          jsonb,
  despues        jsonb
);

-- ---------------------------------------------------- funciones de acceso
-- security definer: consultan `abogados` sin quedar sujetas a su propia RLS.
create or replace function public.es_abogado() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.abogados where id = auth.uid() and activo);
$$;

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.es_abogado()
     and exists (select 1 from public.abogados where id = auth.uid() and rol = 'admin');
$$;

-- ------------------------------------------------ alta automática de perfil
create or replace function public.alta_abogado() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  primero boolean;
begin
  perform pg_advisory_xact_lock(4242);
  select not exists (select 1 from public.abogados) into primero;
  insert into public.abogados (id, email, rol, activo)
  values (new.id, lower(new.email),
          case when primero then 'admin' else 'abogado' end,
          primero);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.alta_abogado();

-- --------------------------------------- campos que el cliente no controla
create or replace function public.sellar_registro() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.creado_por := auth.uid();
    new.creado_at := now();
  else
    new.creado_por := old.creado_por;
    new.creado_at := old.creado_at;
  end if;
  new.actualizado_at := now();

  if tg_table_name = 'acuerdos' then
    if new.estado = 'atendido' and (tg_op = 'INSERT' or old.estado <> 'atendido') then
      new.atendido_por := auth.uid();
      new.atendido_at := now();
    elsif new.estado = 'pendiente' then
      new.atendido_por := null;
      new.atendido_at := null;
    else
      new.atendido_por := old.atendido_por;
      new.atendido_at := old.atendido_at;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists sellar_expedientes on public.expedientes;
create trigger sellar_expedientes before insert or update on public.expedientes
  for each row execute function public.sellar_registro();

drop trigger if exists sellar_acuerdos on public.acuerdos;
create trigger sellar_acuerdos before insert or update on public.acuerdos
  for each row execute function public.sellar_registro();

-- Un admin no puede quitarse a sí mismo el rol ni desactivarse (evita
-- quedarse sin administradores por error).
create or replace function public.proteger_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.id = auth.uid() and (new.rol <> old.rol or new.activo <> old.activo) then
    raise exception 'No puede cambiar su propio rol ni desactivarse';
  end if;
  new.id := old.id;
  new.email := old.email;
  new.creado_at := old.creado_at;
  return new;
end $$;

drop trigger if exists proteger_admin on public.abogados;
create trigger proteger_admin before update on public.abogados
  for each row execute function public.proteger_admin();

-- --------------------------------------------------------------- bitácora
create or replace function public.registrar_bitacora() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  fila jsonb := coalesce(to_jsonb(new), to_jsonb(old));
begin
  insert into public.bitacora (usuario_id, usuario_email, tabla, registro_id, accion, antes, despues)
  values (auth.uid(), auth.jwt() ->> 'email', tg_table_name,
          coalesce(fila ->> 'id', fila ->> 'fecha'), tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['abogados', 'expedientes', 'acuerdos', 'dias_inhabiles'] loop
    execute format('drop trigger if exists bitacora_%1$s on public.%1$s', t);
    execute format('create trigger bitacora_%1$s after insert or update or delete on public.%1$s
                    for each row execute function public.registrar_bitacora()', t);
  end loop;
end $$;

-- ------------------------------------------------- Row Level Security
alter table public.abogados       enable row level security;
alter table public.expedientes    enable row level security;
alter table public.acuerdos       enable row level security;
alter table public.dias_inhabiles enable row level security;
alter table public.bitacora       enable row level security;

-- Nadie anónimo toca nada.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on public.bitacora from authenticated;
grant select on public.bitacora to authenticated;

-- abogados: cada quien ve su propio perfil (para saber si está activo);
-- los abogados activos ven al equipo; solo admin modifica.
drop policy if exists abogados_ver_propio on public.abogados;
create policy abogados_ver_propio on public.abogados for select to authenticated
  using (id = auth.uid());
drop policy if exists abogados_ver_equipo on public.abogados;
create policy abogados_ver_equipo on public.abogados for select to authenticated
  using (public.es_abogado());
drop policy if exists abogados_admin_edita on public.abogados;
create policy abogados_admin_edita on public.abogados for update to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- expedientes y acuerdos: abogados activos leen, crean y editan; borrar solo admin.
do $$
declare t text;
begin
  foreach t in array array['expedientes', 'acuerdos'] loop
    execute format('drop policy if exists %1$s_ver on public.%1$s', t);
    execute format('create policy %1$s_ver on public.%1$s for select to authenticated using (public.es_abogado())', t);
    execute format('drop policy if exists %1$s_crear on public.%1$s', t);
    execute format('create policy %1$s_crear on public.%1$s for insert to authenticated with check (public.es_abogado())', t);
    execute format('drop policy if exists %1$s_editar on public.%1$s', t);
    execute format('create policy %1$s_editar on public.%1$s for update to authenticated using (public.es_abogado()) with check (public.es_abogado())', t);
    execute format('drop policy if exists %1$s_borrar on public.%1$s', t);
    execute format('create policy %1$s_borrar on public.%1$s for delete to authenticated using (public.es_admin())', t);
  end loop;
end $$;

-- días inhábiles: todos los ven, solo admin los administra.
drop policy if exists inhabiles_ver on public.dias_inhabiles;
create policy inhabiles_ver on public.dias_inhabiles for select to authenticated
  using (public.es_abogado());
drop policy if exists inhabiles_admin on public.dias_inhabiles;
create policy inhabiles_admin on public.dias_inhabiles for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- bitácora: solo admin la consulta; nadie la escribe directo (la llenan los triggers).
drop policy if exists bitacora_admin_ver on public.bitacora;
create policy bitacora_admin_ver on public.bitacora for select to authenticated
  using (public.es_admin());

-- ------------------------------------------- días inhábiles base (México)
-- Ajustar al calendario oficial del tribunal (vacaciones judiciales, etc.).
insert into public.dias_inhabiles (fecha, motivo) values
  ('2026-01-01', 'Año Nuevo'), ('2026-02-02', 'Día de la Constitución'),
  ('2026-03-16', 'Natalicio de Benito Juárez'), ('2026-04-02', 'Jueves Santo'),
  ('2026-04-03', 'Viernes Santo'), ('2026-05-01', 'Día del Trabajo'),
  ('2026-05-05', 'Batalla de Puebla'), ('2026-09-16', 'Día de la Independencia'),
  ('2026-11-02', 'Día de Muertos'), ('2026-11-16', 'Revolución Mexicana'),
  ('2026-12-25', 'Navidad'), ('2027-01-01', 'Año Nuevo'),
  ('2027-02-01', 'Día de la Constitución'), ('2027-03-15', 'Natalicio de Benito Juárez'),
  ('2027-03-25', 'Jueves Santo'), ('2027-03-26', 'Viernes Santo'),
  ('2027-05-05', 'Batalla de Puebla'), ('2027-09-16', 'Día de la Independencia'),
  ('2027-11-02', 'Día de Muertos'), ('2027-11-15', 'Revolución Mexicana')
on conflict (fecha) do nothing;
