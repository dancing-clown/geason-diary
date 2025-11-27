# Redis

由于Redis是互联网最最常见的组件，单单介绍Redis的数据结构就会超出个人总结篇幅，仅仅对项目中使用的Redis进行总结。

## 为什么人人都说Redis快？

参考[Redis 服务器概览](https://redis.io/learn/operate/redis-at-scale/talking-to-redis/redis-server-overview)，因为Redis的存储和操作数据的大部分操作均是在RAM完成而不是磁盘；并且单线程避免了CPU context switching和race condition。但是在6.0开始，Redis支持了多线程I/O从而提升了读写socket性能，可以将IO读写操作委托给另外的线程完成，从而提升了Redis的吞吐量。

虽然Redis大部分操作是内存中进行的，但是也是有持久化机制的，分别是RDB和AOF。RDB是fork进程，进行RDB快照，将内存中的数据完整备份到磁盘，主进程继续处理命令(类似于Mysql的redo log)。AOF是刷盘异步化（类似于Mysql的binlog），将AOF缓冲区的命令写入磁盘，这样主线程只需要写入缓冲区即可，从而达到只进行内存操作的目的。Redis重启时，通过RDB恢复内存，再用AOF重放最近的几条数据；因此每次做完RDB，理论来说AOF就会清零；没做RDB期间就是通过AOF来完成数据的持久化。

网络IO采用典型的Reactor模型（IO多路复用）：通过epoll\select等系统调用，单线程监听多个客户端的IO状态；一旦某个IO就绪，则通过回调机制立即处理数据。这里如果开启了6.0的特性，则会使用多线程并行处理耗时IO操作。Acceptor处理新建连接，给Reactor；Reactor监听到对应的IO读写或就绪，分别分配对应的事件给Dispatch；其中computer事件还是转发给主线程完成，从而保证计算是单线程执行，其他的read/decode/encode/write仍然是dispatch的组合线程完成。

数据结构的动态切换：Redis的五大基础数据结构（字符串\列表\哈希表\集合\有序集合）。

其底层数据由SDS/list/dict/zskiplist/ziplist实现。

```C
// Redis的String，又叫SDS(Simple Dynamic String)
struct sdshdr {
    // 记录buf中已使用字符数量
    int len;
    // 记录buf中未使用字节数量
    int free;
    // 字符数组
    char buf[];
};

// 双链表节点定义
typedef struct ListNode {
    struct ListNode *prev;
    struct ListNode *next;
    void *value;
}ListNode;

// list定义, 通过提供节点值设置类型特定函数，可保存不同类型的值
typedef struct list {
    // 表头节点
    ListNode *head;
    ListNode *tail;
    // 节点数
    unsgined long len;
    // 节点复制函数
    void *(*dup)(void *ptr);
    // 节点值释放函数
    void (*free)(void *ptr);
    // 节点值对比函数
    int (*match)(void *ptr, void *key);
}list;

// 哈希表节点
typedef struct dictEntry {
    void *key;
    union {
        void *val;
        uint64_t u64;
        int64_t s64;
    }v;
    // 指向下个哈希表节点，形成链表
    // 发生哈希冲突时使用
    struct dictEntry *next;
}dictEntry;

// Redis字典所使用的哈希表定义如下
typedef struct dictht {
    // 哈希表数组
    dictEntry **table;
    // 哈希表大小
    unsigned long size;
    // 哈希表大小掩码，用于计算索引值
    unsigned long sizemask;
    // 该哈希表已有节点的数量
    unsigned long used;
}dictht;

// dictType保存累用于操作特定类型键值对的函数
typedef struct dictType {
    // 计算哈希值函数
    uint64_t (*hashFunction)(const void *key);
    // 复制键函数
    void *(*keyDup)(void *privdata, const void *key);
    // 复制值函数
    void *(*valDup)(void *privdata, const void *obj);
    // 对比键函数
    int (*keyCompare)(void *privdata, const void *key1, const void *key2);
    // 销毁键函数
    void (*keyDestructor)(void *privdata, void *key);
    // 销毁值函数
    void (*valDestructor)(void *privdata, void *obj);
}dictType;

// 字典定义
typedef struct dict {
    // 类型特定函数
    dictType *type;
    // 私有数据
    void *prevdata;
    // 哈希表
    dictht ht[2];
    // rehash索引
    int trehashidx;
}dict;

// 以下是存入hash的整个过程的伪代码
hash = dict->type->hashFunction(key);
// 根据哈希表的sizemask属性，计算索引值
index = hash & dict->ht[x].sizemask;
dictEntry *entry = new DictEntry();
entry->key = key;
// 如果冲突，则使用链地址法(separate chaining)解决冲突
// 其他如开放定址（Open Addressing）,布谷鸟哈希（Cuckoo Hashing）
// 并且为了效率会讲新加入的元素放在表头
entry->next = dict->ht[x].table[index][0];
dict->ht[x].table[index][0] = entry;
// 为什么有多个ht，就是为了可以渐进式的哈希扩容或收缩
// 每次都是上一次大小的2倍或1/2，rehashidx=0表示开始rehash，每完成一次就会讲其值+1
// 当所有值完成rehash，则会将rehashidx=-1
// 可以避免大hash一次更新的卡顿问题

// 跳跃表(skiplist）常作为平衡树的平替
// 下面是跳跃表节点的定义
typedef struct zskiplistNode {
    // 层
    struct zskiplistLevel {
        // 前进节点
        struct zskiplistNode *forward;
        // 跨度
        unsigned int span;
    } level [];
    // 后退指针
    struct zskiplistNode *backward;
    // 分值
    double score;
    // 成员对象
    robj *obj;
} zskiplistNode;

// 跳跃表结构体
// 跳跃表本质是二分的空间换时间的做法
// 大致流程如下：
// 1.从最高level开始
// 2.比较当前节点的分数
// 3.如果当前节点分数目标分数，则继续往后
// 4.如果当前节点分数大雨目标分数，则进入下一层的开头
// 5. 重复 2-4，知道找到或已经是最后一层
typedef struct zskiplist {
    struct zskiplistNode *header, *tail;
    // 节点数
    unsigned long length;
    // 表中层数最大的节点的层数
    int level;
} zskiplist;

// 整数集合定义
typedef struct intset {
    // 保存元素的编码方式
    uint32_t encoding;
    // 保存元素的数量
    uint32_t length;
    // 保存元素的数组
    int8_t contents[];
};

// ziplist是列表键和哈希键实现

// 其他数据类型 诸如
// hyperloglog(UV统计)
// Stream(流类型) 
// Geo(地理位置类型)
```

## 我们在项目中是如何使用Redis

目前接入在项目中是使用Redis进行订单管理和用户信息缓存的。其中用户信息为读多写少的使用场景（用户每次登录需要校验是否发生终端信息变更或密钥更新，否则需要重新写入）；订单管理为写多读少的使用场景（订单创建后，每次推送会更新订单的状态或相应的成交信息字段，仅在程序异常复位时进行重新读取恢复应用程序内存）。

对于订单状态，我们使用的是HSET指令，通过传入特定的状态、成交价格、成交数量，避免单量过大时，更新速度编码；而恢复时使用的是HGETALL指令，重启可能往往会需要一定时间。

对于用户信息，当前是将所有用户信息存放在一个key中，重启时，通过HGETALL获取所有信息恢复到内存中，当前用户数量较少，获取完数据进行反序列化即可。

## 注意事项

避免使用`keys *`查询键值，因为redis的单线程模型，对于compute不是瓶颈的前提就是计算复杂度小，如果使用`keys *`，而子单数据量很大，会造成服务器卡顿，从而造成业务瓶颈。正确的做法是使用`scan`无阻塞地异步进行查看，可能需要查询端进行去重操作。

Redis的过期策略，有定量删除、定期删除随机删除、惰性删除。如果内存不足时，会根据配置策略进行数据淘汰。默认还是会使用no-enviction，那么对应的redis就需要进行异步接口返回的处理了。

- volatile-lru:已设置淘汰时间的最近最少使用删除；
- volatile-ttl：已设置淘汰时间的即将过期数据淘汰；
- volatile-random：已设置淘汰时间的随机淘汰；
- allkeys-lru: 从所有数据中最近最少使用删除；
- allkeys-random：从所有数据中随机删除；
- no-enviction：禁止驱逐数据，当内存不足时，直接返回错误。

缓存雪崩：缓存集体过滤，所有请求发送到数据库或其他后端服务不抗压直接挂掉。项目的key设置过期时间的时候，通常也会加入一个较小的随机值，这样做也是为了避免发生缓存雪崩。我们的项目因为交易时间固定，所以在交易时间段内是不会发生过期处理的；且没有数据库业务，因此不会有类似问题。

缓存穿透：发送了非法key，在缓存中绝对找不到，每次都将请求发送给数据库或其他后端服务导致。可以使用bf.exists判断是否存在；我们在单量较大时候也会用以过滤柜台主推回来的数据。

缓存击穿：热点数据过期导致的大量请求发送到数据库或其他后端服务。需要对热点数据进行定时更新，当前业务并不涉及。
