# wgulinux

Tiny browser-based Linux with a planned paravirtual WebGPU compute device.

## Current status

The repository currently contains the static browser shell, the OPFS/IndexedDB overlay, the host WebGPU vector-add probe, the device ABI, and the first guest C ABI. The v86 browser build and Buildroot kernel/rootfs are not bundled yet, so **the guest does not boot in this checkout**. The UI says so rather than simulating a boot.

The compute probe is real: on a WebGPU-capable browser it compiles and dispatches a WGSL vector-add shader, reads the result back, and verifies it. Browsers without WebGPU get a clearly labeled CPU-only state.

## Run locally

Serve the repository as static files from its root, for example:

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080/`. GitHub Pages can serve the same files because asset paths are relative and there is no server API. WebGPU and OPFS require a secure context in deployed environments; GitHub Pages provides HTTPS.

## Build the guest image

Use a pinned Buildroot checkout and this configuration:

```sh
make defconfig BR2_DEFCONFIG=$PWD/buildroot/configs/wgulinux_defconfig
make
```

Copy the resulting kernel and compressed initramfs to `public/images/` as `kernel` and `rootfs.cpio.gz`. A future build script will make this copy and verify the size budget. The target is a stripped x86_64 kernel plus BusyBox/musl image under 10 MB compressed.

The v86 browser build must be placed under `public/v86/` with its normal browser assets. It is deliberately not downloaded at runtime: deployments remain static and reproducible.

## Architecture

```text
Browser UI
	|-- v86 serial adapter --> x86 guest (Buildroot Linux + BusyBox)
	|                             |-- read-only base image
	|                             `-- writable guest overlay --> OPFS / IndexedDB
	|
	`-- custom WGPU MMIO device --> descriptor validation --> WebGPU compute
																			`--> result copied into guest RAM
```

The device register map and 128-byte job descriptor are specified in [PLAN.md](./PLAN.md). The ABI is intentionally custom and is not virtio-gpu or Venus.

## Dependencies

- **v86**: x86 emulation, to be pinned and vendored under `public/v86/`.
- **Buildroot**: reproducible Linux kernel, BusyBox, and musl image generation.
- Browser WebGPU: optional host compute backend; no JavaScript package is required.

## Known limitations

- v86 integration, the actual guest image, and serial boot are still milestone 1 work.
- The current overlay is a browser storage layer, not yet wired into v86's block-device callbacks.
- The host device module defines the ABI and descriptor shape but is not yet registered inside v86.
- The guest C library currently demonstrates the polling/MMIO contract; its physical mapping and `gpurun` CLI still need a small kernel-side access path.
- Completion currently uses polling. Interrupt delivery, shader IDs, buffer quotas, matrix multiply, and CPU/GPU timing comparison are future milestones.
- GitHub Pages cannot set COOP/COEP headers. The initial design avoids requiring SharedArrayBuffer; the optional `coi-serviceworker` optimization is not included yet.