# 池化案例

当前背景，因为项目运行初期，客户量比较少，为了快速交付，项目采用了`one client, one thread, one connection`模型。这样的好处在于，如果单一客户的连接或处理发生阻塞，不会影响其他客户的正常使用。demo代码如下：

```C++
#include <thread>
#include <atomic>
#include <functional>
#include "moodycamel_concurrentqueue/blockingconcurrentqueue.h"

class Worker
{
public:
    Worker() = default;
    ~Worker() = default;
    // 不支持拷贝构造和移动构造
    Worker(const Worker &) = delete;
    Worker &operator=(const Worker &) = delete;
    Worker(Worker &&) = delete;
    Worker &operator=(Worker &&) = delete;

    // 异步执行
    void Run(std::function<void()> &&f) {
        _task_queue.enqueue(std::move(f));
    }
    // 开启异步执行任务的线程
    void Start() {
        _thread = std::thread(
            [this]() {
                while (!_stop) {
                    std::function<void()> task;
                    // wait_dequeue_timed会阻塞当前线程直到有任务从队列中取出或达到指定时间，超时返回false
                    while (!_stop && _task_queue.wait_dequeue_timed(task, std::chrono::milliseconds(50))) {
                        task();
                    }
                    std::this_thread::sleep_for(std::chrono::milliseconds(1));
                }
            }
        );
    }
    // 停止异步执行任务的线程；调用stop后，该worker无法通过start再重启
    void Stop() {
        _stop = true;
        if (_thread.joinable()) {
            _thread.join();
        }
    }

private:
    // 异步执行的独立线程
    std::thread _thread;
    // 异步执行任务的队列
    moodycamel::BlockingConcurrentQueue<std::function<void()>> _task_queue;
    // 是否主动停止异步任务执行
    std::atomic<bool> _stop{false};
};

class Gateway : ITradeApi {
public:
    Gateway() = default;
    ~Gateway() = default;
    AsyncLogin(LoginReq& req) override;
    AsyncLogout(LogoutReq& req) override;
    AsyncPutOrder(OrderInfo& req) override;
    AsyncCancelOrder(CancelOrderReq& req) override;
    AsyncQueryOrder(QueryOrderReq& req) override;
    AsyncQueryTrade(QueryTradeReq& req) override;
    AsyncQueryAccount(QueryAccountReq& req) override;
    AsyncQueryPos(QueryPos& req) override;
    AsyncPushOrder(OrderInfo &info) override;
    AsyncPushTrade(TradeInfo &info) override;
private:
    Worker _worker;
}
```

随着客户量的增加，有的客户可能仅做登录操作，并不实际执行其他交易，倒是部分线程其实一直在等待任务，造成了资源的浪费。

另外部分客户数比较大的，采用`one connection`，会导致连接数超限（例如ATP的connection_num是20，UF2.0的connection_num是50），导致后登录的客户因为连接超限在sdk层面就被连接拒绝了。随后和sdk的开发人员沟通，都是支持单连接多客户登录的，因此对其进行了改造。

改造方案的核心，就是同一个线程，可以处理不同客户的sdk调用和主推，同一连接处理多个客户的登录和交易请求。后续在思考是否使用[`工作窃取线程`](./concurrency.md)来优化线程池的性能发现，如果使用了工作窃取线程，可能存在主推消息的乱序处理。例如线程A完成部成状态的更新和推送，线程B完成了全成状态的更新和推送，可能在更新状态时，A先B后，从而两者校验逻辑均可以执行推送动作；但是推送时可能是B先A后，而我们的策略组件当前并不支持乱序处理，因而改造过程还需要设计发送重排的问题，比如将推送单独独立出一个队列，并对其中不合法的推送进行过滤删除，这大大加大了项目的维护难度（因为我们是多SDK的模块设计）。经过讨论，最终采用的是`one connection, one thread, multi clients`的模型设计。

一个`connection`和`worker`共同封装为一个`context`，每个客户在创建时就从对应的`ConextPool`中获取一个`context`;另外可能对应的Context还有一些`connection`注册回调，这里统一用`typename T`来完成。创建的ContextPool会根据实际的连接情况，动态调整线程池的大小。

```C++
# 设计说明：
# - 采用 one connection, one thread, multi clients 模型，以减少线程与连接资源消耗。
# - 为避免工作窃取带来的主推乱序问题，任务执行在同一工作线程内按到期时间有序调度。
# - 定时任务使用微秒精度，以“最早到期优先”的策略出队执行。
#include <chrono>
#include <functional>
#include <queue>

// 定时任务：根据“当前时间 + 预设延时”形成绝对到期时间用于优先队列排序
class ScheduledTask {
public:
    // expected_us_time 表示延时微秒，>0 时与 steady_clock 相加得到绝对到期时间。
    // steady_clock 单调递增，避免 system_clock 被用户调整造成时间跳变。
    // 真实工程建议使用 duration_cast 进行单位换算，此处为示意写法。
    ScheduledTask(std::function<void()> task = []() -> void {}, const size_t expected_us_time = 0) : _task(std::move(task)), _expected_us_time(expected_us_time) {
        if (expected_us_time > 0) {
            // system_clock反应的是系统真实时间，可能会被用户调整
            // steady_clock是单调递增的时钟，不会被系统影响，适合时间间隔
            // high_resolution_clock精度最高，需要高精度计时场景
            _expected_us_time += std::chrono::steady_clock::now().time_since_epoch().count() / 1000;
        }
    }
    ScheduledTask(const ScheduledTask &other) = default;
    ScheduledTask &operator=(const ScheduledTask &other) {
        if (this != &other) {
            _task = other._task;
            _expected_us_time = other._expected_us_time;
        }
    }
    ScheduledTask(ScheduledTask &&other) noexcept : _task(std::move(other._task)), _expected_us_time(other._expected_us_time) {}
    ScheduledTask &operator=(ScheduledTask &&other) noexcept {
        _task = std::move(other._task);
        _expected_us_time = other._expected_us_time;
        return *this;
    }

    ScheduledTask &operator=(ScheduledTask &&other) {
        if (this != &other) {
            _task = std::move(other._task);
            _expected_us_time = other._expected_us_time;
        }
        return *this;
    }

    void Run() {
        _task();
    }

    const size_t ExpectedUsTime() const {
        return _expected_us_time;
    }

    // 比较约定：到期时间更早（值更小）的任务应当排在前面
    bool operator<(const ScheduledTask &other) const {
        return _expected_us_time < other._expected_us_time;
    }

private:
    std::function<void()> _task;
    size_t _expected_us_time;
};


// TODO 当前队列需要外部加锁，因此仅实现在这里，后续无锁化后可以外部调用
class ScheduledTaskPriorityQueue {
public:
    ScheduledTaskPriorityQueue() = default;
    ~ScheduledTaskPriorityQueue() = default;
    void Push(const ScheduledTask &task) {
        _task_queue.push(task);
    }
    void Push(ScheduledTask &&task) {
        _task_queue.push(std::move(task));
    }
    ScheduledTask Pop() {
        // 伪代码提示：priority_queue 正确用法应为 top() 后再 pop()
        // auto t = _task_queue.top(); _task_queue.pop(); return t;
        ScheduledTask task;
        _task_queue.pop(task);
        return task;
    }
    bool Empty() const {
        return _task_queue.empty();
    }
private:
    // priority_queue 默认是“大顶堆”，通过 std::greater + operator< 形成“最早到期优先”的堆顶
    std::priority_queue<ScheduledTask, std::vector<ScheduledTask>, std::greater<ScheduledTask>> _task_queue;
};


# 并发队列说明：
# - 使用 moodycamel::BlockingConcurrentQueue 实现生产者-消费者队列，支持高并发入队与阻塞出队。
# - 由于不具备优先级能力，工作线程在出队后进行“未到期任务重投”，以保证到期前不执行。
#include <unorderded_map> // 伪代码演示：真实工程请使用 <unordered_map>
#include <vector>
// TODO 若切换到外部锁保护的 priority_queue 获取严格到期顺序，需要权衡锁开销与批处理策略。
using ScheduledThreadPoolQueue = moodycamel::BlockingConcurrentQueue<ScheduledTask>;

template<typename T>
class Context {
public:
    Context() = default;
    // 一个 Context = 一个连接 + 一个工作线程 + 一个队列，实现同线程内的多客户复用
    Context(std::shared_ptr<T> connection_ptr,  std::shared_ptr<std::thread> thread_ptr, std::shared_ptr<ScheduledThreadPoolQueue> queue_ptr)
        : _connection_ptr(std::move(connection_ptr)), _thread_ptr(std::move(thread_ptr)), _queue_ptr(std::move(queue_ptr)) {}
    ~Context() = default;

    bool AsyncRun(ScheduledTask &&task) const {
        // 如果队列满了会插入失败：此处采用 yield 自旋让出时间片
        // TODO 可优化为退避策略以降低高负载下的 CPU 占用
        while (!_queue_ptr->try_enqueue(task)) {
            std::this_thread::yield();
        }
        return true;
    }

    bool AsyncRun(std::function< void() > &&func, us_time_t expected_us_time = 0) const {
        // 将“函数 + 延时”封装为 ScheduledTask 入队，工作线程负责到期执行
        ScheduledTask task(func, expected_us_time);
        return AsyncRun(std::move(task));
    }

    // 具体的回调信息需要实现者填写，这样task的实现才通用
    std::shared_ptr<T> ConnectionPtr() const {
        return _connection_ptr;
    }

    private:
        std::string _key{};
        std::shared_ptr<std::thread> _thread_ptr{};
        std::shared_ptr<ScheduledThreadPoolQueue> _queue_ptr{};
        std::shared_ptr<T> _connection_ptr{};
}

template<typename T>
class ContextPool {
public:
    ~ContextPool() = default;

    void Init(size_t pool_size) {
        std::lock_guard<std::mutex> guard(_mtx);
        if (_inited) {
            return;
        }
        _pool_size = pool_size;
        for (size_t i = 0; i < _pool_size; ++i)
        {
            // 每个工作线程持有一个独立队列，避免跨线程乱序；后续可考虑将主推与交易请求分队
            auto queue_ptr = std::make_shared<ScheduledThreadPoolQueue>();
            auto worker = std::make_shared<std::thread>(std::thread[queue_ptr]() -> void {
                ScheduledTask task;
                while (true) {
                    // 判断过期时间：到期则执行，未到期则重投，维持时间顺序
                    while (queue_ptr.wait_dequeue_timed(task, std::chrono::milliseconds(50))) {
                        us_time_t current_time = std::chrono::steady_clock::now().time_since_epoch().count() / 1000;
                        if (task.ExpectedUsTime() <= current_time) {
                            task.Run();
                        } else {
                            queue_ptr.enqueue(std::move(task));
                        }
                    }
                }
            });
            // 连接指针由上层创建传入，此处仅演示 Context 的聚合关系
            _pool.push_back(std::make_shared<Context<T>>(connection_ptr, worker, queue_ptr));
        }
        _inited = true;
    }

    std::shared_ptr<Context<T>> Allocate(const std::string &key) {
        std::lock_guard<std::mutex> guard(_mtx);
        auto ptr = _key_to_index.find(key);
        if (ptr != _key_to_index.end()) {
            return _pool[ptr->second];
        }
        // 新 key 采用RR轮询分配到下一个 Context，保证负载均衡与简单性
        _key_to_index[key] = _pool_index;
        auto &context    = _pool[_pool_index];
        _pool_index = (_pool_index + 1) % _pool_size;
        return context;
    }

private:
    std::mutex _mtx{};
    std::unordered_map<std::string, size_t> _key_to_index{}; // key -> Context 索引映射，加速复用
    std::vector<std::shared_ptr<Context<T>>> _pool{};
    size_t _pool_size{};
    bool _inited{false};
}
```

以上为对应的 ContextPool 实现，包含初始化、分配与异步运行等功能。下面给出实际调用中的伪代码

```C++
// 以下为伪代码实现，非真实业务代码
ContextPool<Connection> context_pool;
context_pool.Init(4); // 初始化 4 个 Context

// 分配一个 Context 给 key1
auto context1 = context_pool.Allocate("key1");

context1->AsyncRun([callback = context1->ConnectionPtr()->Callback()]() -> void {
    // 根据回调函数执行相关的逻辑，或者还有其他的变量进行数值拷贝
    callback();
});
```

实际的效能问题，因为暂时未对Sdk有相关的Mock实现，后续会考虑添加相关的Mock实现，以验证ContextPool的修改效能，目前主要是进行的理论分析。
