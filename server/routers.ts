import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  completeStationTask,
  ensureMvpSeedData,
  getAdminSetupData,
  getEngineerKpiSummary,
  getSamplingQueue,
  getStationOverviewData,
  getStationPageData,
  seedKpiForDemo,
  submitSamplingResult,
} from "./db";

const stationCodeSchema = z.enum(["A1", "A2", "B", "C", "D", "E", "STOCK"]);

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(async (opts) => {
      if (opts.ctx.user) {
        await ensureMvpSeedData();
        await seedKpiForDemo(opts.ctx.user.id);
      }
      return opts.ctx.user;
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  dashboard: router({
    home: protectedProcedure.query(async ({ ctx }) => {
      await ensureMvpSeedData();
      const stations = await getStationOverviewData();
      const kpi = await getEngineerKpiSummary(ctx.user.id);
      const roleLanding = ["admin", "manager", "supervisor"].includes(ctx.user.role) ? "dashboard" : "operations";

      return {
        roleLanding,
        stations,
        kpi,
      };
    }),
  }),
  station: router({
    list: protectedProcedure.query(async () => {
      await ensureMvpSeedData();
      return getStationOverviewData();
    }),
    detail: protectedProcedure.input(z.object({ stationCode: stationCodeSchema })).query(async ({ input }) => {
      await ensureMvpSeedData();
      return getStationPageData(input.stationCode);
    }),
    complete: protectedProcedure
      .input(
        z.object({
          taskId: z.number(),
          stationCode: stationCodeSchema.exclude(["D"]),
          productId: z.number(),
          categoryId: z.number().nullable().optional(),
          subtypeCode: z.string().nullable().optional(),
          summary: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        return completeStationTask({
          taskId: input.taskId,
          stationCode: input.stationCode,
          operatorUserId: ctx.user.id,
          productId: input.productId,
          categoryId: input.categoryId,
          subtypeCode: input.subtypeCode,
          summary: input.summary,
        });
      }),
  }),
  sampling: router({
    queue: protectedProcedure.query(async () => {
      await ensureMvpSeedData();
      return getSamplingQueue();
    }),
    submit: protectedProcedure
      .input(
        z.object({
          taskId: z.number(),
          productId: z.number(),
          passed: z.boolean(),
          defectReason: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        return submitSamplingResult({
          taskId: input.taskId,
          productId: input.productId,
          sampledByUserId: ctx.user.id,
          passed: input.passed,
          defectReason: input.defectReason,
        });
      }),
  }),
  engineer: router({
    kpi: protectedProcedure.query(async ({ ctx }) => {
      await ensureMvpSeedData();
      await seedKpiForDemo(ctx.user.id);
      return getEngineerKpiSummary(ctx.user.id);
    }),
  }),
  admin: router({
    setup: adminProcedure.query(async () => {
      await ensureMvpSeedData();
      return getAdminSetupData();
    }),
  }),
});

export type AppRouter = typeof appRouter;
