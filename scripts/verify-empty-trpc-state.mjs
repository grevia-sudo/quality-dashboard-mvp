import { appRouter } from "../server/routers.ts";

const createContext = (role = "admin") => ({
  user: {
    id: 7,
    openId: "demo-open-id",
    email: "demo@example.com",
    name: "Demo User",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  },
  req: {
    protocol: "https",
    headers: {},
    get: () => "qualitydash-f4lqwhzd.manus.space",
  },
  res: {},
});

const caller = appRouter.createCaller(createContext("admin"));

const stationList = await caller.station.list();
const adminSetup = await caller.admin.setup();
const samplingQueue = await caller.sampling.queue();

console.log(JSON.stringify({
  stationCount: Array.isArray(stationList) ? stationList.length : null,
  adminCategoryCount: Array.isArray(adminSetup.categories) ? adminSetup.categories.length : null,
  adminRuleCount: Array.isArray(adminSetup.rules) ? adminSetup.rules.length : null,
  adminUserCount: Array.isArray(adminSetup.users) ? adminSetup.users.length : null,
  samplingTaskCount: Array.isArray(samplingQueue.tasks) ? samplingQueue.tasks.length : null,
}, null, 2));
