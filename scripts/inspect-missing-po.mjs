import 'dotenv/config';
import mysql from 'mysql2/promise';

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await connection.query(`
  SELECT \`vendorName\`, \`arrivalAt\`, DATE(\`createdAt\`) AS createdDate, COUNT(*) AS total
  FROM \`products\`
  WHERE \`currentStationCode\` = 'A1' AND \`archivedAt\` IS NULL AND (\`poNumber\` IS NULL OR \`poNumber\` = '')
  GROUP BY \`vendorName\`, \`arrivalAt\`, DATE(\`createdAt\`)
  ORDER BY total DESC, createdDate DESC
  LIMIT 20
`);
console.log(JSON.stringify(rows, null, 2));
await connection.end();
