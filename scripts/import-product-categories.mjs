import { createProductCategoryOption, getProductCategoryOptions } from "../server/db.ts";

const entries = [
  ["液晶螢幕", "Acer"],
  ["筆記型電腦", "Acer"],
  ["平板電腦", "Apple"],
  ["耳機音響", "Apple"],
  ["穿戴型設備", "Apple"],
  ["穿戴裝置", "Apple"],
  ["桌上型電腦", "Apple"],
  ["液晶螢幕", "Apple"],
  ["智慧型手機", "Apple"],
  ["筆記型電腦", "Apple"],
  ["影音周邊", "Apple"],
  ["觸控筆", "Apple"],
  ["智慧型手機", "ASUS"],
  ["筆記型電腦", "DELL"],
  ["液晶螢幕", "Gigabyte"],
  ["車用週邊", "GOLIFE"],
  ["智慧型手機", "Google"],
  ["筆記型電腦", "HP"],
  ["筆記型電腦", "Lenovo"],
  ["智慧型手機", "Motorola"],
  ["桌上型電腦", "MSI"],
  ["液晶螢幕", "MSI"],
  ["筆記型電腦", "MSI"],
  ["智慧型手機", "OPPO"],
  ["車用週邊", "PAPAGO"],
  ["智慧型手機", "POCO"],
  ["平板電腦", "Redmi"],
  ["智慧型手機", "Redmi"],
  ["液晶螢幕", "Samsung"],
  ["智慧型手機", "Samsung"],
  ["智慧型手機", "SONY"],
  ["筆記型電腦", "TOSHIBA"],
  ["智慧型手機", "vivo"],
  ["平板電腦", "Xiaomi"],
  ["智慧型手機", "Xiaomi"],
];

const deduped = Array.from(new Map(entries.map(([categoryName, brandName]) => [`${categoryName}__${brandName}`, { categoryName, brandName }])).values());

for (const entry of deduped) {
  await createProductCategoryOption(entry);
}

const allCategories = await getProductCategoryOptions();
const matched = deduped.filter(({ categoryName, brandName }) => allCategories.some((item) => item.categoryName === categoryName && item.brandName === brandName));

console.log(JSON.stringify({
  requestedCount: entries.length,
  insertedOrEnsuredCount: deduped.length,
  matchedCount: matched.length,
  missing: deduped.filter(({ categoryName, brandName }) => !matched.some((item) => item.categoryName === categoryName && item.brandName === brandName)),
}, null, 2));
