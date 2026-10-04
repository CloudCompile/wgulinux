import { WgulinuxGPUDevice } from "./gpu/device.js";

const terminal = document.querySelector("#terminal");
const bootButton = document.querySelector("#boot-button");
const saveButton = document.querySelector("#save-button");
const resetButton = document.querySelector("#reset-button");
const gpuButton = document.querySelector("#gpu-button");
const snapshotSizeLabel = document.querySelector("#snapshot-size");
const bootState = document.querySelector("#boot-state");

const STORAGE_NAME = "wgulinux-rootfs.img";
const DEFAULT_DISK_PATH = "./public/images/rootfs.img";
const DEFAULT_KERNEL_PATH = "./public/images/linux4.bzImage";
let emulator;
let stateTimer = null;
let storage;
let diskBuffer = null;
let gpuDevice = null;

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** power);
  return `${value.toFixed(value >= 10 || power === 0 ? 0 : 1)} ${units[power]}`;
}

function updateSnapshotSize(bytes = 0) {
  snapshotSizeLabel.textContent = `snapshot: ${formatBytes(bytes)}`;
}

function appendConsoleChunk(chunk) {
  if (typeof chunk === "number") chunk = String.fromCharCode(chunk);
  terminal.textContent += chunk;
  terminal.scrollTop = terminal.scrollHeight;
}

function writeSerialByte(byte) {
  appendConsoleChunk(byte);
}

function sendKey(event) {
  if (!emulator) return;
  let value = event.key;
  if (event.ctrlKey && event.key.length === 1) value = String.fromCharCode(event.key.toUpperCase().charCodeAt(0) - 64);
  else if (event.key === "Enter") value = "\r";
  else if (event.key === "Backspace") value = "\x7f";
  else if (event.key.length !== 1) return;
  event.preventDefault();
  emulator.serial0_send(value);
}

async function openStorage() {
  if (storage) return storage;

  storage = {
    backend: "IndexedDB",
    async read() {
      try {
        if (navigator.storage?.getDirectory) {
          const root = await navigator.storage.getDirectory();
          try {
            const handle = await root.getFileHandle(STORAGE_NAME, { create: false });
            const file = await handle.getFile();
            return new Uint8Array(await file.arrayBuffer());
          } catch {
            return null;
          }
        }
      } catch {
        // fall through to the IDB path below
      }

      return new Promise((resolve, reject) => {
        const request = indexedDB.open("wgulinux-state", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("state");
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("state", "readonly");
          const getRequest = tx.objectStore("state").get("snapshot");
          getRequest.onsuccess = () => resolve(getRequest.result ? new Uint8Array(getRequest.result) : null);
          getRequest.onerror = () => reject(getRequest.error);
        };
        request.onerror = () => reject(request.error);
      });
    },
    async write(bytes) {
      const data = bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
      try {
        if (navigator.storage?.getDirectory) {
          const root = await navigator.storage.getDirectory();
          const handle = await root.getFileHandle(STORAGE_NAME, { create: true });
          const writable = await handle.createWritable();
          await writable.write(data);
          await writable.close();
          return true;
        }
      } catch {
        // fall through to IDB path below
      }

      return new Promise((resolve, reject) => {
        const request = indexedDB.open("wgulinux-state", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("state");
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("state", "readwrite");
          tx.objectStore("state").put(data, "snapshot");
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      });
    },
    async clear() {
      try {
        if (navigator.storage?.getDirectory) {
          const root = await navigator.storage.getDirectory();
          try {
            await root.removeEntry(STORAGE_NAME);
          } catch {
            // ignore missing state
          }
        }
      } catch {
        // ignore
      }

      return new Promise((resolve, reject) => {
        const request = indexedDB.open("wgulinux-state", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("state");
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("state", "readwrite");
          tx.objectStore("state").delete("snapshot");
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      });
    },
  };

  return storage;
}

async function readDiskImage() {
  const store = await openStorage();
  const bytes = await store.read();
  if (bytes && bytes.length) {
    updateSnapshotSize(bytes.byteLength);
    return bytes;
  }

  const defaultBuffer = await fetch(DEFAULT_DISK_PATH).then(response => response.arrayBuffer());
  const defaultBytes = new Uint8Array(defaultBuffer);
  updateSnapshotSize(defaultBytes.byteLength);
  return defaultBytes;
}

function getDiskBuffer() {
  if (!emulator || !emulator.v86 || !emulator.v86.cpu || !emulator.v86.cpu.devices) return null;
  const ide = emulator.v86.cpu.devices.ide;
  return ide?.primary?.master?.buffer || ide?.secondary?.master?.buffer || null;
}

async function saveDiskImage() {
  const disk = getDiskBuffer();
  if (!disk) return 0;
  const bytes = new Uint8Array(disk.buffer, disk.byteOffset, disk.byteLength);
  const store = await openStorage();
  await store.write(bytes);
  updateSnapshotSize(bytes.byteLength);
  return bytes.byteLength;
}

async function resetDiskImage() {
  if (emulator) {
    emulator.destroy();
    emulator = null;
  }
  const store = await openStorage();
  await store.clear();
  diskBuffer = null;
  updateSnapshotSize(0);
}

function scheduleAutosave() {
  if (stateTimer) clearInterval(stateTimer);
  stateTimer = setInterval(async () => {
    if (!emulator) return;
    try {
      await saveDiskImage();
    } catch (error) {
      console.error("autosave failed", error);
    }
  }, 15000);
}

function attachGpuDevice(emulatorInstance) {
  if (!emulatorInstance || !emulatorInstance.v86 || !emulatorInstance.v86.cpu) {
    return null;
  }

  if (!gpuDevice) {
    gpuDevice = new WgulinuxGPUDevice();
  }

  gpuDevice.attach(emulatorInstance);
  terminal.textContent += "\n[wgpu: device mapped at 0xf0000000]\n";
  return gpuDevice;
}

async function runGpuDemo() {
  if (!emulator) {
    terminal.textContent += "\n[wgpu: boot the guest first]\n";
    return;
  }

  if (!gpuDevice) {
    attachGpuDevice(emulator);
  }

  const guestMemory = emulator.v86.cpu.mem8;
  const baseAddr = 0x1000000;
  const floatSize = 4;
  const count = 256;
  const aAddr = baseAddr;
  const bAddr = aAddr + count * floatSize;
  const outAddr = bAddr + count * floatSize;
  const descAddr = outAddr + count * floatSize;

  const valuesA = Float32Array.from({ length: count }, (_, index) => index + 1);
  const valuesB = Float32Array.from({ length: count }, (_, index) => 2 * index + 3);
  const expected = new Float32Array(count);
  for (let i = 0; i < count; i++) expected[i] = valuesA[i] + valuesB[i];

  emulator.v86.cpu.write_blob(new Uint8Array(valuesA.buffer), aAddr);
  emulator.v86.cpu.write_blob(new Uint8Array(valuesB.buffer), bAddr);
  const resultBuffer = new Float32Array(count);
  emulator.v86.cpu.write_blob(new Uint8Array(resultBuffer.buffer), outAddr);

  const descriptor = new ArrayBuffer(128);
  const view = new DataView(descriptor);
  view.setUint32(0x00, 0x444a4757, true);
  view.setUint16(0x04, 1, true);
  view.setUint32(0x08, 1, true);
  view.setUint32(0x0c, 0, true);
  view.setBigUint64(0x18, BigInt(aAddr), true);
  view.setBigUint64(0x20, BigInt(valuesA.byteLength), true);
  view.setBigUint64(0x28, BigInt(bAddr), true);
  view.setBigUint64(0x30, BigInt(valuesB.byteLength), true);
  view.setBigUint64(0x38, BigInt(outAddr), true);
  view.setBigUint64(0x40, BigInt(resultBuffer.byteLength), true);
  view.setUint32(0x48, count, true);
  view.setUint32(0x4c, 1, true);
  view.setUint32(0x50, 1, true);

  emulator.v86.cpu.write_blob(new Uint8Array(descriptor), descAddr);
  const result = await gpuDevice.submitDescriptor(descAddr);

  if (!result.supported) {
    terminal.textContent += `\n[wgpu: ${result.message}]\n`;
    return;
  }

  const resultBytes = new Uint8Array(guestMemory.buffer, guestMemory.byteOffset + outAddr, count * floatSize);
  const output = new Float32Array(resultBytes.buffer, resultBytes.byteOffset, count);
  const matches = output.every((value, index) => Math.abs(value - expected[index]) < 0.000001);

  terminal.textContent += `\n[wgpu: job complete (${matches ? "verified" : "mismatch"}) in ${result.elapsedMs} ms]\n`;
  if (!matches) {
    terminal.textContent += `[wgpu: expected ${expected.slice(0, 8).join(", ")}, got ${output.slice(0, 8).join(", ")}]\n`;
  }
}

async function bootLinux({ forceCold = false } = {}) {
  if (emulator) {
    emulator.destroy();
    emulator = null;
  }

  bootButton.disabled = true;
  bootState.textContent = "booting";
  terminal.focus();

  try {
    const store = await openStorage();
    const persisted = forceCold ? null : await store.read();
    const diskBytes = persisted && persisted.length ? persisted : new Uint8Array(await fetch(DEFAULT_DISK_PATH).then(response => response.arrayBuffer()));
    diskBuffer = diskBytes;
    const kernelBytes = new Uint8Array(await fetch(DEFAULT_KERNEL_PATH).then(response => response.arrayBuffer()));

    emulator = new V86({
      wasm_path: "./public/v86/build/v86.wasm",
      memory_size: 64 * 1024 * 1024,
      vga_memory_size: 2 * 1024 * 1024,
      bios: { url: "./public/v86/bios/seabios.bin" },
      vga_bios: { url: "./public/v86/bios/vgabios.bin" },
      hda: { buffer: diskBytes.buffer.slice(diskBytes.byteOffset, diskBytes.byteOffset + diskBytes.byteLength) },
      bzimage: { buffer: kernelBytes.buffer.slice(kernelBytes.byteOffset, kernelBytes.byteOffset + kernelBytes.byteLength) },
      cmdline: "console=ttyS0 root=/dev/sda rw init=/init",
      boot_order: 786,
      autostart: true,
      disable_keyboard: false,
    });
    window.__emulator = emulator;
    emulator.add_listener("serial0-output-byte", writeSerialByte);
    attachGpuDevice(emulator);
    scheduleAutosave();
    bootState.textContent = persisted && persisted.length ? "restored" : "running";
    if (persisted && persisted.length) terminal.textContent += "\n[restored disk image]\n";
    updateSnapshotSize(diskBytes.byteLength);
    bootButton.disabled = false;
  } catch (error) {
    bootState.textContent = "boot failed";
    terminal.textContent += `\n[v86 boot failed: ${error.message}]\n`;
    bootButton.disabled = false;
  }
}

async function saveButtonHandler() {
  if (!emulator) {
    terminal.textContent += "\n[no running guest to save]\n";
    return;
  }
  const start = performance.now();
  try {
    const size = await saveDiskImage();
    const elapsed = Math.round(performance.now() - start);
    terminal.textContent += `\n[save ok: ${formatBytes(size)} in ${elapsed} ms]\n`;
    bootState.textContent = "saved";
  } catch (error) {
    terminal.textContent += `\n[save failed: ${error.message}]\n`;
  }
}

window.addEventListener("pagehide", async () => {
  if (!emulator) return;
  try {
    await saveDiskImage();
  } catch (error) {
    console.error("pagehide save failed", error);
  }
});

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "hidden" && emulator) {
    try {
      await saveDiskImage();
    } catch (error) {
      console.error("visibility save failed", error);
    }
  }
});

terminal.addEventListener("keydown", sendKey);
bootButton.addEventListener("click", () => bootLinux({ forceCold: true }));
saveButton.addEventListener("click", saveButtonHandler);
gpuButton.addEventListener("click", () => runGpuDemo());
resetButton.addEventListener("click", async () => {
  await resetDiskImage();
  terminal.textContent = "";
  bootState.textContent = "reset";
  await bootLinux({ forceCold: true });
});

await openStorage();
updateSnapshotSize(0);
await bootLinux();
