const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
if (!raw) {
  console.error("GOOGLE_SERVICE_ACCOUNT_JSON not found");
  process.exit(1);
}
const credentials = JSON.parse(raw);
if (!credentials.client_email) {
  console.error("client_email missing");
  process.exit(1);
}
console.log(credentials.client_email);
