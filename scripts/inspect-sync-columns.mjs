import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL 不存在");
}

const connection = await mysql.createConnection(process.env.DATABASE_URL);

try {
  const [taskColumns] = await connection.query("SHOW COLUMNS FROM station_tasks");
  const [eventColumns] = await connection.query("SHOW COLUMNS FROM station_events");
  console.log(JSON.stringify({ taskColumns, eventColumns }, null, 2));
} finally {
  await connection.end();
}
