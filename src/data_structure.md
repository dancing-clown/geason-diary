# 数据结构

## C++

C++ 标准库（参考《C++ Primer》第六版）围绕“容器 + 迭代器 + 算法 + 适配器”的组合式设计，强调抽象与效率的统一。

### 容器

- 序列容器：`vector`（动态数组，随机访问高效，尾部增删快）、`deque`（双端队列，头尾增删快）、`list`（双向链表，中间插删快，随机访问差）、`forward_list`（单向链表，极轻量）
- 关联容器（有序）：`map`/`multimap`、`set`/`multiset`（红黑树，按键有序，适合范围查询）
- 关联容器（无序）：`unordered_map`/`unordered_set`（哈希结构，平均 O(1) 查找与插入）
- 容器适配器：`stack`、`queue`、`priority_queue`（基于底层容器提供受限接口，`priority_queue` 默认最大堆）

### 迭代器

- 分类：输入/输出、前向、双向、随机访问；容器提供与其能力匹配的迭代器
- 迭代器失效：插入、删除或扩容可能导致指针与迭代器失效，`vector`/`string` 扩容尤需注意
- 范围与适配器：`begin/end`、`cbegin/cend`；插入迭代器（`back_inserter` 等）可与算法配合生成输出

### 算法

- 核心头文件：`<algorithm>`（遍历、查找、排序、变换）、`<numeric>`（`accumulate`、`inner_product` 等）
- 非成员算法与成员操作的配合：排序用 `sort`（需随机访问迭代器），去重常用 `sort + unique + erase`
- 可定制谓词：比较与过滤通过函数对象或 `lambda`；稳定排序用 `stable_sort`

```C++
#include <vector>
#include <algorithm>

// vector相关操作
std::vector<int> v{3,1,2,2,5};
// 不稳定排序，不关心内部的相对顺序
std::sort(v.begin(), v.end());
// 稳定排序，保证内部的相对顺序
std::stable_sort(v.begin(), v.end());
// 去重后删除，通常去重依赖前后元素，因此常在排序后进行
v.erase(std::unique(v.begin(), v.end()), v.end());
// 顺序查找，复杂度O(n)
auto it = std::find(v.begin(), v.end(), 3);
// 查找>=3的
auto lb = std::lower_bound(v.begin(), v.end(), 3);
// 查找>3的
auto ub = std::upper_bound(v.begin(), v.end(), 3);
// 二分查找，复杂度O(log(n))
bool ex = std::binary_search(v.begin(), v.end(), 3);

#include <deque>
// deque相关操作
std::deque<int> d{4,2,6,7,9,8};
// 排序
std::sort(d.begin(), d.end());
// 变换
std::transform(d.begin(), d.end(), d.begin(), [](int x){ return x*2; });
// 删除队首
d.pop_front();
// 删除队尾
d.pop_back();
// d.erase(std::remove_if(d.begin(), d.end(), pred), d.end());

#include <list>
// list操作
std::list<int> lst{3,1,2,2,5};
// 排序
lst.sort();
// 删除偶数
lst.remove_if([](int x){ return x % 2 == 0; });

#include <map>
// map操作
std::map<int, int> m{{1,10},{3,30},{5,50}};
auto it = m.find(3);
auto lb = m.lower_bound(2);
auto ub = m.upper_bound(4);

#include <unordered_map>
#include <string>
// unordered_map操作
std::unordered_map<std::string,int> um;
um.emplace("a",1);
auto it = um.find("a");
bool has = um.count("b") > 0;

#include <set>
// set操作
std::set<int> s{1,3,5};
s.insert(2);
auto lb = s.lower_bound(3);
auto ub = s.upper_bound(4);
bool has = s.count(2) == 1;

#include <queue>
// priority_queue操作
std::priority_queue<int> pq;
pq.push(3);
pq.push(1);
pq.push(5);
int t = pq.top();
pq.pop();

#include <numeric>

std::vector<int> a{1,2,3};
int sum = std::accumulate(a.begin(), a.end(), 0);

std::vector<std::pair<int,int>> p{{2,1},{2,0},{1,1}};
std::stable_sort(p.begin(), p.end(), [](auto &x, auto &y){ return x.first < y.first; });

#include <vector>

std::vector<int> b{1,2,3,4,5,6};
auto mid = std::stable_partition(b.begin(), b.end(), [](int x){ return x%2==0; });
```

### 比较与哈希

- 自定义排序：重载 `operator<` 或传入比较器；关联容器的键比较默认使用 `std::less`
- 自定义哈希：为 `unordered_*` 提供 `Hash` 与 `KeyEqual`；复合键建议自定义结构体并实现哈希

### 分配器与内存

- `allocator` 提供可定制的内存管理；一般情况下使用默认分配器即可
- `string`/`vector` 的容量策略：预留容量 `reserve` 可减少扩容次数，提升性能

### 复杂度与选择建议

- 随机访问频繁选 `vector`；频繁头尾增删选 `deque`；中间插删多选 `list`
- 有序查找与范围遍历选 `map/set`；高并发、键分布均匀选 `unordered_map/set`

### 常见操作复杂度（C++）

- `vector`：索引访问 O(1)；尾部 `push_back` 摊还 O(1)；中间插入/删除 O(n)；扩容搬移 O(n)
- `deque`：索引访问 O(1)；头尾插入/删除 O(1)；中间插入/删除 O(n)
- `list/forward_list`：迭代访问 O(n)；已知迭代器位置插入/删除 O(1)
- `map/set`：查找/插入/删除 O(log(n))；范围遍历 O(k + log(n))
- `unordered_map/set`：平均查找/插入/删除 O(1)，最坏 O(n)
- `priority_queue`：`top` O(1)；`push/pop` O(log(n))
- `sort`：O(nlo(n))；`stable_sort`：O(nlog(n))（额外内存）
- `lower_bound/upper_bound/binary_search`：O(log(n))（需有序范围或随机访问迭代器）

### 中间插入/删除函数（C++）

- `vector`：插入 `v.insert(pos, value)`；删除 `v.erase(pos)`（均需迭代器 `pos`）
- `deque`：插入 `d.insert(pos, value)`；删除 `d.erase(pos)`
- `list`：插入 `lst.insert(pos, value)`；删除 `lst.erase(pos)`；链表搬移 `lst.splice(pos, other, it)`
- `forward_list`：插入 `flst.insert_after(pos, value)`；删除 `flst.erase_after(pos)`（单向链表仅提供 after 语义）

## Rust

Rust 标准库集合（参考《Rust 圣经》/《The Rust Programming Language》）以“所有权 + 借用 + 安全并发”的语义为基础，容器设计强调内存安全与可预测性能。

### 集合类型

- 动态序列：`Vec<T>`（动态数组，随机访问高效）、`VecDeque<T>`（环形缓冲，头尾增删快）
- 链表与堆：`LinkedList<T>`（少用，随机访问差）、`BinaryHeap<T>`（优先队列，最大堆，`Reverse` 可得最小堆）
- 映射与集合：`HashMap<K, V>`/`HashSet<K>`（哈希，平均 O(1)）、`BTreeMap<K, V>`/`BTreeSet<K>`（有序，适合范围查询）
- 字符串：`String`（拥有堆内存）、`&str`（切片视图）

### 序列与迭代器

- 迭代器适配器：`map`、`filter`、`fold`、`collect` 等可组合形成“管道式”算法；零开销抽象，编译器可优化
- 切片与视图：`&[T]`/`&mut [T]`，避免拷贝；`chunks`/`windows` 提供高效分块与滑窗

### 排序与比较

- 通过 `Ord/PartialOrd` 实现比较；`sort`、`sort_by_key`、`sort_unstable` 等提供稳定与不稳定排序选择
- 哈希需求由 `Hash` trait 驱动；自定义键需实现 `Eq + Hash`

### 所有权与并发

- 所有权与借用保证容器内元素的生命周期安全；多线程需满足 `Send/Sync`
- 引用计数：`Rc/Arc`；内部可变性：`Cell/RefCell`（单线程）与 `Mutex/RwLock`（多线程）

### 性能与选择建议

- 大量随机访问选 `Vec`；头尾操作频繁选 `VecDeque`
- 需要优先队列选 `BinaryHeap`（或 `BinaryHeap<Reverse<T>>` 做最小堆）
- 有序键与范围遍历选 `BTreeMap/BTreeSet`；键分布均匀的哈希场景选 `HashMap/HashSet`

### 常见操作复杂度（Rust）

- `Vec<T>`：索引访问 O(1)；尾部 `push` 摊还 O(1)；中间插入`v.insert(index, value)`/删除`v.remove(index)` O(n)
- `VecDeque<T>`：头尾插入/删除 O(1)；索引访问 O(1)；中间插入`vd.insert(index, value)`/删除`vd.remove(index)` O(n)
- `LinkedList<T>`：迭代访问 O(n)；持有节点指针的插入`cursor.insert_after(value)`或`cursor.insert_before(value)`/删除`cursor.remove_current()` O(1)（`cursor`来自 `lst.cursor_front_mut()`/`cursor_back_mut()`）
- `BinaryHeap<T>`：`peek` O(1)；`push/pop` O(log(n))
- `HashMap/HashSet`：平均查找/插入/删除 O(1)，最坏 O(n)
- `BTreeMap/BTreeSet`：查找/插入/删除 O(log(n))；范围迭代 O(k + log(n))
- 迭代器链（`map/filter/fold`）：整体 O(n)；`collect` O(n)
- 排序：`slice::sort`/`sort_by_key` O(n log(n))；`sort_unstable` O(n log(n))，不稳定但常更快

### 中间插入/删除函数（Rust）

- `LinkedList<T>`：通过游标插入/删除：`cursor.insert_after(value)`、`cursor.insert_before(value)`、`cursor.remove_current()`（游标来自 `lst.cursor_front_mut()`/`cursor_back_mut()`）

## C++ vs Rust 对照要点

- 内存模型：C++ 依赖开发者约束迭代器与生命周期；Rust 通过所有权与借用在编译期保证安全
- 算法模型：C++ 更偏“算法与迭代器解耦”的函数式接口；Rust 以 `Iterator` 适配器链为主，表达力强且优化良好
- 优先队列：C++ `priority_queue` 默认最大堆；Rust `BinaryHeap` 同理，最小堆使用 `Reverse`
- 有序映射：C++ 默认红黑树；Rust 使用 B-Tree 结构，范围查询与缓存友好
- 无序映射：两者均为哈希表；C++ 可自定义哈希器；Rust 需实现 `Hash + Eq`

## 常用模式建议

- C++：排序去重用 `sort + unique + erase`；批量构造用 `reserve`；算法配合插入迭代器生成输出
- Rust：迭代器链替代临时容器；`collect` 到目标集合；必要时使用 `with_capacity` 预分配

## 参考实践

- 优先级任务队列：C++ 用 `priority_queue` 或自定义比较器；Rust 用 `BinaryHeap` 搭配 `Reverse`
- 范围查询：C++ 用 `map.lower_bound/upper_bound`；Rust 用 `BTreeMap.range`
- 批量计算：C++ 用 `<numeric>` 的 `accumulate/inner_product`；Rust 用 `iter.fold/sum` 等

## 经典算法LRU

Q：设计和构建一个"最近最少使用"缓存，该缓存会删除最近最少使用的项目。缓存应该从键映射到值，并在初始化时指定最大容量。当缓存被填满时，它应该删除最近最少使用的项目。

它应该支持以下操作：获取数据 get 和 写入数据 put。

获取数据`get(key)`-如果`key`存在于缓存中，获得关联的值总是为正，否则返回-1。

写入数据`put(key, value)`-如果不存在，则写入其数据值，当缓存容量达到上限时，它应该在写入新数据之前删除最近最少使用的数据，为新数据留出空间。

A：首先key-value对首选的数据存储对象应该是哈希表，因为这样可以在O(1)时间内进行查找判断和数据的删除了。

其次就是数据的更新，需要维护一个最近经常使用的有序集合，排在集合最前面的就是最不常使用的，最后的是经常使用的。由于get和put都会更新这个最近更新，需要在O(1)的时间内将元素从有序集合中删除并添加到最后面。首先想到的就是双向链表，因为链表的删除和添加都是O(1)的时间复杂度。

下面是C++实现

```C++
// 需要手动实现
struct DLinkedNode {
    int key, value;
    DLinkedNode* prev;
    DLinkedNode* next;
    DLinkedNode(): key(0), value(0), prev(nullptr), next(nullptr) {}
    DLinkedNode(int _key, int _value): key(_key), value(_value), prev(nullptr), next(nullptr) {}
};

class LRUCache {
private:
    unordered_map<int, DLinkedNode*> cache;
    DLinkedNode* head;
    DLinkedNode* tail;
    int size;
    int capacity;

public:
    LRUCache(int _capacity): capacity(_capacity), size(0) {
        // 使用伪头部和伪尾部节点
        head = new DLinkedNode();
        tail = new DLinkedNode();
        head->next = tail;
        tail->prev = head;
    }
    
    int get(int key) {
        if (!cache.count(key)) {
            return -1;
        }
        // 如果 key 存在，先通过哈希表定位，再移到头部
        DLinkedNode* node = cache[key];
        moveToHead(node);
        return node->value;
    }
    
    void put(int key, int value) {
        if (!cache.count(key)) {
            // 如果 key 不存在，创建一个新的节点
            DLinkedNode* node = new DLinkedNode(key, value);
            // 添加进哈希表
            cache[key] = node;
            // 添加至双向链表的头部
            addToHead(node);
            ++size;
            if (size > capacity) {
                // 如果超出容量，删除双向链表的尾部节点
                DLinkedNode* removed = removeTail();
                // 删除哈希表中对应的项
                cache.erase(removed->key);
                // 防止内存泄漏
                delete removed;
                --size;
            }
        }
        else {
            // 如果 key 存在，先通过哈希表定位，再修改 value，并移到头部
            DLinkedNode* node = cache[key];
            node->value = value;
            moveToHead(node);
        }
    }

    // 添加节点到头部
    void addToHead(DLinkedNode* node) {
        node->prev = head;
        node->next = head->next;
        head->next->prev = node;
        head->next = node;
    }

    // 移除某个节点
    void removeNode(DLinkedNode* node) {
        node->prev->next = node->next;
        node->next->prev = node->prev;
    }

    // 将某个节点移动到头部,最近使用
    void moveToHead(DLinkedNode* node) {
        removeNode(node);
        addToHead(node);
    }

    // 删除最近不使用
    DLinkedNode* removeTail() {
        DLinkedNode* node = tail->prev;
        removeNode(node);
        return node;
    }
};
```

下面是Rust实现

```rust,edition2024
use std::rc::Rc;
use std::cell::RefCell;
use std::collections::HashMap;
struct ListNode {
    key: i32,
    value: i32,
    prev: Option<Rc<RefCell<ListNode>>>,
    next: Option<Rc<RefCell<ListNode>>>,
}

impl ListNode {
    fn new(key: i32, val: i32) -> Self {
        Self {
            key,
            value: val,
            prev: None,
            next: None,
        }
    }
}

struct List {
    head: Option<Rc<RefCell<ListNode>>>,
    tail: Option<Rc<RefCell<ListNode>>>,
}

impl List {
    fn new() -> Self {
        // dumpy head and tail
        let head = Some(Rc::new(RefCell::new(ListNode::new(0, 0))));
        let tail = Some(Rc::new(RefCell::new(ListNode::new(0, 0))));
        // 先形成初始化的双链表
        head.as_ref().unwrap().borrow_mut().next = tail.clone();
        tail.as_ref().unwrap().borrow_mut().prev = head.clone();
        Self { head, tail }
    }

    fn push_front(&mut self, node: Rc<RefCell<ListNode>>) {
        let head = self.head.as_ref().unwrap().clone();
        let head_next = head.next();
        node.borrow_mut().prev = Some(head.clone());
        node.borrow_mut().next = head_next;
        head.borrow_mut().next = Some(node.clone());
        head_next.borrow_mut().prev = Some(node.clone());
    }

    fn pop_back(&self) -> Option<Rc<RefCell<ListNode>>> {
        let tail = self.tail.as_ref().unwrap().clone();
        let poped = self.tail.as_ref().unwrap().prev;
        let tail_prev = poped.as_ref().unwrap().prev.clone();
        tail_prev.as_ref().unwrap().borrow_mut().next = tail.clone();
        tail.as_ref().unwrap().borrow_mut().prev = tail_prev;
        poped
    }

    fn move_to_front(&self, node: Option<Rc<RefCell<ListNode>>>) {
        if let Some(n) = node {
            let prev = n.borrow().prev.as_ref().unwrap().clone();
            let next = n.borrow().next.as_ref().unwrap().clone();
            prev.borrow_mut().next = next.clone();
            next.borrow_mut().prev = prev.clone();
            self.push_front(Some(n));
        }
    }
}

struct LRUCache {
    cache: HashMap<i32, Rc<RefCell<ListNode>>>,
    list: List,
    capacity: i32,
    size: i32,
}

impl LRUCache {
    fn new(capacity: i32) -> Self {
        Self {
            cache: HashMap::new(),
            list: List::new(),
            capacity,
            size: 0,
        }
    }

    fn get(&mut self, key: i32) -> i32 {
        if let Some(node) = self.cache.get(&key) {
            self.list.move_to_front(Some(node.clone()));
            node.borrow().value
        }
        -1
    }

    fn put(&mut self, key: i32, value: i32) {
        if let Some(node) = self.cache.get(&key) {
            node.borrow_mut().value = value;
            self.list.move_to_front(Some(node.clone()));
        } else {
            let node = Rc::new(RefCell::new(ListNode::new(key, value)));
            self.cache.insert(key, node.clone());
            self.list.push_front(node);
            self.size += 1;
            if self.size > self.capacity {
                if let Some(poped) = self.list.pop_back() {
                    self.cache.remove(&poped.borrow().key);
                    self.size -= 1;
                }
            }
        }
    }
}

```

## 环形缓冲区 RingBuffer

环形队列优势在于可以使用固定的连续空间大小，内存复用。

写数据：从 tail 开始写入，更新 tail。

读数据：从 head 开始读取，更新 head。

优势：连续内存，读写效率高，无内存碎片。

局限：大小固定，动态扩容成本高（需拷贝数据）。

下面给出C++实现版本。

```C++
#include <iostream>
#include <vector>
#include <stdexcept>

template<typename T>
class RingBuffer {
private:
    std::vector<T> buffer;
    size_t head;    // 指向缓冲区中下一个要读取的位置
    size_t tail;    // 指向缓冲区中下一个要写入的位置
    size_t capacity;    // 缓冲区的容量
public:
    RingBuffer(size_t size) : capacity(size), head(0), tail(0) {
        buffer.resize(size);
    }

    // 判断缓冲区是否为空
    bool Empty() const {
        return head == tail;
    }

    bool Full() const {
        return (tail + 1) % capacity == head;
    }

    void Push(const T& value) {
        if (Full()) {
            throw std::overflow_error("RingBuffer is full");
        }
        buffer[tail] = value;
        tail = (tail + 1) % capacity;   // 更新尾指针，实现环状结构
    }

    T Pop() {
        if (Empty()) {
            throw std::underflow_error("RingBuffer is empty");
        }
        T value = buffer[head];
        head = (head + 1) % capacity;   // 更新头指针，实现环状结构
        return value;
    }
};

int main() {
    RingBuffer<int> rb(3);
    rb.Push(1);
    rb.Push(2);
    rb.Push(3);
    std::cout << rb.Pop() << std::endl;
    std::cout << rb.Pop() << std::endl;
    std::cout << rb.Pop() << std::endl;
}
```

Rust实现版本如下，rust的`VecDeque`本身就是环形缓冲区的实现。以下仅做封装和禁用扩容，使其满足我们最初对RingBuffer的定义。

```rust,edition2024
struct RingBuffer<T> {
    buffer: VecDeque<T>,
    capacity: usize,
}
impl<T> RingBuffer<T> {
    fn new(capacity: usize) -> Self {
        Self {
            buffer: VecDeque::with_capacity(capacity),
            capacity,
        }
    }

    pub fn push(&mut self, value: T) {
        if self.buffer.len() == self.capacity {
            return;
        }
        self.buffer.push_back(value);
    }

    pub fn pop(&mut self) -> Option<T> {
        if self.buffer.is_empty() {
            return None;
        }
        self.buffer.pop_front()
    }

    pub fn is_empty(&self) -> bool {
        self.buffer.is_empty()
    }

    pub fn is_full(&self) -> bool {
        self.buffer.len() == self.capacity
    }
}

fn main() {
    let mut ring_buffer = RingBuffer::new(3);
    ring_buffer.push_back(1);
    ring_buffer.push_back(2);
    ring_buffer.push_back(3);
    println!("{:?}", ring_buffer.pop_front());
    println!("{:?}", ring_buffer.pop_front());
    println!("{:?}", ring_buffer.pop_front());
}
```

## 链式缓冲区 ChainBuffer

ChainBuffer由多个不连续的内存块(Chunk)通过链表连接而成，支持动态扩容，适合数据大小不确定的场景。

核心结构：用链表存储多个`Chunk`,通过`read_pos`和`write_pos`标记当前读写位置。

TODO: 待实现
