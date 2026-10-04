#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(mktemp -d /tmp/wgulinux-rootfs.XXXXXX)}"
IMG_PATH="${2:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../public/images" && pwd)/rootfs.img}"

mkdir -p "$(dirname "$IMG_PATH")"
rm -rf "$ROOT_DIR"
mkdir -p "$ROOT_DIR"/{bin,dev,etc,etc/init.d,home,proc,root,sbin,sys,tmp,usr,var}

BUSYBOX_BIN="$(command -v busybox || true)"
if [[ -z "$BUSYBOX_BIN" ]]; then
  echo "busybox is required but was not found in PATH" >&2
  exit 1
fi

cp "$BUSYBOX_BIN" "$ROOT_DIR/bin/busybox"
chmod 755 "$ROOT_DIR/bin/busybox"
while IFS= read -r app; do
  [ -n "$app" ] || continue
  ln -sf /bin/busybox "$ROOT_DIR/bin/$app"
done < <("$BUSYBOX_BIN" --list)

cat > "$ROOT_DIR/init" <<'EOF'
#!/bin/sh
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev
mdev -s
mkdir -p /dev/pts
mount -t devpts devpts /dev/pts
mknod /dev/console c 5 1
mknod /dev/ttyS0 c 4 64
mknod /dev/null c 1 3
mknod /dev/zero c 1 5
echo /sbin/mdev > /proc/sys/kernel/hotplug
exec /bin/sh -i
EOF
chmod 755 "$ROOT_DIR/init"

cat > "$ROOT_DIR/etc/profile" <<'EOF'
export PS1='(guest) # '
EOF

cat > "$ROOT_DIR/etc/inittab" <<'EOF'
::sysinit:/etc/init.d/rcS
::respawn:/bin/sh
EOF

cat > "$ROOT_DIR/etc/init.d/rcS" <<'EOF'
#!/bin/sh
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev
mdev -s
mkdir -p /dev/pts
mount -t devpts devpts /dev/pts
mknod /dev/console c 5 1
mknod /dev/ttyS0 c 4 64
mknod /dev/null c 1 3
mknod /dev/zero c 1 5
echo /sbin/mdev > /proc/sys/kernel/hotplug
EOF
chmod 755 "$ROOT_DIR/etc/init.d/rcS"

# Make the device files visible to the guest before the shell is launched.
# BusyBox's dynamic device creation will populate the rest of /dev.
for dev in console ttyS0 null zero; do
  case "$dev" in
    console) mknod "$ROOT_DIR/dev/console" c 5 1 ;;
    ttyS0) mknod "$ROOT_DIR/dev/ttyS0" c 4 64 ;;
    null) mknod "$ROOT_DIR/dev/null" c 1 3 ;;
    zero) mknod "$ROOT_DIR/dev/zero" c 1 5 ;;
  esac
done

if ! command -v mke2fs >/dev/null 2>&1; then
  echo "mke2fs is required but was not found" >&2
  exit 1
fi

mke2fs -F -m 0 -d "$ROOT_DIR" "$IMG_PATH" 32768

# A quick integrity check makes the next browser validation much more reliable.
file "$IMG_PATH"
dumpe2fs -h "$IMG_PATH" 2>/dev/null | head -n 12 || true

echo "Built rootfs image at $IMG_PATH"
