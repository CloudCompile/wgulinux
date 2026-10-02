#include "wgulinux_gpu.h"

#define REG_DESC_GPA_LO 0x10
#define REG_DESC_GPA_HI 0x14
#define REG_DOORBELL 0x0c
#define REG_STATUS 0x08
#define STATUS_COMPLETE (1u << 2)
#define STATUS_ERROR (1u << 3)

int wgulinux_gpu_submit(volatile uint8_t *mmio, struct wgulinux_gpu_job *job)
{
    uintptr_t address = (uintptr_t)job;
    *(volatile uint32_t *)(mmio + REG_DESC_GPA_LO) = (uint32_t)address;
    *(volatile uint32_t *)(mmio + REG_DESC_GPA_HI) = (uint32_t)(address >> 32);
    *(volatile uint32_t *)(mmio + REG_DOORBELL) = 1;
    while ((*(volatile uint32_t *)(mmio + REG_STATUS) & (STATUS_COMPLETE | STATUS_ERROR)) == 0) {}
    return (*(volatile uint32_t *)(mmio + REG_STATUS) & STATUS_ERROR) ? -1 : 0;
}
