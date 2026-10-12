import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async () => {
  const user = Deno.env.get("GMAIL_USER");
  const pass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!user || !pass) return json({ error: "Faltan los secretos GMAIL_USER y GMAIL_APP_PASSWORD" }, 500);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: pending, error } = await sb.from("alert_outbox").select("*").eq("status", "pending").order("id").limit(20);
  if (error) return json({ error: error.message }, 500);
  if (!pending?.length) return json({ sent: 0 });

  const { data: rcpts } = await sb.from("alert_recipients").select("email").eq("active", true);
  const to = (rcpts ?? []).map((r) => r.email);

  const transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
  let sent = 0;
  for (const m of pending) {
    try {
      const dest = m.to_email ? [m.to_email] : to;
      if (!dest.length) throw new Error("No hay destinatarios activos");
      await transport.sendMail({ from: `Central de Monitoreo <${user}>`, to: dest, subject: m.subject, text: m.body });
      await sb.from("alert_outbox").update({ status: "sent", sent_at: new Date().toISOString(), attempts: m.attempts + 1, last_error: null }).eq("id", m.id);
      sent++;
    } catch (e) {
      const attempts = m.attempts + 1;
      await sb.from("alert_outbox").update({ status: attempts >= 5 ? "error" : "pending", attempts, last_error: String(e).slice(0, 500) }).eq("id", m.id);
    }
  }
  return json({ sent, total: pending.length });
});
