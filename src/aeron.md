# Aeron

## 背景

目前的技术架构，为减少程序耦合，采用了[`aeron-rs`](https://github.com/UnitedTraders/aeron-rs)进行跨进程间通信；其中采用其共享内存的机制。因为Aeron协议是设计直接跑多种传输介质的，包含了共享内存/IPC, infiniBand/RDMA,UDP,TCP,Raw IP,HTTP,WebSocket,BLE。因此Aeron基于以下假设：

- 传输介质可以是流媒体，例如 TCP 或 RDMA，而没有固有的帧边界。
- 传输介质可能仅具有单播模式。
- 长度为 16 位及以上的字段采用小端序。这主要是为了在对性能要求较高的平台上提高效率。由于字节被视为原子单位，因此无需考虑子字节序。

Aeron作为传输协议，可以在不可靠的介质上运行，作为OSI传输层（物理层/数据链路层/网络层/传输层/会话层/表示层/应用层）提供可靠的面向连接的数据流。因此必须接受一些额外的假设，Aeron会检测并纠正这些假设，例如：

- 可能会出现数据包重复的情况。
- 数据包可能会丢失。
- 包裹可能乱序送达。

因此，使用了基于日志的持久化存储，Publication和Subscription都基于内存映射文件。消息发送就可以追加到日志文件中，消费从日志文件中读取。类似于数据库的WAL的持久化保证。如果要追求极致的低延迟，还是需要显示配置允许丢消息（不发NAK消息，reliable=false）。

因此Aeron本身产生问题，通常和系统配置有关。常见排查步骤如下：

1.查看Aeron日志

2.查看空间状态`df -h /dev/shm`

3.检查系统参数`sysctl vm.max_map_count`和`ipcs -ls`

4.使用`aeron-stat`来诊断流状态和内部计数器。

## 高性能和高并发

核心思想：最大化顺序I/O,最小化竞争，零拷贝

每个Publication对应一个日志文件，只有一个写入者（线程）。因此可以完全无锁。且追加日志是最快的I/O模式而不是随机寻址。

零拷贝：共享内存+mmap+write。aeron通过共享内存和环形队列实现低延迟的数据传输。

## 性能数据实测

### 压测目的与总体思路

压测由 latency_pub.rs（发布端）与 latency_sub.rs（订阅端）配合完成，使用 Messaging 项目库基于 Aeron 验证消息端到端时延。
发布端以固定速率发送 Protobuf 消息，并在消息中携带发送时间戳。
订阅端在收到消息后取当前时间，与消息内时间戳相减得到单条消息端到端时延；随后统计平均值、最小/最大值以及多个百分位，并按时间顺序分组观测时延走势。

### 消息结构与时间戳携带方法

使用 protobuf 定义的 OrderInfo 作为负载。将纳秒级发送时间戳写入字段 strategy_order_id（i64）以便对端精确计算时延。
字节序列化与反序列化：

发布端：order.write_to_bytes()

订阅端：OrderInfo::parse_from_bytes(...)

发布端（latency_pub.rs）的压测逻辑

命令行参数：

dir_prefix: Aeron 共享内存目录

duration_secs: 运行时长秒数

rate_per_sec: 每秒发送条数

wait_secs: 启动后等待订阅端就绪的秒数

发送节奏控制：

计算总消息数 total_messages = duration_secs * rate_per_sec。

计算间隔 interval_ns = 1_000_000_000 / rate_per_sec。

发送过程：

每条消息生成发送时间戳（UNIX_EPOCH 纳秒），写入 strategy_order_id，序列化后发布。

订阅端（latency_sub.rs）的压测逻辑

命令行参数：

dir_prefix: Aeron 共享目录

total_messages: 计划接收的总条数

timeout_secs: 全局超时时间秒数

订阅与收包：

messaging.subscribe(topic, sender, stop) 将 Aeron 收到的二进制消息投递到内部crossbeam::channel。

订阅端以 recv_timeout(1s) 拉取消息；若超时则检查整体运行是否超过 timeout_secs，超时则退出并汇报已收条数。

时延计算：

收到消息时取当前纳秒时间 receive_time。

从消息中读出发送端写入的 send_time（strategy_order_id）。

计算单条时延：latency_ns = receive_time - send_time。
指标统计：

累计：总时延、最小/最大、保存全量单条时延数组以便后续排序求百分位。

平均时延：avg = total_latency / received_count。

百分位：对全量时延排序后取索引近似求 P50/P90/P95/P99/P99.9。

分组观测（时延随时间演化）：

将总消息按顺序均分为 NUM_GROUPS=20 组（最后一组可能不足整组）。

每组独立计算平均值与多个百分位，输出组号、消息范围与统计数据，便于观察阶段性变化。

压测结果：

在性能测试机器（当时暂未截取相关配置）上完成测试：

duration_secs 运行时长秒数 = 30

rate_per_sec 每秒发送条数 = 10000

如下图所示

![压测结果展示](images/stress_test.png)
