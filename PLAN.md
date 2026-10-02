# wgulinux plan

## Goal

A static browser application boots a small Buildroot Linux image in v86, persists guest writes in an OPFS copy-on-write layer, and exposes a deliberately small compute device whose jobs execute through WebGPU when available.

## File layout

```text
index.html                 Static entry point
src/
  main.js                  Browser bootstrap and feature detection
  terminal.js              Serial console adapter
  storage/overlay.js        OPFS backend with IndexedDB fallback
  gpu/device.js             Host-side device ABI and guest-memory bridge
  gpu/webgpu-bridge.js      WebGPU compute execution
  ui.css                    Application styling
public/
  v86/                      Pinned v86 browser build (generated/vendor input)
  images/                   Buildroot kernel and rootfs artifacts
buildroot/
  configs/wgulinux_defconfig Minimal target configuration
  README.md                 Reproducible image build notes
guest/
  include/wgulinux_gpu.h    Guest ABI definitions
  libwgulinux_gpu.c         Guest userspace submission library
auto/
  ...                       Optional generated image metadata
tests/
  ...                       Host unit tests and ABI fixtures
```

Generated/vendor binaries are intentionally not checked in until the first reproducible image build is available. The app must display a clear setup state when those artifacts are absent.

## Device ABI

The first implementation uses a 4 KiB MMIO region. The device is intentionally not virtio-gpu and only supports compute jobs.

| Offset | Name | Access | Meaning |
|---:|---|---|---|
| `0x00` | `MAGIC` | R | ASCII `WGPU` as `0x55504757` |
| `0x04` | `VERSION` | R | ABI version, initially `1` |
| `0x08` | `STATUS` | R/W1C | bit 0 ready, bit 1 busy, bit 2 complete, bit 3 error |
| `0x0c` | `DOORBELL` | W | nonzero value submits the descriptor at `DESC_GPA` |
| `0x10` | `DESC_GPA_LO` | R/W | guest physical address, low 32 bits |
| `0x14` | `DESC_GPA_HI` | R/W | guest physical address, high 32 bits |
| `0x18` | `IRQ_ACK` | W | acknowledge completion/error notification |
| `0x1c` | `ERROR` | R | stable numeric error code |

The initial host implementation may expose completion through polling `STATUS`; the interrupt wiring is a follow-up once the descriptor path is proven.

## Job descriptor ABI

All fields are little-endian and the descriptor is exactly 128 bytes, aligned to 64 bytes.

| Offset | Size | Field |
|---:|---:|---|
| `0x00` | 4 | magic `WGJD` (`0x444a4757`) |
| `0x04` | 2 | descriptor version (`1`) |
| `0x06` | 2 | flags, reserved initially `0` |
| `0x08` | 4 | shader kind: `1` means inline WGSL UTF-8 |
| `0x0c` | 4 | shader byte length |
| `0x10` | 8 | shader guest address |
| `0x18` | 8 | input A guest address |
| `0x20` | 8 | input A byte length |
| `0x28` | 8 | input B guest address |
| `0x30` | 8 | input B byte length |
| `0x38` | 8 | output guest address |
| `0x40` | 8 | output byte length |
| `0x48` | 4 | dispatch X |
| `0x4c` | 4 | dispatch Y |
| `0x50` | 4 | dispatch Z |
| `0x54` | 4 | reserved |
| `0x58` | 40 | reserved for future buffers/limits |

The host validates every address and length against guest RAM before reading or writing. It never treats guest-provided shader text as trusted JavaScript.

## Milestones

1. **Boot:** static page, pinned v86 build, Buildroot kernel/rootfs, and serial terminal. Until binaries are present, show an explicit artifact checklist.
2. **Persistence:** mount an OPFS-backed copy-on-write overlay with IndexedDB fallback, reset control, and reload verification.
3. **Device model:** add the MMIO region, descriptor reads, doorbell, status/error state, and guest-memory bounds checks.
4. **WebGPU bridge:** feature-detect WebGPU, validate descriptors, dispatch WGSL, copy results back, and expose CPU-only fallback.
5. **Guest side:** add the C ABI header/library and a small `gpurun` command using the simplest available device access path.
6. **Demo:** vector add first, then matrix multiply only after correctness and timing checks pass.

## GitHub Pages

The site is static and uses relative asset paths. A Pages deployment workflow will publish the built site. The optional `coi-serviceworker` path is reserved for a later SharedArrayBuffer optimization; basic v86 operation does not depend on it.
