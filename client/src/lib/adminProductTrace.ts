export type ProductTraceTask = {
  id: number;
  stationCode: string;
  taskStatus: string;
  startedAt?: string | Date | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  completedAt?: string | Date | null;
  dueDate?: string | Date | null;
  resultSummary?: string | null;
};

export type ProductTraceEvent = {
  id: number;
  stationCode: string;
  eventType: string;
  createdAt?: string | Date | null;
  operatorName?: string | null;
  summary?: string | null;
};

export type ProductTraceRecord = {
  id: number;
  productName?: string | null;
  batchNo?: string | null;
  serialNumber?: string | null;
  poNumber?: string | null;
  currentStatus: string;
  currentStationCode?: string | null;
  timeline: ProductTraceTask[];
  events: ProductTraceEvent[];
};

export function toTimestamp(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatDuration(durationMs: number | null) {
  if (durationMs === null || durationMs < 0) {
    return "-";
  }

  const totalMinutes = Math.round(durationMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days} 天 ${hours} 小時`;
  }

  if (hours > 0) {
    return `${hours} 小時 ${minutes} 分`;
  }

  return `${minutes} 分`;
}

export function analyzeProductTraceResults(products: ProductTraceRecord[], now = Date.now()) {
  return products.map((product) => {
    const analyzedTimeline = product.timeline.map((task) => {
      const startTimestamp = toTimestamp(task.startedAt) ?? toTimestamp(task.createdAt);
      const completionTimestamp = toTimestamp(task.completedAt);
      const fallbackEndTimestamp = task.taskStatus === "completed" ? toTimestamp(task.updatedAt) : now;
      const endTimestamp = completionTimestamp ?? fallbackEndTimestamp;
      const durationMs = startTimestamp !== null && endTimestamp !== null && endTimestamp >= startTimestamp
        ? endTimestamp - startTimestamp
        : null;
      const isOverdue = task.taskStatus !== "completed" && task.dueDate
        ? (toTimestamp(task.dueDate) ?? Number.POSITIVE_INFINITY) < now
        : false;
      const isLongRunning = durationMs !== null && (
        (task.taskStatus === "completed" && durationMs >= 24 * 60 * 60 * 1000)
        || (task.taskStatus !== "completed" && durationMs >= 8 * 60 * 60 * 1000)
      );

      return {
        ...task,
        durationMs,
        durationLabel: formatDuration(durationMs),
        isOverdue,
        isLongRunning,
        isAnomaly: isOverdue || isLongRunning,
      };
    });

    const validDurations = analyzedTimeline
      .map((task) => task.durationMs)
      .filter((value): value is number => value !== null);
    const averageDurationMs = validDurations.length > 0
      ? validDurations.reduce((sum, value) => sum + value, 0) / validDurations.length
      : null;
    const maxDurationMs = validDurations.length > 0 ? Math.max(...validDurations) : null;
    const anomalyStations = analyzedTimeline.filter((task) => task.isAnomaly).map((task) => task.stationCode);

    return {
      ...product,
      analyzedTimeline,
      stats: {
        totalStations: analyzedTimeline.length,
        completedStations: analyzedTimeline.filter((task) => task.taskStatus === "completed").length,
        averageDurationLabel: formatDuration(averageDurationMs),
        longestDurationLabel: formatDuration(maxDurationMs),
        anomalyCount: anomalyStations.length,
        overdueCount: analyzedTimeline.filter((task) => task.isOverdue).length,
        anomalyStations,
      },
    };
  });
}
