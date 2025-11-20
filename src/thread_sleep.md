# 线程休眠

在实际的运行过程中，出现过使用condition_variable+mutex来做资源互斥，其中资源使用完毕归还后，会调用condition_variable的notify_one()来通知等待的线程。若等待的线程数很多，会出现某个线程运气很差，每次都等不到唤醒，从而一致拿不到对应的资源。

线程休眠是多线程编程中常见的同步或资源管理手段，常见的触发场景包括：

等待资源就绪：当线程需要的资源（锁\数据\外部设备）未准备好时，会进入休眠状态，避免无效的CPU占用。例如PC模型中，C线程等待P线程生成数据。注意，如果是自旋锁，就不存在等待资源就绪，相应的对应的cpu使用率就会比较高。

同步协作需求：多线程间需要按顺序执行时，某线程等待其他线程完成特定操作后再继续。例如：主线程等待子线程完成初始化后再发送任务。例如：主线程等待自线程完成初始化后再发送任务。

定时任务执行：线程需周期性执行任务时，两次执行之间会主动休眠指定时长。

C++ 支持线程休眠的函数包括`std::this_thread::sleep_for`,`std::condition_variable::wait`(本质是依赖互斥锁`std::mutex::lock`)，以及信号的`semaphore::wait`。需要更正的是，`std::this_thread::yield`不是休眠，而是将线程的执行权让给其他线程，从而避免线程饥饿。常和自旋锁，死循环搭配使用，如果不休眠，会造成CPU空转。

之前有问题的代码实现如下所示，需要C++20的concepts来限制T的类型。

```C++
#pragma once
#include <deque>
#include <mutex>
#include <condition_variable>
#include <concepts>
#include <atomic>
#include <optional>

// 模板代表一种字段，具体的T的限制
template<typename T>
concept ResourceType = requires(T t) {
    { t.IsAvailable() } -> std::same_as<bool>;
    { t.Release() } ->std::same_as<void>;
    { t.ConnectServer() } ->std::same_as<void>;
    { t.DoSomething() } ->std::same_as<int>;
};

template<ResourceType T>
class ResourcePool
{
public:
    template<typename... Args>
    ResourcePool(size_t pool_size, Args&&... args)
    {
        // 类型是size_t，不会小于0
        if (pool_size == 0)
        {
            pool_size = 50;
        }
        _pool_size = pool_size;
        // 根据对应的构造函数生成ResourceType的实例
        for (size_t i = 0; i < _pool_size; ++i)
        {
            _pool.emplace_back(std::forward<Args>(args)...);
        }
    }

    ~ResourcePool()
    {
        std::unique_lock<std::mutex> lock(_mutex);
        for (size_t i = 0; i < _pool.size(); ++i)
        {
            _pool[i].Release();
        }
    }

    void ConnectServer()
    {
        std::unique_lock<std::mutex> lock(_mutex);
        for (size_t i = 0; i < _pool.size(); ++i)
        {
            _pool[i].ConnectServer();
        }
    }

    bool IsAvailable()
    {
        std::unique_lock<std::mutex> lock(_mutex);
        for (size_t i = 0; i < _pool.size(); ++i)
        {
            if (_pool[i].IsAvailable())
            {
                return true;
            }
        }
        return false;
    }

    bool IsAllAvailable()
    {
        std::unique_lock<std::mutex> lock(_mutex);
        for (size_t i = 0; i < _pool.size(); ++i)
        {
            if (!_pool[i].IsAvailable())
            {
                return false;
            }
        }
        return true;
    }

    // -1表示没有对应资源或资源不可用，或主动退出
    int DoSomething()
    {
        for (size_t i = 0; i < _pool.size(); i++)
        {
            PoolGuard lock(this);
            if (!lock.ResourceOpt()) {
                continue;
            }
            T &resource = *lock.ResourceOpt();
            if (!resource.IsAvailable())
            {
                continue;
            }
            return resource.DoSomething();
        }
        return -1;
    }

private:
    void Stop()
    {
        _need_stop.store(true, std::memory_order_release);
        _condition_variable_pop.notify_all();
        _condition_variable_push.notify_all();
    }

    // 主动停止时，队列可能为空，则获取resource的opt为空
    // 负责一定是得到了resource才返回
    std::optional<T> GetResourceOpt()
    {
        std::unique_lock<std::mutex> lock(_mutex);
        _condition_variable_pop.wait(lock, [this] {
            return _need_stop.load(std::memory_order_acquire) || !_pool.empty();
        });

        if (_pool.empty()) {
            return std::nullopt;
        }
        T resource = std::move(_pool.front());
        _pool.pop_front();
        // 实际这里是可能出现问题的，因为这里是notify_one,随机唤醒一个线程
        // 而唤醒的线程可能会因为还没有释放_mutex，导致二次休眠；而不是判断不满足条件而进行的休眠
        // 形成无效唤醒，正确应该先执行 lock.unlock();
        // 代码参考 https://en.cppreference.com/w/cpp/thread/condition_variable/notify_one.html
        _condition_variable_push.notify_one();
        return std::optional<T>(std::move(resource));
    }

    void PutResource(T&& resource)
    {
        std::unique_lock<std::mutex> lock(_mutex);
        _condition_variable_push.wait(lock, [this] {
            return _need_stop.load(std::memory_order_acquire) || _pool.size() < _pool_size;
        });
        if (_need_stop.load(std::memory_order_acquire)) {
            return;
        }
        _pool.push_back(std::move(resource));
        _condition_variable_pop.notify_one();
    }

private:
    size_t _pool_size;
    // 存放资源的队列
    std::deque<T> _pool;
    // 保护_pool的互斥锁
    mutable std::mutex _mutex;
    // 当_pool为空时，等待资源的线程会阻塞在这个条件变量上并休眠
    std::condition_variable _condition_variable_pop;
    // 当_pool满时，等待资源的线程会阻塞在这个条件变量上并休眠
    std::condition_variable _condition_variable_push;
    // 停机标志
    std::atomic<bool> _need_stop{false};

    // 其实可以命名为对应的lock_guard,不过因为会获取对应的
    class PoolGuard
    {
    public:
        PoolGuard(ResourcePool<T>* pool)
        {
            _pool = pool;
            _opt = _pool->GetResourceOpt();
        }

        ~PoolGuard()
        {
            if (_opt) {
                _pool->PutResource(std::move(*_opt));
            }
        }
        std::optional<T>& ResourceOpt() { return _opt; }
    private:
        ResourcePool* _pool;
        std::optional<T> _opt;
    };
};
```

以上实现是通过mutex + condition_variable实现资源的获取和放回，使用condition_variable是为了没有获取到资源时可以通过阻塞休眠达到等待资源的效果。但是实际测试中发现即使非高并发场景，仍然会出现部分线程一直无法获取到资源的场景，导致部分请求处理超时。

```C++
#include <deque>
#include <mutex>
#include <optional>
#include <semaphore>

template<typename T>
concept ResourceType2 = requires(T t) {
    { t.IsAvailable() } -> std::same_as<bool>;
    { t.Release() } -> std::same_as<void>;
    { t.ConnectServer() } -> std::same_as<void>;
    { t.DoSomething() } -> std::same_as<int>;
};

template<ResourceType2 T>
class AtomicResourcePool
{
public:
    template<typename... Args>
    AtomicResourcePool(size_t n, Args&&... args) : _avail(0)
    {
        if (n == 0) n = 50;
        _pool_size = n;
        for (size_t i = 0; i < _pool_size; ++i) {
            _pool.emplace_back(std::forward<Args>(args)...);
        }
        // 释放50个信号
        _avail.release(_pool_size);
    }

    std::optional<T> Acquire()
    {
        for (size_t i = 0; i < _pool_size; ++i)
        {
            std::optional<T> opt = std::nullopt;
            _avail.acquire();
            {
                std::lock_guard<std::mutex> lock(_mtx);
                if (_pool.empty()) {
                    return opt;
                }
                opt = stq::optional<T>(std::move(_pool.front()));
                _pool.pop_front();
            }
            // 资源不可用，又要重新塞回去，同时释放对应资源
            if (!opt->IsAvailable()) {
                {
                    std::lock_guard<std::mutex> lock(_mtx);
                    _pool.push_back(std::move(*opt));
                }
                _avail.release();
                return std::nullopt;
            }
            return opt;
        }
        return std::nullopt;
    }

    void Release(T&& r)
    {
        {
            std::lock_guard<std::mutex> lock(_mtx);
            _pool.push_back(std::move(r));
        }
        _avail.release();
    }

    void ConnectServer()
    {
        std::unique_lock<std::mutex> lock(_mtx);
        for (auto &x : _pool) x.ConnectServer();
    }

private:
    size_t _pool_size{};
    std::deque<T> _pool;
    std::mutex _mtx;
    std::counting_semaphore<50> _avail;
};

template<ResourceType2 T>
class AtomicPoolGuard
{
public:
    explicit AtomicPoolGuard(AtomicResourcePool<T>* p) : _p(p)
    {
        _opt = _p->Acquire();
    }
    ~AtomicPoolGuard()
    {
        if (_opt) _p->Release(std::move(*_opt));
    }
    std::optional<T>& ResourceOpt() { return _opt; }
private:
    AtomicResourcePool<T>* _p;
    std::optional<T> _opt;
};

template<ResourceType2 T>
int DoSomething(AtomicResourcePool<T>& pool)
{
    AtomicPoolGuard<T> g(&pool);
    if (!g.ResourceOpt()) return -1;
    T &r = *g.ResourceOpt();
    if (!r.IsAvailable()) return -1;
    return r.DoSomething();
}
```

更加合适的方式还是应该参考线程池，使用原子队列；从handle中获取资源，检查资源是否可用，如果不可用，则放回到队尾；可用的话，使用完毕后，执行放回操作即可。

其实也可以改成最近最少使用资源，从而能够较快匹配到可用资源。
