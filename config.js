// Configuración pública del despacho.
// La "anon key" es pública por diseño: la seguridad la dan RLS + 2FA.
// La llave service_role JAMÁS va aquí (solo en variables de Netlify).
// Con SUPABASE_URL / SUPABASE_ANON_KEY vacíos la app arranca en MODO DEMO.
window.DESPACHO_CONFIG = {
  NOMBRE_DESPACHO: "Lexpress",
  SUPABASE_URL: "https://ybixdzawjblaofvxuzav.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InliaXhkemF3amJsYW9mdnh1emF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NTI0ODcsImV4cCI6MjExMDAyODQ4N30.DjK-esDYTL1PqNOb8j-Xd-fSdP0SB3J62yvsoebGhWo",
  MINUTOS_INACTIVIDAD: 20, // cierre automático de sesión
};
