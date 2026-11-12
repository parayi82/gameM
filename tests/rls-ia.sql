-- Prueba de la migración 002 (documentos, análisis, escritos, archivos).
-- Uso: psql -d t -f supabase-stub.sql -f ../supabase/schema.sql -f ../supabase/002_documentos_ia.sql -f rls.sql -f rls-ia.sql
\set ON_ERROR_STOP 0
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002","aal":"aal2"}',false);
\echo '--- abogado activo sube documento y crea escrito'
insert into storage.objects (bucket_id, name) values ('expedientes', 'x/demanda.pdf');
insert into documentos (expediente_id, nombre, ruta, mime) select id, 'demanda.pdf', 'x/demanda.pdf', 'application/pdf' from expedientes returning nombre, creado_por;
insert into escritos (expediente_id, titulo, contenido, generado_ia) select id, 'Contestación', 'texto v1', true from expedientes returning estado;
\echo '--- visto bueno sella quién aprobó'
update escritos set estado='aprobado';
select estado, aprobado_por is not null as sellado from escritos;
\echo '--- modificar texto aprobado (debe fallar)'
update escritos set contenido='texto alterado';
\echo '--- marcar presentado y luego volver a borrador permite editar'
update escritos set estado='presentado', presentado_at='2026-11-12';
update escritos set estado='borrador';
update escritos set contenido='texto v2';
select estado, contenido, aprobado_por from escritos;
\echo '--- presentado sin visto bueno (debe fallar)'
update escritos set estado='presentado';
\echo '--- abogado no puede borrar archivos ni documentos (0 filas)'
delete from storage.objects; delete from documentos;
select (select count(*) from storage.objects) as archivos, (select count(*) from documentos) as docs;
\echo '--- sin 2FA no ve archivos ni escritos'
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002","aal":"aal1"}',false);
select (select count(*) from storage.objects) as archivos, (select count(*) from escritos) as escritos;
\echo '--- anónimo'
reset role; set role anon;
select count(*) from escritos;
reset role;
select tabla, accion from bitacora where tabla in ('documentos','escritos') order by id;
