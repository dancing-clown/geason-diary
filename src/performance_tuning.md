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

### 案例总结

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

关于优化参数O0-O3做一个补充说明。参考链接[Options That Control Optimization](https://gcc.gnu.org/onlinedocs/gcc/Optimize-Options.html)

|优化类型|说明|典型优化级别|
|---|---|---|
|死代码消除|移除不使用的代码|O1+|
|循环优化|展开、向量化、并行化|O2/O3|
|函数内联|将小函数直接嵌入调用处|O2+|
|常量传播|替换已知常量值|O1+|
|公共子表达式消除|避免重复计算相同表达式|O1+|

O0: 调试模式，保留所有调试信息和源代码执行顺序，禁用所有优化，编译速度快

O1: 编译器在不增加编译时间即不影响编译速度的情况下，减少可执行程序代码大小和代码执行时间。常见的有：基础优化，死代码消除，跳转线程化，基本循环优化，寄存器分配优化。相关优化参数如下所示。

```bash
-fauto-inc-dec
-fbranch-count-reg 
-fcombine-stack-adjustments 
-fcompare-elim 
-fcprop-registers 
-fdce 
-fdefer-pop 
-fdelayed-branch 
-fdse 
-fforward-propagate 
-fguess-branch-probability 
-fif-conversion 
-fif-conversion2 
-finline-functions-called-once 
-fipa-modref 
-fipa-profile 
-fipa-pure-const 
-fipa-reference 
-fipa-reference-addressable 
-fmerge-constants 
-fmove-loop-invariants 
-fmove-loop-stores
-fomit-frame-pointer 
-freorder-blocks 
-fshrink-wrap 
-fshrink-wrap-separate 
-fsplit-wide-types 
-fssa-backprop 
-fssa-phiopt 
-ftree-bit-ccp 
-ftree-ccp 
-ftree-ch 
-ftree-coalesce-vars 
-ftree-copy-prop 
-ftree-dce 
-ftree-dominator-opts 
-ftree-dse 
-ftree-forwprop 
-ftree-fre 
-ftree-phiprop 
-ftree-pta 
-ftree-scev-cprop 
-ftree-sink 
-ftree-slsr 
-ftree-sra 
-ftree-ter 
-funit-at-a-time
```

O2: 相对于O1进一步优化，会增加编译时间（牺牲编译速度）以及进一步降低代码运行时间。常见的有：函数内联，指令重排，尾部调用优化，常量传播，循环展开。-O2选项除了开启-O1的所有优化标志外，还会开启以下优化标志：

```bash
-falign-functions  -falign-jumps 
-falign-labels  -falign-loops 
-fcaller-saves 
-fcode-hoisting 
-fcrossjumping 
-fcse-follow-jumps  -fcse-skip-blocks 
-fdelete-null-pointer-checks 
-fdevirtualize  -fdevirtualize-speculatively 
-fexpensive-optimizations 
-ffinite-loops 
-fgcse  -fgcse-lm  
-fhoist-adjacent-loads 
-finline-functions 
-finline-small-functions 
-findirect-inlining 
-fipa-bit-cp  -fipa-cp  -fipa-icf 
-fipa-ra  -fipa-sra  -fipa-vrp 
-fisolate-erroneous-paths-dereference 
-flra-remat 
-foptimize-sibling-calls 
-foptimize-strlen 
-fpartial-inlining 
-fpeephole2 
-freorder-blocks-algorithm=stc 
-freorder-blocks-and-partition  -freorder-functions 
-frerun-cse-after-loop  
-fschedule-insns  -fschedule-insns2 
-fsched-interblock  -fsched-spec 
-fstore-merging 
-fstrict-aliasing 
-fthread-jumps 
-ftree-builtin-call-dce 
-ftree-loop-vectorize 
-ftree-pre 
-ftree-slp-vectorize 
-ftree-switch-conversion  -ftree-tail-merge 
-ftree-vrp 
-fvect-cost-model=very-cheap
```

O3: 进一步优化，一般都是采取很多向量化算法，提高代码的并行执行程度，利用现代CPU中的流水线，Cache等。常见的有自动向量化(SIMD)，函数间优化(IPO)，循环展开，预测执行优化。

```bash
-fgcse-after-reload 
-fipa-cp-clone 
-floop-interchange 
-floop-unroll-and-jam 
-fpeel-loops 
-fpredictive-commoning
-fsplit-loops 
-fsplit-paths 
-ftree-loop-distribution 
-ftree-partial
-pre 
-funswitch-loops 
-fvect-cost-model=dynamic 
-fversion-loops-for-strides
```

Ofast: 除了O3外，也会针对某些语言启用部分优化。如：-ffast-math ，-fallow-store-data-races，和特定于Fortan语言的-fstack-arrays标志，除非 -fmax-stack-var-size和-fno-protect-parens被指定。-Ofast主要是牺牲兼容性来获取更快的运行速度。

Os: 尺寸优化，减少代码体积，禁用增加体积的优化。和O2差不多，但不包含以下指令。

```bash
-falign-functions -falign-jumps 
-falign-labels -falign-loops 
-fprefetch-loop-arrays -freorder-blocks-algorithm=stc
```

Og: 在快速编译和可调试之间保持了一个合理的优化策略，沿用-O1,但是不包含对O1中对调试信息产生影响的标志。

```bash
-fbranch-count-reg -fdelayed-branch 
-fdse -fif-conversion -fif-conversion2   
-finline-functions-called-once 
-fmove-loop-invariants -fmove-loop-stores -fssa-phiopt 
-ftree-bit-ccp -ftree-dse -ftree-pta -ftree-sra
```

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

## crossbeam::channel p99毛刺解析

我们为了提高消息处理，并且crossbeam::channel是无锁队列，模拟10w突发流量数据处理，测试代码如下。

测试机信息如下：

```bash
CPU: Apple M4 Pro
Phys:12 Logical:12
Mem:48 GB
```

```rust
use crossbeam::channel;
use std::time::{Duration, Instant};
use hdrhistogram::Histogram;

const SENDER_THREAD_COUNT: usize = 1;
const RECEIVER_THREAD_COUNT: usize = 1;
const ORDER_COUNT: usize = 100_000;

pub struct Order {
    pub id: i32,
    pub price: f64,
    pub amount: u32,
    pub instant: Instant,
}

fn main() {
    let (tx, rx) = channel::bounded::<Order>(1000_000);
    let (metric_tx, metric_rx) = channel::unbounded::<Duration>();
    let mut recv_join_handle = Vec::new();
    // 先创建接收线程，避免已经开始发送数据后，接收端还不能接受数据的偏差
    for _ in 0..RECEIVER_THREAD_COUNT {
        let rx_clone = rx.clone();
        let metric_tx_clone = metric_tx.clone();
        recv_join_handle.push(std::thread::spawn(move || {
            for order in rx_clone {
                let _ = metric_tx_clone.send(order.instant.elapsed());
            }
        }));
    }
    drop(metric_tx);

    let mut send_join_handle = Vec::new();
    for _ in 0..SENDER_THREAD_COUNT {
        let tx_clone = tx.clone();
        send_join_handle.push(std::thread::spawn(move || {
            for i in 0..ORDER_COUNT {
                let order = Order {
                    id: i as i32,
                    price: i as f64,
                    amount: i as u32,
                    instant: Instant::now(),
                };
                if tx_clone.send(order).is_err() { break; }
            }
        }));
    }
    drop(tx);
    // 创建一个直方图，指定桶数量（例如1000个桶）
    let mut histogram = Histogram::<u64>::new(3).unwrap();

    for i in (0..SENDER_THREAD_COUNT).rev() {
        send_join_handle.remove(i).join().unwrap();
    }

    for i in (0..RECEIVER_THREAD_COUNT).rev() {
        recv_join_handle.remove(i).join().unwrap();
    }

    for duration in metric_rx {
        histogram.record(duration.as_micros() as u64).unwrap();
    }
     // 计算P99延迟
    let p99 = histogram.value_at_percentile(99.0);
    println!("P99 latency: {p99} us");
    // 计算p90延迟
    let p90 = histogram.value_at_percentile(90.0);
    println!("P90 latency: {p90} us");
    // 计算p50延迟
    let p50 = histogram.value_at_percentile(50.0);
    println!("P50 latency: {p50} us");

    // 其他统计信息
    println!("Mean: {} us", histogram.mean());
    // 不允许丢数据
    println!("Total count: {}", histogram.len());
}
```

优化前，使用单线程消息发送和接收，统计结果如下图所示。

|发送线程数量|接受线程数量|p50|p90|p99|数据量|
|---|---|---|---|---|---|
|1|1|670 us|1148 us|1220 us|100000|
|1|1|757 us|1226 us|1305 us|100000|
|1|1|757 us|1193 us|1310 us|100000|
|1|1|787 us|1347 us|1418 us|100000|
|1|1|743 us|1183 us|1298 us|100000|
|1|1|682 us|1207 us|1325 us|100000|
|1|1|769 us|1244 us|1362 us|100000|
|1|1|601 us|1026 us|1142 us|100000|
|1|1|602 us|1000 us|1085 us|100000|
|1|1|554 us|1023 us|1112 us|100000|

初期的想法是简单的根据当前的核数进行分配。
分别测试SENDER_NUM = 5, 10，20的场景

```rust
// 修改部分代码如下
const SENDER_THREAD_COUNT: usize = 5;
const RECEIVER_THREAD_COUNT: usize = 1;
const ORDER_COUNT: usize = 20_000;
```

测试send=5的结果如下：

|发送线程数量|接受线程数量|p50|p90|p99|数据量|
|---|---|---|---|---|---|
|5|1|0 us|15 us|114 us|100000|
|5|1|0 us|1 us|36 us|100000|
|5|1|0 us|63 us|123 us|100000|
|5|1|0 us|2 us|50 us|100000|
|5|1|0 us|2 us|61 us|100000|
|5|1|0 us|8 us|64 us|100000|
|5|1|0 us|3 us|45 us|100000|
|5|1|0 us|3 us|59 us|100000|
|5|1|0 us|8 us|51 us|100000|
|5|1|0 us|102 us|156 us|100000|

同比于单一线程发送，这里的p99延迟是单一线程的15倍左右，这是因为多线程发送会引入额外的线程切换开销。因为高频关注的往往会要求p99的延迟性能，所以这里仅讨论p99。

```rust
// 发送线程数为10
const SENDER_THREAD_COUNT: usize = 10;
const RECEIVER_THREAD_COUNT: usize = 1;
const ORDER_COUNT: usize = 10_000;
```

测试send=10（release）的结果如下：

|发送线程数量|接受线程数量|p50|p90|p99|数据量|
|---|---|---|---|---|---|
|10|1|0 us|5 us|117 us|100000|
|10|1|198 us|487 us|521 us|100000|
|10|1|0 us|141 us|205 us|100000|
|10|1|0 us|8 us|117 us|100000|
|10|1|0 us|3 us|113 us|100000|
|10|1|100 us|287 us|356 us|100000|
|10|1|0 us|59 us|103 us|100000|
|10|1|0 us|5 us|90 us|100000|
|10|1|0 us|5 us|150 us|100000|
|10|1|104 us|332 us|382 us|100000|

```rust
const SENDER_THREAD_COUNT: usize = 20;
const RECEIVER_THREAD_COUNT: usize = 1;
const ORDER_COUNT: usize = 5_000;
```

测试send=20（release）的结果如下：

|发送线程数量|接受线程数量|p50|p90|p99|数据量|
|---|---|---|---|---|---|
|20|1|0 us|5 us|271 us|100000|
|20|1|0 us|21 us|225 us|100000|
|20|1|0 us|244 us|320 us|100000|
|20|1|0 us|148 us|202 us|100000|
|20|1|0 us|3 us|264 us|100000|
|20|1|16 us|573 us|665 us|100000|
|20|1|0 us|18 us|321 us|100000|
|20|1|0 us|21 us|216 us|100000|
|20|1|233 us|593 us|660 us|100000|
|20|1|0 us|101 us|206 us|100000|

可以看到当发送线程达到10以上后，p50的延迟基本都是微妙级别，但是p99的延迟仍然是百纳秒级。

测试recv=5的结果如下：

|发送线程数量|接受线程数量|p50|p90|p99|数据量|
|---|---|---|---|---|---|
|1|5|7779 us|13407 us|14823 us|100000|
|1|5|8271 us|13439 us|14287 us|100000|
|1|5|7307 us|12783 us|13807 us|100000|
|1|5|5203 us|9383 us|10759 us|100000|
|1|5|6251 us|11271 us|11951 us|100000|
|1|5|5259 us|10311 us|11359 us|100000|
|1|5|4787 us|9231 us|10471 us|100000|
|1|5|5747 us|10695 us|11663 us|100000|
|1|5|6483 us|10631 us|12111 us|100000|
|1|5|5979 us|11471 us|12703 us|100000|

测试recv=10的结果如下：

|发送线程数量|接受线程数量|p50|p90|p99|数据量|
|---|---|---|---|---|---|
|1|10|9287 us|16511 us|18079 us|100000|
|1|10|5323 us|10783 us|11751 us|100000|
|1|10|6831 us|13255 us|14663 us|100000|
|1|10|7667 us|14311 us|15711 us|100000|
|1|10|6059 us|12071 us|13311 us|100000|
|1|10|5979 us|12463 us|13951 us|100000|
|1|10|8527 us|15463 us|17103 us|100000|
|1|10|9519 us|17295 us|19007 us|100000|
|1|10|8959 us|16359 us|18095 us|100000|
|1|10|9127 us|16735 us|18367 us|100000|

测试send=1, recv=20（release）的结果如下：

|发送线程数量|接受线程数量|p50|p90|p99|数据量|
|---|---|---|---|---|---|
|1|20|6671 us|13527 us|15231 us|100000|
|1|20|8543 us|15719 us|17071 us|100000|
|1|20|9127 us|15895 us|17407 us|100000|
|1|20|8671 us|15247 us|16623 us|100000|
|1|20|7479 us|13847 us|15311 us|100000|
|1|20|7131 us|13639 us|15191 us|100000|
|1|20|7035 us|12583 us|13831 us|100000|
|1|20|8983 us|15263 us|16655 us|100000|
|1|20|6599 us|12895 us|14127 us|100000|
|1|20|8479 us|15119 us|16607 us|100000|

可以看到，如果不改变生产者的速率，消费者越多，也会导致p99的延迟大幅度增加。即使调快了生产者速率，消费者线程增加也会导致处理延迟的增加，后续解释。

目前尝试下来最优为send=5，recv=1的场景，那么分析为什么这种场景下，p50延迟几乎可以为0，p90为微秒级，但p99仍然为百微妙左右。

添加热力图

```rust
use crossbeam::channel;
use std::time::{Duration, Instant};
use hdrhistogram::Histogram;
use pprof::ProfilerGuardBuilder;

const SENDER_THREAD_COUNT: usize = 5;
const RECEIVER_THREAD_COUNT: usize = 1;
const ORDER_COUNT: usize = 20_000;

pub struct Order {
    pub id: i32,
    pub price: f64,
    pub amount: u32,
    pub instant: Instant,
}

fn main() {
    let guard = ProfilerGuardBuilder::default()
        .frequency(99)
        .build()
        .unwrap();
    let (tx, rx) = channel::bounded::<Order>(1000_000);
    let (metric_tx, metric_rx) = channel::unbounded::<Duration>();
    let mut recv_join_handle = Vec::new();
    for _ in 0..RECEIVER_THREAD_COUNT {
        let rx_clone = rx.clone();
        let metric_tx_clone = metric_tx.clone();
        recv_join_handle.push(std::thread::spawn(move || {
            for order in rx_clone {
                let _ = metric_tx_clone.send(order.instant.elapsed());
            }
        }));
    }
    drop(metric_tx);

    let mut send_join_handle = Vec::new();
    for _ in 0..SENDER_THREAD_COUNT {
        let tx_clone = tx.clone();
        send_join_handle.push(std::thread::spawn(move || {
            for i in 0..ORDER_COUNT {
                let order = Order {
                    id: i as i32,
                    price: i as f64,
                    amount: i as u32,
                    instant: Instant::now(),
                };
                if tx_clone.send(order).is_err() { break; }
            }
        }));
    }
    drop(tx);
    // 创建一个直方图，指定桶数量（例如1000个桶）
    let mut histogram = Histogram::<u64>::new(3).unwrap();

    for i in (0..SENDER_THREAD_COUNT).rev() {
        send_join_handle.remove(i).join().unwrap();
    }

    for i in (0..RECEIVER_THREAD_COUNT).rev() {
        recv_join_handle.remove(i).join().unwrap();
    }

    for duration in metric_rx {
        histogram.record(duration.as_micros() as u64).unwrap();
    }
     // 计算P99延迟
    let p99 = histogram.value_at_percentile(99.0);
    println!("P99 latency: {p99} us");
    // 计算p90延迟
    let p90 = histogram.value_at_percentile(90.0);
    println!("P90 latency: {p90} us");
    // 计算p50延迟
    let p50 = histogram.value_at_percentile(50.0);
    println!("P50 latency: {p50} us");

    // 其他统计信息
    println!("Mean: {} us", histogram.mean());
    // 不允许丢数据
    println!("Total count: {}", histogram.len());

    if let Ok(report) = guard.report().build() {
        let file = std::fs::File::create("flamegraph.svg").unwrap();
        let _ = report.flamegraph(file);
        println!("flamegraph.svg generated");
    }
}
```

多次测试后得到如下热力图

[热力图展示](./images/flamegraph.svg)

可以看到当前主要阻塞点为`crossbeam::Sender::send`

切换linux系统运行strace,可以观察到有大量的futex调用。

```bash
strace -c  ./target/release/own_test
P99 latency: 763 us
P90 latency: 479 us
P50 latency: 2 us
Mean: 91.34759 us
Total count: 100000
% time     seconds  usecs/call     calls    errors syscall
------ ----------- ----------- --------- --------- ------------------
 40.77    0.007387        1846         4           futex
 24.37    0.004416        1472         3           munmap
  9.87    0.001788         298         6           clone3
  7.89    0.001429          59        24           mmap
  5.34    0.000967          74        13           rt_sigprocmask
  3.00    0.000544          41        13           mprotect
  2.43    0.000441         441         1           execve
  1.49    0.000270         270         1           madvise
  0.82    0.000148          24         6           openat
  0.79    0.000143          17         8           read
  0.56    0.000102          20         5           write
  0.41    0.000074          12         6           close
  0.34    0.000062          12         5           newfstatat
  0.32    0.000058           9         6           rt_sigaction
  0.30    0.000055          18         3           brk
  0.26    0.000048          12         4           pread64
  0.20    0.000036          18         2           prlimit64
  0.18    0.000033          11         3           sigaltstack
  0.13    0.000023          23         1         1 access
  0.10    0.000019           9         2         1 arch_prctl
  0.10    0.000018          18         1           poll
  0.09    0.000016          16         1           sched_getaffinity
  0.07    0.000012          12         1           set_robust_list
  0.06    0.000011          11         1           getrandom
  0.05    0.000009           9         1           set_tid_address
  0.05    0.000009           9         1           rseq
------ ----------- ----------- --------- --------- ------------------
100.00    0.018118         148       122         2 total
```

但是我们的crossbeam应该是无锁结构才对！代码片段如下。

```rust
    /// Sends a message into the channel.
    pub(crate) fn send(
        &self,
        msg: T,
        deadline: Option<Instant>,
    ) -> Result<(), SendTimeoutError<T>> {
        let token = &mut Token::default();
        loop {
            // Try sending a message several times.
            let backoff = Backoff::new();
            loop {
                if self.start_send(token) {
                    let res = unsafe { self.write(token, msg) };
                    return res.map_err(SendTimeoutError::Disconnected);
                }

                if backoff.is_completed() {
                    break;
                } else {
                    backoff.snooze();
                }
            }

            if let Some(d) = deadline {
                if Instant::now() >= d {
                    return Err(SendTimeoutError::Timeout(msg));
                }
            }

            Context::with(|cx| {
                // Prepare for blocking until a receiver wakes us up.
                let oper = Operation::hook(token);
                self.senders.register(oper, cx);

                // Has the channel become ready just now?
                if !self.is_full() || self.is_disconnected() {
                    let _ = cx.try_select(Selected::Aborted);
                }

                // Block the current thread.
                let sel = cx.wait_until(deadline);

                match sel {
                    Selected::Waiting => unreachable!(),
                    Selected::Aborted | Selected::Disconnected => {
                        self.senders.unregister(oper).unwrap();
                    }
                    Selected::Operation(_) => {}
                }
            });
        }
    }
```

当我们进入这个send后，如果无法发送会调用snooze自旋锁等待，当判断当前`step`大于`YIELD_LIMIT`后，退出loop循环，执行wait_until，因为我们调用时没有传入deadline，则会直接调用`thread::park()`阻塞线程，指导recv通知我们。结合strace系统调用可以看到，目前仍然存在40%的时间进行futex即锁的休眠和唤醒。大量线程进行在CAS失败后，选择了休眠，也就导致了我们P99的毛刺产生。

那么找到问题的关键，我们来验证，增加send线程数为20，增加CAS冲突概率，strace统计。

```rust
strace -c  ./target/release/own_test
P99 latency: 2809 us
P90 latency: 349 us
P50 latency: 3 us
Mean: 189.25318000000027 us
Total count: 100000
% time     seconds  usecs/call     calls    errors syscall
------ ----------- ----------- --------- --------- ------------------
 76.19    0.019443       19443         1           futex
 15.60    0.003981         796         5           munmap
  4.39    0.001120          28        39           mmap
  1.80    0.000459          21        21           clone3
  0.74    0.000188           6        28           mprotect
  0.31    0.000080           1        43           rt_sigprocmask
  0.27    0.000068           8         8           read
  0.20    0.000050           8         6           openat
  0.14    0.000037           6         6           rt_sigaction
  0.06    0.000016           5         3           brk
  0.05    0.000014          14         1           poll
  0.05    0.000014           7         2           prlimit64
  0.05    0.000012           4         3           sigaltstack
  0.04    0.000011           1         6           close
  0.04    0.000009           9         1           sched_getaffinity
  0.04    0.000009           1         5           newfstatat
  0.03    0.000008           8         1           getrandom
  0.00    0.000000           0         5           write
  0.00    0.000000           0         4           pread64
  0.00    0.000000           0         1         1 access
  0.00    0.000000           0         1           madvise
  0.00    0.000000           0         1           execve
  0.00    0.000000           0         2         1 arch_prctl
  0.00    0.000000           0         1           set_tid_address
  0.00    0.000000           0         1           set_robust_list
  0.00    0.000000           0         1           rseq
------ ----------- ----------- --------- --------- ------------------
100.00    0.025519         130       196         2 total
```

可以看到毛刺明显，且futex从原来的40%上涨到了76%。

### channel案例总结

crossbeam::channel 的 P99 毛刺本质是高竞争下无锁设计的开销叠加：
核心矛盾：CAS 竞争 → 自旋 → park/unpark。
优化核心：减少竞争（分片）> 避免扩容（固定容量）> 缓解缓存问题（对齐）> 批量处理；
极致场景：SPSC 替代 MPMC，或换用 flume/ringbuf 等专用库（实际测试还是没有crossbeam快）。
百万级消息场景下，优先通过 “通道分片 + 固定容量 ArrayChannel + 批量处理” 组合，可将 P99 毛刺降低 1~2 个数量级。

核心诉求是「多生产者提升写入效率 + 低延迟无毛刺」，分片 Ringbuf 是最优解；若需快速落地且功能要求高，选Flume的MPSC模式；Crossbeam 仅适合低并发通用场景。

最终将这个代码改成ringbuf形式进行测试回归。

```rust
use ringbuf::HeapRb;
use std::time::{Duration, Instant};
use hdrhistogram::Histogram;
// use std::hint::spin_loop;

// 保持与原测试一致的配置（仅放大消息量体现 Ringbuf 优势）
const SENDER_THREAD_COUNT: usize = 5;    // 5个生产者（分片 SPSC 适配）
// const RECEIVER_THREAD_COUNT: usize = 1;  // 1个消费者（批量读取所有分片）
const ORDER_COUNT: usize = 20_000;      // 单生产者10万条 → 总50万条
const WARMUP_COUNT: usize = 10_000;      // 预热消息数（排除冷启动开销）
const RINGBUF_CAPACITY: usize = 100_000;  // 每个 SPSC 缓冲区容量

// 消息结构体（与原代码一致）
#[derive(Clone, Debug)]
pub struct Order {
    pub id: i32,
    pub price: f64,
    pub amount: u32,
    pub instant: Instant,
}

fn main() {
    // 1. 初始化分片 Ringbuf（5个分片对应5个生产者）
    let mut producers = Vec::with_capacity(SENDER_THREAD_COUNT);
    let mut consumers = Vec::with_capacity(SENDER_THREAD_COUNT);
    for _ in 0..SENDER_THREAD_COUNT {
        let rb = HeapRb::<Order>::new(RINGBUF_CAPACITY);
        let (prod, cons) = rb.split();
        producers.push(prod);
        consumers.push(cons);
    }
    let (metric_tx, metric_rx) = crossbeam::channel::unbounded::<Duration>();

    // 2. 启动消费者线程（批量读取所有分片）
    let mut recv_join_handle = Vec::new();
    let mut rb_consumers = consumers;
    let metric_tx_clone = metric_tx.clone();
    recv_join_handle.push(std::thread::spawn(move || {
        // 预热阶段：读取所有分片的预热消息（不计入统计）
        for consumer in rb_consumers.iter_mut() {
            for _ in 0..WARMUP_COUNT {
                while consumer.pop().is_none() {
                    // spin_loop(); // 轻量自旋，适配 Mac 调度
                }
            }
        }

        // 正式统计阶段：批量读取所有分片
        let mut total_recv = 0;
        let target_total = SENDER_THREAD_COUNT * ORDER_COUNT;
        while total_recv < target_total {
            for consumer in rb_consumers.iter_mut() {
                // 批量读取（一次读64条，减少循环开销）
                let mut batch = Vec::with_capacity(64);
                while let Some(order) = consumer.pop() {
                    batch.push(order);
                    if batch.len() >= 64 {
                        break;
                    }
                }
                // 统计延迟
                for order in batch {
                    let _ = metric_tx_clone.send(order.instant.elapsed());
                    total_recv += 1;
                }
            }
        }
    }));
    drop(metric_tx); // 关闭统计通道生产者端

    // 3. 启动生产者线程（单生产者绑定单分片，无竞争）
    let mut send_join_handle = Vec::new();
    for (prod_idx, mut rb_producer) in producers.into_iter().enumerate() {
        send_join_handle.push(std::thread::spawn(move || {
            // 预热阶段：发送空消息（不计入统计）
            for _ in 0..WARMUP_COUNT {
                let warmup_order = Order {
                    id: 0,
                    price: 0.0,
                    amount: 0,
                    instant: Instant::now(),
                };
                while rb_producer.push(warmup_order.clone()).is_err() {
                    // spin_loop(); // 缓冲区满时自旋，避免 park
                }
            }

            // 正式发送阶段：无竞争写入（Ringbuf 核心优势）
            for i in 0..ORDER_COUNT {
                let order = Order {
                    id: (prod_idx * ORDER_COUNT + i) as i32,
                    price: (prod_idx * ORDER_COUNT + i) as f64,
                    amount: (prod_idx * ORDER_COUNT + i) as u32,
                    instant: Instant::now(),
                };
                // 无锁写入，满时轻量自旋
                while rb_producer.push(order.clone()).is_err() {
                    // spin_loop();
                }
            }
        }));
    }

    // 4. 等待生产者线程结束
    for handle in send_join_handle {
        handle.join().unwrap();
    }

    // 5. 等待消费者线程结束
    for handle in recv_join_handle {
        handle.join().unwrap();
    }

    // 6. 统计延迟（与原代码逻辑完全一致）
    let mut histogram = Histogram::<u64>::new(3).unwrap();
    for duration in metric_rx {
        histogram.record(duration.as_micros() as u64).unwrap();
    }

    // 7. 输出结果（对齐原测试的输出格式）
    let p99 = histogram.value_at_percentile(99.0);
    println!("P99 latency: {p99} us");
    let p90 = histogram.value_at_percentile(90.0);
    println!("P90 latency: {p90} us");
    let p50 = histogram.value_at_percentile(50.0);
    println!("P50 latency: {p50} us");
    println!("Mean: {} us", histogram.mean());
    println!("Total count: {}", histogram.len());
}
```

测试send=5（release）的结果如下：

|发送线程数量|接受线程数量|p50|p90|p99|数据量|
|---|---|---|---|---|---|
|5|1|3151 us|4727 us|5103 us|100000|
|5|1|3115 us|4851 us|5259 us|100000|
|5|1|1718 us|2667 us|2931 us|100000|
|5|1|3279 us|5059 us|5531 us|100000|
|5|1|3533 us|5407 us|5995 us|100000|
|5|1|3177 us|4855 us|5247 us|100000|
|5|1|3167 us|4759 us|5323 us|100000|
|5|1|3109 us|4895 us|5315 us|100000|
|5|1|2827 us|4479 us|4891 us|100000|

TODO: 可能是因为没有采用分片设计导致接收端效率较低，后续优化测试。
