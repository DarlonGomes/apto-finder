// Email OTP auth, profile and shared searches. No passwords: POST /api/auth/start
// mails a 6-digit code, /api/auth/verify trades it for an HttpOnly session
// cookie (creating the user on first login). Everything else under /api needs
// the cookie; `requireUser` puts the user on the context.

import { Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { normEmail, validateSearch, type Me, type Search } from "@apto/shared";
import { dbFor, type Bindings, type Sql } from "./db";

export type User = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  home_neighborhood: string | null;
  home_city: string | null;
  referral: string | null;
};
export type Env = { Bindings: Bindings; Variables: { user: User } };

const CODE_TTL = "10 minutes";
const RESEND_AFTER = "60 seconds";
const MAX_ATTEMPTS = 5;
const SESSION_DAYS = 90;

const sha256 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export async function sendMail(env: Bindings, to: string, subject: string, text: string) {
  if (!env.EMAIL || !env.DIGEST_FROM) {
    console.log(`[mail to ${to}] ${subject}\n${text}`); // local dev: read the code from the log
    return;
  }
  await env.EMAIL.send({ from: { name: "apto-finder", email: env.DIGEST_FROM }, to, subject, text });
}

export const requireUser: MiddlewareHandler<Env> = async (c, next) => {
  const sid = getCookie(c, "sid");
  if (!sid) return c.json({ error: "unauthenticated" }, 401);
  const [user] = await dbFor(c.env)`
    SELECT u.id, u.email, u.first_name, u.last_name, u.home_neighborhood, u.home_city, u.referral
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${await sha256(sid)} AND s.expires_at > now()`;
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  c.set("user", user as User);
  await next();
};

/** The search if `email` is a member, else null. */
export async function memberSearch(sql: Sql, searchId: string | undefined, email: string) {
  if (!searchId || !/^[0-9a-f-]{36}$/.test(searchId)) return null;
  const [s] = await sql`
    SELECT s.* FROM searches s JOIN search_members m ON m.search_id = s.id
    WHERE s.id = ${searchId} AND m.email = ${email}`;
  return (s as Omit<Search, "members">) ?? null;
}

export const auth = new Hono<Env>();

auth.post("/start", async (c) => {
  const email = normEmail((await c.req.json().catch(() => ({}))).email);
  if (!email) return c.json({ error: "email inválido" }, 400);
  const sql = dbFor(c.env);
  // ponytail: per-email cooldown only; add a Cloudflare rate-limit rule on
  // /api/auth/* if someone starts spraying addresses.
  const [recent] = await sql`SELECT 1 FROM login_codes
    WHERE email = ${email} AND sent_at > now() - ${RESEND_AFTER}::interval`;
  if (recent) return c.json({ error: "aguarde um minuto para pedir outro código" }, 429);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, "0");
  await sql`INSERT INTO login_codes (email, code_hash, expires_at, attempts, sent_at)
    VALUES (${email}, ${await sha256(`${email}:${code}`)}, now() + ${CODE_TTL}::interval, 0, now())
    ON CONFLICT (email) DO UPDATE SET code_hash = EXCLUDED.code_hash,
      expires_at = EXCLUDED.expires_at, attempts = 0, sent_at = now()`;
  await sendMail(
    c.env,
    email,
    `apto-finder: seu código é ${code}`,
    `Seu código de acesso ao apto-finder: ${code}\n\nVale por 10 minutos. Se não foi você, ignore este email.\n`,
  );
  return c.json({ ok: true });
});

auth.post("/verify", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = normEmail(body.email);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!email || !/^\d{6}$/.test(code)) return c.json({ error: "código inválido" }, 400);
  const sql = dbFor(c.env);
  // Count the attempt before comparing, so guesses are capped even when racing.
  const [row] = await sql`UPDATE login_codes SET attempts = attempts + 1
    WHERE email = ${email} AND expires_at > now() RETURNING code_hash, attempts`;
  if (!row || row.attempts > MAX_ATTEMPTS || row.code_hash !== (await sha256(`${email}:${code}`)))
    return c.json({ error: "código inválido ou expirado" }, 401);
  await sql`DELETE FROM login_codes WHERE email = ${email}`;
  const [user] = await sql`INSERT INTO users (email) VALUES (${email})
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`;
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/[+/=]/g, (ch) => ({ "+": "-", "/": "_", "=": "" })[ch]!);
  await sql`INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (${await sha256(token)}, ${user!.id}, now() + ${`${SESSION_DAYS} days`}::interval)`;
  setCookie(c, "sid", token, {
    httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: SESSION_DAYS * 86400,
  });
  return c.json({ ok: true });
});

auth.post("/logout", async (c) => {
  const sid = getCookie(c, "sid");
  if (sid) await dbFor(c.env)`DELETE FROM sessions WHERE token_hash = ${await sha256(sid)}`;
  deleteCookie(c, "sid", { path: "/" });
  return c.json({ ok: true });
});

export const account = new Hono<Env>();

account.get("/me", async (c) => {
  const user = c.get("user");
  const searches = await dbFor(c.env)`
    SELECT s.*, (
      SELECT jsonb_agg(jsonb_build_object('email', m2.email, 'first_name', u.first_name) ORDER BY m2.created_at)
      FROM search_members m2 LEFT JOIN users u ON u.email = m2.email
      WHERE m2.search_id = s.id
    ) AS members
    FROM searches s JOIN search_members m ON m.search_id = s.id
    WHERE m.email = ${user.email} ORDER BY s.created_at`;
  const { id: _, ...profile } = user;
  return c.json({ ...profile, searches } satisfies Me);
});

const text = (v: unknown, max = 80) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

account.put("/me", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const first = text(b.first_name);
  const last = text(b.last_name);
  if (!first || !last) return c.json({ error: "nome e sobrenome são obrigatórios" }, 400);
  await dbFor(c.env)`UPDATE users SET first_name = ${first}, last_name = ${last},
    home_neighborhood = ${text(b.home_neighborhood)}, home_city = ${text(b.home_city)},
    referral = ${text(b.referral, 200)}
    WHERE id = ${c.get("user").id}`;
  return c.json({ ok: true });
});

async function invite(c: { env: Bindings }, sql: Sql, searchId: string, inviter: User, email: string) {
  const [added] = await sql`INSERT INTO search_members (search_id, email, invited_by)
    VALUES (${searchId}, ${email}, ${inviter.id}) ON CONFLICT DO NOTHING RETURNING email`;
  if (!added) return;
  const who = inviter.first_name ? `${inviter.first_name} ${inviter.last_name ?? ""}`.trim() : inviter.email;
  await sendMail(
    c.env,
    email,
    `${who} compartilhou uma busca de apartamento com você`,
    `${who} convidou você para acompanhar uma busca de aluguel no apto-finder.\n\n` +
      `Entre com este email (${email}) para ver os imóveis:\n${c.env.APP_URL ?? ""}\n`,
  );
}

const SEARCH_COLS = (s: Exclude<ReturnType<typeof validateSearch>, string>) => [
  s.name, s.neighborhoods, s.total_min_cents, s.total_max_cents, s.bedrooms_min,
  s.bathrooms_min, s.parking_min, s.pets, s.furnished, s.facilities,
];

account.post("/searches", async (c) => {
  const b = await c.req.json().catch(() => null);
  const s = validateSearch(b);
  if (typeof s === "string") return c.json({ error: s }, 400);
  const user = c.get("user");
  const sql = dbFor(c.env);
  const [row] = await sql.query(
    `INSERT INTO searches (name, neighborhoods, total_min_cents, total_max_cents, bedrooms_min,
       bathrooms_min, parking_min, pets, furnished, facilities, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [...SEARCH_COLS(s), user.id],
  );
  await sql`INSERT INTO search_members (search_id, email, invited_by) VALUES (${row.id}, ${user.email}, ${user.id})`;
  const invites = (Array.isArray(b.invite) ? b.invite : []).map(normEmail).filter(Boolean).slice(0, 10);
  for (const e of invites) if (e !== user.email) await invite(c, sql, row.id, user, e);
  return c.json({ id: row.id });
});

account.put("/searches/:id", async (c) => {
  const sql = dbFor(c.env);
  if (!(await memberSearch(sql, c.req.param("id"), c.get("user").email))) return c.json({ error: "not found" }, 404);
  const s = validateSearch(await c.req.json().catch(() => null));
  if (typeof s === "string") return c.json({ error: s }, 400);
  await sql.query(
    `UPDATE searches SET name = $1, neighborhoods = $2, total_min_cents = $3, total_max_cents = $4,
       bedrooms_min = $5, bathrooms_min = $6, parking_min = $7, pets = $8, furnished = $9,
       facilities = $10
     WHERE id = $11`,
    [...SEARCH_COLS(s), c.req.param("id")],
  );
  return c.json({ ok: true });
});

account.post("/searches/:id/members", async (c) => {
  const sql = dbFor(c.env);
  const user = c.get("user");
  const id = c.req.param("id");
  if (!(await memberSearch(sql, id, user.email))) return c.json({ error: "not found" }, 404);
  const email = normEmail((await c.req.json().catch(() => ({}))).email);
  if (!email) return c.json({ error: "email inválido" }, 400);
  await invite(c, sql, id, user, email);
  return c.json({ ok: true });
});
