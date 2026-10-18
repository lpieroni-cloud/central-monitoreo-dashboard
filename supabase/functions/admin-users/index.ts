import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json" };
const reply = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: cors });
const ROLES = ["admin", "tecnico", "lector"];
const LOGIN = "https://central-monitoreo-dashboard.vercel.app/admin";

function tempPassword() {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(b, (x) => chars[x % chars.length]).join("") + "#7";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return reply({ error: "Sesión no válida" }, 401);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: me } = await admin.from("people").select("role,active").eq("user_id", user.id).maybeSingle();
    if (!me || me.role !== "admin" || !me.active) return reply({ error: "Solo un administrador puede hacer esto" }, 403);

    const b = await req.json();
    const mail = (to: string, subject: string, body: string) => admin.from("alert_outbox").insert({ event_type: "access", subject, body, to_email: to });

    if (b.action === "list") {
      const { data: auth, error } = await admin.auth.admin.listUsers({ perPage: 200 });
      if (error) throw error;
      const { data: people } = await admin.from("people").select("*");
      const byId = new Map((people ?? []).map((p) => [p.user_id, p]));
      const users = auth.users.filter((u) => byId.has(u.id)).map((u) => {
        const p = byId.get(u.id);
        return { user_id: u.id, email: u.email, name: p.name, role: p.role, active: p.active, organization: p.organization, last_sign_in_at: u.last_sign_in_at };
      }).sort((x, y) => x.name.localeCompare(y.name));
      return reply({ users });
    }

    if (b.action === "create") {
      const email = String(b.email ?? "").trim().toLowerCase(), name = String(b.name ?? "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply({ error: "El correo no es válido" });
      if (!name) return reply({ error: "Falta el nombre" });
      if (!ROLES.includes(b.role)) return reply({ error: "Rol no válido" });
      const pw = tempPassword();
      const { data: created, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
      if (error) return reply({ error: /already|registered/i.test(error.message) ? "Ya existe un usuario con ese correo" : error.message });
      const { error: e2 } = await admin.from("people").insert({ user_id: created.user.id, name, role: b.role, organization: b.organization || null });
      if (e2) { await admin.auth.admin.deleteUser(created.user.id); return reply({ error: e2.message }); }
      await mail(email, "[Central de Monitoreo] Tu acceso al panel",
        `Hola ${name},\n\nSe creó tu acceso al panel de la Central de Monitoreo (${b.role === "admin" ? "Administrador" : b.role === "tecnico" ? "Operador" : "Solo lectura"}).\n\nPanel: ${LOGIN}\nUsuario: ${email}\nContraseña temporal: ${pw}\n\nAl ingresar, tocá tu nombre arriba a la derecha > "Cambiar contraseña" y elegí una propia de 12 caracteres o más.\n\nCentral de Monitoreo - San José de la Esquina`);
      return reply({ ok: true });
    }

    if (b.action === "update") {
      if (b.user_id === user.id && (b.active === false || b.role !== "admin")) return reply({ error: "No podés quitarte a vos mismo el acceso de administrador" });
      const patch: Record<string, unknown> = {};
      if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim();
      if (ROLES.includes(b.role)) patch.role = b.role;
      if (typeof b.active === "boolean") patch.active = b.active;
      const { error } = await admin.from("people").update(patch).eq("user_id", b.user_id);
      if (error) return reply({ error: error.message });
      if (typeof b.active === "boolean") await admin.auth.admin.updateUserById(b.user_id, { ban_duration: b.active ? "none" : "876000h" });
      return reply({ ok: true });
    }

    if (b.action === "reset") {
      const { data: u, error } = await admin.auth.admin.getUserById(b.user_id);
      if (error || !u.user?.email) return reply({ error: "No se encontró al usuario" });
      const { data: p } = await admin.from("people").select("name").eq("user_id", b.user_id).maybeSingle();
      const pw = tempPassword();
      const { error: e2 } = await admin.auth.admin.updateUserById(b.user_id, { password: pw });
      if (e2) return reply({ error: e2.message });
      await mail(u.user.email, "[Central de Monitoreo] Nueva contraseña temporal",
        `Hola ${p?.name ?? ""},\n\nSe generó una contraseña temporal para tu acceso al panel.\n\nPanel: ${LOGIN}\nUsuario: ${u.user.email}\nContraseña temporal: ${pw}\n\nAl ingresar, cambiala desde tu nombre > "Cambiar contraseña".\n\nCentral de Monitoreo - San José de la Esquina`);
      return reply({ ok: true });
    }

    return reply({ error: "Acción desconocida" });
  } catch (e) {
    return reply({ error: String(e) }, 500);
  }
});
