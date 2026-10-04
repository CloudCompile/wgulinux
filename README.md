# wgulinux

Tiny browser-based Linux with a planned paravirtual WebGPU compute device.

## Current status

STEP 1 is implemented: the repository vendors v86's browser runtime and BIOS files plus the v86 project's `linux4.iso`. The page boots that real x86 Linux image and routes its serial bytes and keyboard input through v86. The first proof is typing `uname -a` and `ls /` into the guest terminal.

Persistence and GPU work are intentionally not wired into this boot step yet. There is no simulated shell or scripted command output.

## Run locally

Serve the repository as static files from its root, for example:

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080/`, click **Boot Linux**, click the terminal, and type `uname -a` followed by Enter. Then type `ls /`. GitHub Pages can serve the same files because asset paths are relative and there is no server API.

## Build the guest image

Use a pinned Buildroot checkout and this configuration:

```sh
make defconfig BR2_DEFCONFIG=$PWD/buildroot/configs/wgulinux_defconfig
make
```

Copy the resulting kernel and compressed initramfs to `public/images/` as `kernel` and `rootfs.cpio.gz`. A future build script will make this copy and verify the size budget. The target is a stripped x86_64 kernel plus BusyBox/musl image under 10 MB compressed.

The vendored v86 files are under `public/v86/`; `public/images/linux4.iso` is the temporary prebuilt guest image. STEP 4 will replace this image with the project's own Buildroot output.

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

- Persistence is not yet wired into v86's block-device callbacks.
- The host device module defines the ABI and descriptor shape but is not yet registered inside v86.
- The guest C library currently demonstrates the polling/MMIO contract; its physical mapping and `gpurun` CLI still need a small kernel-side access path.
- Completion currently uses polling. Interrupt delivery, shader IDs, buffer quotas, matrix multiply, and CPU/GPU timing comparison are future milestones.
- GitHub Pages cannot set COOP/COEP headers directly. `coi-serviceworker.js` provides the optional client-side header path for future SharedArrayBuffer acceleration; basic operation does not require it.