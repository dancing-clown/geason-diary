# 性能调优案例

## xxHash调优

背景:之前公司内举办的算法比赛，涉及在特定arm 64bbit，对xxhash的运算效率进行优化，要求不能使用多线程计算。源地址可见[xxHash](https://github.com/Cyan4973/xxHash)。

用到的工具涉及[compile explorer](https://www.godbolt.org/)。

如下为优化后的代码。大致优化点总结如下：

- 使用arm的循环左移和循环右移，将多指令优化为单一汇编指令
- 对SGL_HashValue进行for进行循环展开，其中根据SGL参数，可以将循环展开（可选组合是64次循环=2x32/4x16/8x8/16x4）,方便编译器优化
- 使用C的指令预期功能，将下一次需要处理的数据提前，通过查阅对应arm架构的L1，L2，L3cache大小，决定需要预取的大小，来提升缓存命中的概率

```C++
// #include "securec.h" /* 提供 memcpy_s 等安全函数，Windows 平台上不需要此头文件 */
#include "sgl.h" /* 包含了 SGL 结构体的定义以及 SGL_HashValue 的声明。 */
#include <stdbool.h>
#include <arm_neon.h>

#define XXH64_LANE_COUNT ((size_t)4)
#define XXH64_SEED       ((uint64_t)0)
#define XXH64_STEP_SIZE  ((size_t)32)

#define XXH64_PRIME_1 ((uint64_t)0x9E3779B185EBCA87ULL)
#define XXH64_PRIME_2 ((uint64_t)0xC2B2AE3D27D4EB4FULL)
#define XXH64_PRIME_3 ((uint64_t)0x165667B19E3779F9ULL)
#define XXH64_PRIME_4 ((uint64_t)0x85EBCA77C2B2AE63ULL)
#define XXH64_PRIME_5 ((uint64_t)0x27D4EB2F165667C5ULL)

/*
 * 用于保存 XXH64 算法的状态。
 */
typedef struct {
    uint64_t acc[XXH64_LANE_COUNT];             /* 4 个累加器。 */
    uint8_t buffer[XXH64_STEP_SIZE];            /* 保存不满 32 字节的零散数据。 */
    size_t bufferSize;                          /* 当前零散数据的大小。 */
    uint64_t totalSize;                         /* 状态已经接受的数据的总大小。 */
    bool isLarge;                               /* 状态是否已经接受了大于 32 字节的数据量。 */
} XXH64State;

static uint64_t inline XXH64_Read64(const uint8_t *data)
{
    return *(const uint64_t *)data;
}

/*
 * 初始化 XXH64 算法的状态。
 */
static void XXH64_StateInit(XXH64State *state)
{
    static const uint64_t INIT_ACC[] = {
        XXH64_SEED + XXH64_PRIME_1 + XXH64_PRIME_2,
        XXH64_SEED + XXH64_PRIME_2,
        XXH64_SEED,
        XXH64_SEED - XXH64_PRIME_1,
    };

    state->bufferSize = 0;
    state->totalSize = 0;
    state->isLarge = false;
    for (size_t i = 0; i < XXH64_LANE_COUNT; i++) {
        state->acc[i] = INIT_ACC[i];
    }
}

/*
 * 返回 x 循环左移 n 位的结果。
 */
static uint64_t XXH64_RotateLeft(uint64_t value, uint8_t shift)
{
    __asm__("ROR %[value], %[value], %[shift]"
            : [value] "+r"(value)
            : [shift] "r"((unsigned int)(33)));
    return value;
}

static uint64_t XXH64_Round(uint64_t accn, uint64_t lane)
{
    // 步骤1
    accn += XXH64_PRIME_2 * lane;

    // 步骤2: 循环左移31位
    // uint64x2_t v = vld1q_u64(&accn);
    // uint64x2_t result = vorrq_u64(vshlq_n_u64(v, 31), vshrq_n_u64(v, 33));
    // vst1q_lane_u64(&accn, result, 0);

    // accn = (accn << 31) | (accn >> 33);
    __asm__("ROR %[accn], %[accn], %[shift]" : [accn] "+r"(accn) : [shift] "r"((unsigned int)(33)));

    // 步骤3
    accn *= XXH64_PRIME_1;
    return accn;
}

static uint64_t XXH64_MergeAccumulator(uint64_t finalAcc, uint64_t accn)
{
    uint64_t tmp = finalAcc;
    tmp = tmp ^ XXH64_Round(0, accn);
    tmp = tmp * XXH64_PRIME_1;
    tmp = tmp + XXH64_PRIME_4;
    return tmp;
}

/*
 * 如果总数据量小于 32 字节，则返回一个特殊值作为 finalAcc；否则将 4 个累加器整合为 finalAcc。
 */
static uint64_t XXH64_FinalAcc(XXH64State *state)
{
    static const int ROTATE_LEFT[] = { 1, 7, 12, 18 };

    uint64_t finalAcc = 0;

    for (size_t i = 0; i < XXH64_LANE_COUNT; i++) {
        finalAcc += XXH64_RotateLeft(state->acc[i], ROTATE_LEFT[i]);
    }
    for (size_t i = 0; i < XXH64_LANE_COUNT; i++) {
        finalAcc = XXH64_MergeAccumulator(finalAcc, state->acc[i]);
    }

    finalAcc += (uint64_t)state->totalSize;
    return finalAcc;
}

/* 对 finalAcc 进行雪崩操作、使得输入发生微小变动时，输出的每一位都有机会被翻转。 */
static uint64_t XXH64_Mix(uint64_t finalAcc)
{
    static const int MIX_COUNT = 3;
    static const int MIX_SHIFT[] = { 33, 29, 32 };
    static const uint64_t MIX_MUL[] = { XXH64_PRIME_2, XXH64_PRIME_3, 1 };
    uint64_t tmp = finalAcc;
    for (size_t i = 0; i < MIX_COUNT; i++) {
        tmp ^= tmp >> MIX_SHIFT[i];
        tmp *= MIX_MUL[i];
    }
    return tmp;
}

/*
 * 将当前状态整合为哈希值返回。
 */
static uint64_t XXH64_Digest(XXH64State *state)
{
    uint64_t finalAcc = XXH64_FinalAcc(state);
    finalAcc = XXH64_Mix(finalAcc);
    return finalAcc;
}

uint64_t SGL_HashValue(SGL *sgl)
{
    XXH64State state = {};
    XXH64_StateInit(&state);
    register uint64_t num1 = state.acc[0];
    register uint64_t num2 = state.acc[1];
    register uint64_t num3 = state.acc[2];
    register uint64_t num4 = state.acc[3];

    const uint64_t shift = 31;
    const uint64_t shiftRight = 31;

    state.totalSize = sgl->entryCount * 8192;
    for (size_t i = 0; i < sgl->entryCount; i++) {
        const uint8_t *entrybuf = sgl->entries[i].buf;
        size_t entrylen = sgl->entries[i].len;
        // __builtin_prefetch(entrybuf + 520);
        for (size_t offset = 0; offset < entrylen; offset += 520) {
            // process current block
            // XXH64_Update_new(&state, entrybuf + offset, BYTE_PER_SECTOR_NOPI);
            const uint64_t *data64 = (uint64_t *)(entrybuf + offset);
            for (size_t i = 0; i < 8; ++i) {

                num1 += (uint64_t)(data64[0] * XXH64_PRIME_2);
                __asm__("ROR %[num1], %[num1], %[shift]" : [num1] "+r"(num1) : [shift] "r"(shiftRight)); 
                num1 *= XXH64_PRIME_1;

                num2 += (uint64_t)(data64[1] * XXH64_PRIME_2);
                __asm__("ROR %[num2], %[num2], %[shift]" : [num2] "+r"(num2) : [shift] "r"(shiftRight)); 
                num2 *= XXH64_PRIME_1;

                num3 += (uint64_t)(data64[2] * XXH64_PRIME_2);
                __asm__("ROR %[num3], %[num3], %[shift]" : [num3] "+r"(num3) : [shift] "r"(shiftRight)); 
                num3 *= XXH64_PRIME_1;

                num4 += (uint64_t)(data64[3] * XXH64_PRIME_2);
                __asm__("ROR %[num4], %[num4], %[shift]" : [num4] "+r"(num4) : [shift] "r"(shiftRight)); 
                num4 *= XXH64_PRIME_1;

                num1 += (uint64_t)(data64[4] * XXH64_PRIME_2);
                __asm__("ROR %[num1], %[num1], %[shift]" : [num1] "+r"(num1) : [shift] "r"(shiftRight)); 
                num1 *= XXH64_PRIME_1;

                num2 += (uint64_t)(data64[5] * XXH64_PRIME_2);
                __asm__("ROR %[num2], %[num2], %[shift]" : [num2] "+r"(num2) : [shift] "r"(shiftRight)); 
                num2 *= XXH64_PRIME_1;

                num3 += (uint64_t)(data64[6] * XXH64_PRIME_2);
                __asm__("ROR %[num3], %[num3], %[shift]" : [num3] "+r"(num3) : [shift] "r"(shiftRight)); 
                num3 *= XXH64_PRIME_1;

                num4 += (uint64_t)(data64[7] * XXH64_PRIME_2);
                __asm__("ROR %[num4], %[num4], %[shift]" : [num4] "+r"(num4) : [shift] "r"(shiftRight)); 
                num4 *= XXH64_PRIME_1;

    
                data64 += 8;
            }
        }
    }
    state.acc[0] = num1;
    state.acc[1] = num2;
    state.acc[2] = num3;
    state.acc[3] = num4;

    return XXH64_Digest(&state);
}

#include <iostream>
#include "xxhash.h"
using namespace std;
uint64_t multiply_uint64(uint64_t a, uint64_t b)
{
    uint32_t a_low = static_cast<uint32_t>(a);
    uint32_t a_high = static_cast<uint32_t>(a >> 32);

    uint32_t b_low = static_cast<uint32_t>(b);
    uint32_t b_high = static_cast<uint32_t>(b >> 32);


    // Calculate high and low parts
    uint64_t low_product = static_cast<uint64_t>(a_low) * static_cast<uint64_t>(b_low);
    uint64_t mid_product = static_cast<uint64_t>(a_low) * b_high + static_cast<uint64_t>(a_high) * b_low;

    // // Combine the high and low parts
    uint64_t result = low_product + (mid_product << 32);

    return result;
}


uint64_t multiply(uint32_t low1, uint32_t high1, uint32_t low2, uint32_t high2)
{
    uint32x2_t v1 = vdup_n_u32(low1);
    uint32x2_t v4 = vdup_n_u32(low2);

    uint32x2_t v2 = { low2, high2 };
    uint32x2_t v3 = { high1, low1 };

    uint64x2_t low_product = vmull_u32(v1, v4);
    uint64x2_t mid_product = vmull_u32(v2, v3);

    uint64x1_t low = vget_low_u64(low_product);
    cout << "multiply low: " << vget_lane_u64(low, 0) << endl;
    uint64x1_t high = vget_high_u64(mid_product);
    uint64x1_t sum = vadd_u64(low, high);

    cout << "multiply: "<< vget_lane_u64(sum, 0) << endl;

    sum = vadd_u64(vshl_n_u64(sum, 32), vget_low_u64(low_product));

    return vget_lane_u64(sum, 0);
}


uint64_t SGL_HashValue_Raw(SGL *sgl)
{
    XXH64_state_t *state = XXH64_createState();
    XXH64_reset(state, 0);
    for (size_t i = 0; i < sgl->entryCount; i++) {
        const uint8_t *entrybuf = sgl->entries[i].buf;
        size_t entrylen = sgl->entries[i].len;
        for (size_t offset = 0; offset < entrylen; offset += BYTE_PER_SECTOR_PI) {
            // prefetch the next block
            __builtin_prefetch(entrybuf + offset + BYTE_PER_SECTOR_PI);

            // process current block
            XXH64_update(state, entrybuf + offset, BYTE_PER_SECTOR_NOPI);
        }
    }

    return XXH64_digest(state);
}

#include <chrono>
int main()
{
    SGL sgl;

    constexpr uint32_t len = 8320;
    sgl.entries[0].buf = new uint8_t[len]();
    sgl.entries[0].len = len;

    sgl.entryCount = 1;

    uint64_t expected = 0x2b5073505a48fb4;
    auto ret = SGL_HashValue_Raw(&sgl);
    if (expected != ret) {
        cout << "[raw implenment] incorrect!" << endl;
    }

    ret = SGL_HashValue(&sgl);
    if (expected != ret) {
        cout << "[my implenment] incorrect!" << endl;
    }

    cout << "[raw implenment]: ";
    auto start = std::chrono::high_resolution_clock::now();
    for (size_t i = 0; i < 1000; i++) {
        SGL_HashValue_Raw(&sgl);
    }

    auto end = std::chrono::high_resolution_clock::now();
    auto duration = std::chrono::duration_cast<std::chrono::microseconds>(end - start);
    std::cout << "time cost: " << duration.count() << " us" << std::endl;

    cout << "[my implenment]:";
    start = std::chrono::high_resolution_clock::now();
    for (size_t i = 0; i < 1000; i++) {
        SGL_HashValue(&sgl);
    }

    end = std::chrono::high_resolution_clock::now();
    duration = std::chrono::duration_cast<std::chrono::microseconds>(end - start);
    std::cout << "time cost: " << duration.count() << " us" << std::endl;

    uint64_t a = UINT64_MAX - 1;
    uint64_t b = UINT64_MAX - 1000;

}


```

## 相关知识点总结

1.循环左移的arm指令

关于指令，最开始是希望引用SIMD来进行并行计算加速的，但是实际测试效果不如预期。

2.for循环展开

关于循环展开为什么能优化效率，究其原因是因为CPU的指令流水线在发力。经典的5级流水线为：

- 指令获取（IF）
- 指令解码（ID）
- 执行（EX）
- 内存访问（MEM）
- 写回（WB）

而这5个阶段，每个阶段使用不同的硬件资源，为了提高效率，同一时刻可以同时运行不同的指令，让多条指令的执行时间相互重叠。那么为什么展开前性能较差呢？

主要是因为for循环体内是热点路径，原实现虽然可读性强，但是涉及的热点路径无用指令、跳转指令、内存访问太多了。

展开后，编译器会根据寄存器数量，将大部分变量存放在寄存器中，消除了大量的内存访问操作（也可以增加resgiter keyword标明使用寄存器）；

其次，原始的计算，其实涉及到64次跳转指令，循环展开后，仅涉及8次跳转。

最后，也是因为展开后，提高了每个时钟周期并行执行指令的条数。

关于优化参数O0-O3做一个补充说明。

|优化类型|说明|典型优化级别|
|---|---|---|
|死代码消除|移除不使用的代码|O1+|
|循环优化|展开、向量化、并行化|O2/O3|
|函数内联|将小函数直接嵌入调用处|O2+|
|常量传播|替换已知常量值|O1+|
|公共子表达式消除|避免重复计算相同表达式|O1+|

O0: 调试模式，保留所有调试信息和源代码执行顺序，禁用所有优化，编译速度快

O1: 基础优化，死代码消除，跳转线程化，基本循环优化，寄存器分配优化

O2: 函数内联，指令重排，尾部调用优化，常量传播，循环展开

O3: 自动向量化(SIMD)，函数间优化(IPO)，循环展开，预测执行优化

Os: 尺寸优化，减少代码体积，禁用增加体积的优化。

3.预取操作

现代CPU架构中，缓存`Cache`和主存`Memory`之间通常存在3-5个数量级的访问延迟差距，当数据访问模式与CPU缓存架构不匹配时，会产生严重的缓存缺失(Cache Miss)问题，导致计算核心长期处于等待数据的空闲状态。

|缓存级别|容量范围|访问延迟(CPU周期)|带宽(GB/s)|
|---|---|---|---|
|L1 Cache|32-64KB|1-3|1000+|
|L2 Cache|256KB-2MB|10-20|500-800|
|L3 Cache|4-64MB|30-100|200-400|
|主存|4GB+|200-400|50-100|

诸如例题内存密集型操作，传统实现因为需要等待数据的加载，导致CPU流水线停滞等待。而预取函数就是为了解决这种场景。预取函数声明如下。

```C++
void __buitin_prefetch(const void *addr, int rw, int locality);
```

- addr: 预取数据的内存地址
- rw: 访问类型（0：只读，1：读写）
- locality: 局部性类型（0：最近，1：循环，2：随机）

关于预取当前其实没有特别的优化说明，后续会补充相关的汇编代码进行解释。
