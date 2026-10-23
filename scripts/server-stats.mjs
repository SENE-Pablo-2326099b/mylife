// État du serveur pour l'éditeur : comptes, données par app, espaces, taille de la base (face aux limites
// des offres gratuites). Ne lit aucun contenu : tout est chiffré ; seulement des nombres.
//   DATABASE_URL=… node scripts/server-stats.mjs
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL manquante (vercel env pull, puis export).');
  process.exit(1);
}
const db = new pg.Client({ connectionString: url });
await db.connect();
const one = async (sql, args = []) => (await db.query(sql, args).catch(() => ({ rows: [] }))).rows;
const n = (v) => Number(v ?? 0).toLocaleString('fr-FR');
const DAY = 86_400_000;
const now = Date.now();
try {
  const users = await one('SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE created_at > $1) AS week FROM users', [now - 7 * DAY]);
  const active = await one('SELECT COUNT(DISTINCT user_id) AS d7 FROM records WHERE updated_at > $1', [now - 7 * DAY]);
  const active30 = await one('SELECT COUNT(DISTINCT user_id) AS d30 FROM records WHERE updated_at > $1', [now - 30 * DAY]);
  const perApp = await one('SELECT app, COUNT(*) AS n, COALESCE(SUM(LENGTH(payload)), 0) AS bytes FROM records GROUP BY app ORDER BY app');
  const spaces = await one('SELECT kind, COUNT(*) AS n FROM spaces GROUP BY kind ORDER BY kind');
  const members = await one('SELECT COUNT(*) AS n FROM space_members');
  const support = await one('SELECT COUNT(*) AS n FROM support_messages');
  const size = await one('SELECT pg_database_size(current_database()) AS bytes');
  const tables = await one(`SELECT relname AS t, pg_total_relation_size(relid) AS bytes FROM pg_catalog.pg_statio_user_tables ORDER BY bytes DESC LIMIT 6`);
  const mb = (b) => `${(Number(b) / 1_048_576).toFixed(1)} Mo`;
  console.log(`Comptes : ${n(users[0]?.n)} (dont ${n(users[0]?.week)} cette semaine) · actifs 7 j : ${n(active[0]?.d7)} · 30 j : ${n(active30[0]?.d30)}`);
  console.log('Données synchronisées (chiffrées) :');
  for (const r of perApp) console.log(`  ${r.app.padEnd(9)} ${n(r.n).padStart(10)} lignes · ${mb(r.bytes)}`);
  console.log(`Espaces partagés : ${spaces.map((s) => `${s.kind} ${n(s.n)}`).join(' · ') || 'aucun'} · ${n(members[0]?.n)} adhésions`);
  console.log(`Messages au support en attente : ${n(support[0]?.n)} (node scripts/support.mjs)`);
  const total = Number(size[0]?.bytes ?? 0);
  console.log(`Base : ${mb(total)} sur 512 Mo de l'offre gratuite de Neon (${((total / 536_870_912) * 100).toFixed(1)} %)`);
  for (const t of tables) console.log(`  ${t.t.padEnd(20)} ${mb(t.bytes)}`);
  if (total > 0.8 * 536_870_912) console.log('⚠ Plus de 80 % : passer à l’offre payante de Neon ou faire du ménage.');
} finally {
  await db.end();
}
