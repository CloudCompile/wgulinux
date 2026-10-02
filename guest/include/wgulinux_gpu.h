#ifndef WGULINUX_GPU_H
#define WGULINUX_GPU_H

#include <stdint.h>

#define WGULINUX_GPU_MAGIC 0x55504757u
#define WGULINUX_JOB_MAGIC 0x444a4757u
#define WGULINUX_GPU_MMIO_SIZE 0x1000u

struct wgulinux_gpu_job {
    uint32_t magic;
    uint16_t version;
    uint16_t flags;
    uint32_t shader_kind;
    uint32_t shader_length;
    uint64_t shader_gpa;
    uint64_t input_a_gpa;
    uint64_t input_a_length;
    uint64_t input_b_gpa;
    uint64_t input_b_length;
    uint64_t output_gpa;
    uint64_t output_length;
    uint32_t dispatch_x;
    uint32_t dispatch_y;
    uint32_t dispatch_z;
    uint32_t reserved;
    uint8_t reserved_tail[40];
} __attribute__((packed, aligned(64)));

int wgulinux_gpu_submit(volatile uint8_t *mmio, struct wgulinux_gpu_job *job);

#endif
