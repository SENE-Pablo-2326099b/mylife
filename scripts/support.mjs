// Messages reçus au support (lisibles par l'éditeur), puis effacement de ceux traités.
//   DATABASE_URL=… node scripts/support.mjs            liste
//   DATABASE_URL=… node scripts/support.mjs done <id>  efface un message traité
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL manquante (vercel env pull, puis export).');
  process.exit(1);
}
const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  await db.query('CREATE TABLE IF NOT EXISTS support_messages (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, app TEXT NOT NULL, message TEXT NOT NULL, created_at BIGINT NOT NULL)');
  const [cmd, id] = process.argv.slice(2);
  if (cmd === 'done' && id) {
    const r = await db.query('DELETE FROM support_messages WHERE id = $1', [id]);
    console.log(r.rowCount ? `Message ${id} effacé.` : `Aucun message ${id}.`);
  } else {
    const { rows } = await db.query(
      `SELECT m.id, m.kind, m.app, m.message, m.created_at, u.login FROM support_messages m LEFT JOIN users u ON u.id = m.user_id ORDER BY m.created_at`,
    );
    if (!rows.length) console.log('Aucun message.');
    for (const r of rows) console.log(`\n[${r.id}] ${new Date(Number(r.created_at)).toLocaleString('fr-FR')} · ${r.kind} · ${r.app} · ${r.login ?? 'compte supprimé'}\n${r.message}`);
  }
} finally {
  await db.end();
}
