import DashboardLayout, { type DashboardNavItem } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { resolveA1ProductNamePickerState } from "./station-product-name-picker";
import { createUtf8CsvBlob, exportStationStockRowsToCsv } from "./station-stock-export";
import { Boxes, Camera, ClipboardCheck, Download, Gauge, LoaderCircle, PackagePlus, Search, ShieldAlert, ShieldCheck, Undo2 } from "lucide-react";
import jsQR from "jsqr";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { useLocation, useRoute } from "wouter";

const MANAGEMENT_VIEWER_ROLES = ["supervisor", "manager", "admin"];

const navItems: DashboardNavItem[] = [
  { label: "站點總覽", path: "/operations", icon: Boxes },
  { label: "匯入作業", path: "/import", icon: PackagePlus, allowedRoles: MANAGEMENT_VIEWER_ROLES },
  { label: "D 站抽樣", path: "/sampling", icon: ClipboardCheck, allowedRoles: MANAGEMENT_VIEWER_ROLES },
  { label: "工程師 KPI", path: "/kpi", icon: Gauge },
  { label: "管理後台", path: "/admin", icon: ShieldCheck, allowedRoles: MANAGEMENT_VIEWER_ROLES },
  { label: "待入庫待比對", path: "/admin/pending-stock-mismatches", icon: ShieldAlert, allowedRoles: MANAGEMENT_VIEWER_ROLES },
];

const stationCodes = ["A1", "A2", "B", "C", "E", "STOCK"] as const;
type StationCode = (typeof stationCodes)[number];

type BatteryIssueLabel = (typeof B_BATTERY_ISSUE_OPTIONS)[number];
type StationCapturedPhoto = {
  dataUrl: string;
  mimeType: string;
  fileName: string;
};

type DetectedBarcode = {
  rawValue?: string;
};

type BarcodeDetectorInstance = {
  detect: (source: ImageBitmapSource) => Promise<DetectedBarcode[]>;
};

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;

type OptionSelections = {
  faultOptionIds: number[];
  appearanceOptionIds: number[];
  cameraOptionIds: number[];
  bFaultOptionIds: number[];
  batteryNote: string;
  batteryIssueLabels: BatteryIssueLabel[];
  eFrontPhoto: StationCapturedPhoto | null;
  eBackPhoto: StationCapturedPhoto | null;
  isEditingBFaults: boolean;
  hasOpenedBFaultEditor: boolean;
  hasOpenedBatteryEditor: boolean;
};

const defaultSelections = (): OptionSelections => ({
  faultOptionIds: [],
  appearanceOptionIds: [],
  cameraOptionIds: [],
  bFaultOptionIds: [],
  batteryNote: "",
  batteryIssueLabels: [],
  eFrontPhoto: null,
  eBackPhoto: null,
  isEditingBFaults: false,
  hasOpenedBFaultEditor: false,
  hasOpenedBatteryEditor: false,
});

const normalizeIdList = (values: number[]) => Array.from(new Set(values)).sort((left, right) => left - right);
const normalizeTextList = (values: string[]) => Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right, "zh-Hant"));
const summarizeTextResult = (values: string[]) => values.map((value) => value.trim()).filter(Boolean).join(", ") || "正常";
const B_BATTERY_ISSUE_OPTIONS = ["電池膨脹", "副廠電池", "蓄電異常"] as const;

const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string") {
      resolve(reader.result);
      return;
    }
    reject(new Error("照片讀取失敗"));
  };
  reader.onerror = () => reject(reader.error ?? new Error("照片讀取失敗"));
  reader.readAsDataURL(file);
});

const getBarcodeDetectorConstructor = () => {
  if (typeof window === "undefined") {
    return null;
  }

  return (window as typeof window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector ?? null;
};

const decodeQrWithJsQr = async (file: File) => {
  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const nextImage = new Image();
    nextImage.onload = () => resolve(nextImage);
    nextImage.onerror = () => reject(new Error("照片載入失敗"));
    nextImage.src = sourceDataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("瀏覽器不支援照片處理，請改用其他裝置或重新整理後再試");
  }

  context.drawImage(image, 0, 0, image.width, image.height);
  const imageData = context.getImageData(0, 0, image.width, image.height);
  const result = jsQR(imageData.data, image.width, image.height, {
    inversionAttempts: "attemptBoth",
  });

  const detectedValue = result?.data?.trim();
  if (!detectedValue) {
    throw new Error("照片中找不到可辨識的 QR，請重新拍攝並讓 QR 置中清晰");
  }

  return detectedValue;
};

const detectQrCodeFromImageFile = async (file: File) => {
  const BarcodeDetectorApi = getBarcodeDetectorConstructor();
  if (BarcodeDetectorApi && typeof createImageBitmap === "function") {
    const detector = new BarcodeDetectorApi({ formats: ["qr_code"] });
    const bitmap = await createImageBitmap(file);
    try {
      const results = await detector.detect(bitmap);
      const detectedValue = results.find((result) => typeof result.rawValue === "string" && result.rawValue.trim())?.rawValue?.trim();
      if (detectedValue) {
        return detectedValue;
      }
    } finally {
      bitmap.close?.();
    }
  }

  return decodeQrWithJsQr(file);
};

const detectQrCodeFromVideoFrame = async (video: HTMLVideoElement, canvas: HTMLCanvasElement) => {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
    return null;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("瀏覽器不支援相機畫面處理，請改用手動輸入批號");
  }

  context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
  const BarcodeDetectorApi = getBarcodeDetectorConstructor();
  if (BarcodeDetectorApi) {
    const detector = new BarcodeDetectorApi({ formats: ["qr_code"] });
    const results = await detector.detect(canvas);
    const detectedValue = results.find((result) => typeof result.rawValue === "string" && result.rawValue.trim())?.rawValue?.trim();
    if (detectedValue) {
      return detectedValue;
    }
  }

  const imageData = context.getImageData(0, 0, video.videoWidth, video.videoHeight);
  return jsQR(imageData.data, video.videoWidth, video.videoHeight, {
    inversionAttempts: "attemptBoth",
  })?.data?.trim() ?? null;
};

const compressCapturedPhoto = async (file: File): Promise<StationCapturedPhoto> => {
  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const nextImage = new Image();
    nextImage.onload = () => resolve(nextImage);
    nextImage.onerror = () => reject(new Error("照片載入失敗"));
    nextImage.src = sourceDataUrl;
  });

  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const targetWidth = Math.max(1, Math.round(image.width * scale));
  const targetHeight = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("瀏覽器不支援照片處理，請改用其他裝置或重新整理後再試");
  }

  context.drawImage(image, 0, 0, targetWidth, targetHeight);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  const normalizedBaseName = (file.name || "capture")
    .replace(/\.[^.]+$/, "")
    .trim()
    .replace(/\s+/g, "-") || "capture";

  return {
    dataUrl,
    mimeType: "image/jpeg",
    fileName: `${normalizedBaseName}.jpg`,
  };
};

const getImportComparisonStatus = (task: {
  poNumber?: string | null;
  importedCategoryName?: string | null;
  importedBrandName?: string | null;
}) => {
  const missingFields: string[] = [];
  if (!task.poNumber) {
    missingFields.push("PO");
  }
  if (!task.importedCategoryName) {
    missingFields.push("商品分類");
  }
  if (!task.importedBrandName) {
    missingFields.push("品牌");
  }
  if (missingFields.length === 0) {
    return {
      label: "已完成匯入比對",
      detail: "PO、商品分類與品牌都已補齊",
      className: "bg-emerald-100 text-emerald-700",
    };
  }
  return {
    label: "尚未完成匯入比對",
    detail: `待補 ${missingFields.join("、")}`,
    className: "bg-amber-100 text-amber-700",
  };
};

export function normalizeStationCodeParam(value?: string | null): StationCode | null {
  if (!value) return null;

  const normalized = value.replace(/^:/, "").trim().toUpperCase();
  return stationCodes.includes(normalized as StationCode) ? (normalized as StationCode) : null;
}

export default function StationPage() {
  const [, params] = useRoute<{ stationCode: string }>("/station/:stationCode");
  const rawStationCode = params?.stationCode;
  const normalizedStationCode = normalizeStationCodeParam(rawStationCode);
  const stationCode = normalizedStationCode ?? "A1";
  const [, setLocation] = useLocation();
  const [keyword, setKeyword] = useState("");
  const [arrivalForm, setArrivalForm] = useState({
    batchNo: "",
    serialNumber: "",
    imei: "",
    productName: "",
  });
  const [selectedOptions, setSelectedOptions] = useState<Record<number, OptionSelections>>({});
  const [productNamePickerOpen, setProductNamePickerOpen] = useState(false);
  const [batteryDialogTaskId, setBatteryDialogTaskId] = useState<number | null>(null);
  const [categoryDialogTask, setCategoryDialogTask] = useState<{
    taskId: number;
    productId: number;
    productCode: string;
    categoryId: number | null;
    categoryLabel: string;
  } | null>(null);
  const [categoryDraftValue, setCategoryDraftValue] = useState("");
  const [isProcessingEStationQrCapture, setIsProcessingEStationQrCapture] = useState(false);
  const [isEStationQrScannerOpen, setIsEStationQrScannerOpen] = useState(false);
  const [isStartingEStationQrScanner, setIsStartingEStationQrScanner] = useState(false);
  const [eStationQrScannerError, setEStationQrScannerError] = useState("");
  const batchNoInputRef = useRef<HTMLInputElement | null>(null);
  const serialNumberInputRef = useRef<HTMLInputElement | null>(null);
  const imeiInputRef = useRef<HTMLInputElement | null>(null);
  const productNameInputRef = useRef<HTMLInputElement | null>(null);
  const quickScanInputRef = useRef<HTMLInputElement | null>(null);
  const eStationQrCaptureInputRef = useRef<HTMLInputElement | null>(null);
  const eStationQrScannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const eStationQrScannerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const eStationQrScannerFrameRef = useRef<number | null>(null);
  const eStationQrScannerStreamRef = useRef<MediaStream | null>(null);
  const utils = trpc.useUtils();
  const canEditCategory = stationCode === "A1" || stationCode === "C";
  const shouldLoadProductNameOptions = stationCode === "A1" && (productNamePickerOpen || Boolean(arrivalForm.productName.trim()));
  const productNameOptionsQuery = trpc.station.productNameOptions.useQuery(undefined, {
    retry: false,
    enabled: shouldLoadProductNameOptions,
  });
  const productCategoryOptionsQuery = trpc.station.productCategoryOptions.useQuery(undefined, {
    retry: false,
    enabled: canEditCategory && Boolean(categoryDialogTask),
  });
  const detailQuery = trpc.station.detail.useQuery(
    { stationCode },
    {
      retry: false,
    },
  );
  const productNameOptions = productNameOptionsQuery.data ?? [];
  const productCategoryOptions = productCategoryOptionsQuery.data ?? [];
  const eStationLiveQrCaptureSupported = useMemo(() => {
    if (stationCode !== "E" || typeof navigator === "undefined") {
      return false;
    }

    return typeof navigator.mediaDevices?.getUserMedia === "function";
  }, [stationCode]);
  const eStationQrCaptureSupported = useMemo(() => stationCode === "E", [stationCode]);

  const invalidateStationData = async () => {
    await utils.station.detail.invalidate({ stationCode });
    await utils.station.list.invalidate();
    await utils.dashboard.home.invalidate();
  };

  const refreshA1StationDataInBackground = () => {
    void utils.station.detail.invalidate({ stationCode: "A1" });
    void utils.station.detail.invalidate({ stationCode: "A2" });
    void utils.station.list.invalidate();
    void utils.dashboard.home.invalidate();
  };

  const refreshStationDataInBackground = (currentStationCode: StationCode, nextStationCode?: StationCode | "D" | null) => {
    void utils.station.detail.invalidate({ stationCode: currentStationCode });
    if (nextStationCode) {
      void utils.station.detail.invalidate({ stationCode: nextStationCode });
    }
    void utils.station.list.invalidate();
    void utils.dashboard.home.invalidate();
  };

  const removeCompletedTaskFromCache = (currentStationCode: StationCode, productId?: number | null) => {
    if (!productId) {
      return;
    }

    utils.station.detail.setData({ stationCode: currentStationCode }, (current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        tasks: current.tasks.filter((task) => task.productId !== productId),
      };
    });
  };

  const focusBatchInput = () => {
    window.requestAnimationFrame(() => {
      batchNoInputRef.current?.focus();
      batchNoInputRef.current?.select();
    });
  };

  const focusSerialNumberInput = () => {
    window.requestAnimationFrame(() => {
      serialNumberInputRef.current?.focus();
      serialNumberInputRef.current?.select();
    });
  };

  const focusImeiInput = () => {
    window.requestAnimationFrame(() => {
      imeiInputRef.current?.focus();
      imeiInputRef.current?.select();
    });
  };

  const focusProductNameInput = () => {
    window.requestAnimationFrame(() => {
      productNameInputRef.current?.focus();
      productNameInputRef.current?.select();
      setProductNamePickerOpen(true);
    });
  };

  const focusQuickScanInput = () => {
    window.requestAnimationFrame(() => {
      quickScanInputRef.current?.focus();
      quickScanInputRef.current?.select();
    });
  };

  const applyDetectedEStationQrValue = useCallback((detectedValue: string) => {
    setKeyword(detectedValue);
    setIsEStationQrScannerOpen(false);
    toast.success(`已從 QR 辨識到 ${detectedValue}，請確認抹除完成後再推進下一站`);
    focusQuickScanInput();
  }, []);

  const stopEStationQrScanner = useCallback(() => {
    if (eStationQrScannerFrameRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame?.(eStationQrScannerFrameRef.current);
      eStationQrScannerFrameRef.current = null;
    }

    eStationQrScannerStreamRef.current?.getTracks().forEach((track) => track.stop());
    eStationQrScannerStreamRef.current = null;

    if (eStationQrScannerVideoRef.current) {
      eStationQrScannerVideoRef.current.srcObject = null;
    }
  }, []);

  const openEStationQrCapture = () => {
    if (!eStationQrCaptureSupported) {
      toast.error("目前裝置不支援拍照辨識 QR，請改用掃碼槍或手動輸入批號");
      return;
    }

    if (eStationLiveQrCaptureSupported) {
      setEStationQrScannerError("");
      setIsEStationQrScannerOpen(true);
      return;
    }

    eStationQrCaptureInputRef.current?.click();
  };

  const handleEStationQrCaptureChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setIsProcessingEStationQrCapture(true);
    try {
      const detectedValue = await detectQrCodeFromImageFile(file);
      applyDetectedEStationQrValue(detectedValue);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "QR 辨識失敗，請重新拍攝或改用手動輸入");
    } finally {
      setIsProcessingEStationQrCapture(false);
    }
  };

  useEffect(() => {
    if (!isEStationQrScannerOpen || !eStationLiveQrCaptureSupported) {
      stopEStationQrScanner();
      return;
    }

    let cancelled = false;
    let isDetecting = false;

    const scanNextFrame = async () => {
      if (cancelled || isDetecting) {
        return;
      }

      const video = eStationQrScannerVideoRef.current;
      const canvas = eStationQrScannerCanvasRef.current;
      if (!video || !canvas) {
        eStationQrScannerFrameRef.current = window.requestAnimationFrame(scanNextFrame);
        return;
      }

      isDetecting = true;
      try {
        const detectedValue = await detectQrCodeFromVideoFrame(video, canvas);
        if (detectedValue) {
          applyDetectedEStationQrValue(detectedValue);
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "QR 辨識失敗，請重新拍攝或改用手動輸入";
        setEStationQrScannerError(message);
      } finally {
        isDetecting = false;
      }

      if (!cancelled) {
        eStationQrScannerFrameRef.current = window.requestAnimationFrame(scanNextFrame);
      }
    };

    const startScanner = async () => {
      if (typeof navigator === "undefined" || typeof navigator.mediaDevices?.getUserMedia !== "function") {
        setEStationQrScannerError("目前裝置無法直接開啟即時掃碼，請改用拍照或手動輸入批號");
        return;
      }

      setIsStartingEStationQrScanner(true);
      setEStationQrScannerError("");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        eStationQrScannerStreamRef.current = stream;
        const video = eStationQrScannerVideoRef.current;
        if (!video) {
          throw new Error("相機畫面初始化失敗，請重新開啟一次");
        }

        video.srcObject = stream;
        await video.play();
        eStationQrScannerFrameRef.current = window.requestAnimationFrame(scanNextFrame);
      } catch (error) {
        const message = error instanceof Error ? error.message : "無法開啟相機，請確認相機權限後再試";
        setEStationQrScannerError(message);
        toast.error(message);
      } finally {
        if (!cancelled) {
          setIsStartingEStationQrScanner(false);
        }
      }
    };

    void startScanner();

    return () => {
      cancelled = true;
      stopEStationQrScanner();
      setIsStartingEStationQrScanner(false);
    };
  }, [applyDetectedEStationQrValue, eStationLiveQrCaptureSupported, isEStationQrScannerOpen, stopEStationQrScanner]);

  const openCategoryEditor = (task: {
    taskId: number;
    productId: number;
    productCode: string;
    categoryId?: number | null;
    categoryName?: string | null;
    importedCategoryName?: string | null;
    subtypeCode?: string | null;
    brandName?: string | null;
    importedBrandName?: string | null;
  }) => {
    if (!canEditCategory) {
      return;
    }

    setCategoryDialogTask({
      taskId: task.taskId,
      productId: task.productId,
      productCode: task.productCode,
      categoryId: task.categoryId ?? null,
      categoryLabel: [task.categoryName ?? task.importedCategoryName ?? task.subtypeCode ?? "未分類", task.brandName ?? task.importedBrandName ?? ""]
        .filter(Boolean)
        .join(" × "),
    });
    setCategoryDraftValue(task.categoryId ? String(task.categoryId) : "");
  };

  const playA2SuccessTone = () => {
    if (typeof window === "undefined") {
      return;
    }

    const AudioContextConstructor = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextConstructor) {
      return;
    }

    const audioContext = new AudioContextConstructor();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    const startTime = audioContext.currentTime;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(1046.5, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(1318.5, startTime + 0.12);

    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.16, startTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.18);

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + 0.2);
    oscillator.onended = () => {
      void audioContext.close().catch(() => undefined);
    };
  };

  const submitA1Receive = () => {
    if (receiveMutation.isPending || !canReceiveA1) {
      return;
    }

    receiveMutation.mutate({
      batchNo: arrivalForm.batchNo.trim() || undefined,
      serialNumber: arrivalForm.serialNumber.trim() || undefined,
      imei: arrivalForm.imei.trim() || undefined,
      productName: arrivalForm.productName.trim() || undefined,
    });
  };

  const handleA1BatchNoKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    focusSerialNumberInput();
  };

  const handleA1SerialNumberKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    focusImeiInput();
  };

  const handleA1ImeiKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    focusProductNameInput();
  };

  const handleA1ProductNameKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setProductNamePickerOpen(false);
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    setProductNamePickerOpen(false);
    submitA1Receive();
  };

  const submitA2ScanComplete = () => {
    if (stationCode !== "A2" || completeMutation.isPending) {
      return;
    }

    const normalizedScanValue = keyword.trim().toLowerCase();
    if (!normalizedScanValue) {
      return;
    }

    const matchedTask = (detailQuery.data?.tasks ?? []).find((task) => (
      [task.batchNo, task.productCode, task.serialNumber, task.imei]
        .filter((candidate): candidate is string => Boolean(candidate?.trim()))
        .some((candidate) => candidate.trim().toLowerCase() === normalizedScanValue)
    ));

    if (!matchedTask) {
      toast.error("找不到符合的 A2 待處理商品");
      focusQuickScanInput();
      return;
    }

    completeMutation.mutate({
      taskId: matchedTask.taskId,
      stationCode: "A2",
      productId: matchedTask.productId,
      categoryId: matchedTask.categoryId ?? null,
      subtypeCode: matchedTask.subtypeCode ?? null,
      summary: `${detailQuery.data?.label ?? "A2 安裝"} 掃碼完成`,
    });
  };

  const handleStationScanInputKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (stationCode !== "A2" || event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    submitA2ScanComplete();
  };

  const assignCategoryMutation = trpc.station.assignCategory.useMutation({
    onSuccess: async (result) => {
      toast.success(`已更新 ${result?.currentStationCode === "STOCK" ? "待入庫" : (result?.currentStationCode ?? stationCode)} 的品類設定`);
      setCategoryDialogTask(null);
      setCategoryDraftValue("");
        void invalidateStationData();
        void utils.sampling.queue.invalidate();

    },
    onError: (error) => {
      toast.error(error.message || "更新品類設定失敗");
    },
  });

  const completeMutation = trpc.station.complete.useMutation({
    onSuccess: (_result, variables) => {
      setSelectedOptions({});

      if (variables.stationCode === "A2") {
        removeCompletedTaskFromCache("A2", variables.productId);
        setKeyword("");
        playA2SuccessTone();
        toast.success("A2 已完成並推進下一站，請直接掃描下一筆");
        focusQuickScanInput();
        refreshStationDataInBackground("A2", "B");
        return;
      }

      if (variables.stationCode === "B") {
        removeCompletedTaskFromCache("B", variables.productId);
        setBatteryDialogTaskId(null);
        setKeyword("");
        toast.success("B 站軟體測試已完成並推進下一站，請直接輸入下一筆批號");
        focusQuickScanInput();
        refreshStationDataInBackground("B", "C");
        return;
      }

      if (variables.stationCode === "C") {
        removeCompletedTaskFromCache("C", variables.productId);
        setBatteryDialogTaskId(null);
        setKeyword("");
        toast.success("C 站品檢已完成並推進下一站，請直接輸入下一筆批號");
        focusQuickScanInput();
        refreshStationDataInBackground("C", "D");
        return;
      }

      if (variables.stationCode === "E") {
        removeCompletedTaskFromCache("E", variables.productId);
        setKeyword("");
        toast.success("E 站抹除已完成並推進下一站，請直接掃描下一筆");
        focusQuickScanInput();
        refreshStationDataInBackground("E", "STOCK");
        return;
      }

      toast.success("站點作業已完成");
      void invalidateStationData();
    },
    onError: (error) => {
      toast.error(error.message || "站點作業更新失敗");
    },
  });

  const receiveMutation = trpc.station.receive.useMutation({
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.message || "A1 點到貨處理失敗");
        return;
      }

      removeCompletedTaskFromCache("A1", result.productId);
      toast.success(`${result.productCode ?? "商品"} 已完成 A1 點到貨，請直接掃描下一筆`);
      setProductNamePickerOpen(false);
      setArrivalForm({ batchNo: "", serialNumber: "", imei: "", productName: "" });
      focusBatchInput();
      refreshA1StationDataInBackground();
    },
    onError: (error) => {
      toast.error(error.message || "A1 點到貨處理失敗");
      setProductNamePickerOpen(false);
      focusBatchInput();
    },
  });

  useEffect(() => {
    if (!rawStationCode || rawStationCode !== stationCode) {
      setLocation(`/station/${stationCode}`);
    }
  }, [rawStationCode, setLocation, stationCode]);

  useEffect(() => {
    if (stationCode === "A1" && !detailQuery.isLoading) {
      focusBatchInput();
    }

    if ((stationCode === "A2" || stationCode === "B" || stationCode === "C" || stationCode === "E") && !detailQuery.isLoading) {
      focusQuickScanInput();
    }
  }, [detailQuery.isLoading, stationCode]);

  useEffect(() => {
    setSelectedOptions((prev) => {
      const tasks = detailQuery.data?.tasks ?? [];
      let changed = false;
      const next = { ...prev };

      for (const task of tasks) {
        if (next[task.taskId]) {
          continue;
        }

        const carryoverTask = task as typeof task & {
          inheritedBFaultOptionIds?: number[];
          inheritedBatteryNote?: string;
          inheritedBatteryIssueLabels?: BatteryIssueLabel[];
        };

        next[task.taskId] = {
          faultOptionIds: [],
          appearanceOptionIds: [],
          cameraOptionIds: [],
          bFaultOptionIds: carryoverTask.inheritedBFaultOptionIds ?? [],
          batteryNote: carryoverTask.inheritedBatteryNote ?? "",
          batteryIssueLabels: carryoverTask.inheritedBatteryIssueLabels ?? [],
          eFrontPhoto: null,
          eBackPhoto: null,
          isEditingBFaults: false,
          hasOpenedBFaultEditor: false,
          hasOpenedBatteryEditor: false,
        };
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [detailQuery.data?.tasks]);

  const hasKeyword = keyword.trim().length > 0;

  const filteredTasks = useMemo(() => {
    const tasks = detailQuery.data?.tasks ?? [];
    const normalizedKeyword = keyword.trim().toLowerCase();

    if (stationCode === "B" || stationCode === "C") {
      if (!normalizedKeyword) {
        return [];
      }

      return tasks.filter((task) => (
        [task.batchNo, task.productCode, task.serialNumber, task.imei]
          .filter((candidate): candidate is string => Boolean(candidate?.trim()))
          .some((candidate) => candidate.trim().toLowerCase() === normalizedKeyword)
      ));
    }

    return tasks.filter((task) => {
      const text = `${task.productCode} ${task.productName ?? ""} ${task.batchNo ?? ""} ${task.serialNumber ?? ""} ${task.imei ?? ""}`.toLowerCase();
      return text.includes(normalizedKeyword);
    });
  }, [detailQuery.data?.tasks, keyword, stationCode]);

  const showStationEmptyState = (stationCode !== "B" && stationCode !== "C") || hasKeyword;
  const pendingTasks = detailQuery.data?.tasks ?? [];
  const handleExportStockCsv = () => {
    const csvContent = exportStationStockRowsToCsv(filteredTasks);
    const blob = createUtf8CsvBlob(csvContent);
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
    link.href = url;
    link.download = `stock-items-${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const matchedA1PendingTask = useMemo(() => {
    if (stationCode !== "A1") {
      return null;
    }

    const normalizedBatchNo = arrivalForm.batchNo.trim();
    const normalizedSerialNumber = arrivalForm.serialNumber.trim();
    const normalizedImei = arrivalForm.imei.trim();

    if (!normalizedBatchNo && !normalizedSerialNumber && !normalizedImei) {
      return null;
    }

    return pendingTasks.find((task) => {
      if (normalizedBatchNo && task.batchNo?.trim() === normalizedBatchNo) {
        return true;
      }
      if (normalizedSerialNumber && task.serialNumber?.trim() === normalizedSerialNumber) {
        return true;
      }
      if (normalizedImei && task.imei?.trim() === normalizedImei) {
        return true;
      }
      return false;
    }) ?? null;
  }, [arrivalForm.batchNo, arrivalForm.imei, arrivalForm.serialNumber, pendingTasks, stationCode]);

  const matchedA1CategoryName = matchedA1PendingTask?.categoryName ?? matchedA1PendingTask?.importedCategoryName ?? matchedA1PendingTask?.subtypeCode ?? null;
  const matchedA1BrandName = matchedA1PendingTask?.brandName ?? matchedA1PendingTask?.importedBrandName ?? null;

  useEffect(() => {
    if (stationCode !== "A1") {
      return;
    }

    const matchedProductName = matchedA1PendingTask?.productName?.trim();
    if (!matchedProductName) {
      return;
    }

    setArrivalForm((prev) => {
      if (prev.productName.trim()) {
        return prev;
      }
      return {
        ...prev,
        productName: matchedProductName,
      };
    });
  }, [matchedA1PendingTask?.productId, matchedA1PendingTask?.productName, stationCode]);

  const productNamePickerState = useMemo(() => resolveA1ProductNamePickerState({
    keyword: arrivalForm.productName,
    matchedCategoryName: matchedA1CategoryName,
    matchedBrandName: matchedA1BrandName,
    productNameOptions,
  }), [arrivalForm.productName, matchedA1BrandName, matchedA1CategoryName, productNameOptions]);

  const filteredProductNameOptions = productNamePickerState.options;
  const productNamePickerUsingFallbackAllOptions = productNamePickerState.usingFallbackAllOptions;

  const pendingCategorySummary = useMemo(() => {
    const summaryMap = new Map<string, { label: string; count: number }>();

    for (const task of detailQuery.data?.tasks ?? []) {
      const label = [
        task.categoryName ?? task.importedCategoryName ?? task.subtypeCode ?? "未分類",
        task.brandName ?? task.importedBrandName ?? "",
      ].filter(Boolean).join(" × ");
      const current = summaryMap.get(label);
      summaryMap.set(label, {
        label,
        count: (current?.count ?? 0) + 1,
      });
    }

    return Array.from(summaryMap.values()).sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.label.localeCompare(right.label, "zh-Hant");
    });
  }, [detailQuery.data?.tasks]);

  const pendingTotalCount = detailQuery.data?.tasks.length ?? 0;

  const getTaskSummaryText = (task: (typeof filteredTasks)[number], key: "bBatterySummary" | "bFaultSummary" | "cFaultSummary" | "cAppearanceSummary" | "cCameraSummary") => {
    const value = (task as Record<string, unknown>)[key];
    return typeof value === "string" && value.trim() ? value.trim() : "正常";
  };

  const toggleSelection = (taskId: number, key: "faultOptionIds" | "appearanceOptionIds" | "cameraOptionIds" | "bFaultOptionIds", optionId: number, checked: boolean) => {
    setSelectedOptions((prev) => {
      const current = prev[taskId] ?? defaultSelections();
      const currentList = current[key];
      const nextList = checked ? Array.from(new Set([...currentList, optionId])) : currentList.filter((id) => id !== optionId);

      return {
        ...prev,
        [taskId]: {
          ...current,
          [key]: nextList,
        },
      };
    });
  };

  const updateBatteryNote = (taskId: number, nextValue: string) => {
    setSelectedOptions((prev) => {
      const current = prev[taskId] ?? defaultSelections();
      return {
        ...prev,
        [taskId]: {
          ...current,
          batteryNote: nextValue,
        },
      };
    });
  };

  const toggleBatteryIssueLabel = (taskId: number, label: BatteryIssueLabel, checked: boolean) => {
    setSelectedOptions((prev) => {
      const current = prev[taskId] ?? defaultSelections();
      const nextLabels = checked
        ? Array.from(new Set([...current.batteryIssueLabels, label]))
        : current.batteryIssueLabels.filter((item) => item !== label);

      return {
        ...prev,
        [taskId]: {
          ...current,
          batteryIssueLabels: nextLabels,
        },
      };
    });
  };

  const getTaskSelections = (taskId: number) => selectedOptions[taskId] ?? defaultSelections();

  const setBFaultEditing = (taskId: number, isEditingBFaults: boolean) => {
    setSelectedOptions((prev) => {
      const current = prev[taskId] ?? defaultSelections();
      return {
        ...prev,
        [taskId]: {
          ...current,
          isEditingBFaults,
          hasOpenedBFaultEditor: current.hasOpenedBFaultEditor || isEditingBFaults,
        },
      };
    });
  };

  const openBatteryEditor = (taskId: number) => {
    setSelectedOptions((prev) => {
      const current = prev[taskId] ?? defaultSelections();
      return {
        ...prev,
        [taskId]: {
          ...current,
          hasOpenedBatteryEditor: true,
        },
      };
    });
    setBatteryDialogTaskId(taskId);
  };

  const updateStationPhoto = (taskId: number, key: "eFrontPhoto" | "eBackPhoto", photo: StationCapturedPhoto | null) => {
    setSelectedOptions((prev) => {
      const current = prev[taskId] ?? defaultSelections();
      return {
        ...prev,
        [taskId]: {
          ...current,
          [key]: photo,
        },
      };
    });
  };

  const handleStationPhotoChange = async (taskId: number, key: "eFrontPhoto" | "eBackPhoto", fileList: FileList | null) => {
    const selectedFile = fileList?.[0];
    if (!selectedFile) {
      updateStationPhoto(taskId, key, null);
      return;
    }

    try {
      const compressedPhoto = await compressCapturedPhoto(selectedFile);
      updateStationPhoto(taskId, key, compressedPhoto);
      toast.success(key === "eFrontPhoto" ? "已更新正面照片" : "已更新反面照片");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "照片處理失敗，請重新拍照");
    }
  };

  const submitStationCompletion = (task: (typeof filteredTasks)[number]) => {
    const selections = getTaskSelections(task.taskId);
    const basePayload = {
      taskId: task.taskId,
      stationCode,
      productId: task.productId,
      categoryId: task.categoryId ?? null,
      subtypeCode: task.subtypeCode ?? null,
      summary: stationCode === "B" ? "B 站軟體測試完成" : stationCode === "C" ? "C 站品檢完成" : `${detailQuery.data?.label} 完成`,
      faultOptionIds: selections.faultOptionIds,
      appearanceOptionIds: selections.appearanceOptionIds,
      cameraOptionIds: selections.cameraOptionIds,
    };

    if (stationCode === "B") {
      completeMutation.mutate({
        ...basePayload,
        batteryNote: selections.batteryNote,
        batteryIssueLabels: selections.batteryIssueLabels,
      });
      return;
    }

    if (stationCode === "C") {
      const carryoverTask = task as typeof task & {
        inheritedBFaultOptionIds?: number[];
        inheritedBatteryNote?: string;
        inheritedBatteryIssueLabels?: BatteryIssueLabel[];
      };
      const originalBFaultOptionIds = normalizeIdList(carryoverTask.inheritedBFaultOptionIds ?? []);
      const originalBatteryIssueLabels = normalizeTextList(carryoverTask.inheritedBatteryIssueLabels ?? []);
      const nextBFaultOptionIds = normalizeIdList(selections.bFaultOptionIds);
      const nextBatteryIssueLabels = normalizeTextList(selections.batteryIssueLabels);
      const nextBatteryNote = selections.batteryNote.trim();
      const originalBatteryNote = (carryoverTask.inheritedBatteryNote ?? "").trim();
      const hasBatteryChanges = selections.hasOpenedBatteryEditor && (
        nextBatteryNote !== originalBatteryNote
        || JSON.stringify(nextBatteryIssueLabels) !== JSON.stringify(originalBatteryIssueLabels)
      );
      const hasBFaultChanges = selections.hasOpenedBFaultEditor
        && JSON.stringify(nextBFaultOptionIds) !== JSON.stringify(originalBFaultOptionIds);
      const hasBChanges = hasBatteryChanges || hasBFaultChanges;
      const applyBChanges = hasBChanges
        ? window.confirm("是否修改電池／非螢幕功能狀態？按下「確定」會將更新後的電池檢測與 B 站故障狀態回寫到 Google Sheet M/N 欄，並在 Q 欄標記 Y。")
        : false;

      completeMutation.mutate({
        ...basePayload,
        bFaultOptionIds: applyBChanges ? selections.bFaultOptionIds : carryoverTask.inheritedBFaultOptionIds ?? [],
        batteryNote: applyBChanges ? selections.batteryNote : carryoverTask.inheritedBatteryNote ?? undefined,
        batteryIssueLabels: applyBChanges ? selections.batteryIssueLabels : carryoverTask.inheritedBatteryIssueLabels ?? [],
        applyBChanges,
      });
      return;
    }

    if (stationCode === "E") {
      if (!selections.eFrontPhoto || !selections.eBackPhoto) {
        toast.error("請先拍攝正面與反面照片，再完成 E 站抹除");
        return;
      }

      completeMutation.mutate({
        ...basePayload,
        eFrontPhoto: selections.eFrontPhoto,
        eBackPhoto: selections.eBackPhoto,
      });
      return;
    }

    completeMutation.mutate(basePayload);
  };

  const canReceiveA1 = Boolean(
    arrivalForm.batchNo.trim() && arrivalForm.serialNumber.trim() && arrivalForm.productName.trim(),
  );

  if (detailQuery.isLoading) {
    return <div className="grid gap-4 p-6"><Skeleton className="h-28 rounded-3xl" /><Skeleton className="h-40 rounded-3xl" /></div>;
  }

  return (
    <DashboardLayout title={detailQuery.data?.label ?? "站點作業"} navItems={navItems}>
      <div className="space-y-6">
        <Card className="rounded-[28px] border-0 bg-[#eef2f7] shadow-sm">
          <CardContent className="flex flex-col gap-4 p-8 md:flex-row md:items-end md:justify-between">
            <div>
              <Badge className="bg-white/80 text-slate-700">掃碼、補錄與推進下一站</Badge>
              <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-900">{detailQuery.data?.label}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">支援站內搜尋與快速完工。A1 站可直接補齊已匯入商品的缺漏欄位；B 站可補記電池檢測與非螢幕功能狀態；C 站則會承接 B 站資料，補記螢幕狀態與機身外觀，並可視需要修正上一站紀錄。</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/import")}>
                <PackagePlus className="mr-2 h-4 w-4" /> 匯入作業
              </Button>
              <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/operations")}>
                <Undo2 className="mr-2 h-4 w-4" /> 返回站點總覽
              </Button>
            </div>
          </CardContent>
        </Card>

        {stationCode === "A1" ? (
          <div className="space-y-6">
            <Card className="rounded-[28px] border-0 bg-white shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold">目前待點貨商品分類與數量</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-3 rounded-[24px] bg-slate-50 p-4 text-sm text-slate-600">
                  <Badge className="bg-slate-900 text-white">待點貨總數 {pendingTotalCount}</Badge>
                  <span>匯入完成後，A1 可先依商品分類確認目前待處理分布，再開始逐筆點到貨。</span>
                </div>
                {pendingCategorySummary.length > 0 ? (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {pendingCategorySummary.map((item) => (
                      <div key={item.label} className="rounded-[24px] bg-[#eef2f7] p-4 shadow-sm">
                        <p className="text-xs font-medium tracking-wide text-slate-500">商品分類 × 品牌</p>
                        <p className="mt-2 text-base font-bold text-slate-900">{item.label || "未分類"}</p>
                        <p className="mt-3 text-sm text-slate-600">待點貨數量 <span className="font-bold text-slate-900">{item.count}</span></p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[24px] bg-slate-50 p-4 text-sm text-slate-600">目前沒有待點貨商品，完成匯入後會在這裡顯示各商品分類的待處理數量。</div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-[28px] border-0 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-bold">A1 點到貨新增／補齊</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitA1Receive();
                  }}
                >
                  <div className="rounded-[24px] bg-slate-50 p-4 text-sm leading-7 text-slate-600">
                    A1 改為掃碼補齊模式。推進 A2 前需填寫商品批號、商品序號與品名；IMEI 改為非必填，若現場有資料仍可一併補齊。完成後系統會直接完成 A1 並留在本頁，方便現場立即掃描下一筆。
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <label className="space-y-2 text-sm text-slate-600">
                      <span>商品批號（必填）</span>
                      <Input
                        ref={batchNoInputRef}
                        autoFocus
                        value={arrivalForm.batchNo}
                        onChange={(event) => setArrivalForm((prev) => ({ ...prev, batchNo: event.target.value }))}
                        onKeyDown={handleA1BatchNoKeyDown}
                        className="editable-field h-14 rounded-2xl border-0 bg-slate-50 text-base"
                        placeholder="必填，掃描批號後可直接按 Enter"
                      />
                    </label>
                    <label className="space-y-2 text-sm text-slate-600">
                      <span>商品序號（必填）</span>
                      <Input
                        ref={serialNumberInputRef}
                        value={arrivalForm.serialNumber}
                        onChange={(event) => setArrivalForm((prev) => ({ ...prev, serialNumber: event.target.value }))}
                        onKeyDown={handleA1SerialNumberKeyDown}
                        className="editable-field h-14 rounded-2xl border-0 bg-slate-50 text-base"
                        placeholder="必填，請輸入或掃描商品序號"
                      />
                    </label>
                    <label className="space-y-2 text-sm text-slate-600">
                      <span>IMEI（非必填）</span>
                      <Input
                        ref={imeiInputRef}
                        value={arrivalForm.imei}
                        onChange={(event) => setArrivalForm((prev) => ({ ...prev, imei: event.target.value }))}
                        onKeyDown={handleA1ImeiKeyDown}
                        className="editable-field h-14 rounded-2xl border-0 bg-slate-50 text-base"
                        placeholder="選填，可補刷 IMEI 以補齊資料"
                      />
                    </label>
                    <label className="space-y-2 text-sm text-slate-600">
                      <span>品名（必填）</span>
                      <div className="relative">
                        <Input
                          ref={productNameInputRef}
                          value={arrivalForm.productName}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setArrivalForm((prev) => ({ ...prev, productName: nextValue }));
                            setProductNamePickerOpen(true);
                          }}
                          onFocus={() => setProductNamePickerOpen(true)}
                          onBlur={() => {
                            window.setTimeout(() => setProductNamePickerOpen(false), 120);
                          }}
                          onKeyDown={handleA1ProductNameKeyDown}
                          className="editable-field h-14 rounded-2xl border-0 bg-slate-50 pr-12 text-base"
                          placeholder="輸入品名關鍵字搜尋（可選）"
                       autoComplete="off"
                        />
                        <Search className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
                        {productNamePickerOpen ? (
                          <div className="absolute z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                            {productNameOptionsQuery.isLoading ? (
                              <p className="px-3 py-4 text-sm text-slate-500">品名載入中…</p>
                            ) : filteredProductNameOptions.length > 0 ? (
                              <div className="space-y-2">
                                {matchedA1CategoryName && matchedA1BrandName ? (
                                  <p className="px-3 pt-2 text-xs text-slate-500">
                                    {productNamePickerUsingFallbackAllOptions
                                      ? `目前沒有 ${matchedA1CategoryName} × ${matchedA1BrandName} 的預設品名，已切換為全品項搜尋；你也可以直接手動修改。`
                                      : `目前先顯示 ${matchedA1CategoryName} × ${matchedA1BrandName} 的符合品名。`}
                                  </p>
                                ) : null}
                                <div className="space-y-1">
                                  {filteredProductNameOptions.map((option) => {
                                    const isActive = option.label === arrivalForm.productName;
                                    return (
                                      <button
                                        key={`${option.id}-${option.label}`}
                                        type="button"
                                        className={`flex w-full items-center rounded-xl px-3 py-2 text-left text-sm transition ${isActive ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={() => {
                                          setArrivalForm((prev) => ({ ...prev, productName: option.label }));
                                          setProductNamePickerOpen(false);
                                        }}
                                      >
                                        {option.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : arrivalForm.productName.trim() ? (
                              <div className="space-y-1 px-3 py-4 text-sm text-slate-500">
                                <p>找不到符合的品名，可直接保留目前輸入。</p>
                                <p>系統會改用全品項邏輯處理。</p>
                              </div>
                            ) : (
                              <p className="px-3 py-4 text-sm text-slate-500">請先掃描批號／序號，再輸入關鍵字搜尋品名。</p>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] bg-[#eef2f7] p-4 text-sm text-slate-600">
                    <div className="space-y-2">
                      <p>為了讓掃描槍操作更快，本區不再要求先填 PO、廠商、到貨時間與商品分類；只要任一識別碼命中已匯入的 A1 待處理商品，就會直接完成點到貨、同步回寫資料，並留在 A1 等待下一筆。</p>
                      {matchedA1PendingTask ? (() => {
                        const importComparisonStatus = getImportComparisonStatus(matchedA1PendingTask);
                        return (
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <Badge variant="secondary" className={importComparisonStatus.className}>
                              {importComparisonStatus.label}
                            </Badge>
                            <span>{importComparisonStatus.detail}</span>
                          </div>
                        );
                      })() : null}
                    </div>
                    <Button type="submit" className="rounded-2xl" disabled={receiveMutation.isPending || !canReceiveA1}>
                      {receiveMutation.isPending ? "比對中..." : "完成 A1 並準備下一筆"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {stationCode !== "STOCK" ? (
          <Card className="rounded-[28px] border-0 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-bold">掃碼／條碼輸入</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative max-w-xl space-y-3">
                <div className="relative">
                  <Search className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                  <Input
                    ref={quickScanInputRef}
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    onKeyDown={handleStationScanInputKey}
                    placeholder={stationCode === "A2" ? "掃描商品批號 QR 後可直接按 Enter 完成 A2" : stationCode === "B" ? "輸入商品批號後可快速定位 B 站待測項目" : stationCode === "C" ? "輸入商品批號後可快速定位 C 站待檢項目" : stationCode === "E" ? "掃描、拍照或輸入商品批號、序號或 IMEI 後，確認抹除完成即可推進下一站" : "輸入產品代碼、批號、序號或 IMEI"}
                    className="editable-field h-12 rounded-2xl border-0 bg-slate-50 pl-11"
                  />
                </div>
                {stationCode === "E" ? (
                  <div className="flex flex-col gap-3 rounded-[20px] bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1 text-xs leading-6 text-slate-500">
                      <p className="font-medium text-slate-700">手持裝置可直接開啟相機掃描批號 QR，抓到後會自動返回 E 站並帶入上方欄位。</p>
                      <p>{eStationQrCaptureSupported ? (eStationLiveQrCaptureSupported ? "Safari 與一般手機瀏覽器都可直接開啟相機即時辨識，抓到 QR 後會立即回到 E 站。" : "若現場裝置不支援即時掃描，仍可改用拍照辨識。") : "目前裝置不支援拍照辨識 QR，請改用掃碼槍或手動輸入批號。"}</p>
                    </div>
                    <>
                      <input
                        ref={eStationQrCaptureInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={handleEStationQrCaptureChange}
                      />
                      <Button type="button" variant="outline" className="rounded-2xl" onClick={openEStationQrCapture} disabled={isProcessingEStationQrCapture || isStartingEStationQrScanner}>
                        {isProcessingEStationQrCapture || isStartingEStationQrScanner ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
                        {isProcessingEStationQrCapture ? "辨識 QR 中..." : isStartingEStationQrScanner ? "開啟相機中..." : eStationLiveQrCaptureSupported ? "開啟相機掃描 QR" : "拍照掃描 QR"}
                      </Button>
                    </>
                  </div>
                ) : null}
                {stationCode === "A2" ? (
                  <p className="text-sm text-slate-500">A2 已改為掃碼快速完工模式。刷入商品批號 QR 後會立即完成 A2、推進到下一站，並在背景回寫安裝完成時間。</p>
                ) : null}
                {stationCode === "B" ? (
                  <p className="text-sm text-slate-500">B 站可先用商品批號快速定位待測商品，再補充電池檢測與故障狀態；完成軟體測試後會立即推進下一站，並在背景回寫 B 站完成、電池檢測與故障摘要。</p>
                ) : null}
                {stationCode === "C" ? (
                  <p className="text-sm text-slate-500">C 站會承接 B 站的電池檢測與故障狀態，完成品檢後立即推進下一站，並在背景回寫 C 站測試時間、螢幕狀態、機身狀態、鏡頭狀態與必要的上一站修正標記。</p>
                ) : null}
                {stationCode === "E" ? (
                  <p className="text-sm text-slate-500">E 站支援掃碼、手動輸入與相機拍照辨識 QR 來快速定位待抹除商品。確認完成抹除後按下完成並推進下一站，系統會自動回到待輸入狀態，並在背景回寫抹除完成時間與執行人員。</p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="rounded-[28px] border-0 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-bold">待入庫詳細清單</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm leading-7 text-slate-600">
              <div className="rounded-[24px] bg-slate-50 p-4">
                目前共有 <span className="font-semibold text-slate-900">{filteredTasks.length}</span> 筆待入庫商品；下方表格可直接比對批號、序號、IMEI、匯入比對狀態，並支援匯出 CSV。
              </div>
              {filteredTasks.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {filteredTasks.slice(0, 3).map((task) => (
                    <div key={`stock-preview-${task.taskId}`} className="rounded-[24px] bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      <p className="font-semibold text-slate-900">{task.productName ?? task.productCode}</p>
                      <p className="mt-1 text-xs leading-6 text-slate-500">產品代碼：{task.productCode}</p>
                      <p className="text-xs leading-6 text-slate-500">批號：{task.batchNo ?? "-"}</p>
                      <p className="text-xs leading-6 text-slate-500">序號：{task.serialNumber ?? "-"}</p>
                      <p className="text-xs leading-6 text-slate-500">IMEI：{task.imei ?? "-"}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[24px] bg-slate-50 p-4 text-sm leading-7 text-slate-600">目前待入庫沒有商品。</div>
              )}
              {filteredTasks.length > 3 ? (
                <p className="text-xs text-slate-500">其餘 {filteredTasks.length - 3} 筆資料請查看下方待入庫表格清單。</p>
              ) : null}
            </CardContent>
          </Card>
        )}

        {stationCode === "STOCK" ? (
          <Card className="rounded-[28px] border-0 bg-white shadow-sm">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base font-bold">待入庫表格清單</CardTitle>
              <Button type="button" variant="outline" className="rounded-2xl" onClick={handleExportStockCsv} disabled={filteredTasks.length === 0}>
                <Download className="mr-2 h-4 w-4" />
                匯出 CSV
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 rounded-[24px] bg-slate-50 p-4 text-sm leading-7 text-slate-600">
                <p>待入庫改為表格明細檢視，方便直接比對批號、序號、IMEI 與目前站點狀態；命中外部進退貨明細後，後續會自動從這份清單移除。</p>
                <p className="text-xs leading-6 text-slate-500">上方表格只顯示目前仍有效的待入庫任務；已自動移除、已完成或已失效的資料不會混在這份清單，若為最近自動移除案件會另外列在下方提示區塊。</p>
              </div>
              <div className="overflow-x-auto rounded-[24px] bg-slate-50">
                <table className="min-w-full text-sm text-slate-700">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                      <th className="px-4 py-3">產品代碼</th>
                      <th className="px-4 py-3">品名</th>
                      <th className="px-4 py-3">品類</th>
                      <th className="px-4 py-3">批號</th>
                      <th className="px-4 py-3">序號</th>
                      <th className="px-4 py-3">IMEI</th>
                      <th className="px-4 py-3">B站結果</th>
                      <th className="px-4 py-3">C站結果</th>
                      <th className="px-4 py-3">匯入比對</th>
                      <th className="px-4 py-3">狀態</th>
                      {canEditCategory ? <th className="px-4 py-3 text-right">操作</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTasks.map((task) => (
                      <tr key={task.taskId} className="border-b border-slate-200/80 last:border-b-0">
                        <td className="px-4 py-3 font-medium text-slate-900">{task.productCode}</td>
                        <td className="px-4 py-3">{task.productName ?? "-"}</td>
                        <td className="px-4 py-3">{[task.categoryName ?? task.importedCategoryName ?? task.subtypeCode ?? "-", task.brandName ?? task.importedBrandName ?? ""].filter(Boolean).join(" × ")}</td>
                        <td className="px-4 py-3">{task.batchNo ?? "-"}</td>
                        <td className="px-4 py-3">{task.serialNumber ?? "-"}</td>
                        <td className="px-4 py-3">{task.imei ?? "-"}</td>
                        <td className="px-4 py-3 text-xs leading-6 text-slate-600">
                          <p>電池：{getTaskSummaryText(task, "bBatterySummary")}</p>
                          <p>功能：{getTaskSummaryText(task, "bFaultSummary")}</p>
                        </td>
                        <td className="px-4 py-3 text-xs leading-6 text-slate-600">
                          <p>功能：{getTaskSummaryText(task, "cFaultSummary")}</p>
                          <p>外觀：{getTaskSummaryText(task, "cAppearanceSummary")}</p>
                          <p>相機：{getTaskSummaryText(task, "cCameraSummary")}</p>
                        </td>
                        <td className="px-4 py-3">
                          {(() => {
                            const importComparisonStatus = getImportComparisonStatus(task);
                            return (
                              <div className="space-y-1">
                                <Badge variant="secondary" className={importComparisonStatus.className}>
                                  {importComparisonStatus.label}
                                </Badge>
                                <p className="text-xs text-slate-500">{importComparisonStatus.detail}</p>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="secondary" className={task.isOverdue ? "bg-[#f7e8ee] text-rose-700" : "bg-slate-100 text-slate-700"}>
                            {task.isOverdue ? "逾期" : task.taskStatus}
                          </Badge>
                        </td>
                        {canEditCategory ? (
                          <td className="px-4 py-3 text-right">
                            <Button type="button" variant="outline" className="rounded-2xl" onClick={() => openCategoryEditor(task)}>
                              編輯
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredTasks.length === 0 ? (
                <div className="rounded-[24px] bg-slate-50 p-4 text-sm leading-7 text-slate-600">目前待入庫沒有符合條件的商品。</div>
              ) : null}
              {(detailQuery.data?.recentAutoRemovedStockItems?.length ?? 0) > 0 ? (
                <div className="space-y-3 rounded-[24px] bg-amber-50 p-4 text-sm leading-7 text-amber-900">
                  <p className="font-semibold">最近自動移除待入庫</p>
                  <p className="text-amber-800">以下商品已命中外部進貨明細，因此系統自動完成待入庫並從上方清單移除；若你剛找不到某筆批號，請先在這裡確認。</p>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {detailQuery.data?.recentAutoRemovedStockItems?.map((item) => (
                      <div key={`auto-removed-${item.taskId}`} className="rounded-[20px] bg-white/80 px-4 py-3 text-sm text-amber-900">
                        <p className="font-semibold">{item.productName ?? item.productCode}</p>
                        <p className="mt-1 text-xs leading-6 text-amber-800">批號：{item.batchNo ?? "-"}</p>
                        <p className="text-xs leading-6 text-amber-800">序號：{item.serialNumber ?? "-"}</p>
                        <p className="text-xs leading-6 text-amber-800">IMEI：{item.imei ?? "-"}</p>
                        <p className="text-xs leading-6 text-amber-800">完成時間：{item.completedAt ? new Date(item.completedAt).toLocaleString() : "-"}</p>
                        <p className="mt-1 text-xs leading-6 text-amber-800">{item.resultSummary ?? "已自動移除待入庫"}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {stationCode !== "STOCK" && ((stationCode !== "B" && stationCode !== "C") || hasKeyword) ? (
        <div className={stationCode === "B" || stationCode === "C" ? "w-full space-y-4" : "grid gap-4 xl:grid-cols-2"}>
          {filteredTasks.map((task) => {
            const selections = getTaskSelections(task.taskId);
            const carryoverTask = task as typeof task & {
              inheritedBFaultLabels?: string[];
              inheritedBFaultSummary?: string | null;
            };
            const editableBFaultOptions = ((stationCode === "B" ? detailQuery.data?.faultOptions : detailQuery.data?.bFaultOptions) ?? []).filter((option) => option.active);
            const allBFaultOptions = (stationCode === "B" ? detailQuery.data?.faultOptions : detailQuery.data?.bFaultOptions) ?? [];
            const selectedBFaultIds = stationCode === "B" ? selections.faultOptionIds : selections.bFaultOptionIds;
            const selectedBFaultLabels = allBFaultOptions
              .filter((option) => selectedBFaultIds.includes(option.id))
              .map((option) => option.label);
            const fallbackBFaultLabels = stationCode === "C"
              ? normalizeTextList([
                  ...(carryoverTask.inheritedBFaultLabels ?? []),
                  ...(carryoverTask.inheritedBFaultSummary
                    ? carryoverTask.inheritedBFaultSummary.split(",")
                    : []),
                ])
              : [];
            const displayedBFaultLabels = selectedBFaultLabels.length > 0 ? selectedBFaultLabels : fallbackBFaultLabels;
            const batterySummary = summarizeTextResult([
              selections.batteryNote.trim(),
              ...selections.batteryIssueLabels,
            ]);
            const bFaultSummary = summarizeTextResult(displayedBFaultLabels);

            return (
              <Card key={task.taskId} className={`rounded-[26px] border-0 bg-white shadow-sm ${stationCode === "B" || stationCode === "C" ? "w-full" : ""}`}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between text-base font-bold text-slate-900">
                    <span>{task.productCode}</span>
                    <Badge variant="secondary" className={task.isOverdue ? "bg-[#f7e8ee] text-rose-700" : "bg-slate-100 text-slate-700"}>
                      {task.isOverdue ? "逾期" : task.taskStatus}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600 md:grid-cols-2">
                    <div><p className="text-xs text-slate-400">商品名稱</p><p className="mt-1 font-semibold text-slate-900">{task.productName ?? "-"}</p></div>
                    <div><p className="text-xs text-slate-400">品類 / 品牌</p><p className="mt-1 font-semibold text-slate-900">{[task.categoryName ?? task.importedCategoryName ?? task.subtypeCode ?? "-", task.brandName ?? task.importedBrandName ?? ""].filter(Boolean).join(" × ")}</p></div>
                  </div>
                  <div className="grid gap-3 text-sm md:grid-cols-5">
                    <div><p className="text-xs text-slate-400">批號</p><p className="mt-1 font-semibold text-slate-900">{task.batchNo ?? "-"}</p></div>
                    <div><p className="text-xs text-slate-400">序號</p><p className="mt-1 font-semibold text-slate-900">{task.serialNumber ?? "-"}</p></div>
                    <div><p className="text-xs text-slate-400">IMEI</p><p className="mt-1 font-semibold text-slate-900">{task.imei ?? "-"}</p></div>
                    <div><p className="text-xs text-slate-400">目前站點</p><p className="mt-1 font-semibold text-slate-900">{task.currentStationCode}</p></div>
                    <div>
                      <p className="text-xs text-slate-400">匯入比對</p>
                      {(() => {
                        const importComparisonStatus = getImportComparisonStatus(task);
                        return (
                          <div className="mt-1 space-y-1">
                            <Badge variant="secondary" className={importComparisonStatus.className}>
                              {importComparisonStatus.label}
                            </Badge>
                            <p className="text-xs text-slate-500">{importComparisonStatus.detail}</p>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                {canEditCategory ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm">
                      <div className="space-y-1">
                        <p className="text-xs text-slate-400">套用品類設定</p>
                        <p className="font-semibold text-slate-900">{[task.categoryName ?? task.importedCategoryName ?? task.subtypeCode ?? "未分類", task.brandName ?? task.importedBrandName ?? ""].filter(Boolean).join(" × ")}</p>
                      </div>
                      <Button type="button" variant="outline" className="rounded-2xl" onClick={() => openCategoryEditor(task)}>
                        編輯
                      </Button>
                    </div>
                  ) : null}

                  {stationCode === "B" || stationCode === "C" ? (
                    <div className="space-y-4">
                      <div className="space-y-3 rounded-[24px] bg-[#eef2f7] p-4 md:p-5">
                        <div>
                          <p className="text-sm font-bold text-slate-900">{stationCode === "B" ? "B 站故障狀態" : "B 站故障狀態（C 站可修改）"}</p>
                          <p className="mt-1 text-xs leading-6 text-slate-500">{stationCode === "B" ? "直接勾選本次軟測結果即可完成送出。" : "這裡先帶入 B 站完成後的文字結果；如需調整，再按修改按鈕進入編輯，完成時可選擇是否一併回寫 Google Sheet M / N / Q 欄。"}</p>
                        </div>
                        {stationCode === "C" && !selections.isEditingBFaults ? (
                          <div className="space-y-3">
                            <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
                              {bFaultSummary}
                            </div>
                            <div className="flex justify-end">
                              <Button type="button" variant="outline" className="rounded-2xl" onClick={() => setBFaultEditing(task.taskId, true)}>
                                修改故障狀態
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="flex flex-wrap gap-3">
                              {editableBFaultOptions.map((option) => (
                                <label key={option.id} className="flex min-h-[56px] min-w-[170px] items-center gap-3 rounded-[20px] bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm sm:min-w-[180px] xl:min-w-[185px]">
                                  <Checkbox checked={(stationCode === "B" ? selections.faultOptionIds : selections.bFaultOptionIds).includes(option.id)} onCheckedChange={(checked) => toggleSelection(task.taskId, stationCode === "B" ? "faultOptionIds" : "bFaultOptionIds", option.id, Boolean(checked))} />
                                  <span>{option.label}</span>
                                </label>
                              ))}
                            </div>
                            {stationCode === "C" ? (
                              <div className="flex justify-end">
                                <Button type="button" variant="ghost" className="rounded-2xl" onClick={() => setBFaultEditing(task.taskId, false)}>
                                  取消修改
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                      <div className="space-y-3 rounded-[24px] bg-[#f8fbff] p-4 md:p-5">
                        <div>
                          <p className="text-sm font-bold text-slate-900">電池檢測</p>
                        </div>
                        {stationCode === "B" ? (
                          <div className="space-y-4">
                            <label className="space-y-2 text-sm text-slate-600">
                              <span>檢測回覆</span>
                              <Input
                                value={selections.batteryNote}
                                onChange={(event) => updateBatteryNote(task.taskId, event.target.value)}
                                className="editable-field h-12 rounded-2xl border-0 bg-white shadow-sm"
                                placeholder="例如：88、85%、待更換"
                              />
                            </label>
                            <div className="space-y-3">
                              <p className="text-sm font-medium text-slate-700">異常標記</p>
                              <div className="flex flex-wrap gap-3">
                                {B_BATTERY_ISSUE_OPTIONS.map((optionLabel) => (
                                  <label key={optionLabel} className="flex min-h-[56px] min-w-[170px] items-center gap-3 rounded-[20px] bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm sm:min-w-[180px] xl:min-w-[185px]">
                                    <Checkbox
                                      checked={selections.batteryIssueLabels.includes(optionLabel)}
                                      onCheckedChange={(checked) => toggleBatteryIssueLabel(task.taskId, optionLabel, Boolean(checked))}
                                    />
                                    <span>{optionLabel}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                            <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
                              {batterySummary}
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-xs leading-6 text-slate-500">這裡先帶入 B 站的電池檢測文字結果；如需調整，再按修改按鈕編輯，完成時可選擇是否回寫 Google Sheet M / Q 欄。</p>
                              </div>
                              <Button type="button" variant="outline" className="rounded-2xl" onClick={() => openBatteryEditor(task.taskId)}>
                                修改電池檢測
                              </Button>
                            </div>
                            <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
                              {batterySummary}
                            </div>
                            <Dialog open={batteryDialogTaskId === task.taskId} onOpenChange={(open) => setBatteryDialogTaskId(open ? task.taskId : null)}>
                              <DialogContent className="rounded-[28px] border-0 p-0 sm:max-w-xl">
                                <div className="space-y-6 p-6">
                                  <DialogHeader>
                                    <DialogTitle>電池檢測</DialogTitle>
                                    <DialogDescription>此區會先帶入 B 站已記錄的電池檢測文字結果。若你有調整，完成 C 站時可選擇是否同步回 Google Sheet M 欄，並在 Q 欄標記為已修改上一關狀態。</DialogDescription>
                                  </DialogHeader>
                                  <label className="space-y-2 text-sm text-slate-600">
                                    <span>檢測回覆</span>
                                    <Input
                                      value={selections.batteryNote}
                                      onChange={(event) => updateBatteryNote(task.taskId, event.target.value)}
                                      className="editable-field h-12 rounded-2xl border-0 bg-slate-50"
                                      placeholder="例如：88、85%、待更換"
                                    />
                                  </label>
                                  <div className="space-y-3">
                                    <p className="text-sm font-medium text-slate-700">異常標記</p>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                      {B_BATTERY_ISSUE_OPTIONS.map((optionLabel) => (
                                        <label key={optionLabel} className="flex items-center gap-3 rounded-[20px] bg-slate-50 px-4 py-4 text-sm font-medium text-slate-700">
                                          <Checkbox
                                            checked={selections.batteryIssueLabels.includes(optionLabel)}
                                            onCheckedChange={(checked) => toggleBatteryIssueLabel(task.taskId, optionLabel, Boolean(checked))}
                                          />
                                          <span>{optionLabel}</span>
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                  <DialogFooter>
                                    <Button type="button" variant="outline" className="rounded-2xl" onClick={() => setBatteryDialogTaskId(null)}>
                                      完成
                                    </Button>
                                  </DialogFooter>
                                </div>
                              </DialogContent>
                            </Dialog>
                          </>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {stationCode === "C" ? (
                    <div className="space-y-4">
                      <div className="space-y-3 rounded-[24px] bg-[#eef2f7] p-4 md:p-5">
                        <div>
                          <p className="text-sm font-bold text-slate-900">C 站螢幕狀態</p>
                          <p className="mt-1 text-xs leading-6 text-slate-500">完成後會自動背景同步到 Google Sheet O 欄；若未勾選任何項目則回寫「正常」。</p>
                        </div>
                        <div className="flex flex-wrap gap-3">
                          {(detailQuery.data?.faultOptions ?? []).filter((option) => option.active).map((option) => (
                            <label key={option.id} className="flex min-h-[56px] min-w-[170px] items-center gap-3 rounded-[20px] bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm sm:min-w-[180px] xl:min-w-[185px]">
                              <Checkbox checked={selections.faultOptionIds.includes(option.id)} onCheckedChange={(checked) => toggleSelection(task.taskId, "faultOptionIds", option.id, Boolean(checked))} />
                              <span>{option.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-3 rounded-[24px] bg-[#f7e8ee] p-4 md:p-5">
                        <div>
                          <p className="text-sm font-bold text-slate-900">C 站機身外觀</p>
                          <p className="mt-1 text-xs leading-6 text-slate-500">完成後會自動背景同步到 Google Sheet S 欄；若未勾選任何項目則回寫「正常」。</p>
                        </div>
                        <div className="flex flex-wrap gap-3">
                          {(detailQuery.data?.appearanceOptions ?? []).filter((option) => option.active).map((option) => (
                            <label key={option.id} className="flex min-h-[56px] min-w-[170px] items-center gap-3 rounded-[20px] bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm sm:min-w-[180px] xl:min-w-[185px]">
                              <Checkbox checked={selections.appearanceOptionIds.includes(option.id)} onCheckedChange={(checked) => toggleSelection(task.taskId, "appearanceOptionIds", option.id, Boolean(checked))} />
                              <span>{option.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-3 rounded-[24px] bg-[#eef7f3] p-4 md:p-5">
                        <div>
                          <p className="text-sm font-bold text-slate-900">C 站鏡頭狀態</p>
                          <p className="mt-1 text-xs leading-6 text-slate-500">完成後會自動背景同步到 Google Sheet T 欄；若未勾選任何項目則回寫「正常」。</p>
                        </div>
                        <div className="flex flex-wrap gap-3">
                          {(detailQuery.data?.cameraOptions ?? []).filter((option) => option.active).map((option) => (
                            <label key={option.id} className="flex min-h-[56px] min-w-[170px] items-center gap-3 rounded-[20px] bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm sm:min-w-[180px] xl:min-w-[185px]">
                              <Checkbox checked={selections.cameraOptionIds.includes(option.id)} onCheckedChange={(checked) => toggleSelection(task.taskId, "cameraOptionIds", option.id, Boolean(checked))} />
                              <span>{option.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {stationCode === "E" ? (
                    <div className="grid gap-4 lg:grid-cols-2">
                      {[
                        { key: "eFrontPhoto" as const, title: "正面照片", helper: "上傳後會寫入 Google 試算表 AC 欄，檔名為商品批號-1" },
                        { key: "eBackPhoto" as const, title: "反面照片", helper: "上傳後會寫入 Google 試算表 AD 欄，檔名為商品批號-2" },
                      ].map((photoField) => {
                        const currentPhoto = photoField.key === "eFrontPhoto" ? selections.eFrontPhoto : selections.eBackPhoto;
                        return (
                          <div key={photoField.key} className="space-y-3 rounded-[24px] bg-[#eef6ff] p-4 md:p-5">
                            <div>
                              <p className="text-sm font-bold text-slate-900">{photoField.title}</p>
                              <p className="mt-1 text-xs leading-6 text-slate-500">{photoField.helper}。手持裝置會優先開啟相機拍照。</p>
                            </div>
                            <Input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              className="editable-field h-12 rounded-2xl border-0 bg-white shadow-sm file:mr-4 file:rounded-xl file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium"
                              onChange={(event) => void handleStationPhotoChange(task.taskId, photoField.key, event.target.files)}
                            />
                            {currentPhoto ? (
                              <div className="space-y-3 rounded-2xl bg-white p-3 shadow-sm">
                                <img src={currentPhoto.dataUrl} alt={photoField.title} className="h-48 w-full rounded-2xl object-cover" />
                                <p className="text-xs text-slate-500">已準備上傳，完成 E 站時會同步寫入 Drive 與採購單試算表。</p>
                              </div>
                            ) : (
                              <div className="rounded-2xl bg-white px-4 py-6 text-sm text-slate-500 shadow-sm">尚未拍攝 {photoField.title}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-3">
                    <Button
                      className="rounded-2xl"
                      disabled={completeMutation.isPending}
                      onClick={() => submitStationCompletion(task)}
                    >
                      {stationCode === "B" ? "完成軟體測試並推進下一站" : stationCode === "C" ? "完成 C 站品檢並推進下一站" : stationCode === "E" ? "完成抹除並推進下一站" : "完成並推進下一站"}
                    </Button>
                    <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/operations")}>
                      返回總覽
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {filteredTasks.length === 0 && showStationEmptyState ? (
            <Card className={`rounded-[26px] border-0 bg-white shadow-sm ${stationCode === "B" || stationCode === "C" ? "" : "xl:col-span-2"}`}>
              <CardContent className="p-8 text-sm leading-7 text-slate-600">目前此站沒有符合條件的待處理商品。你可以返回站點總覽，查看其他站點的未完成數量並切換支援，或前往匯入作業建立新的到貨資料。</CardContent>
            </Card>
          ) : null}
        </div>
        ) : null}

        {stationCode === "B" || stationCode === "C" ? (
          <Card className="rounded-[28px] border-0 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-bold">未處理表格清單</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-[24px] bg-slate-50 p-4 text-sm leading-7 text-slate-600">
                {stationCode === "B"
                  ? "B 站待處理商品改為表格明細檢視，方便直接查看產品代碼、批號、序號、IMEI 與目前狀態；搜尋到指定條碼時，上方會先顯示對應結果，下方仍保留完整未處理清單供你比對。"
                  : "C 站待處理商品也改為表格明細檢視，方便直接查看產品代碼、批號、序號、IMEI 與目前狀態；搜尋到指定條碼時，上方會先顯示對應結果，下方仍保留完整未處理清單供你比對。"}
              </div>
              <div className="overflow-x-auto rounded-[24px] bg-slate-50">
                <table className="min-w-full text-sm text-slate-700">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                      <th className="px-4 py-3">產品代碼</th>
                      <th className="px-4 py-3">品名</th>
                      <th className="px-4 py-3">品類</th>
                      <th className="px-4 py-3">批號</th>
                      <th className="px-4 py-3">序號</th>
                      <th className="px-4 py-3">IMEI</th>
                      <th className="px-4 py-3">B站結果</th>
                      <th className="px-4 py-3">C站結果</th>
                      <th className="px-4 py-3">匯入比對</th>
                      <th className="px-4 py-3">狀態</th>
                      {canEditCategory ? <th className="px-4 py-3 text-right">操作</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {pendingTasks.map((task) => (
                      <tr key={task.taskId} className="border-b border-slate-200/80 last:border-b-0">
                        <td className="px-4 py-3 font-medium text-slate-900">{task.productCode}</td>
                        <td className="px-4 py-3">{task.productName ?? "-"}</td>
                        <td className="px-4 py-3">{[task.categoryName ?? task.importedCategoryName ?? task.subtypeCode ?? "-", task.brandName ?? task.importedBrandName ?? ""].filter(Boolean).join(" × ")}</td>
                        <td className="px-4 py-3">{task.batchNo ?? "-"}</td>
                        <td className="px-4 py-3">{task.serialNumber ?? "-"}</td>
                        <td className="px-4 py-3">{task.imei ?? "-"}</td>
                        <td className="px-4 py-3 text-xs leading-6 text-slate-600">
                          <p>電池：{getTaskSummaryText(task, "bBatterySummary")}</p>
                          <p>功能：{getTaskSummaryText(task, "bFaultSummary")}</p>
                        </td>
                        <td className="px-4 py-3 text-xs leading-6 text-slate-600">
                          <p>功能：{getTaskSummaryText(task, "cFaultSummary")}</p>
                          <p>外觀：{getTaskSummaryText(task, "cAppearanceSummary")}</p>
                          <p>相機：{getTaskSummaryText(task, "cCameraSummary")}</p>
                        </td>
                        <td className="px-4 py-3">
                          {(() => {
                            const importComparisonStatus = getImportComparisonStatus(task);
                            return (
                              <div className="space-y-1">
                                <Badge variant="secondary" className={importComparisonStatus.className}>
                                  {importComparisonStatus.label}
                                </Badge>
                                <p className="text-xs text-slate-500">{importComparisonStatus.detail}</p>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="secondary" className={task.isOverdue ? "bg-[#f7e8ee] text-rose-700" : "bg-slate-100 text-slate-700"}>
                            {task.isOverdue ? "逾期" : task.taskStatus}
                          </Badge>
                        </td>
                        {canEditCategory ? (
                          <td className="px-4 py-3 text-right">
                            <Button type="button" variant="outline" className="rounded-2xl" onClick={() => openCategoryEditor(task)}>
                              編輯
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pendingTasks.length === 0 ? (
                <div className="rounded-[24px] bg-slate-50 p-4 text-sm leading-7 text-slate-600">目前 {stationCode} 站沒有待處理商品。</div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
        {stationCode === "E" ? (
          <Dialog open={isEStationQrScannerOpen} onOpenChange={(open) => {
            setIsEStationQrScannerOpen(open);
            if (!open) {
              setEStationQrScannerError("");
            }
          }}>
            <DialogContent className="rounded-[28px] border-0 p-0 sm:max-w-lg">
              <div className="space-y-6 p-6">
                <DialogHeader>
                  <DialogTitle>相機掃描批號 QR</DialogTitle>
                  <DialogDescription>請將 QR 置中。系統一旦辨識成功，就會自動關閉相機並返回 E 站帶入批號。</DialogDescription>
                </DialogHeader>
                <div className="overflow-hidden rounded-[28px] bg-slate-950">
                  <video ref={eStationQrScannerVideoRef} autoPlay playsInline muted className="aspect-[3/4] w-full object-cover" />
                </div>
                <canvas ref={eStationQrScannerCanvasRef} className="hidden" aria-hidden="true" />
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  {eStationQrScannerError || (isStartingEStationQrScanner ? "正在啟動相機，請稍候..." : "相機開啟後會持續偵測 QR；抓到後會立即跳回 E 站。")}
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" className="rounded-2xl" onClick={() => setIsEStationQrScannerOpen(false)}>
                    關閉相機
                  </Button>
                </DialogFooter>
              </div>
            </DialogContent>
          </Dialog>
        ) : null}
        {canEditCategory ? (
        <Dialog open={Boolean(categoryDialogTask)} onOpenChange={(open) => {
          if (!open) {
            setCategoryDialogTask(null);
            setCategoryDraftValue("");
          }
        }}>
          <DialogContent className="rounded-[28px] border-0 p-0 sm:max-w-xl">
            <div className="space-y-6 p-6">
              <DialogHeader>
                <DialogTitle>編輯品類設定</DialogTitle>
                <DialogDescription>
                  為 {categoryDialogTask?.productCode ?? "此商品"} 手動指定管理後台的品類設定。更新後，本站與後續站點會沿用新的品類／品牌對應。
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                目前設定：<span className="font-semibold text-slate-900">{categoryDialogTask?.categoryLabel || "未分類"}</span>
              </div>
              <label className="space-y-2 text-sm text-slate-600">
                <span>選擇品類設定</span>
                <select
                  value={categoryDraftValue}
                  onChange={(event) => setCategoryDraftValue(event.target.value)}
                  className="editable-select h-12 w-full rounded-2xl border-0 bg-slate-50 px-4 text-slate-900"
                >
                  <option value="">清除指定，改回未分類</option>
                  {productCategoryOptions.map((category) => (
                    <option key={category.id} value={category.id}>
                      {[category.categoryName, category.brandName ?? category.subtypeCode ?? ""].filter(Boolean).join(" × ")}
                    </option>
                  ))}
                </select>
              </label>
              <DialogFooter>
                <Button type="button" variant="outline" className="rounded-2xl" onClick={() => {
                  setCategoryDialogTask(null);
                  setCategoryDraftValue("");
                }}>
                  取消
                </Button>
                <Button
                  type="button"
                  className="rounded-2xl"
                  disabled={!categoryDialogTask || assignCategoryMutation.isPending}
                  onClick={() => {
                    if (!categoryDialogTask) {
                      return;
                    }
                    assignCategoryMutation.mutate({
                      productId: categoryDialogTask.productId,
                      categoryId: categoryDraftValue ? Number(categoryDraftValue) : null,
                    });
                  }}
                >
                  {assignCategoryMutation.isPending ? "更新中..." : "儲存設定"}
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
