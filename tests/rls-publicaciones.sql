-- Prueba de la migración 003 (bandeja de publicaciones).
\set ON_ERROR_STOP 0
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002","aal":"aal2"}',false);
\echo '--- abogado activo guarda una publicación del boletín'
insert into publicaciones (expediente_id, fuente, origen, fecha_publicacion, texto, confianza)
  select id, 'boletin', 'Boletín Judicial Jalisco', '2026-11-12', '0845/2026 SE DA VISTA', 'alta' from expedientes returning estado, creado_por is not null as sellado;
\echo '--- la misma publicación otra vez (debe fallar: duplicado)'
insert into publicaciones (expediente_id, fuente, fecha_publicacion, texto)
  select id, 'boletin', '2026-11-12', '0845/2026 SE DA VISTA' from expedientes;
\echo '--- sin vincular (correo) y registrar'
insert into publicaciones (fuente, origen, fecha_publicacion, texto) values ('correo', 'notificaciones@pjf', '2026-11-12', 'Aviso sin número');
update publicaciones set estado='registrada' where fuente='boletin';
select fuente, estado, expediente_id is null as sin_vincular from publicaciones order by fuente;
\echo '--- abogado no puede borrar (0 filas)'
delete from publicaciones; select count(*) from publicaciones;
\echo '--- sin 2FA no ve nada'
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002","aal":"aal1"}',false);
select count(*) from publicaciones;
reset role; set role anon;
select count(*) from publicaciones;
