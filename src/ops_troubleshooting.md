# 运维定位

## top

实时监控CPU、内存、进程/线程的资源占用，快速定位“哪个进程/线程拖垮系统”（撮合引擎CPU打满、行情推送线程高占用）

top 指令，P按CPU排序；M按内存跑序，H显示所有CPU核，p聚焦指定PID

|字段|含义|异常判定|
|---|---|---|
|`CPU`|进程/线程CPU占用率|单线程长期≥90%（瓶颈）；多核整体≥80%（系统过载）|
|`VIRT/RSS`|虚拟内存/物理内存占用|RSS 持续增长（内存泄漏，如 Rust 未释放堆内存、C++ 内存泄漏）|
|`load average`|1/5/15 分钟系统负载（参考 CPU 核心数）|负载＞CPU 核心数（如 8 核负载＞8）系统繁忙|
|S（状态）|R（运行/S（睡眠/D（不可中断睡眠)|D 状态进程多→IO 阻塞（磁盘 / 网络卡住）|
|`PID`|TID 进程 ID / 线程 ID|结合 perf/strace 定位具体线程问题|

撮合引擎PID=12345的CPU=100% -> `top -Hp`找到TID -> perf 分析对应的热点函数。

结算进程RSS 1G 增至 10G -> 内存泄漏，结合strace是否频繁malloc后未free；测试环境我们常用valgrind进行内存泄漏检测；或者hook malloc delete进行内存泄漏检测。

## perf

perf 聚焦于CPU热点函数、指令执行、缓存命中、上下文切换。

|子命令|基础用法|交易所场景|
|---|---|---|
|`perf top`|`perf top -p PID -g`|实时查看进程的 CPU 热点函数（快速定位）|
|`perf record`|`perf record -p PID -g -o perf.data sleep 10`|采样 10 秒性能数据，生成详细报告|
|`perf report`|`perf report -i perf.data`|解析采样数据，按函数占比排序|
|`perf stat`|`perf stat ./match_order`|统计程序执行的性能指标（指令数、缓存命中）|

其中统计重点关注以下指标
cache-misses：缓存未命中数（交易所低延迟场景，需＜1%，否则优化数据布局）；
context-switches：上下文切换数（越多，线程调度开销越大）；
instructions/cycles：IPC 值（越高越好，＜1 说明 CPU 等待资源）。

## strace

strace主要用于跟踪程序的系统调用（read/write/socket/fork），定位 “程序卡在哪里”（交易所场景：文件 IO 阻塞、网络调用失败、系统调用耗时高、权限问题）。

|参数|作用|交易所场景|
|---|---|---|
|-tt|显示毫秒级时间戳|定位系统调用耗时（如 send () 耗时 100ms）|
|-e trace=xxx|过滤指定系统调用（network/file/process）|聚焦网络 / 文件 IO（减少输出量）|
|-p PID|跟踪指定进程|分析运行中的撮合引擎/行情服务|
|-c|统计系统调用的次数/耗时（汇总报告|找耗时最高的系统调用|
|-o log.log|输出到文件|离线分析|

比如定位行情推送延迟，可以使用

```bash
strace -tt -e trace=network -p 12345 -o strace_net.log
```

观察send和recv的耗时情况，是否经常`EAGAIN`。

## tcpdump

抓取网络数据包，分析协议、延迟、丢包、数据异常等问题。

|参数|作用|场景|
|-i eth0|指定网卡（eth0/lo/ens33）|抓取外网/内网数据包|
|-nn| 不解析域名/ 端口名（显示数字）更快，避免 DNS 解析开销|
|-s 0|抓取完整数据包（默认只抓 68 字节）|查看应用层完整数据（如订单参数）|
|-w dump.pcap|保存到文件（用 Wireshark 分析）|图形化分析，便于定位|
|-port 8888|过滤指定端口|抓取交易接口 / 行情端口数据包|
|-A|以 ASCII 显示数据包内容|查看应用层数据（如行情价格）|
|-vvv|详细输出（TCP 标志位、TTL）|分析 TCP 握手 / 重传|

最常用的还是抓取行情推送，看是否存在延迟问题。

## 实测场景

订单传输延迟 → 定位根因
strace -tt -e trace=network -p 12345 → 看send()耗时＞100ms；
tcpdump -i eth0 -nn port 8888 → 发现 TCP 重传频繁；
排查网络：检查带宽是否打满 / MTU 是否分片 → 调整网络拓扑（专线）
