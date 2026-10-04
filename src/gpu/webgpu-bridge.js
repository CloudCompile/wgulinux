const SHADER = `@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> b: array<f32>;
@group(0) @binding(2) var<storage, read_write> result: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < arrayLength(&result)) { result[id.x] = a[id.x] + b[id.x]; }
}`;

function getReadBuffer(memory, address, byteLength) {
  if (address < 0 || byteLength <= 0) {
    throw new Error("invalid guest memory range");
  }

  const maxLength = memory.byteLength;
  if (address + byteLength > maxLength) {
    throw new Error("guest memory range exceeds the v86 RAM buffer");
  }

  return new Uint8Array(memory.buffer, memory.byteOffset + address, byteLength);
}

export async function runVectorAdd(count = 1024, initialA = null, initialB = null) {
  if (!navigator.gpu) return { supported: false, message: "WebGPU unavailable in this browser; no adapter is available." };

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return { supported: false, message: "No WebGPU adapter is available in this browser." };

  const device = await adapter.requestDevice();
  const valuesA = initialA ? new Float32Array(initialA) : Float32Array.from({ length: count }, (_, index) => index);
  const valuesB = initialB ? new Float32Array(initialB) : Float32Array.from({ length: count }, (_, index) => count - index);
  const output = new Float32Array(count);

  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const readbackUsage = GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ;
  const makeBuffer = (data, extra = 0) => {
    const buffer = device.createBuffer({ size: data.byteLength, usage: usage | extra });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  };

  const a = makeBuffer(valuesA);
  const b = makeBuffer(valuesB);
  const result = device.createBuffer({ size: output.byteLength, usage: usage | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: output.byteLength, usage: readbackUsage });

  const pipeline = device.createComputePipeline({
    layout: "auto",
    compute: {
      module: device.createShaderModule({ code: SHADER }),
      entryPoint: "main",
    },
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: a } },
      { binding: 1, resource: { buffer: b } },
      { binding: 2, resource: { buffer: result } },
    ],
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(count / 64));
  pass.end();

  encoder.copyBufferToBuffer(result, 0, readback, 0, output.byteLength);
  device.queue.submit([encoder.finish()]);

  await readback.mapAsync(GPUMapMode.READ);
  output.set(new Float32Array(readback.getMappedRange().slice(0)));
  readback.unmap();

  [a, b, result, readback].forEach((buffer) => buffer.destroy());

  const correct = output.every((value, index) => value === valuesA[index] + valuesB[index]);
  return { supported: true, correct, values: output, message: `${count} values, result ${correct ? "verified" : "incorrect"}` };
}

export async function runVectorAddFromGuestDescriptor(memory, descriptorAddress) {
  if (!navigator.gpu) {
    return { supported: false, message: "WebGPU unavailable in this browser; no adapter is available." };
  }

  const memoryBytes = new Uint8Array(memory.buffer, memory.byteOffset, memory.byteLength);
  const descriptorBytes = getReadBuffer(memoryBytes, descriptorAddress, 128);
  const view = new DataView(descriptorBytes.buffer, descriptorBytes.byteOffset, descriptorBytes.byteLength);

  const magic = view.getUint32(0x00, true);
  if (magic !== 0x444a4757) {
    throw new Error("bad descriptor magic");
  }

  const shaderKind = view.getUint32(0x08, true);
  if (shaderKind !== 1) {
    throw new Error(`unsupported shader kind: ${shaderKind}`);
  }

  const shaderLength = view.getUint32(0x0c, true);
  const shaderAddress = Number(view.getBigUint64(0x10, true));
  const inputAAddress = Number(view.getBigUint64(0x18, true));
  const inputABytes = Number(view.getBigUint64(0x20, true));
  const inputBAddress = Number(view.getBigUint64(0x28, true));
  const inputBBytes = Number(view.getBigUint64(0x30, true));
  const outputAddress = Number(view.getBigUint64(0x38, true));
  const outputBytes = Number(view.getBigUint64(0x40, true));
  const dispatchCount = view.getUint32(0x48, true);

  if (shaderLength > 0) {
    const shaderText = new TextDecoder().decode(getReadBuffer(memoryBytes, shaderAddress, shaderLength));
    if (!shaderText.includes("result[id.x] = a[id.x] + b[id.x]")) {
      throw new Error("unsupported WGSL shader");
    }
  }

  if (inputABytes !== inputBBytes || inputABytes !== outputBytes) {
    throw new Error("descriptor requires equal buffer lengths");
  }

  const count = Math.max(1, Math.min(dispatchCount || inputABytes / 4, inputABytes / 4));
  const a = new Float32Array(getReadBuffer(memoryBytes, inputAAddress, inputABytes).buffer, getReadBuffer(memoryBytes, inputAAddress, inputABytes).byteOffset, count);
  const b = new Float32Array(getReadBuffer(memoryBytes, inputBAddress, inputBBytes).buffer, getReadBuffer(memoryBytes, inputBAddress, inputBBytes).byteOffset, count);

  const result = await runVectorAdd(count, a, b);
  if (!result.supported || !result.correct) {
    return { supported: false, message: result.message || "WebGPU vector add failed" };
  }

  const outputBytesView = getReadBuffer(memoryBytes, outputAddress, outputBytes);
  const outputArray = new Float32Array(outputBytesView.buffer, outputBytesView.byteOffset, count);
  outputArray.set(result.values);

  return { supported: true, count, result: result.values, correct: true };
}
