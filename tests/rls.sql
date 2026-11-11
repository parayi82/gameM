-- Prueba de permisos (RLS). Uso:
--   createdb t && psql -d t -f supabase-stub.sql -f ../supabase/schema.sql -f rls.sql
-- Las líneas marcadas 'debe fallar' deben imprimir ERROR.
\set ON_ERROR_STOP 0
insert into auth.users (id,email) values ('00000000-0000-0000-0000-000000000001','Admin@x.mx'),('00000000-0000-0000-0000-000000000002','b@x.mx');
select email, rol, activo from abogados order by email;
-- admin con aal2
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","aal":"aal2","email":"admin@x.mx"}',false);
insert into expedientes (numero,juzgado,cliente) values ('123/2026','Juzgado 1 Civil','ACME') returning numero, creado_por;
insert into acuerdos (expediente_id, fecha_notificacion, descripcion, fecha_vencimiento) select id,'2026-11-11','Contestar demanda','2026-11-25' from expedientes;
update acuerdos set estado='atendido', atendido_por='00000000-0000-0000-0000-000000000002';
select estado, atendido_por, atendido_at is not null as sellado from acuerdos;
\echo '--- admin intenta desactivarse (debe fallar)'
update abogados set activo=false where email='admin@x.mx';
\echo '--- bitacora: admin no puede borrar (debe fallar)'
delete from bitacora;
select count(*) as registros_bitacora from bitacora;
\echo '--- admin con aal1 (sin 2FA): no ve nada'
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","aal":"aal1"}',false);
select count(*) as expedientes_visibles from expedientes;
\echo '--- abogado inactivo con aal2: ve solo su perfil, nada más'
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002","aal":"aal2"}',false);
select count(*) as expedientes_visibles from expedientes;
select email from abogados;
insert into expedientes (numero,juzgado,cliente) values ('9','J','X');
\echo '--- abogado intenta auto-activarse (0 filas)'
update abogados set activo=true, rol='admin' where email='b@x.mx';
\echo '--- admin activa al abogado'
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","aal":"aal2"}',false);
update abogados set activo=true where email='b@x.mx';
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002","aal":"aal2"}',false);
select count(*) as expedientes_visibles from expedientes;
\echo '--- abogado normal: no puede borrar ni ver bitácora ni editar inhábiles'
delete from acuerdos; select count(*) from acuerdos;
select count(*) as bitacora_visible from bitacora;
insert into dias_inhabiles values ('2026-12-12','x');
\echo '--- anónimo'
reset role; set role anon;
select count(*) from expedientes;
