const SHADER = `@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> b: array<f32>;
@group(0) @binding(2) var<storage, read_write> result: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < arrayLength(&result)) { result[id.x] = a[id.x] + b[id.x]; }
}`;

export async function runVectorAdd(count = 1024) {
  if (!navigator.gpu) return { supported: false, message: "WebGPU unavailable; CPU fallback is active." };
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return { supported: false, message: "No WebGPU adapter; CPU fallback is active." };
  const device = await adapter.requestDevice();
  const valuesA = Float32Array.from({ length: count }, (_, index) => index);
  const valuesB = Float32Array.from({ length: count }, (_, index) => count - index);
  const output = new Float32Array(count);
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const readbackUsage = GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ;
  const makeBuffer = (data, extra = 0) => { const buffer = device.createBuffer({ size: data.byteLength, usage: usage | extra }); device.queue.writeBuffer(buffer, 0, data); return buffer; };
  const a = makeBuffer(valuesA); const b = makeBuffer(valuesB); const result = device.createBuffer({ size: output.byteLength, usage: usage | GPUBufferUsage.COPY_SRC }); const readback = device.createBuffer({ size: output.byteLength, usage: readbackUsage });
  const pipeline = device.createComputePipeline({ layout: "auto", compute: { module: device.createShaderModule({ code: SHADER }), entryPoint: "main" } });
  const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: a } }, { binding: 1, resource: { buffer: b } }, { binding: 2, resource: { buffer: result } }] });
  const encoder = device.createCommandEncoder(); const pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(count / 64)); pass.end(); encoder.copyBufferToBuffer(result, 0, readback, 0, output.byteLength); device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ); output.set(new Float32Array(readback.getMappedRange().slice(0))); readback.unmap(); [a, b, result, readback].forEach(buffer => buffer.destroy());
  const correct = output.every((value, index) => value === count);
  return { supported: true, correct, message: `${count} values, result ${correct ? "verified" : "incorrect"}` };
}
