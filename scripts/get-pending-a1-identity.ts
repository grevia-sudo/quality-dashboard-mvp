import { getStationPageData } from "../server/db";

async function main() {
  const stationData = await getStationPageData("A1");
  const task = stationData.tasks.find((item) => item.serialNumber || item.imei || item.batchNo);

  if (!task) {
    throw new Error("找不到可用於驗證的 A1 待處理商品");
  }

  const payload = {
    productCode: task.productCode,
    batchNo: task.batchNo ?? "",
    serialNumber: task.serialNumber ?? "",
    imei: task.imei ?? "",
    currentProductName: task.productName ?? "",
  };

  console.log(JSON.stringify(payload));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
