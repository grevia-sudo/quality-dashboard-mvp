import { getStationPageData } from "../server/db.ts";

const result = await getStationPageData("STOCK");

console.log(JSON.stringify({
  stationCode: result.stationCode,
  taskCount: result.tasks.length,
  sampleTasks: result.tasks.slice(0, 10).map((task) => ({
    taskId: task.taskId,
    productId: task.productId,
    productCode: task.productCode,
    batchNo: task.batchNo,
    taskStatus: task.taskStatus,
  })),
}, null, 2));
