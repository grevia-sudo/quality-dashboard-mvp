import { createPool } from 'mysql2/promise';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set');
}

const url = new URL(databaseUrl);
const pool = createPool({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, ''),
  ssl: { rejectUnauthorized: false },
});

const [rows] = await pool.query(`
  select column_name, data_type
  from information_schema.columns
  where table_schema = database()
    and table_name = 'users'
  order by ordinal_position
`);

console.log(JSON.stringify(rows, null, 2));
await pool.end();
