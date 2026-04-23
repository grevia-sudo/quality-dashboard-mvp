import {
  boolean,
  date,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const userRoleEnum = mysqlEnum("role", ["user", "admin", "manager", "engineer", "supervisor"]);
export const stationCodeEnum = mysqlEnum("stationCode", ["A1", "A2", "B", "C", "D", "E", "STOCK"]);
export const productStatusEnum = mysqlEnum("productStatus", [
  "pending_a1",
  "pending_a2",
  "pending_b",
  "pending_c",
  "pending_d",
  "pending_e",
  "pending_stock",
  "completed",
  "archived",
]);
export const stationTaskStatusEnum = mysqlEnum("stationTaskStatus", ["pending", "in_progress", "completed", "returned", "overdue", "archived"]);
export const stationEventTypeEnum = mysqlEnum("stationEventType", [
  "enter",
  "complete",
  "return_to_hub",
  "rework",
  "sampling_pass",
  "sampling_fail",
  "wipe_complete",
  "stock_ready",
  "archived",
]);
export const syncJobStatusEnum = mysqlEnum("syncJobStatus", ["queued", "processing", "success", "failed"]);
export const defectOptionTypeEnum = mysqlEnum("defectOptionType", ["fault", "appearance", "camera"]);

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRoleEnum.default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const productCategories = mysqlTable("product_categories", {
  id: int("id").autoincrement().primaryKey(),
  categoryName: varchar("categoryName", { length: 120 }).notNull(),
  subtypeCode: varchar("subtypeCode", { length: 80 }).notNull(),
  brandName: varchar("brandName", { length: 80 }),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const stationRules = mysqlTable("station_rules", {
  id: int("id").autoincrement().primaryKey(),
  stationCode: stationCodeEnum.notNull(),
  routeKey: varchar("routeKey", { length: 80 }).notNull(),
  nextStationCode: mysqlEnum("nextStationCode", ["A1", "A2", "B", "C", "D", "E", "STOCK"]),
  allowReworkToCode: mysqlEnum("allowReworkToCode", ["A1", "A2", "B", "C", "D", "E", "STOCK"]),
  active: boolean("active").default(true).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const defectOptions = mysqlTable("defect_options", {
  id: int("id").autoincrement().primaryKey(),
  stationCode: stationCodeEnum.notNull(),
  optionType: defectOptionTypeEnum.notNull(),
  label: varchar("label", { length: 160 }).notNull(),
  active: boolean("active").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const productNameOptions = mysqlTable("product_name_options", {
  id: int("id").autoincrement().primaryKey(),
  label: varchar("label", { length: 160 }).notNull(),
  active: boolean("active").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  productCode: varchar("productCode", { length: 120 }).notNull().unique(),
  poNumber: varchar("poNumber", { length: 120 }),
  vendorName: varchar("vendorName", { length: 160 }),
  batchNo: varchar("batchNo", { length: 120 }),
  serialNumber: varchar("serialNumber", { length: 120 }),
  imei: varchar("imei", { length: 120 }),
  productName: varchar("productName", { length: 160 }),
  arrivalAt: timestamp("arrivalAt"),
  warrantyDate: date("warrantyDate"),
  importedCategoryName: varchar("importedCategoryName", { length: 120 }),
  categoryId: int("categoryId").references(() => productCategories.id),
  currentStationCode: stationCodeEnum.default("A1").notNull(),
  currentStatus: productStatusEnum.default("pending_a1").notNull(),
  inspectionSummary: text("inspectionSummary"),
  sheetRowNumber: int("sheetRowNumber"),
  lastSheetSyncedAt: timestamp("lastSheetSyncedAt"),
  wipeStatus: varchar("wipeStatus", { length: 40 }).default("pending"),
  stockStatus: varchar("stockStatus", { length: 40 }).default("pending"),
  archivedAt: timestamp("archivedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  a1ImeiLookupIdx: index("products_a1_imei_lookup_idx").on(table.currentStationCode, table.archivedAt, table.imei),
  a1SerialLookupIdx: index("products_a1_serial_lookup_idx").on(table.currentStationCode, table.archivedAt, table.serialNumber),
  a1BatchLookupIdx: index("products_a1_batch_lookup_idx").on(table.currentStationCode, table.archivedAt, table.batchNo),
  stationStatusIdx: index("products_station_status_idx").on(table.currentStationCode, table.currentStatus, table.archivedAt),
}));

export const stationTasks = mysqlTable("station_tasks", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("productId").notNull().references(() => products.id),
  stationCode: stationCodeEnum.notNull(),
  assignedUserId: int("assignedUserId").references(() => users.id),
  taskStatus: stationTaskStatusEnum.default("pending").notNull(),
  dueDate: date("dueDate"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  isOverdue: boolean("isOverdue").default(false).notNull(),
  resultSummary: text("resultSummary"),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  productStationStatusIdx: index("station_tasks_product_station_status_idx").on(table.productId, table.stationCode, table.taskStatus),
  stationQueueIdx: index("station_tasks_station_queue_idx").on(table.stationCode, table.taskStatus, table.isOverdue, table.id),
}));

export const stationEvents = mysqlTable("station_events", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("productId").notNull().references(() => products.id),
  stationTaskId: int("stationTaskId").references(() => stationTasks.id),
  stationCode: stationCodeEnum.notNull(),
  eventType: stationEventTypeEnum.notNull(),
  operatorUserId: int("operatorUserId").references(() => users.id),
  businessDate: date("businessDate").notNull(),
  categoryId: int("categoryId").references(() => productCategories.id),
  subtypeCode: varchar("subtypeCode", { length: 80 }),
  isRework: boolean("isRework").default(false).notNull(),
  reworkRound: int("reworkRound").default(0).notNull(),
  countForProductivity: boolean("countForProductivity").default(true).notNull(),
  payload: json("payload"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const samplingResults = mysqlTable("sampling_results", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("productId").notNull().references(() => products.id),
  stationTaskId: int("stationTaskId").references(() => stationTasks.id),
  sampledByUserId: int("sampledByUserId").references(() => users.id),
  sampleDate: date("sampleDate").notNull(),
  passed: boolean("passed").notNull(),
  defectReason: text("defectReason"),
  reworkToStationCode: stationCodeEnum.default("C").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const productivityTargetConfigs = mysqlTable("productivity_target_configs", {
  id: int("id").autoincrement().primaryKey(),
  stationCode: stationCodeEnum.notNull(),
  categoryId: int("categoryId").references(() => productCategories.id),
  subtypeCode: varchar("subtypeCode", { length: 80 }).notNull(),
  dailyTargetQty: int("dailyTargetQty").notNull(),
  baseUnitPoints: decimal("baseUnitPoints", { precision: 12, scale: 6 }).notNull(),
  qualityDeductionThreshold: decimal("qualityDeductionThreshold", { precision: 8, scale: 4 }).default("0.0000"),
  reworkFactor: decimal("reworkFactor", { precision: 8, scale: 4 }).default("0.5000").notNull(),
  effectiveFrom: date("effectiveFrom").notNull(),
  effectiveTo: date("effectiveTo"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const productivityScoreDetails = mysqlTable("productivity_score_details", {
  id: int("id").autoincrement().primaryKey(),
  businessDate: date("businessDate").notNull(),
  userId: int("userId").notNull().references(() => users.id),
  stationEventId: int("stationEventId").notNull().references(() => stationEvents.id),
  productId: int("productId").notNull().references(() => products.id),
  stationCode: stationCodeEnum.notNull(),
  categoryId: int("categoryId").references(() => productCategories.id),
  subtypeCode: varchar("subtypeCode", { length: 80 }),
  targetConfigId: int("targetConfigId"),
  completedQty: int("completedQty").default(1).notNull(),
  baseUnitPoints: decimal("baseUnitPoints", { precision: 12, scale: 6 }).notNull(),
  reworkFactor: decimal("reworkFactor", { precision: 8, scale: 4 }).default("1.0000").notNull(),
  qualityFactor: decimal("qualityFactor", { precision: 8, scale: 4 }).default("1.0000").notNull(),
  earnedPoints: decimal("earnedPoints", { precision: 12, scale: 6 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const engineerDailyProductivity = mysqlTable("engineer_daily_productivity", {
  id: int("id").autoincrement().primaryKey(),
  businessDate: date("businessDate").notNull(),
  userId: int("userId").notNull().references(() => users.id),
  attendanceFlag: boolean("attendanceFlag").default(true).notNull(),
  totalPoints: decimal("totalPoints", { precision: 12, scale: 6 }).default("0.000000").notNull(),
  rawAchievementRate: decimal("rawAchievementRate", { precision: 8, scale: 2 }).default("0.00").notNull(),
  kpiAchievementRate: decimal("kpiAchievementRate", { precision: 8, scale: 2 }).default("0.00").notNull(),
  overAchievementRate: decimal("overAchievementRate", { precision: 8, scale: 2 }).default("0.00").notNull(),
  samplingFailRate: decimal("samplingFailRate", { precision: 8, scale: 4 }).default("0.0000").notNull(),
  reworkRate: decimal("reworkRate", { precision: 8, scale: 4 }).default("0.0000").notNull(),
  overdueCount: int("overdueCount").default(0).notNull(),
  avgProcessHours: decimal("avgProcessHours", { precision: 8, scale: 2 }).default("0.00").notNull(),
  attendanceFairnessFactor: decimal("attendanceFairnessFactor", { precision: 8, scale: 4 }).default("1.0000").notNull(),
  finalKpiScore: decimal("finalKpiScore", { precision: 12, scale: 6 }).default("0.000000").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const sheetSyncJobs = mysqlTable("sheet_sync_jobs", {
  id: int("id").autoincrement().primaryKey(),
  jobType: varchar("jobType", { length: 80 }).notNull(),
  targetSheetName: varchar("targetSheetName", { length: 160 }).notNull(),
  status: syncJobStatusEnum.default("queued").notNull(),
  queuedAt: timestamp("queuedAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  finishedAt: timestamp("finishedAt"),
  errorMessage: text("errorMessage"),
});

export const productArchives = mysqlTable("product_archives", {
  id: int("id").autoincrement().primaryKey(),
  originalProductId: int("originalProductId").notNull(),
  productSnapshot: json("productSnapshot").notNull(),
  archivedAt: timestamp("archivedAt").defaultNow().notNull(),
  archiveMonth: varchar("archiveMonth", { length: 7 }).notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Product = typeof products.$inferSelect;
export type StationTask = typeof stationTasks.$inferSelect;
export type StationEvent = typeof stationEvents.$inferSelect;
export type ProductivityTargetConfig = typeof productivityTargetConfigs.$inferSelect;
export type EngineerDailyProductivity = typeof engineerDailyProductivity.$inferSelect;
