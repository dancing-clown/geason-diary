# Rust/C++并发编程

## 其他并发模型

OS线程：无需改变线程模型，线程间同步困难，性能开销大；线程池可以降低一些成本，但难以支撑大量IO绑定的工作

Event-driven编程：与回调函数一起使用，可能高效；非线性的控制流，数据流和错误传播难以追踪

Coroutinues：类似于线程，无需改变编程模型；类似async，支持大量任务，抽象掉了底层细节

Actor模型：将所有并发计算划分为actor，消息通信易出错，可以有效的实现actor模型，但许多实际问题没解决（流控制，重试逻辑）

## 核心概念

### 线程(thread)

是操作系统能够运算调度的最小单位 对于长时间运行的CPU密集型任务，例如并行计算，使用线程是更有优势的。这种密集型任务往往会在所在线程持续运行，不必要的线程切换都会带来性能的损耗。

### 线程池(thread pool)

线程池是一种用于管理和复用线程的机制，它可以在需要时创建新线程，而不是每次都创建新线程。线程池通常用于处理大量的并发任务，例如Web服务器处理多个客户端请求。

#### 工作窃取线程池

工作窃取算法(Work-Stealing)：让空闲的线程从忙碌的线程的双端队列中偷取任务。当线程的队列中没有其他任务，它就会从其他忙碌的线程或全局的双端队列尾部获取任务，因为队列尾部是最有可能存在还未执行的任务。它促使线程最大程度地取获取可执行的任务，从而提高了线程的利用率。但是会牺牲公平性（后进队列的任务可能被先执行）。使用本地任务队列可以尽可能避免竞争。使用栈窃取可以尽可能公平

当本地缓存队列为空且全局队列也为空时，则会发生工作窃取。任务调度器将额外的任务分配给A线程。

下面给出[C++实现版本](https://github.com/fasiondog/hikyuu/tree/master/hikyuu_cpp/hikyuu/utilities/thread)。

```C++
#pragma once
#include <deque>
#include <mutex>
#include <memory>
#include <functional>
#include <future>
#include <thread>
#include <vector>

/**
 * 函数及函数对象等包装器实现移动语义，以便线程池支持不同类型的任务
 */
class FuncWrapper {
public:
    FuncWrapper() = default;
    // 禁止拷贝构造和拷贝赋值
    FuncWrapper(const FuncWrapper&) = delete;
    FuncWrapper(FuncWrapper&) = delete;
    FuncWrapper& operator=(const FuncWrapper&) = delete;

    /** 移动构造函数，实现对函数及函数对象等任务包装 */
    template<typename F>
    FuncWrapper(F&& f) : impl(new impl_type<F>(std::move(f))) {}

    // 执行被包装的任务
    void operator() {
        if (impl) {
            impl->call();
        }
    }

    // 移动构造函数
    FuncWrapper(FuncWrapper&& other) : impl(std::move(other.impl)) {}

    // 移动赋值函数
    FuncWrapper& operator=(FuncWrapper&& other) {
        impl = std::move(other.impl);
        return *this;
    }

    // 是否是空任务，用于线程池判断是否在所有任务完成后终止运行
    bool isNullTask() const {
        return (impl == nullptr);
    }
private:
    struct impl_base {
        virtual void call() = 0;
        virtual ~impl_base() {}
    };

    std::unique_ptr<impl_base> impl;
    
    template<typename F>
    struct impl_type : impl_base {
        F f;
        impl_type(F&& f_) : f(std::move(f_)) {}
        void call() override {
            f();
        }
    }
};

class WorkStealQueue {
private:
    typedef FuncWrapper data_type;
    std::deque<data_type> m_queue;
    mutable std::mutex m_mutex;

public:
    // 构造函数
    WorkStealQueue() {}
    // 禁用赋值构造和赋值重载
    WorkStealQueue(const WorkStealQueue& other) = delete;
    WorkStealQueue& operator=(const WorkStealQueue& other) = delete;

    // 将数据插入队列头部
    void push_front(data_type&& data) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_queue.push_front(std::move(data));
    }

    // 将数据插入对尾
    void push_back(data_type&& data) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_queue.push_back(std::move(data));
    }

    // 检查队列是否为空
    bool empty() const {
        std::lock_guard<std::mutex> lock(m_mutex);
        return m_queue.empty();
    }

    // 队列大小
    size_t size() const {
        std::lock_guard<std::mutex> lock(m_mutex);
        return m_queue.size();
    }

    // 清空队列
    void clear() {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_queue.clear();
    }

    // 尝试从队列头部弹出一条数据
    bool try_pop(data_type& res) {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (m_queue.empty()) {
            return false;
        }
        // move是为了把该值变为右值引用，从而触发移动构造或移动赋值重载
        // 例如unique_ptr和thread等不可拷贝但可移动的类型，需要move才能把元素`取走`到res
        // 对应string vector等大对象的移动只转移内部指针，避免昂贵的深拷贝
        res = std::move(m_queue.front());
        m_queue.pop_front();
        return true;
    }

    // 尝试从队列尾部偷取一条数据
    bool try_steal(data_type& res) {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (m_queue.empty()) {
            return false;
        }
        if (m_queue.back().isNullTask()) {
            return false;
        }
        res = std::move(m_queue.back());
        m_queue.pop_back();
        return true;
    }
};

/**
 * @brief 分布偷取式线程池
 * @note 主要用于存在递归情况，任务又创建任务加入线程池的情况，否则建议使用普通的线程池
 * @details
 * @ingroup ThreadPool
 */
class GlobalStealThreadPool {

public:
    /**
     * 默认构造函数，创建和当前系统CPU数一致的线程数
     */
    GlobalStealThreadPool() : GlobalStealThreadPool(std::thread::hardware_concurrency()) {}

    /**
     * 构造函数，创建指定数量的线程
     * @param n 指定的线程数
     * @param until_empty 任务队列为空时，自动停止运行
     */
    explicit GlobalStealThreadPool(size_t n, bool until_empty = true)
    : m_done(false), m_worker_num(n), m_running_until_empty(until_empty) {
        try {
            m_interrupt_flags.resize(m_worker_num, nullptr);
            for (int i = 0; i < m_worker_num; i++) {
                // 创建工作线程及其任务队列
                m_queues.emplace_back(new WorkStealQueue);
            }
            // 初始完毕所有线程资源后再启动线程
            for (int i = 0; i < m_worker_num; i++) {
                m_threads.emplace_back(&GlobalStealThreadPool::worker_thread, this, i);
            }
        } catch (...) {
            m_done = true;
            throw;
        }
    }

    /**
     * 析构函数，等待并阻塞至线程池内所有任务完成
     */
    ~GlobalStealThreadPool() {
        if (!m_done) {
            join();
        }
    }

    /** 获取工作线程数 */
    size_t worker_num() const {
        return m_worker_num;
    }

    /** 剩余任务数 */
    size_t remain_task_count() const {
        if (m_done) {
            return 0;
        }
        size_t total = m_master_work_queue.size();
        for (size_t i = 0; i < m_worker_num; i++) {
            total += m_queues[i]->size();
        }
        return total;
    }

    /** 先线程池提交任务后返回的对应 future 的类型 */
    template <typename ResultType>
    using task_handle = std::future<ResultType>;

    /** 向线程池提交任务 */
    template <typename FunctionType>
    auto submit(FunctionType f) {
        if (m_thread_need_stop.isSet() || m_done) {
            throw std::logic_error(
              "You can't submit a task to the stopped GlobalStealThreadPool!!");
        }

        typedef typename std::invoke_result<FunctionType>::type result_type;
        std::packaged_task<result_type()> task(f);
        task_handle<result_type> res(task.get_future());
        // 如果调用submit是工作线程，就可以直接用本地的任务队列，从而减少竞争；
        // 否则加入全局队列，然后唤醒其中一个线程等待执行
        if (m_local_work_queue) {
            // 本地线程任务从前部入队列（递归成栈）
            m_local_work_queue->push_front(std::move(task));
        } else {
            m_master_work_queue.push(std::move(task));
            m_cv.notify_one();
        }
        return res;
    }

#ifdef _MSC_VER
#pragma warning(pop)
#endif

    /** 返回线程池结束状态 */
    bool done() const {
        return m_done;
    }

    /**
     * 等待各线程完成当前执行的任务后立即结束退出
     */
    void stop() {
        if (m_done) {
            return;
        }

        m_done = true;

        // 同时加入结束任务指示，以便在dll退出时也能够终止
        for (size_t i = 0; i < m_worker_num; i++) {
            if (m_interrupt_flags[i]) {
                m_interrupt_flags[i]->set();
            }
            m_queues[i]->push_front(FuncWrapper());
        }

        m_cv.notify_all();  // 唤醒所有工作线程
        for (size_t i = 0; i < m_worker_num; i++) {
            if (m_threads[i].joinable()) {
                m_threads[i].join();
            }
        }

        m_master_work_queue.clear();
        for (size_t i = 0; i < m_worker_num; i++) {
            m_queues[i]->clear();
        }
    }

    /**
     * 等待并阻塞至线程池内所有任务完成
     * @note 至此线程池能工作线程结束不可再使用
     */
    void join() {
        if (m_done) {
            return;
        }

        // 指示各工作线程在未获取到工作任务时，停止运行
        if (m_running_until_empty) {
            while (true) {
                if (m_master_work_queue.size() != 0) {
                    std::this_thread::yield();
                } else {
                    bool can_quit = true;
                    for (size_t i = 0; i < m_worker_num; i++) {
                        if (m_queues[i]->size() != 0) {
                            can_quit = false;
                            break;
                        }
                    }
                    if (can_quit) {
                        break;
                    } else {
                        std::this_thread::yield();
                    }
                }
            }

            m_done = true;
            for (size_t i = 0; i < m_worker_num; i++) {
                if (m_interrupt_flags[i]) {
                    m_interrupt_flags[i]->set();
                }
            }
        }

        for (size_t i = 0; i < m_worker_num; i++) {
            m_master_work_queue.push(FuncWrapper());
        }

        // 唤醒所有工作线程
        m_cv.notify_all();

        // 等待线程结束
        for (size_t i = 0; i < m_worker_num; i++) {
            if (m_threads[i].joinable()) {
                m_threads[i].join();
            }
        }

        m_master_work_queue.clear();
        for (size_t i = 0; i < m_worker_num; i++) {
            m_queues[i]->clear();
        }

        m_done = true;
    }

private:
    typedef FuncWrapper task_type;
    std::atomic_bool m_done;       // 线程池全局需终止指示
    size_t m_worker_num;           // 工作线程数量
    bool m_running_until_empty;    // 任务队列为空时，自动停止运行
    std::condition_variable m_cv;  // 条件变量，无任务时阻塞线程并等待
    std::mutex m_cv_mutex;         // 配合条件变量的锁

    std::vector<InterruptFlag*> m_interrupt_flags;           // 工作线程状态
    ThreadSafeQueue<task_type> m_master_work_queue;          // 主线程任务队列
    std::vector<std::unique_ptr<WorkStealQueue> > m_queues;  // 任务队列（每个工作线程一个）
    std::vector<std::thread> m_threads;                      // 工作线程

    // 线程本地变量
#if CPP_STANDARD >= CPP_STANDARD_17 && !defined(__clang__)
    inline static thread_local WorkStealQueue* m_local_work_queue = nullptr;  // 本地任务队列
    inline static thread_local int m_index = -1;                              // 在线程池中的序号
    inline static thread_local InterruptFlag m_thread_need_stop;              // 线程停止运行指示
#else
    static thread_local WorkStealQueue* m_local_work_queue;  // 本地任务队列
    static thread_local int m_index;                         // 在线程池中的序号
    static thread_local InterruptFlag m_thread_need_stop;    // 线程停止运行指示
#endif

    void worker_thread(int index) {
        m_interrupt_flags[index] = &m_thread_need_stop;
        m_index = index;
        m_local_work_queue = m_queues[index].get();
        while (!m_thread_need_stop.isSet() && !m_done) {
            run_pending_task();
        }
        m_local_work_queue = nullptr;
        m_interrupt_flags[index] = nullptr;
    }

    void run_pending_task() {
        // 从本地队列提前工作任务，如本地无任务则从主队列中提取任务
        // 如果主队列中提取的任务是空任务，则认为需结束本线程，否则从其他工作队列中偷取任务
        task_type task;
        if (pop_task_from_local_queue(task)) {
            if (!task.isNullTask()) {
                task();
            } else {
                m_thread_need_stop.set();
            }
        } else if (pop_task_from_master_queue(task)) {
            if (!task.isNullTask()) {
                task();
            } else {
                m_thread_need_stop.set();
            }
        } else if (pop_task_from_other_thread_queue(task)) {
            task();
        } else {
            std::unique_lock<std::mutex> lk(m_cv_mutex);
            m_cv.wait(lk, [this] { return this->m_done || !this->m_master_work_queue.empty(); });
        }
    }

    bool pop_task_from_master_queue(task_type& task) {
        return m_master_work_queue.try_pop(task);
    }

    // cppcheck-suppress functionStatic // 屏蔽cppcheck转静态函数建议
    bool pop_task_from_local_queue(task_type& task) {
        return m_local_work_queue && m_local_work_queue->try_pop(task);
    }

    bool pop_task_from_other_thread_queue(task_type& task) {
        for (int i = 0; i < m_worker_num; ++i) {
            int index = (m_index + i + 1) % m_worker_num;
            if (index != m_index && m_queues[index]->try_steal(task)) {
                return true;
            }
        }
        return false;
    }
};

```

(TODO)下面是rust版本的任务窃取队列实现

```rust,edition2024
```

## Rust

### 1. Futures

Futures 是 Rust 中用于表示异步计算的类型，它代表了一个可能在未来某个时间点完成的计算结果。Futures 可以被认为是一个异步操作的占位符，它允许你在异步代码中进行非阻塞的等待，而不会阻塞当前线程的执行。在其他语言中（例如JavaScript）可能叫“promise”。

```rust,edition2024,dependencies=futures@0.3.28
use futures::executor::block_on;
use futures::future::ready;

fn main() {
    let future = ready(42);
    println!("The value is: {}", block_on(future));
}
```

其中的future代表异步执行返回常量42，block_on函数会阻塞当前线程直到future完成，并返回结果42。

### 2. async/await

async 标识符标注当前函数为异步函数，异步函数允许你像编写同步代码一样编写代码，同时在底层仍然支持真正的异步行为。

await 函数则表示等待并接受异步执行的结果，它只能在异步函数中使用。当当前的future未完成时，也会让出线程，提供给其他任务使用；本质上是建立两两future之间的依赖关系，A调用B.await实际就是A依赖B执行完成，B执行完成后，A才会继续执行。

```rust,edition2024,dependencies=tokio@0.3.28
use tokio::net::TcpStream;

async fn my_async_fn() {
    println!("hello from async");
    match TcpStream::connect("127.0.0.1:3001").await {
        Ok(stream) => {
            println!("connected to server");
        }
        Err(e) => {
            println!("error connecting to server: {:?}", e);
        }
    }
    println!("async TCP operation complete");
}

#[tokio::main]
async fn main() {
    let what_is_this = my_async_fn();
    what_is_this.await;
}
```

以上例子中，`my_async_fn`是一个异步函数，返回的是`std::future::Future<()>`

std::future::Future trait如下所示：

```rust
use std::pin::Pin;
use std::task::{Context, Poll};

pub trait Future {
    type Output;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output>;
}
```

`Output`是future 完成时会产生的输出类型；而`Pin`类型是Rust在异步函数中用于支持借用的类型。参考链接[Pin 类型文档](https://doc.rust-lang.org/std/pin/index.html)

与其他语言中 futures 的实现不同，Rust 中的 future 并不代表在后台运行的计算，而是计算本身。future 的所有者负责通过轮询（polling）future 来推进计算。这通过调用 Future::poll 方法来实现；当future未完成时，poll调用会返回`Poll::Pending`。当future完成时，poll调用会返回`Poll::Ready<Output>`。

如上所述，future统一由所有者调用poll确认是否完成，那么可以在main函数中通过队列进行异步任务的管理；waker的wake方法主要是将任务放入调度器中，表示当前任务已就绪；当前实现仅做线程唤醒，提醒线程继续处理。

```rust,edition2024,dependencies=tokio@0.3.28
use std::collections::VecDeque;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll, Wake};
use std::thread::{self, Thread};
use std::time::{Duration, Instant};

// 自定义waker，用于任务唤醒
struct ThreadWaker(Thread);

impl Wake for ThreadWaker {
    // 这里的wake其实暂无作用，run函数没有park的地方
    fn wake(self: Arc<Self>) {
        // self.0.unpark();
    }
}

// 模拟异步IO操作
struct AsyncIOOperate {
    when: Instant,
}

impl Future for AsyncIOOperate {
    type Output = ();

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>)
        -> Poll<()>
    {
        // 判断当前时间和预设时间是否一致，
        // 如果一致，则返回Ready，否则返回Pending
        if Instant::now() >= self.when {
            Poll::Ready(())
        } else {
            cx.waker().wake_by_ref();
            Poll::Pending
        }
    }
}

struct FutureQueues {
    tasks: VecDeque<Task>,
}

type Task = Pin<Box<dyn Future<Output = ()> + Send>>;

impl FutureQueues {

    fn new() -> FutureQueues {
        FutureQueues {
            tasks: VecDeque::new(),
        }
    }

    /// 将future存入队列中
    fn spawn<F>(&mut self, future: F)
    where
        F: Future<Output = ()> + Send + 'static,
    {
        self.tasks.push_back(Box::pin(future));
    }

    fn run(&mut self) {
        let t = thread::current();
        let waker = Arc::new(ThreadWaker(t)).into();
        let mut cx = Context::from_waker(&waker);
        while let Some(mut task) = self.tasks.pop_front() {
            match task.as_mut().poll(&mut cx) {
                Poll::Ready(_) => {}
                Poll::Pending => {
                    self.tasks.push_back(task);
                }
            }
        }
    }
}

async fn async_sleep_fn(i : i32) {
    let now = Instant::now();
    println!("async_sleep_fn {} start", i);
    let when = Instant::now() + Duration::from_secs(1);
    let future = AsyncIOOperate { when };
    // 当前异步任务依赖于异步IO执行完成，故调用await
    future.await;
    let new_now = Instant::now();
    println!("async_sleep_fn {} end, cost: {:?}", i, new_now.duration_since(now));
}

fn main() {
    let mut queue = FutureQueues::new();
    for i in 0..10 {
        queue.spawn(async_sleep_fn(i));
    }
    queue.run();
}

```

以上就是一个很经典的案例；，使用``tokio::time::sleep``模拟耗时操作，在main函数中通过队列管理异步任务。如果是多线程执行，需要开启10个线程，才可以在1秒后完成；而使用异步编程，则只需要1个线程即可。那么在面对数以万计的IO操作时，异步编程的优势尽显。

以上代码的run函数，其实就是一个简单执行器，当前的调度是通过轮训poll实现，但循环空转必定导致CPU忙等待；实际的代码中，往往是ready之后，通过waker唤醒通知调度器可调度，以下为AsyncIOOperate的完成唤醒版本实现；当然需要注意虚假唤醒，因此被唤醒时仍然需要校验是否ready

```rust,edition2024
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Waker};
use std::thread;
use std::time::{Duration, Instant};

struct AsyncIOOperate {
    when: Instant,
    waker: Option<Arc<Mutex<Waker>>>,
}

impl Future for AsyncIOOperate {
    type Output = ();

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        if Instant::now() >= self.when {
            return Poll::Ready(());
        }

        // 时间尚未到达。如果这是第一次调用该future
        // 则生成定时器线程。如果定时器线程已在运行，
        // 确保存储的`Waker`与当前任务的waker匹配。
        if let Some(waker) = &self.waker {
            let mut waker = waker.lock().unwrap();

            // 检查存储的唤醒器是否与当前任务的唤醒器匹配。
            // 这是必要的，因为`Delay` future实例可能会在调用`poll`之间移动到
            // 不同的任务。如果发生这种情况，给定`Context`中包含的唤醒器将会不同，
            // 我们必须更新存储的唤醒器以反映这一变化。
            if !waker.will_wake(cx.waker()) {
                *waker = cx.waker().clone();
            }
        } else {
            let when = self.when;
            let waker = Arc::new(Mutex::new(cx.waker().clone()));
            self.waker = Some(waker.clone());

            // 需要注意这里的waker就不能使用前一个例子的方法进行调度，而消费后不能重新塞入，否则会导致大量线程创建
            thread::spawn(move || {
                let now = Instant::now();

                if now < when {
                    thread::sleep(when - now);
                }

                // 达到对应条件，尝试唤醒
                let waker = waker.lock().unwrap();
                waker.wake_by_ref();
            });
        }
        Poll::Pending
    }
}
```

### 3. Send/Sync

在Rust，还有可能直接使用thread来实现并发操作。

- `Send`：表示类型的实例可以在线程之间安全地转移(move)。
- `Sync`：如果`T: Sync`,则`&T`可以在多线程间共享。而在线程中共享所有权，则需要`Arc<T>`,详情可见[智能指针](./smart_pointer.md)；而如果要使用可变共享，需要`Arc<Mutex<T>>` 或者`Arc<RwLock<T>>`。
