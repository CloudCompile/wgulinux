import { OverlayStorage } from "./storage/overlay.js";
import { runVectorAdd } from "./gpu/webgpu-bridge.js";

const $ = selector => document.querySelector(selector);
const consoleOutput = $("#console-output");
const appendConsole = line => { consoleOutput.textContent += `${line}\n`; consoleOutput.scrollTop = consoleOutput.scrollHeight; };

const gpuStatus = $("#gpu-status");
if (navigator.gpu) { gpuStatus.textContent = "WebGPU detected"; gpuStatus.classList.add("signal-good"); } else { gpuStatus.textContent = "CPU fallback"; }

const storage = new OverlayStorage();
try {
  await storage.init();
  $("#storage-state").textContent = "ready";
  $("#storage-backend").textContent = `${storage.backend} overlay online`;
} catch (error) {
  $("#storage-state").textContent = "unavailable";
  $("#storage-backend").textContent = `storage error: ${error.message}`;
}

$("#boot-button").addEventListener("click", () => {
  appendConsole("boot request received");
  appendConsole("v86 / Buildroot artifacts are not bundled in this checkout");
  appendConsole("add public/v86 and public/images/kernel + rootfs to enable boot");
  $("#boot-state").textContent = "awaiting artifacts";
});
$("#clear-console").addEventListener("click", () => { consoleOutput.textContent = ""; });

$("#write-file").addEventListener("click", async () => {
  try { await storage.write($("#file-name").value, $("#file-value").value); $("#file-preview").textContent = "write committed to overlay"; } catch (error) { $("#file-preview").textContent = `write failed: ${error.message}`; }
});
$("#read-file").addEventListener("click", async () => {
  const value = await storage.read($("#file-name").value);
  $("#file-preview").textContent = value === null ? "file not found in overlay" : value;
});
$("#reset-disk").addEventListener("click", async () => { await storage.reset(); $("#file-preview").textContent = "overlay reset"; });

$("#run-compute").addEventListener("click", async event => {
  const button = event.currentTarget; button.disabled = true; $("#device-state").textContent = "running";
  try { const result = await runVectorAdd(); $("#compute-result").textContent = result.message; $("#device-state").textContent = result.correct === false ? "error" : "complete"; }
  catch (error) { $("#compute-result").textContent = `GPU job failed: ${error.message}`; $("#device-state").textContent = "error"; }
  finally { button.disabled = false; }
});
