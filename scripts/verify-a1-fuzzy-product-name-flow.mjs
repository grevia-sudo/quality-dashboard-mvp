import { spawn } from "node:child_process";

const [baseUrl, serialNumber] = process.argv.slice(2);

if (!baseUrl || !serialNumber) {
  console.error("Usage: node verify-a1-fuzzy-product-name-flow.mjs <baseUrl> <serialNumber>");
  process.exit(1);
}

const debuggerPort = 9222;
const chrome = spawn(
  "chromium",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    `--remote-debugging-port=${debuggerPort}`,
    "--user-data-dir=/tmp/chromium-a1-fuzzy-verify",
    "about:blank",
  ],
  {
    stdio: "ignore",
  },
);

const cleanup = () => {
  if (!chrome.killed) {
    chrome.kill("SIGKILL");
  }
};

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

async function waitForDebugger() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debuggerPort}/json/list`);
      const targets = await response.json();
      const pageTarget = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (pageTarget) {
        return pageTarget.webSocketDebuggerUrl;
      }
    } catch {
      // ignore boot wait
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Chrome remote debugger did not become ready in time");
}

async function main() {
  const wsUrl = await waitForDebugger();
  const ws = new WebSocket(wsUrl);
  let requestId = 0;
  const pending = new Map();
  const pageLoadedResolvers = [];

  ws.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);

    if (payload.id && pending.has(payload.id)) {
      const { resolve, reject } = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.error) {
        reject(new Error(payload.error.message));
      } else {
        resolve(payload.result);
      }
      return;
    }

    if (payload.method === "Page.loadEventFired") {
      while (pageLoadedResolvers.length > 0) {
        const resolve = pageLoadedResolvers.shift();
        resolve?.();
      }
    }
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", (error) => reject(error), { once: true });
  });

  const send = (method, params = {}) => {
    requestId += 1;
    const currentId = requestId;
    ws.send(JSON.stringify({ id: currentId, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(currentId, { resolve, reject });
    });
  };

  const waitForLoad = () => new Promise((resolve) => pageLoadedResolvers.push(resolve));

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");

  const loadPromise = waitForLoad();
  await send("Page.navigate", { url: `${baseUrl}/station/A1` });
  await loadPromise;

  await send("Runtime.evaluate", {
    expression: `(() => {
      if (window.__capturedFetches) return;
      const originalFetch = window.fetch.bind(window);
      window.__capturedFetches = [];
      window.fetch = (...args) => {
        const [input, init] = args;
        window.__capturedFetches.push({
          url: String(input),
          body: typeof init?.body === "string" ? init.body : null,
        });
        return originalFetch(...args);
      };
    })()`,
    awaitPromise: true,
  });

  const interaction = await send("Runtime.evaluate", {
    expression: `(() => new Promise(async (resolve, reject) => {
      const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
      const setInputValue = (input, value) => {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
        descriptor.set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const waitFor = async (getter, timeout = 15000) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeout) {
          const value = getter();
          if (value) return value;
          await sleep(100);
        }
        throw new Error("Timed out waiting for target element");
      };

      try {
        const productInput = await waitFor(() => document.querySelector('input[placeholder="輸入品名關鍵字搜尋（可選）"]'));
        const serialInput = await waitFor(() => document.querySelector('input[placeholder="可補刷序號以補齊資料"]'));
        const submitButton = await waitFor(() => Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("完成 A1 並準備下一筆")));

        productInput.focus();
        setInputValue(productInput, "機");
        await sleep(200);

        const optionButton = await waitFor(() => Array.from(document.querySelectorAll("button")).find((button) => {
          const text = button.textContent?.trim();
          return Boolean(text) && text !== "完成 A1 並準備下一筆" && button.closest("div.absolute");
        }));

        const selectedLabel = optionButton.textContent.trim();
        optionButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        optionButton.click();
        await sleep(100);

        serialInput.focus();
        setInputValue(serialInput, ${JSON.stringify(serialNumber)});
        await sleep(100);
        submitButton.click();
        await sleep(1800);

        const captured = [...(window.__capturedFetches ?? [])].reverse();
        const stationReceiveRequest = captured.find((item) => item.url.includes("station.receive"));
        const activePlaceholder = document.activeElement?.getAttribute("placeholder") ?? null;

        resolve(JSON.stringify({
          selectedLabel,
          activePlaceholder,
          requestBody: stationReceiveRequest?.body ?? null,
          submitTriggered: Boolean(stationReceiveRequest?.body),
        }));
      } catch (error) {
        reject(error instanceof Error ? error.message : String(error));
      }
    }))()`,
    awaitPromise: true,
    returnByValue: true,
  });

  const result = JSON.parse(interaction.result.value);
  console.log(JSON.stringify(result));

  ws.close();
  cleanup();
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exit(1);
});
