# Rust/C++异步编程

## 核心概念

### 线程(thread)

是操作系统能够运算调度的最小单位 对于长时间运行的CPU密集型任务，例如并行计算，使用线程是更有优势的。这种密集型任务往往会在所在线程持续运行，不必要的线程切换都会带来性能的损耗。

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
