import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not available');
  }

  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  const [countRows] = await connection.query(
    'SELECT COUNT(*) AS total, MIN(sortOrder) AS minSortOrder, MAX(sortOrder) AS maxSortOrder FROM product_name_options'
  );
  const [sampleRows] = await connection.query(
    'SELECT label, sortOrder FROM product_name_options ORDER BY sortOrder ASC, id ASC LIMIT 15'
  );
  await connection.end();

  console.log(
    JSON.stringify(
      {
        summary: countRows[0],
        sample: sampleRows,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
