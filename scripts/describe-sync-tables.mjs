import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) {
  throw new Error("缺少 DATABASE_URL");
}

const connection = await mysql.createConnection(process.env.DATABASE_URL);

try {
  const [productColumns] = await connection.query("SHOW COLUMNS FROM products");
  const [jobColumns] = await connection.query("SHOW COLUMNS FROM sheet_sync_jobs");
  console.log(JSON.stringify({ productColumns, jobColumns }, null, 2));
} finally {
  await connection.end();
}
