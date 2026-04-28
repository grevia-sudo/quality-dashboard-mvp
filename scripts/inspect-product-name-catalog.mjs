import { getProductNameOptions, syncProductNameOptionsFromGoogleSheet } from "../server/db.ts";

const result = await syncProductNameOptionsFromGoogleSheet();
const options = await getProductNameOptions();

console.log(JSON.stringify({
  result,
  totalOptions: options.length,
  firstFive: options.slice(0, 5),
  firstIphone: options.find((option) => option.label.includes("iPhone")) ?? null,
  firstWithBrand: options.find((option) => option.brandName) ?? null,
}, null, 2));
