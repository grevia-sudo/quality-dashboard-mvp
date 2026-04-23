import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL 不存在");
}

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const appNow = new Date();
const appTaipei = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
}).format(appNow);

try {
  const [rows] = await connection.query(`
    SELECT
      NOW() AS dbNow,
      UTC_TIMESTAMP() AS dbUtcNow,
      @@global.time_zone AS globalTimeZone,
      @@session.time_zone AS sessionTimeZone,
      TIMESTAMPDIFF(HOUR, UTC_TIMESTAMP(), NOW()) AS hourOffset,
      TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), NOW()) AS minuteOffset
  `);

  console.log(JSON.stringify({ appNow: appNow.toISOString(), appTaipei, db: rows }, null, 2));
} finally {
  await connection.end();
}
