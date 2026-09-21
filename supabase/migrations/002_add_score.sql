-- Agrega sistema de puntaje (minijuego de búsqueda a contrarreloj) a un
-- proyecto que ya corrió schema.sql sin la columna `score`.
alter table public.progress
  add column if not exists score integer not null default 0;
