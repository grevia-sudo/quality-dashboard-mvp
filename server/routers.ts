import { z } from "zod";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, managementProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  archiveExpiredData,
  assignProductCategoryToProduct,
  clearProductCategoryOptions,
  completeA1ArrivalByScan,
  completeStationTask,
  createProductCategoryOption,
  createProductNameOption,
  deleteImportedPurchaseOrder,
  deleteProductCategoryOption,
  deleteProductNameOption,
  ensureMvpSeedData,
  getAdminSetupData,
  getDefectOptions,
  getEngineerKpiSummary,
  getProductCategoryOptions,
  getProductNameOptions,
  getSamplingQueue,
  getStationOverviewData,
  getStationPageData,
  importProducts,
  seedKpiForDemo,
  submitSamplingResult,
  updateProductivityTarget,
  updateStationRule,
  upsertDefectOption,
  replaceCategoryStationFlow,
} from "./db";

const stationCodeSchema = z.enum(["A1", "A2", "B", "C", "D", "E", "STOCK"]);
const defectOptionStationSchema = z.enum(["B", "C"]);
const defectOptionTypeSchema = z.enum(["fault", "appearance", "camera"]);
const batteryIssueLabelSchema = z.enum(["電池膨脹", "副廠電池", "電池異常"]);
const optionalTextSchema = z.string().trim().optional().transform((value) => value || undefined);
const importRowSchema = z.object({
  batchNo: optionalTextSchema,
  serialNumber: optionalTextSchema,
  imei: optionalTextSchema,
  productName: optionalTextSchema,
  categoryName: z.string().trim().min(1),
  brandName: z.string().trim().min(1),
}).superRefine((value, ctx) => {
  if (!value.batchNo && !value.serialNumber && !value.imei) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["batchNo"],
      message: "商品批號、商品序號、IMEI 至少要填一項",
    });
  }
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(async (opts) => {
      if (opts.ctx.user) {
        await ensureMvpSeedData();
        await archiveExpiredData();
        await seedKpiForDemo(opts.ctx.user.id);
      }
      return opts.ctx.user;
    }),
    login: publicProcedure
      .input(
        z.object({
          username: z.string().trim().min(1, "請輸入帳號"),
          password: z.string().min(1, "請輸入密碼"),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const user = await sdk.authenticatePasswordUser(input.username, input.password);
        const sessionToken = await sdk.createSessionToken(user.openId, {
          name: user.name || user.username || input.username,
          expiresInMs: ONE_YEAR_MS,
        });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, {
          ...cookieOptions,
          maxAge: ONE_YEAR_MS,
        });

        return {
          success: true,
          user,
        } as const;
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
      await archiveExpiredData();
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
    productNameOptions: protectedProcedure.query(async () => {
      await ensureMvpSeedData();
      return getProductNameOptions();
    }),
    productCategoryOptions: protectedProcedure.query(async () => {
      await ensureMvpSeedData();
      return getProductCategoryOptions();
    }),
    assignCategory: protectedProcedure
      .input(
        z.object({
          productId: z.number().int().positive(),
          categoryId: z.number().int().positive().nullable(),
        }),
      )
      .mutation(async ({ input }) => {
        return assignProductCategoryToProduct({
          productId: input.productId,
          categoryId: input.categoryId,
        });
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
          faultOptionIds: z.array(z.number().int().positive()).optional(),
          appearanceOptionIds: z.array(z.number().int().positive()).optional(),
          cameraOptionIds: z.array(z.number().int().positive()).optional(),
          bFaultOptionIds: z.array(z.number().int().positive()).optional(),
          batteryNote: optionalTextSchema,
          batteryIssueLabels: z.array(batteryIssueLabelSchema).optional(),
          applyBChanges: z.boolean().optional(),
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
          faultOptionIds: input.faultOptionIds,
          appearanceOptionIds: input.appearanceOptionIds,
          cameraOptionIds: input.cameraOptionIds,
          bFaultOptionIds: input.bFaultOptionIds,
          batteryNote: input.batteryNote,
          batteryIssueLabels: input.batteryIssueLabels,
          applyBChanges: input.applyBChanges,
        });
      }),
    receive: protectedProcedure
      .input(
        z.object({
          batchNo: optionalTextSchema,
          serialNumber: optionalTextSchema,
          imei: optionalTextSchema,
          productName: optionalTextSchema,
        }).superRefine((value, ctx) => {
          if (!value.batchNo && !value.serialNumber && !value.imei) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["batchNo"],
              message: "商品批號、商品序號、IMEI 至少要填一項",
            });
          }
        }),
      )
      .mutation(async ({ ctx, input }) => {
        return completeA1ArrivalByScan({
          operatorUserId: ctx.user.id,
          batchNo: input.batchNo,
          serialNumber: input.serialNumber,
          imei: input.imei,
          productName: input.productName,
        });
      }),
    importBatch: managementProcedure
      .input(
        z.object({
          poNumber: optionalTextSchema,
          vendorName: z.string().trim().min(1),
          arrivalAt: optionalTextSchema,
          rows: z.array(importRowSchema).min(1),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        return importProducts({
          poNumber: input.poNumber,
          vendorName: input.vendorName,
          arrivalAt: input.arrivalAt,
          importedByUserId: ctx.user.id,
          rows: input.rows,
        });
      }),
  }),
  sampling: router({
    queue: managementProcedure.query(async () => {
      await ensureMvpSeedData();
      return getSamplingQueue();
    }),
    submit: managementProcedure
      .input(
        z.object({
          taskId: z.number(),
          productId: z.number(),
          passed: z.boolean(),
          categoryId: z.number().int().positive().nullable().optional(),
          subtypeCode: optionalTextSchema.nullable().optional(),
          defectReason: optionalTextSchema,
          applyInspectionChanges: z.boolean().optional(),
          batterySummary: optionalTextSchema,
          bFaultSummary: optionalTextSchema,
          cFaultSummary: optionalTextSchema,
          cAppearanceSummary: optionalTextSchema,
          cCameraSummary: optionalTextSchema,
        }),

      )
      .mutation(async ({ ctx, input }) => {
        return submitSamplingResult({
          taskId: input.taskId,
          productId: input.productId,
          sampledByUserId: ctx.user.id,
          passed: input.passed,
          categoryId: input.categoryId ?? null,
          subtypeCode: input.subtypeCode ?? null,
          defectReason: input.defectReason,
          applyInspectionChanges: input.applyInspectionChanges,
          batterySummary: input.batterySummary,
          bFaultSummary: input.bFaultSummary,
          cFaultSummary: input.cFaultSummary,
          cAppearanceSummary: input.cAppearanceSummary,
          cCameraSummary: input.cCameraSummary,
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
    setup: adminProcedure
      .input(
        z.object({
          startDate: optionalTextSchema.nullable().optional(),
          endDate: optionalTextSchema.nullable().optional(),
        }).optional(),
      )
      .query(async ({ input }) => {
        await ensureMvpSeedData();
        await archiveExpiredData();
        return getAdminSetupData({
          startDate: input?.startDate ?? undefined,
          endDate: input?.endDate ?? undefined,
        });
      }),
    getDefectOptions: adminProcedure
      .input(
        z.object({
          stationCode: defectOptionStationSchema,
          optionType: defectOptionTypeSchema,
        }),
      )
      .query(async ({ input }) => {
        return getDefectOptions(input.stationCode, input.optionType);
      }),
    updateStationRule: adminProcedure
      .input(
        z.object({
          id: z.number(),
          routeKey: z.string().min(1),
          nextStationCode: stationCodeSchema.nullable(),
          allowReworkToCode: stationCodeSchema.nullable(),
          active: z.boolean(),
          notes: z.string().nullable().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        return updateStationRule({
          id: input.id,
          routeKey: input.routeKey,
          nextStationCode: input.nextStationCode,
          allowReworkToCode: input.allowReworkToCode,
          active: input.active,
          notes: input.notes ?? null,
        });
      }),
    updateProductivityTarget: adminProcedure
      .input(
        z.object({
          id: z.number().optional(),
          stationCode: stationCodeSchema.exclude(["STOCK"]),
          categoryId: z.number().int().positive(),
          subtypeCode: z.string().trim().min(1),
          dailyTargetQty: z.number().int().min(1),
          active: z.boolean(),
        }),
      )
      .mutation(async ({ input }) => {
        return updateProductivityTarget({
          id: input.id,
          stationCode: input.stationCode,
          categoryId: input.categoryId,
          subtypeCode: input.subtypeCode,
          dailyTargetQty: input.dailyTargetQty,
          active: input.active,
        });
      }),
    upsertDefectOption: adminProcedure
      .input(
        z.object({
          id: z.number().optional(),
          stationCode: defectOptionStationSchema,
          optionType: defectOptionTypeSchema,
          label: z.string().min(1),
          active: z.boolean(),
          sortOrder: z.number().int().min(0),
        }),
      )
      .mutation(async ({ input }) => {
        return upsertDefectOption(input);
      }),
    importProducts: adminProcedure
      .input(
        z.object({
          poNumber: optionalTextSchema,
          vendorName: z.string().trim().min(1),
          arrivalAt: optionalTextSchema,
          rows: z.array(importRowSchema).min(1),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        return importProducts({
          poNumber: input.poNumber,
          vendorName: input.vendorName,
          arrivalAt: input.arrivalAt,
          importedByUserId: ctx.user.id,
          rows: input.rows,
        });
      }),
    createProductNameOption: adminProcedure
      .input(
        z.object({
          label: z.string().min(1),
        }),
      )
      .mutation(async ({ input }) => {
        return createProductNameOption({ label: input.label });
      }),
    deleteProductNameOption: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
        }),
      )
      .mutation(async ({ input }) => {
        return deleteProductNameOption(input.id);
      }),
    createProductCategoryOption: adminProcedure
      .input(
        z.object({
          categoryName: z.string().trim().min(1),
          brandName: z.string().trim().min(1),
        }),
      )
      .mutation(async ({ input }) => {
        return createProductCategoryOption({ categoryName: input.categoryName, brandName: input.brandName });
      }),
    deleteProductCategoryOption: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
        }),
      )
      .mutation(async ({ input }) => {
        return deleteProductCategoryOption(input.id);
      }),
    clearProductCategoryOptions: adminProcedure.mutation(async () => {
      return clearProductCategoryOptions();
    }),
    replaceCategoryStationFlow: adminProcedure
      .input(
        z.object({
          categoryId: z.number().int().positive(),
          stationCodes: z.array(stationCodeSchema).min(1),
        }),
      )
      .mutation(async ({ input }) => {
        return replaceCategoryStationFlow({
          categoryId: input.categoryId,
          stationCodes: input.stationCodes,
        });
      }),
    saveAllSettings: adminProcedure
      .input(
        z.object({
          rules: z.array(
            z.object({
              id: z.number(),
              routeKey: z.string().min(1),
              nextStationCode: stationCodeSchema.nullable(),
              allowReworkToCode: stationCodeSchema.nullable(),
              active: z.boolean(),
              notes: z.string().nullable().optional(),
            }),
          ),
          targets: z.array(
            z.object({
              id: z.number().optional(),
              stationCode: stationCodeSchema.exclude(["STOCK"]),
              categoryId: z.number().int().positive(),
              subtypeCode: z.string().trim().min(1),
              dailyTargetQty: z.number().int().min(1),
              active: z.boolean(),
            }),
          ),
          defectOptions: z.array(
            z.object({
              id: z.number().optional(),
              stationCode: defectOptionStationSchema,
              optionType: defectOptionTypeSchema,
              label: z.string().min(1),
              active: z.boolean(),
              sortOrder: z.number().int().min(0),
            }),
          ),
          categoryFlows: z.array(
            z.object({
              categoryId: z.number().int().positive(),
              stationCodes: z.array(stationCodeSchema).min(1),
            }),
          ),
        }),
      )
      .mutation(async ({ input }) => {
        await Promise.all(input.rules.map((rule) => updateStationRule({
          id: rule.id,
          routeKey: rule.routeKey,
          nextStationCode: rule.nextStationCode,
          allowReworkToCode: rule.allowReworkToCode,
          active: rule.active,
          notes: rule.notes ?? null,
        })));

        await Promise.all(input.targets.map((target) => updateProductivityTarget({
          id: target.id,
          stationCode: target.stationCode,
          categoryId: target.categoryId,
          subtypeCode: target.subtypeCode,
          dailyTargetQty: target.dailyTargetQty,
          active: target.active,
        })));

        await Promise.all(input.defectOptions.map((option) => upsertDefectOption(option)));

        await Promise.all(input.categoryFlows.map((flow) => replaceCategoryStationFlow({
          categoryId: flow.categoryId,
          stationCodes: flow.stationCodes,
        })));

        return {
          success: true as const,
          savedCounts: {
            rules: input.rules.length,
            targets: input.targets.length,
            defectOptions: input.defectOptions.length,
            categoryFlows: input.categoryFlows.length,
          },
        };
      }),
    deleteImportedPurchaseOrder: adminProcedure
      .input(
        z.object({
          poNumber: z.string().trim().min(1),
        }),
      )
      .mutation(async ({ input }) => {
        return deleteImportedPurchaseOrder(input.poNumber);
      }),
    createUser: adminProcedure
      .input(
        z.object({
          username: z.string().trim().min(1, "請輸入帳號"),
          password: z.string().min(6, "密碼至少 6 碼"),
          name: z.string().trim().optional(),
          role: z.enum(["user", "admin", "manager", "engineer", "supervisor"]),
        }),
      )
      .mutation(async ({ input }) => {
        return sdk.createLocalPasswordUser({
          username: input.username,
          password: input.password,
          name: input.name,
          role: input.role,
        });
      }),
  }),
});

export type AppRouter = typeof appRouter;
