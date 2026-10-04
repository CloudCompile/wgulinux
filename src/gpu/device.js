import { runVectorAddFromGuestDescriptor } from "./webgpu-bridge.js";

export const REGISTERS = Object.freeze({
  MAGIC: 0x00,
  VERSION: 0x04,
  STATUS: 0x08,
  DOORBELL: 0x0c,
  DESC_GPA_LO: 0x10,
  DESC_GPA_HI: 0x14,
  IRQ_ACK: 0x18,
  ERROR: 0x1c,
});

export const DEVICE_MAGIC = 0x55504757;
export const DESCRIPTOR_MAGIC = 0x444a4757;
export const DESCRIPTOR_SIZE = 128;
export const GPU_DEVICE_BASE = 0xf0000000;
export const GPU_DEVICE_SIZE = 0x1000;

export const STATUS_READY = 1 << 0;
export const STATUS_BUSY = 1 << 1;
export const STATUS_COMPLETE = 1 << 2;
export const STATUS_ERROR = 1 << 3;

export function makeVectorAddDescriptor({ inputA, inputB, output, count, shaderText = "" }) {
  const descriptor = new ArrayBuffer(DESCRIPTOR_SIZE);
  const view = new DataView(descriptor);

  view.setUint32(0x00, DESCRIPTOR_MAGIC, true);
  view.setUint16(0x04, 1, true);
  view.setUint16(0x06, 0, true);
  view.setUint32(0x08, 1, true);
  view.setUint32(0x0c, shaderText.length, true);
  view.setBigUint64(0x10, BigInt(shaderText.length ? 0n : 0n), true);
  view.setBigUint64(0x18, BigInt(inputA.byteOffset || 0), true);
  view.setBigUint64(0x20, BigInt(inputA.byteLength), true);
  view.setBigUint64(0x28, BigInt(inputB.byteOffset || 0), true);
  view.setBigUint64(0x30, BigInt(inputB.byteLength), true);
  view.setBigUint64(0x38, BigInt(output.byteOffset || 0), true);
  view.setBigUint64(0x40, BigInt(output.byteLength), true);
  view.setUint32(0x48, count, true);
  view.setUint32(0x4c, 1, true);
  view.setUint32(0x50, 1, true);

  return descriptor;
}

export class WgulinuxGPUDevice {
  constructor({ baseAddress = GPU_DEVICE_BASE, size = GPU_DEVICE_SIZE } = {}) {
    this.baseAddress = baseAddress >>> 0;
    this.size = size >>> 0;
    this.registerBank = new Uint8Array(this.size);
    this.reg32 = new Uint32Array(this.registerBank.buffer, this.registerBank.byteOffset, this.registerBank.byteLength / 4);
    this.emulator = null;
    this.attached = false;
    this.error = 0;
    this.resetRegisters();
  }

  resetRegisters() {
    this.registerBank.fill(0);
    this.reg32[REGISTERS.MAGIC >> 2] = DEVICE_MAGIC;
    this.reg32[REGISTERS.VERSION >> 2] = 1;
    this.reg32[REGISTERS.STATUS >> 2] = STATUS_READY;
    this.reg32[REGISTERS.ERROR >> 2] = 0;
  }

  attach(emulator) {
    if (!emulator || !emulator.v86 || !emulator.v86.cpu) {
      throw new Error("a live v86 emulator is required");
    }

    this.emulator = emulator;
    const { cpu } = emulator.v86;
    cpu.io.mmap_register(
      this.baseAddress,
      this.size,
      (addr) => this.read8(addr),
      (addr, value) => this.write8(addr, value),
      (addr) => this.read32(addr),
      (addr, value) => this.write32(addr, value),
    );

    this.attached = true;
    return this;
  }

  detach() {
    this.attached = false;
    this.resetRegisters();
  }

  read8(addr) {
    const offset = (addr - this.baseAddress) >>> 0;
    if (offset >= this.size) return 0;
    return this.registerBank[offset];
  }

  write8(addr, value) {
    const offset = (addr - this.baseAddress) >>> 0;
    if (offset >= this.size) return;
    this.registerBank[offset] = value & 0xff;

    if ((offset & 3) === 0) {
      const register = offset >>> 0;
      if (register === REGISTERS.DOORBELL) {
        this.triggerDoorbell();
      }
      if (register === REGISTERS.IRQ_ACK) {
        this.reg32[REGISTERS.STATUS >> 2] = STATUS_READY;
      }
    }
  }

  read32(addr) {
    const offset = (addr - this.baseAddress) >>> 0;
    if (offset >= this.size) return 0;
    return this.reg32[offset >> 2] >>> 0;
  }

  write32(addr, value) {
    const offset = (addr - this.baseAddress) >>> 0;
    if (offset >= this.size) return;

    const reg = offset >>> 0;
    this.reg32[reg >> 2] = value >>> 0;

    if (reg === REGISTERS.DOORBELL) {
      this.triggerDoorbell();
    }
    if (reg === REGISTERS.IRQ_ACK) {
      this.reg32[REGISTERS.STATUS >> 2] = STATUS_READY;
    }
  }

  async triggerDoorbell() {
    if (!this.emulator) return;

    this.reg32[REGISTERS.STATUS >> 2] = STATUS_BUSY;

    try {
      const memory = this.emulator.v86.cpu.mem8;
      const descAddress = (BigInt(this.reg32[REGISTERS.DESC_GPA_HI >> 2] >>> 0) << 32n) | BigInt(this.reg32[REGISTERS.DESC_GPA_LO >> 2] >>> 0);
      const result = await runVectorAddFromGuestDescriptor(memory, Number(descAddress));

      if (!result || !result.supported) {
        this.reg32[REGISTERS.ERROR >> 2] = 2;
        this.reg32[REGISTERS.STATUS >> 2] = STATUS_READY | STATUS_ERROR;
        return { supported: false, message: result?.message || "WebGPU job unavailable" };
      }

      this.reg32[REGISTERS.STATUS >> 2] = STATUS_READY | STATUS_COMPLETE;
      this.reg32[REGISTERS.ERROR >> 2] = 0;
      return { supported: true, message: "ok" };
    } catch (error) {
      this.error = 1;
      this.reg32[REGISTERS.ERROR >> 2] = this.error;
      this.reg32[REGISTERS.STATUS >> 2] = STATUS_READY | STATUS_ERROR;
      return { supported: false, message: error.message || "WebGPU job failed" };
    }
  }

  async submitDescriptor(descriptorAddress) {
    const gpa = BigInt(descriptorAddress);
    const lower = Number(gpa & 0xffffffffn);
    const upper = Number((gpa >> 32n) & 0xffffffffn);
    const startedAt = performance.now();

    this.reg32[REGISTERS.DESC_GPA_LO >> 2] = lower >>> 0;
    this.reg32[REGISTERS.DESC_GPA_HI >> 2] = upper >>> 0;

    const outcome = await this.triggerDoorbell();

    const status = this.reg32[REGISTERS.STATUS >> 2] >>> 0;
    if (status & STATUS_ERROR) {
      return { status, supported: false, message: outcome?.message || `GPU job failed: error=${this.reg32[REGISTERS.ERROR >> 2]}` };
    }

    return { status, supported: true, elapsedMs: performance.now() - startedAt };
  }
}

