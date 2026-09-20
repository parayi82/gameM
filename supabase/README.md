# Supabase — La Cabaña

1. Crear proyecto en https://supabase.com
2. Ejecutar `schema.sql` en el SQL Editor del proyecto (o vía `supabase db push` con la CLI)
3. En **Authentication → Providers**, habilitar **Anonymous Sign-ins** (el motor usa
   `supabase.auth.signInAnonymously()` para no forzar registro antes de jugar)
4. Copiar `Project URL` y `anon public key` a `config.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`)
5. Copiar la `service_role key` como `SUPABASE_SERVICE_ROLE_KEY` en las variables de entorno
   de Netlify (solo la usa `netlify/functions/stripe-webhook.js`, nunca el cliente)

## Tablas

- `progress`: un row por `(user_id, chapter_id)` con el nodo actual, flags, inventario,
  finales desbloqueados y el último punto de decisión (para "rebobinar").
- `purchases`: registrado únicamente por el webhook de Stripe tras un pago confirmado.

RLS está activo: cada usuario solo ve/edita sus propias filas; `purchases` solo se
inserta desde el backend con la service role key.
