-- =====================================================================
-- Lexpress — Migración 003: bandeja de publicaciones (boletín y correos)
-- Ejecutar completo en el SQL Editor DESPUÉS de 002_documentos_ia.sql.
-- Se puede ejecutar más de una vez sin problema.
-- =====================================================================

create table if not exists public.publicaciones (
  id                 uuid primary key default gen_random_uuid(),
  expediente_id      uuid references public.expedientes (id) on delete restrict,  -- null = sin vincular
  fuente             text not null check (fuente in ('boletin', 'correo', 'manual')),
  origen             text not null default '',      -- "Boletín Judicial Jalisco", remitente del correo, etc.
  asunto             text not null default '',      -- asunto del correo, si aplica
  fecha_publicacion  date not null,
  juzgado_detectado  text not null default '',
  texto              text not null check (length(trim(texto)) > 0),
  confianza          text not null default 'media' check (confianza in ('alta', 'media', 'baja')),
  motivo             text not null default '',
  estado             text not null default 'nueva' check (estado in ('nueva', 'registrada', 'descartada')),
  acuerdo_id         uuid references public.acuerdos (id),
  documento_id       uuid references public.documentos (id),
  huella             text generated always as
                     (md5(coalesce(expediente_id::text, '-') || '|' || (fecha_publicacion - date '2000-01-01')::text || '|' || texto)) stored,
  creado_por         uuid references public.abogados (id),
  creado_at          timestamptz not null default now(),
  actualizado_at     timestamptz not null default now(),
  unique (huella)                                    -- la misma publicación no se duplica
);
create index if not exists publicaciones_estado_idx on public.publicaciones (estado, fecha_publicacion desc);
create index if not exists publicaciones_expediente_idx on public.publicaciones (expediente_id);

drop trigger if exists sellar_publicaciones on public.publicaciones;
create trigger sellar_publicaciones before insert or update on public.publicaciones
  for each row execute function public.sellar_registro();
drop trigger if exists bitacora_publicaciones on public.publicaciones;
create trigger bitacora_publicaciones after insert or update or delete on public.publicaciones
  for each row execute function public.registrar_bitacora();

alter table public.publicaciones enable row level security;
revoke all on public.publicaciones from anon;

drop policy if exists publicaciones_ver on public.publicaciones;
create policy publicaciones_ver on public.publicaciones for select to authenticated using (public.es_abogado());
drop policy if exists publicaciones_crear on public.publicaciones;
create policy publicaciones_crear on public.publicaciones for insert to authenticated with check (public.es_abogado());
drop policy if exists publicaciones_editar on public.publicaciones;
create policy publicaciones_editar on public.publicaciones for update to authenticated using (public.es_abogado()) with check (public.es_abogado());
drop policy if exists publicaciones_borrar on public.publicaciones;
create policy publicaciones_borrar on public.publicaciones for delete to authenticated using (public.es_admin());
-- Los correos los inserta la función "buzon" con la llave de servicio (no usa estas políticas).
