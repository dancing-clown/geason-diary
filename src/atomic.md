# 原子操作

## 线程同步

参考链接[线程同步](https://course.rs/advance/concurrency-with-threads/sync2.html)

Mutex使用简单，但是无法并发读；RwLock虽然可以并发读，但是使用场景较为受限且性能不够。

因此我们需要一种更高效的线程同步机制，即原子操作。原子操作是指的一系列不可被CPU上下文交换的机器指令，这些指令组合在一起就形成了原子操作。在多核CPU下，当某个CPU核心开始运行原子操作时，会先暂停其他CPU内核对内存的操作，以保证原子操作不会被其他CPU内核所干扰。

## 内存顺序

内存顺序是指CPU在访问内存时的顺序，该顺序可能受以下因素的影响：

代码中的先后顺序

编译器优化导致在编译阶段发生改变，即内存重排序

运行阶段因CPU的缓存机制导致顺序被打乱

### 编译器优化导致的内存顺序改变

```rust,edition2024
static mut X: u64 = 0;
static mut Y: u64 = 0;
fn main() {
    // code block A
    unsafe {
        // code block B
        X = 1;
        // code block C
        Y = 3;
        // code block D
        X = 2;
        // code block E
    }
}
```

假如在`C`和`D`代码片段中，根本没有用到X = 1，编译器可能会将X = 1 和 X =2 进行合并:

```rust,edition2024
static mut X: u64 = 0;
static mut Y: u64 = 0;
fn main() {
    // code block A
    unsafe {
        // code block B
        X = 2;
        // code block C
        Y = 3;
        // code block D
        // code block E
    }
}
```

若代码A中创建了一个新的线程用于读取全局静态变量X,则该线程将无法读取到`X=1`的结果，因此在编译阶段就已经被优化掉。

### CPU缓存导致的内存顺序的改变

假设之前的`X=1`没有被优化掉，并且在代码片段`A`中有一个新的线程：

```text
initial state: X = 0, Y = 1

THREAD Main     THREAD A
X = 1;          if X == 1 {
Y = 3;              Y *= 2;
X = 2;          }
```

判断Y的最终可能值:

`Y = 3`: 线程`Main`运行完后才运行线程`A`，或者线程`A`运行完后再运行线程`Main`

`Y = 6`: 线程`Main`的`Y = 3`运行完，但`X = 2`还没被运行， 此时线程`A`开始运行`Y *= 2`, 最后才运行`Main`线程的`X = 2`

`Y = 2`: 线程`Main`正在运行`Y = 3`还没结束，此时线程`A`正在运行`Y *= 2`, 因此`Y`取到了值 1，然后`Main`的线程将`Y`设置为 3， 紧接着就被线程`A`的`Y = 2`所覆盖

`Y = 2`: 上面的还只是一般的数据竞争，这里虽然产生了相同的结果2，但是背后的原理大相径庭: 线程`Main`运行完`Y = 3`，但是 CPU 缓存中的`Y = 3`还没有被同步到其它 CPU 缓存中，此时线程`A`中的`Y *= 2`就开始读取`Y`，结果读到了值1，最终计算出结果2

总结下来就是CPU切换带来的执行顺序的不确定性，以及CPU缓存未及时同步到其他CPU缓存中造成的缓存失效。

### 限定内存顺序的5个规则

在理解了内存顺序可能存在改变之后，就知道为什么需要限定内存顺序了，该枚举有5个成员。

Relaxed：最宽松，只保证该原子变量的读写是原子的，并维持该原子变量自身的修改顺序；不与其他内存访问建立同步，编译器/CPU可以重排与其无关的访问。

Release：释放语义。禁止“之前的内存访问写”被重排到此原子操作之后；当有线程以 Acquire 读取到该写入时，二者形成 happens-before，使之前的效果对获取方可见。它不约束“之后的访问”前移。

Acquire：获取语义。禁止“之后的内存访问读”被重排到此原子操作之前；当它读取到带 Release 的写入时建立同步，从而保证随后能看到对方线程在 Release 之前完成的写入。它不约束“之前的访问”后移。

AcqRel：同时具备 Acquire 与 Release 的效果，适用于读改写的原子操作（如 `swap`、`fetch_add`），既约束之前访问不能越过它，也约束之后访问不能越过它。

SeqCst：在拥有 Acquire/Release 语义的基础上，还将所有 `SeqCst` 原子操作置于一个全局单调序列中，所有线程都以同一顺序观察它们。

下面举例使用Acquire和Release实现轻量级锁。

```rust,edition2024
use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::ops::{Deref, DerefMut};
use std::hint::spin_loop;

pub struct Lock<T> {
    data: UnsafeCell<T>,
    locked: AtomicBool,
}

// 在锁保护下，跨线程共享是安全的
unsafe impl<T: Send> Sync for Lock<T> {}
unsafe impl<T: Send> Send for Lock<T> {}

impl<T> Lock<T> {
    pub fn new(data: T) -> Self {
        Self {
            data: UnsafeCell::new(data),
            locked: AtomicBool::new(false),
        }
    }

    // 获取锁并返回 Guard，可变访问由 Guard 提供
    pub fn lock(&self) -> LockGuard<'_, T> {
        // 仅当从 false 改为 true 的成功获取使用 Acquire；失败重试用 Relaxed
        while self
            .locked
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .is_err()
        {
            // 减少总线压力，提示忙等待
            spin_loop();
        }
        LockGuard { lock: self }
    }
}

pub struct LockGuard<'a, T> {
    lock: &'a Lock<T>,
}

impl<'a, T> Deref for LockGuard<'a, T> {
    type Target = T;
    fn deref(&self) -> &Self::Target {
        unsafe { &*self.lock.data.get() }
    }
}

impl<'a, T> DerefMut for LockGuard<'a, T> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        unsafe { &mut *self.lock.data.get() }
    }
}

impl<'a, T> Drop for LockGuard<'a, T> {
    fn drop(&mut self) {
        // 发布临界区内对 data 的修改
        self.lock.locked.store(false, Ordering::Release);
    }
}

// 用法示例：
// let lock = std::sync::Arc::new(Lock::new(0));
// let l = lock.clone();
// std::thread::spawn(move || {
//     let mut guard = l.lock();
//     *guard += 1; // 在锁下安全修改 data
// });
// let mut guard = lock.lock();
// *guard += 2;
```

原则上，Acquire用于读取，Release用于写入。但是由于有些原子操作同时拥有读取和写入的功能，此时就需要使用AcqRel来设置内存顺序了。在内存屏障中被写入的数据，都可以被其他线程读取到，不会有CPU缓存的问题。
更准确地说：Acquire 约束“之后”的内存访问，Release 约束“之前”的内存访问；读改写操作使用 AcqRel。数据的可见性要求存在一条 release→acquire 的同步边：只有当 Acquire 读到了由 Release 写入的值，Release 之前的写入才对该线程可见；否则并不保证全局可见性。
