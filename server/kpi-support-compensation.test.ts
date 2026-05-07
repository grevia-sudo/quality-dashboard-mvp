import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { engineerDailyProductivity, supportTaskCompensations, users } from "../drizzle/schema";
import {
  createSupportCompensation,
  deleteSupportCompensation,
  getAdminSetupData,
  getDb,
  getEngineerKpiSummary,
  getSupportCompensationPointsForUser,
  listSupportCompensations,
} from "./db";

const createdUserIds: number[] = [];

function getDateKey(offsetDays = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function toDateValue(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

async function createTestUsers() {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const adminOpenId = `support-admin-${uniqueSuffix}`;
  const engineerOpenId = `support-engineer-${uniqueSuffix}`;

  await db.insert(users).values([
    {
      openId: adminOpenId,
      username: `support-admin-${uniqueSuffix}`,
      name: "Support Admin",
      loginMethod: "password",
      role: "admin",
    },
    {
      openId: engineerOpenId,
      username: `support-engineer-${uniqueSuffix}`,
      name: "Support Engineer",
      loginMethod: "password",
      role: "engineer",
    },
  ]);

  const insertedUsers = await db
    .select({
      id: users.id,
      openId: users.openId,
    })
    .from(users)
    .where(inArray(users.openId, [adminOpenId, engineerOpenId]));

  const adminUser = insertedUsers.find((item) => item.openId === adminOpenId);
  const engineerUser = insertedUsers.find((item) => item.openId === engineerOpenId);

  if (!adminUser || !engineerUser) {
    throw new Error("Failed to create support compensation test users");
  }

  createdUserIds.push(adminUser.id, engineerUser.id);

  return {
    adminUserId: adminUser.id,
    engineerUserId: engineerUser.id,
  };
}

async function seedEngineerDailyProductivity(userId: number, dateKey: string, totalPoints: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  await db.insert(engineerDailyProductivity).values({
    businessDate: toDateValue(dateKey),
    userId,
    attendanceFlag: true,
    totalPoints: totalPoints.toFixed(6),
    rawAchievementRate: (totalPoints * 100).toFixed(2),
    kpiAchievementRate: Math.min(totalPoints * 100, 100).toFixed(2),
    overAchievementRate: Math.max(totalPoints * 100 - 100, 0).toFixed(2),
    finalKpiScore: Math.min(totalPoints * 100, 100).toFixed(6),
  });
}

async function cleanupCreatedRows() {
  const db = await getDb();
  if (!db || createdUserIds.length === 0) {
    return;
  }

  await db.delete(supportTaskCompensations).where(inArray(supportTaskCompensations.userId, createdUserIds));
  await db.delete(engineerDailyProductivity).where(inArray(engineerDailyProductivity.userId, createdUserIds));
  await db.delete(users).where(inArray(users.id, createdUserIds));
  createdUserIds.length = 0;
}

afterEach(async () => {
  await cleanupCreatedRows();
});

describe("support compensation KPI integration", () => {
  it("creates, lists, sums, and deletes support compensation records", async () => {
    const { adminUserId, engineerUserId } = await createTestUsers();
    const todayKey = getDateKey(0);

    await createSupportCompensation({
      businessDate: todayKey,
      userId: engineerUserId,
      supportTask: "D 站全檢支援",
      supportHours: 4,
      notes: "跨站支援",
      createdByUserId: adminUserId,
    });

    const compensationRows = await listSupportCompensations({
      startDate: todayKey,
      endDate: todayKey,
      userId: engineerUserId,
    });

    expect(compensationRows).toHaveLength(1);
    expect(compensationRows[0]?.supportTask).toBe("D 站全檢支援");
    expect(Number(compensationRows[0]?.supportHours ?? 0)).toBeCloseTo(4, 5);

    const supportPoints = await getSupportCompensationPointsForUser(engineerUserId, todayKey);
    expect(supportPoints).toBeCloseTo(0.5, 5);

    await deleteSupportCompensation(compensationRows[0]!.id);
    const deletedRows = await listSupportCompensations({
      startDate: todayKey,
      endDate: todayKey,
      userId: engineerUserId,
    });
    expect(deletedRows).toHaveLength(0);
  }, 20000);

  it("adds support compensation into engineer daily and monthly KPI summary", async () => {
    const { adminUserId, engineerUserId } = await createTestUsers();
    const todayKey = getDateKey(0);
    const yesterdayKey = getDateKey(-1);

    await createSupportCompensation({
      businessDate: yesterdayKey,
      userId: engineerUserId,
      supportTask: "匯入協助",
      supportHours: 2,
      notes: "支援匯入",
      createdByUserId: adminUserId,
    });
    await createSupportCompensation({
      businessDate: todayKey,
      userId: engineerUserId,
      supportTask: "D 站全檢支援",
      supportHours: 4,
      notes: "支援 D 站",
      createdByUserId: adminUserId,
    });

    const summary = await getEngineerKpiSummary(engineerUserId);

    expect(summary.dailySummary?.totalPoints).toBeCloseTo(0.5, 5);
    expect(summary.dailySummary?.displayPoints).toBeCloseTo(50, 5);
    expect(summary.dailySummary?.supportPoints).toBeCloseTo(0.5, 5);
    expect(summary.dailySummary?.supportDisplayPoints).toBeCloseTo(50, 5);
    expect(summary.monthlySummary.attendanceDays).toBe(2);
    expect(summary.monthlySummary.monthTotalPoints).toBeCloseTo(0.75, 5);
    expect(summary.monthlySummary.monthTotalDisplayPoints).toBeCloseTo(75, 5);
    expect(summary.monthlySummary.monthAvgPoints).toBeCloseTo(0.375, 5);
    expect(summary.monthlySummary.monthAvgDisplayPoints).toBeCloseTo(37.5, 5);
  });

  it("surfaces support compensation in admin KPI progress and support list", async () => {
    const { adminUserId, engineerUserId } = await createTestUsers();
    const todayKey = getDateKey(0);
    const yesterdayKey = getDateKey(-1);

    await seedEngineerDailyProductivity(engineerUserId, yesterdayKey, 0.25);
    await seedEngineerDailyProductivity(engineerUserId, todayKey, 0.5);

    await createSupportCompensation({
      businessDate: yesterdayKey,
      userId: engineerUserId,
      supportTask: "匯入協助",
      supportHours: 2,
      notes: "支援匯入",
      createdByUserId: adminUserId,
    });
    await createSupportCompensation({
      businessDate: todayKey,
      userId: engineerUserId,
      supportTask: "D 站全檢支援",
      supportHours: 4,
      notes: "支援 D 站",
      createdByUserId: adminUserId,
    });

    const setup = await getAdminSetupData({
      startDate: yesterdayKey,
      endDate: todayKey,
    });

    const engineerProgress = setup.kpiProgress.find((item) => item.userId === engineerUserId);
    expect(engineerProgress).toBeTruthy();
    expect(engineerProgress?.todayDisplayPoints).toBeCloseTo(100, 5);
    expect(engineerProgress?.monthTotalDisplayPoints).toBeCloseTo(150, 5);
    expect(engineerProgress?.monthAvgDisplayPoints).toBeCloseTo(75, 5);
    expect(engineerProgress?.todaySupportDisplayPoints).toBeCloseTo(50, 5);
    expect(engineerProgress?.todaySupportHours).toBeCloseTo(4, 5);

    const listedSupportRows = setup.supportCompensations.filter((item) => item.userId === engineerUserId);
    expect(listedSupportRows).toHaveLength(2);
    expect(listedSupportRows.every((item) => item.engineerName === "Support Engineer")).toBe(true);
  }, 20000);
});
