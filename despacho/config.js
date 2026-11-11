// Configuración pública del despacho.
// Con SUPABASE_URL / SUPABASE_ANON_KEY vacíos la app arranca en MODO DEMO
// (datos solo en este navegador). Para producción use un proyecto de
// Supabase EXCLUSIVO para el despacho — ver despacho/README.md.
// La "anon key" es pública por diseño: la seguridad la dan RLS + 2FA.
window.DESPACHO_CONFIG = {
  NOMBRE_DESPACHO: "Despacho Jurídico",
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  MINUTOS_INACTIVIDAD: 20, // cierre automático de sesión
};
