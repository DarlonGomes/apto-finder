// Narrow digest (STATUS milestone 8): email ONLY when a shortlisted unit
// (liked / visit_booked / proposal_made) changed price or left the market in
// the window, plus a count of new units. Nothing changed = no email.
// ponytail: fixed 25h window (cron is daily), no run bookkeeping; a duplicate
// line on a slow day beats a missed one.

import type { Sql } from "./db";

const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const STATUS_LABEL: Record<string, string> = {
  liked: "gostei",
  visit_booked: "visita marcada",
  proposal_made: "proposta feita",
};

export async function buildDigest(
  sql: Sql,
  appUrl: string,
  hours = 25,
): Promise<{ subject: string; text: string } | null> {
  const window = `${hours} hours`;
  const rows: any[] = await sql.query(
    `
    SELECT u.id, u.neighborhood, u.street, s.status, l.source, l.delisted_at,
      ch.prev, ch.cur,
      NOT EXISTS (SELECT 1 FROM listings a WHERE a.unit_id = u.id AND a.delisted_at IS NULL) AS unit_gone
    FROM units u
    JOIN LATERAL (
      SELECT status FROM status_events WHERE unit_id = u.id ORDER BY id DESC LIMIT 1
    ) s ON s.status IN ('liked','visit_booked','proposal_made')
    JOIN listings l ON l.unit_id = u.id
    LEFT JOIN LATERAL (
      SELECT h.prev, h.total_monthly_cents AS cur FROM (
        SELECT total_monthly_cents, observed_at,
               lag(total_monthly_cents) OVER (ORDER BY observed_at) AS prev
        FROM price_history WHERE listing_id = l.id
      ) h
      WHERE h.observed_at > now() - $1::interval AND h.prev IS NOT NULL AND h.prev <> h.total_monthly_cents
      ORDER BY h.observed_at DESC LIMIT 1
    ) ch ON true
    WHERE ch.prev IS NOT NULL OR l.delisted_at > now() - $1::interval
    ORDER BY u.neighborhood, u.street`,
    [window],
  );

  const place = (r: any) => `${r.neighborhood}${r.street ? ` · ${r.street}` : ""}`;
  const link = (r: any) => `${appUrl}/?unit=${r.id}`;

  const priceLines = rows
    .filter((r) => r.prev != null)
    .map((r) => `- ${place(r)}: ${brl(r.prev)} → ${brl(r.cur)} (${r.source})\n  ${link(r)}`);
  // One line per unit that is fully off the market, whichever listing tripped it.
  const goneLines = [...new Map(
    rows.filter((r) => r.unit_gone && r.delisted_at).map((r) => [r.id, r]),
  ).values()].map((r) => `- ${place(r)} (${STATUS_LABEL[r.status] ?? r.status})\n  ${link(r)}`);

  if (priceLines.length === 0 && goneLines.length === 0) return null;

  const [{ n: fresh }] = (await sql.query(
    `SELECT count(DISTINCT unit_id)::int AS n FROM listings WHERE first_seen_at > now() - $1::interval`,
    [window],
  )) as any[];

  const today = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const parts = [`apto-finder · resumo de ${today}`];
  if (priceLines.length) parts.push(`Preço mudou:\n${priceLines.join("\n")}`);
  if (goneLines.length) parts.push(`Saiu do ar:\n${goneLines.join("\n")}`);
  parts.push(`${fresh} ${fresh === 1 ? "imóvel novo" : "imóveis novos"} desde ontem.\n${appUrl}`);

  const n = priceLines.length + goneLines.length;
  return {
    subject: `apto-finder: ${n} ${n === 1 ? "mudança" : "mudanças"} nos seus favoritos`,
    text: parts.join("\n\n") + "\n",
  };
}
