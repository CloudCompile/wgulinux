export const REGISTERS = Object.freeze({ MAGIC: 0x00, VERSION: 0x04, STATUS: 0x08, DOORBELL: 0x0c, DESC_GPA_LO: 0x10, DESC_GPA_HI: 0x14, IRQ_ACK: 0x18, ERROR: 0x1c });
export const DEVICE_MAGIC = 0x55504757;
export const DESCRIPTOR_MAGIC = 0x444a4757;
export const DESCRIPTOR_SIZE = 128;

export function makeVectorAddDescriptor({ inputA, inputB, output, count }) {
  const descriptor = new ArrayBuffer(DESCRIPTOR_SIZE);
  const view = new DataView(descriptor);
  view.setUint32(0x00, DESCRIPTOR_MAGIC, true);
  view.setUint16(0x04, 1, true);
  view.setUint32(0x08, 1, true);
  view.setUint32(0x48, count, true);
  view.setUint32(0x4c, 1, true);
  view.setUint32(0x50, 1, true);
  view.setBigUint64(0x18, BigInt(inputA.byteOffset || 0), true);
  view.setBigUint64(0x20, BigInt(inputA.byteLength), true);
  view.setBigUint64(0x28, BigInt(inputB.byteOffset || 0), true);
  view.setBigUint64(0x30, BigInt(inputB.byteLength), true);
  view.setBigUint64(0x38, BigInt(output.byteOffset || 0), true);
  view.setBigUint64(0x40, BigInt(output.byteLength), true);
  return descriptor;
}
