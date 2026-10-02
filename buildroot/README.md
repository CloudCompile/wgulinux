# Buildroot image

Use a pinned Buildroot release and apply `configs/wgulinux_defconfig`. The minimal target is x86_64 with a musl toolchain, BusyBox, a serial getty, and a compressed initramfs. Keep the generated image outside Git until the build is reproducible and its size is measured.