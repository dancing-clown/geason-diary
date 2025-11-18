# 低延迟技术

低延迟技术通常应用于需要快速响应的场景，例如实时交易系统、游戏服务器等。下面从个人所接触的低延迟技术来进行大致介绍。

## 硬件

专用硬件：使用支持RDMA(远程直接内存访问)技术的网卡，如Infiniband或RoCE，可以绕过操作系统内核，直接在两台机器的内存间交换数据；SolarFlare网卡的Tcp direct技术：也是绕过内核协议栈，直接用户态传输，配置大页内存

## 操作系统与内核优化

内核旁路技术：像DPDK和PF_RING这样的技术，允许应用程序在用户空间直接处理网络数据包，避免了内核协议栈的处理开销和系统调用的上下文切换。内核旁路，用户空间轮询网卡。（比如我们的交易所主推）

线程绑定（CPU亲和性与隔离）：将关键进程或线程绑定到特定的CPU核心上，避免线程在核心间迁移带来的缓存实效和调度开销。（pthread_setaffinity_np）

## 应用编程

TCP socket配置优化：禁用Nagle：TCP_NODELAY，避免小包合并导致延迟尖锋；快速ACK,TCP_QUICKACK；区分服务等级：IP_TOS；适度缩小缓冲：SO_SNDBUF/SO_RCVBUF，减小排队；过小会丢包；低水位唤醒：SO_RCVLOWAT,尽快唤醒读取线程，降低端到端的等待；忙轮询：SO_BUSY_POLL,微秒级忙轮询网卡队列，降低唤醒/调度开销；SOCK_NONBLOCK，非阻塞。

UDP socket配置优化：SOCK_NONBLOCK, 非阻塞；区分服务等级：IP_TOS；适度缩小缓冲：SO_SNDBUF/SO_RCVBUF，减小排队；低水位唤醒：SO_RCVLOWAT,尽快唤醒读取线程，降低端到端的等待。

QUIC：暂未使用。

无等待发送：SOCK_NONBLOCK, 应用层不阻塞IO操作，将发送数据发送到缓存区后即返回，继续发送。

- 应用程序调用`send()`。如果内核缓冲区已满，函数回立即返回一个错误，而不是阻塞线程；
- 使用`epoll`这样的I/O多路复用器来监视这个套接字。当期可写时，epoll通知应用程序，应用程序再次调用`send`。

无锁数据结构：在多线程编程中，使用无锁队列(见[原子操作](./atomic.md))、环形缓冲区(见[数据结构](./data_structure.md))等，避免互斥锁带来的线程阻塞和上下文切换。

内存管理：预分配和复用内存对象，避免在关键路径上进行动态内存分配。可以使用大页内存设置，减少TLB miss。

高效序列化：使用Protobuf\FlatBuffers等高效的二进制序列化库，减少CPU处理和网络带宽占用。

共享内存：见[aeron](./aeron.md)相关介绍。

避免合并过大消息批、减少锁征用、固定线程和CPU亲和、使用零拷贝等。

### IO模式

BIO (Blocking I/O)：同步并阻塞模式。调用方发起IO操作时会阻塞，直到操作完成才能继续执行，适用于连接数较少的场景。

NIO (Non-blocking I/O)：将连接请求都注册到`select`多路复用器上，然后`select`会轮询这些连接，当查询到连接上有IO活动就进行处理。数据总是从通道读取到缓冲区或从缓冲区写入通道；`select`会监听多个通道上的事件（收到连接请求、数据到达等等），因此可以使用一个线程来监听多个客户端通道。

IO多路复用（I/O Multiplexing）：通过一个线程监听多个文件描述符上的事件，当其中任意一个文件描述符就绪时，就可以进行相应的IO操作。

- select:基于位图轮询所有fd，监控数量1024.

- poll:结构体数组代替位图，解决fd数量限制。

- epoll:通过epoll_create创建内核事件表，epoll_ctl动态管理fd, epoll_wait仅返回就绪事件，避免无效遍历；但是如果没有高并发效率可能并不一定优于select/poll。

epoll触发模式（内核回调）

- LT(电平触发)：fd缓冲区非空非满持续通知，方便确保数据完整性。(Nginx的acceptor)
- ET(边沿触发)：仅在缓冲区变化时通知一次，需一次性完成数据处理。无需频繁调用epoll_ctl。（nginx的reactor）

信号驱动IO模型（Signal-Driven I/O）：应用程序注册一个信号处理函数，当IO操作就绪时，发送一个信号通知应用程序。应用程序在信号处理函数中进行IO操作。目前仅在处理父子进程中用过此类模型。

AIO（Asynchronous I/O）:异步非阻塞模型，基于事件回调或Future机制。发起IO请求后，无需等待操作完成，可以执行其他任务。操作系统在IO操作完成后，通过回调或事件通知的方式告知调用方。

### 零拷贝技术

一般的IO操作分为三层：网卡层/内核层/应用层。

一次简单的read/write操作，read进行CPU上下文切换；DMA将数据从网卡层拷贝到内核缓冲区，CPU从内核缓冲区拷贝到用户缓冲区；CPU完成用户态的上下文切换。write进行CPU上下文切换，CPU将数据从用户缓冲区拷贝到socket缓冲区，DMA从socket缓冲区拷贝到网卡层。

而零拷贝技术就通过减少将数据buffer从一个内核区域拷贝到另一个内存区域，从而提高CPU效率。可以通过

- mmap+write：mmap将用户态缓冲区映射到内核态缓冲区，读取时减少了CPU从内核态缓冲区拷贝的过程；写入时仍然需要CPU将内核态缓冲区（等于用户态缓冲区）拷贝到socket，因此还是2次DMA+1次CPU拷贝，4次上下文切换。
- sendfile：sendfile不再有用户态缓冲区的概念，当然还是需要从内核态缓冲区拷贝到socket缓冲区，因此还是2次DMA+1次CPU拷贝，但只有2次上下文切换。
- 带有DMA收集拷贝功能的sendfile：用户进程调用`sendfile()`, DMA利用scatter将数据从硬盘拷贝到读缓冲区离散存储，CPU将读缓冲区的文件描述符和数据长度发送到socket缓冲区，DMA根据socket中的文件描述符和数据长度，使用scatter/gather将数据从内核缓冲区拷贝到网卡层。因此是2次上下文切换，2次DMA拷贝。

以上理解参考[零拷贝详解](https://cloud.tencent.com/developer/article/1922497)。

sendfile接口如下

```C
// out_fd: 为待写入内容的文件描述符，一个socket描述符。
// in_fd: 为待读出内容的文件描述符，必须是真实的文件，不能是socket和管道。
// offset: 指定从读入文件的哪个位置开始读。
// count: 指定为fdout和fdin之间传输的字节数。
ssize_t sendfile(int out_fd, int in_fd, off_t *offset, size_t count);
```
