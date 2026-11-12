-- =====================================================================
-- Lexpress — Migración 002: documentos escaneados, análisis con IA y escritos
-- Ejecutar completo en el SQL Editor DESPUÉS de schema.sql.
-- Se puede ejecutar más de una vez sin problema.
-- =====================================================================

-- ------------------------------------------- datos nuevos del expediente
alter table public.expedientes add column if not exists representa  text not null default '';
alter table public.expedientes add column if not exists tipo_juicio text not null default '';
alter table public.expedientes add column if not exists etapa       text not null default '';

-- ------------------------------------------------------------ documentos
create table if not exists public.documentos (
  id              uuid primary key default gen_random_uuid(),
  expediente_id   uuid not null references public.expedientes (id) on delete restrict,
  nombre          text not null,
  ruta            text not null unique,          -- ruta dentro del bucket "expedientes"
  mime            text not null,
  tamano          bigint not null default 0,
  estado_ia       text not null default 'sin_procesar'
                  check (estado_ia in ('sin_procesar', 'procesando', 'procesado', 'error')),
  extraccion      jsonb,                          -- lo que la IA leyó del documento
  error_ia        text not null default '',
  creado_por      uuid references public.abogados (id),
  creado_at       timestamptz not null default now(),
  actualizado_at  timestamptz not null default now()
);
create index if not exists documentos_expediente_idx on public.documentos (expediente_id);

alter table public.acuerdos add column if not exists documento_id uuid references public.documentos (id);

-- ------------------------------------------------- análisis del juicio (IA)
create table if not exists public.analisis (
  id              uuid primary key default gen_random_uuid(),
  expediente_id   uuid not null references public.expedientes (id) on delete restrict,
  resultado       jsonb not null,
  modelo          text not null default '',
  creado_por      uuid references public.abogados (id),
  creado_at       timestamptz not null default now(),
  actualizado_at  timestamptz not null default now()
);
create index if not exists analisis_expediente_idx on public.analisis (expediente_id, creado_at desc);

-- --------------------------------------------------------------- escritos
create table if not exists public.escritos (
  id              uuid primary key default gen_random_uuid(),
  expediente_id   uuid not null references public.expedientes (id) on delete restrict,
  acuerdo_id      uuid references public.acuerdos (id),
  titulo          text not null check (length(trim(titulo)) > 0),
  contenido       text not null default '',
  estado          text not null default 'borrador'
                  check (estado in ('borrador', 'aprobado', 'presentado', 'descartado')),
  generado_ia     boolean not null default false,
  notas_ia        jsonb,                          -- datos por completar, fundamentos, avisos
  aprobado_por    uuid references public.abogados (id),
  aprobado_at     timestamptz,
  presentado_at   date,
  creado_por      uuid references public.abogados (id),
  creado_at       timestamptz not null default now(),
  actualizado_at  timestamptz not null default now()
);
create index if not exists escritos_expediente_idx on public.escritos (expediente_id);

-- ---------------------------------------------- sellos (quién/cuándo)
create or replace function public.sellar_escrito() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    -- Con visto bueno el texto queda congelado: para corregirlo hay que
    -- regresarlo a borrador (queda en bitácora).
    if old.estado in ('aprobado', 'presentado') and new.estado = old.estado
       and new.contenido is distinct from old.contenido then
      raise exception 'El escrito ya tiene visto bueno; regréselo a borrador para modificarlo';
    end if;
    new.aprobado_por := old.aprobado_por;
    new.aprobado_at := old.aprobado_at;
  end if;
  if new.estado = 'aprobado' and (tg_op = 'INSERT' or old.estado <> 'aprobado') then
    new.aprobado_por := auth.uid();
    new.aprobado_at := now();
  elsif new.estado = 'borrador' then
    new.aprobado_por := null;
    new.aprobado_at := null;
    new.presentado_at := null;
  end if;
  if new.estado = 'presentado' and new.aprobado_at is null then
    raise exception 'Solo se puede marcar como presentado un escrito con visto bueno';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['documentos', 'analisis', 'escritos'] loop
    execute format('drop trigger if exists sellar_%1$s on public.%1$s', t);
    execute format('create trigger sellar_%1$s before insert or update on public.%1$s
                    for each row execute function public.sellar_registro()', t);
    execute format('drop trigger if exists bitacora_%1$s on public.%1$s', t);
    execute format('create trigger bitacora_%1$s after insert or update or delete on public.%1$s
                    for each row execute function public.registrar_bitacora()', t);
  end loop;
end $$;

drop trigger if exists sellar_escrito_estado on public.escritos;
create trigger sellar_escrito_estado before insert or update on public.escritos
  for each row execute function public.sellar_escrito();

-- --------------------------------------------------------------- RLS
alter table public.documentos enable row level security;
alter table public.analisis   enable row level security;
alter table public.escritos   enable row level security;
revoke all on public.documentos, public.analisis, public.escritos from anon;

do $$
declare t text;
begin
  foreach t in array array['documentos', 'analisis', 'escritos'] loop
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

-- ----------------------------------------- almacenamiento de archivos
-- Bucket PRIVADO: los archivos solo se descargan con enlaces temporales
-- firmados, y solo abogados activos con 2FA pueden pedirlos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expedientes', 'expedientes', false, 31457280,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists expedientes_archivos_ver on storage.objects;
create policy expedientes_archivos_ver on storage.objects for select to authenticated
  using (bucket_id = 'expedientes' and public.es_abogado());
drop policy if exists expedientes_archivos_subir on storage.objects;
create policy expedientes_archivos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'expedientes' and public.es_abogado());
drop policy if exists expedientes_archivos_borrar on storage.objects;
create policy expedientes_archivos_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'expedientes' and public.es_admin());
