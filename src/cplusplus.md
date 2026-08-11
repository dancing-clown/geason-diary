# C++

本文章主要收录一些比较有趣的C++问题和解法，加深对C/C++的理解

## 面试题整理导航

本文的前半部分是原有的 C++ 原理笔记，后半部分按照公司题库中反复出现的知识关联重新整理。复习时建议沿着“对象模型 -> 生命周期 -> 容器与性能 -> 模板 -> 并发 -> ABI/工程实践”的顺序学习；每个主题都尽量从概念连接到面试题和工程追问。

- [一、对象模型与多态](#一对象模型与多态)
- [二、资源管理与对象生命周期](#二资源管理与对象生命周期)
- [三、STL 容器、值类别与性能](#三stl-容器值类别与性能)
- [四、模板与现代 C++](#四模板与现代-c)
- [五、并发与 C++ 内存模型](#五并发与-c-内存模型)
- [六、编译、链接、ABI 与 FFI](#六编译链接abi-与-ffi)
- [七、工程排障与低延迟实践](#七工程排障与低延迟实践)
- [八、复习时需要特别纠正的几个结论](#八复习时需要特别纠正的几个结论)
- [九、重点问题的原理拆解](#九重点问题的原理拆解)

### 如何使用这份整理

面试题不应只背结论。回答一个问题时，尽量按下面的顺序展开：

1. 先给出适用范围和核心结论。
2. 再解释语言规则、对象生命周期或内存模型为什么如此。
3. 最后说明工程中的选择、代价和如何验证。

题库中存在少量把实现细节当成标准保证的答案，下面以“标准语义优先、实现细节单独说明”为准。

## How would one write object-oriented code in C? [closed]

[原文链接](https://stackoverflow.com/questions/351733/how-would-one-write-object-oriented-code-in-c)

主要是需要用C实现C++的面向对象特性

封装：使用函数指针把属性与方法封装到结构体中

```C
typedef struct {
    int (*open)(void *self, char *fspec);
    int (*close)(void *self);
    int (*read)(void *self, void *buff, size_t max_sz, size_t *p_act_sz);
    int (*write)(void *self, void *buff, size_t max_sz, size_t *p_act_sz);
    // And data goes here.
} tCommClass;
```

继承：结构体嵌套，有了tCommClass，对应的类型实现可以有不同的实现

```C
static int tcpOpen(tCommClass *tcp, char *fspec) {
    printf ("Opening TCP: %s\n", fspec);
    return 0;
}
static int tcpInit(tCommClass *tcp) {
    tcp->open = &tcpOpen;
    return 0;
}

static int httpOpen(tCommClass *http, char *fspec) {
    printf ("Opening HTTP: %s\n", fspec);
    return 0;
}
static int httpInit(tCommClass *http) {
    http->open = &httpOpen;
    return 0;
}

```

多态：父类与子类方法的函数指针不同，对于我们实际使用的类型，可以通过指针访问

```C
int main (void) {
    int status;
    tCommClass commTcp, commHttp;
    // 两个子类
    tcpInit (&commTcp);
    httpInit (&commHttp);

    // 父指针指向 tcp
    tCommClass *commClass = &commTcp;
    status = (commClass->open)(&commTcp, "bigiron.box.com:5000");
    // 父指针指向http
    commClass = &commHttp;
    status = (commClass->open)(&commHttp, "http://www.microsoft.com");

    return 0;
}
```

## C++虚函数表实现机制以及用C语言对其进行的模拟实现

[原文链接](https://blog.twofei.com/496/)

首先要知道虚表的大致内存布局；可以参考上述链接。下面的结构体和赋值语句是用于说明一种常见 ABI 思路的伪代码，不是可移植的 C++ 实现，也不应直接复制编译。真实的虚表布局由编译器和 ABI 决定。

```text
struct CBase2
{
    int base2_1;
};

struct CBase1
{
    void** __vfptr;
    int base1_1;
};

struct CBase1_VFTable
{
    void(__stdcall* base1_fun1)(CBase1* that);
};

void __stdcall base1_fun1(CBase1* that)
{
    std::cout << "base1_fun1()" << std::endl;
};

struct CBase3
{
    void** __vfptr;
    int base3_1;
};

struct CBase3_VFTable
{
    void(__stdcall* base3_fun1)(CBase3* that);
};

void __stdcall base3_fun1(CBase3* that)
{
    std::cout << "base3_fun1()" << std::endl;
}

struct CDerive1
{
    CBase1 base1;
    CBase3 base3;
    CBase2 base2;

    int derive1_1;
};

struct CBase1_CDerive1_VFTable
{
    void (__stdcall* base1_fun1)(CBase1* that);
    void(__stdcall* derive1_fun1)(CDerive1* that);
};

struct CBase3_CDerive1_VFTable
{
    void(__stdcall* base3_fun1)(CDerive1* that);
};

void __stdcall base3_derive1_fun1(CDerive1* that)
{
    std::cout << "base3_derive1_fun1()" << std::endl;
}

void __stdcall derive1_fun1(CDerive1* that)
{
    std::cout << "derive1_fun1()" << std::endl;
}

// CBase1 的虚函数表
CBase1_VFTable __vftable_base1;
__vftable_base1.base1_fun1 = base1_fun1;

// CBase3 的虚函数表
CBase3_VFTable __vftable_base3;
__vftable_base3.base3_fun1 = base3_fun1;

// CDerive1 和 CBase1 共用的虚函数表
CBase1_CDerive1_VFTable __vftable_base1_derive1;
__vftable_base1_derive1.base1_fun1 = base1_fun1;
__vftable_base1_derive1.derive1_fun1 = derive1_fun1;

CBase3_CDerive1_VFTable __vftable_base3_derive1;
__vftable_base3_derive1.base3_fun1 = base3_derive1_fun1;

CDerive1 d1;
d1.derive1_1 = 1;

d1.base1.base1_1 = 11;
d1.base1.__vfptr = reinterpret_cast<void**>(&__vftable_base1_derive1);

d1.base2.base2_1 = 21;

d1.base3.base3_1 = 31;
d1.base3.__vfptr = reinterpret_cast<void**>(&__vftable_base3_derive1);

```

但是如果我们非要去调Base类的虚函数，应该怎么办呢？可以不虚表，直接用Base的地址进行访问即可。

```C++
class Base
{
public:
    virtual void func() { std::cout << "Base::func" << std::endl;}
};

class Derive : public Base {
    void func() { std::cout << "Derive::func" << std::endl; }
};

int main() {
    Derive d;
    Base &b = d;
    b.Base::func();
    return 0;
}
```

既然说到虚函数了，还可以使用CRTP（奇异递归模板模式）减少虚表带来的性能消耗。
缺点就是，像我们多个接入的时候，总会有依赖库冲突的，需要采用动态so加载，因此还是只能使用动态多态的方案;且 Base<DerviedA>和Base<DerivedB>是不同类型。

```C++
template<class Derived>
struct HandlerBase {
    void on_message() {
        static_cast<Derived*>(this)->handle();
    }
};

struct OrderHandler : HandlerBase<OrderHandler> {
    void handle() { /* 处理订单 */ }
};
struct DataHandler : HandlerBase<DataHandler> {
    void handle() { /* 处理行情 */ }
};

int main() {
    OrderHandler handler;
    handler.on_message();
}
```

这里再区分下 `static_cast` 和 `dynamic_cast`：`dynamic_cast` 需要多态基类和有效的运行时对象，在满足这些前提时会进行运行时检查，指针转换失败返回 `nullptr`，引用转换失败抛出 `std::bad_cast`。`static_cast` 的向下转换不做运行时检查，由程序员保证对象关系；关系不成立时继续使用转换结果可能触发未定义行为。

```C++
struct Base { virtual ~Base() = default; };
struct Der : Base {};

int main() {
Base* p = new Der;
Der* d1 = dynamic_cast<Der*>(p); // 运行时校验，安全
Der* d2 = static_cast<Der*>(p);  // 编译直接转，程序员保证p确实指向Der

Base* fake = new Base;
Der* err = static_cast<Der*>(fake); // 编译放行，运行访问Der成员直接UB
std::cout << "err is null?" << ((err == nullptr) ? "true" : "false") << std::endl;
Der* safe = dynamic_cast<Der*>(fake); // safe == nullptr
std::cout << "safe is null?" << ((safe == nullptr) ? "true" : "false") << std::endl;
return 0;
}
```

其中最经典的例子就是`std::enable_shared_from_this<T>`

```C++
template<class T>
class enable_shared_from_this {
protected:
    mutable weak_ptr<T> _weak_this;
public:
    shared_ptr<T> shared_from_this() {
        return _weak_this.lock();
    }
};

// 使用方式：派生把自身传给父模板
struct Foo : std::enable_shared_from_this<Foo> {
};

int main() {
    // 1. make_shared 创建 Foo 对象 + shared_ptr 控制块
    auto sp1 = std::make_shared<Foo>();

    // 2. 在 sp1 的构造阶段，已经自动执行：sp1->_weak_this = sp1
    // 3. 调用 shared_from_this，从内部弱指针复原 shared_ptr
    auto sp2 = sp1->shared_from_this();

    // sp1.use_count() == 2，正确
    return 0;
}
```

构造 `shared_ptr` 时，标准库会在满足条件时把对象关联到其可访问且无歧义的 `enable_shared_from_this<T>` 基类子对象。下面只是表达这个关系的伪代码；具体检测方式、成员名称和控制块实现都属于标准库实现细节，并不是 ADL 的固定要求：

```C++
if (has_accessible_unambiguous_enable_shared_from_this_base<T>)
{
    auto* base = get_enable_shared_from_this_base(__p);
    base->weak_this = *this;
}
```

既然说到了虚函数表，还有虚基类相关的实现信息。虚继承用于让菱形继承中的派生对象只保留一份共同虚基类子对象，并解决通过不同继承路径访问基类时的二义性；编译器通常需要额外的偏移或访问信息，但具体是否使用“虚基类表”、表的布局和字段都属于 ABI 实现细节。

## 内存分配

malloc: 申请指定字节数的内存。申请到的内存中的初始值不确定。

calloc: 为指定长度的对象，分配能容纳其指定个数的内存。申请到的内存的每一位（bit）都初始化为 0。

realloc: 更改以前分配的内存长度（增加或减少）。当增加长度时，可能需将以前分配区的内容移到另一个足够大的区域，而新增区域内的初始值则不确定。

alloca: 某些平台提供的非标准栈式分配接口，通常在当前函数返回时失效，不能把返回的地址交给调用方长期使用。它不可移植，也不应作为 C++ 的常规资源管理方式。C99 的 VLA 是 C 语言特性，不是标准 C++ 特性，且生命周期和语义不等同于 `alloca`；C++ 中应优先使用 `std::array`、`std::vector` 或其他 RAII 类型。

new: 调用分配函数取得足够存储，并对一个对象执行初始化；如果 `T` 是类类型，会调用相应构造函数，如果是标量类型，则遵循默认初始化或值初始化规则。

new T []（数组）: 对非平凡元素，运行时需要以某种实现方式记录元素数量，以便 `delete[]` 正确调用析构函数；常见实现会使用 array cookie，但标准不保证其存在、位置或布局。

delete: 调用 1 次～T () 析构。将整块内存归还堆。

delete [] ptr（数组释放）: 按实现记录的信息调用数组元素析构函数并释放对应存储；调用方不应假设需要向指针前方偏移，也不能依赖 array cookie 的具体布局。

会有比较经典的问题：混用会造成哪些问题；哪种场景下混用没有问题？如果避免？

经典错误代码
```C++
#include <memory>
#include <string>

char* create_buf(bool is_array) {
    if(is_array) return new char[128];
    else return new char;
}
// 调用方分不清，统一写 delete p; 混用出错

char* buffer = new char[1024];
delete buffer; // 写法错误，只是碰巧不崩溃

// 通常使用智能指针避免；但是遇到异步接口或C接口，需要传递裸指针的话，需要谨慎此部分写法
std::unique_ptr<std::string[]> arr = std::make_unique<std::string[]>(5);
```

既然说到了智能指针，这里展开提一下shared_ptr。

如果使用的是 shared_ptr<T>(new T),那么将会出现两块堆内存

1. 堆内存A: 你的业务对象T；

2. 堆内存B: 独立的控制块ControlBlock;

```markdown
栈上 shared_ptr
├─ T*        → 堆A(T对象)
└─ ControlBlock* → 堆B(控制块)

堆B 控制块结构（概念示意，具体布局由标准库实现决定）：
[strong_count] [weak_count] [deleter] [allocator]

shared_ptr（栈）
├─ 裸指针 → T对象(堆)
└─ 控制块指针 → 堆控制块：
   ├ strong_count
   ├ weak_count
   ├ deleter
   └ allocator
```

make_shared<T>(Args...) 合并分配（整块连续内存）

把 T 对象 + 控制块 分配在同一块连续堆内存中，只调用一次堆分配：

```markdown
整块堆内存布局：
[控制块区域][T 对象区域]
```

强引用和弱引用的销毁时序（概念模型；计数名称、是否额外持有隐式弱引用以及控制块函数名都属于实现细节）

设有两个 `shared_ptr` 和一个 `weak_ptr` 观察同一个对象：

1. 第一个 `shared_ptr` 析构：强引用数减一，对象仍然存活；

2. 第二个 `shared_ptr` 析构：强引用数变为零，调用删除器销毁业务对象；
    此时控制块仍然保留，因为还有 `weak_ptr`；

3. `weak_ptr` 析构后，弱引用数减少；

4. 当控制块不再被强引用或弱引用需要时，释放控制块内存。

## 限价订单簿设计

看下如下设计题。

```markdown
设计：限价订单簿
功能：
1.添加一个新的限价单
2.取消一个已有订单
3.查询当前的 bbo
3.匹配 (新的卖单价格 <= 新的买单价格 反之亦然)
需要考虑数据结构的设计和各自的算法复杂度优劣
```

伪代码如下。

```C++
enum class Side {
    Buy,
    Sell
};

// Order结构体设计
struct Order {
    uint64_t order_id;
    Side side;
    int64_t price_ticks;
    uint64_t remaining_qty;
    uint64_t sequence;
    Order* prev = nullptr;
    Order* next = nullptr;
    PriceLevel* level = nullptr;
};

struct PriceLevel {
    uint64_t total_qty = 0;

    Order* head = nullptr;
    Order* tail = nullptr;
};

class OrderBook {
private:
    std::map<int64_t, PriceLevel, std::greater<int64_t>> bids_;
    std::map<int64_t, PriceLevel, std::less<int64_t>> asks_;
    std::unordered_map<uint64_t, Order*> order_index_;
    uint64_t next_sequence_ = 1;

public:
    AddResult add_limit_order(
        uint64_t order_id,
        Side side,
        int64_t price_ticks,
        uint64_t quantity
    );

    bool cancel_order(uint64_t order_id) {
        order = order_idndex_.find(order_id);
        if (order->prev != nullptr) {
            order->prev->next = order->next;
        } else {
            order->level->head = order->next;
        }

        if (order->next != nullptr) {
            order->next->prev = order->prev;
        } else {
            order->level->tail = order->prev;
        }
        level.total_qty -= order.remaining_qty;
        delete order;
    }

    Bbo get_bbo() const;

    void match() {
        
    }
  };
```

## 一、对象模型与多态

### 1. 封装、继承和多态在 C++ 中如何实现

面向对象的三项能力可以分别理解为：

- **封装**：通过 `class` 的访问控制隐藏表示和实现细节，对外暴露稳定接口。
- **继承**：复用基类接口和实现，并建立基类子对象与派生类对象之间的类型关系。
- **运行时多态**：基类接口中包含 `virtual` 函数，通过基类指针或引用调用时，根据对象的动态类型选择最终函数。

典型的动态多态对象通常包含一个或多个虚表指针，虚函数调用大致经过“对象 -> 虚表 -> 函数地址”这条间接路径。虚表的具体布局、虚表指针的位置、RTTI 数据的位置都属于编译器和 ABI 实现细节，不应当当作 C++ 标准保证。多继承、虚继承会使对象中可能存在多个基类子对象和多个虚表指针，因此不能简单地认为对象只有一个虚表指针。

**面试题：为什么基类析构函数经常要声明为 `virtual`？**

当通过基类指针销毁派生类对象时，如果基类析构函数不是虚函数，`delete base_ptr` 的行为通常不能正确调用派生类析构函数，若派生类拥有资源就可能泄漏，甚至产生未定义行为。若类不打算作为多态基类，也可以把析构函数设为 `protected` 非虚，禁止通过基类指针删除。

```cpp
struct Base {
    virtual ~Base() = default;
};
struct Derived : Base {
    ~Derived() override { /* 释放 Derived 的资源 */ }
};
```

### 2. `static_cast`、`dynamic_cast` 和 CRTP

`static_cast<Derived*>(base)` 只做编译期允许的转换，不进行运行时类型检查；如果对象实际不是 `Derived`，后续访问可能触发未定义行为。`dynamic_cast` 需要多态基类，通过 RTTI 在运行时检查，指针转换失败返回 `nullptr`，引用转换失败抛出 `std::bad_cast`，代价是运行时检查和间接访问。

CRTP 是静态多态：

```cpp
template <class Derived>
struct HandlerBase {
    void on_message() {
        static_cast<Derived*>(this)->handle();
    }
};

struct OrderHandler : HandlerBase<OrderHandler> {
    void handle() {}
};
```

它可以消除虚调用并帮助编译器内联，但会产生不同模板实例、增加编译体积，并且不能自然地把运行时未知的多种类型放进同一个基类容器。插件、多券商动态加载等场景通常仍需要动态多态；类型集合固定时，也可以考虑 `std::variant` + `std::visit`。

## 二、资源管理与对象生命周期

### 1. RAII 是 C++ 资源安全的主线

RAII（Resource Acquisition Is Initialization）把资源的取得绑定到对象构造，把释放绑定到析构。资源不仅包括堆内存，还包括文件描述符、锁、socket、线程、映射区和 SDK 句柄。离开作用域时，即使发生异常，栈对象仍会按逆序析构，因此应优先使用标准库的作用域对象和智能指针。

### 2. `new/delete`、`new[]/delete[]` 的配对

`new T` 完成分配和构造一个对象，必须对应 `delete`；`new T[n]` 构造数组元素，必须对应 `delete[]`。混用属于未定义行为，即使元素是 `char` 或程序“碰巧没有崩溃”，也不能作为可移植的正确性依据。C 风格 `malloc/free` 与 C++ 的 `new/delete` 同样不能混用。

工程建议：

- 单个对象优先 `std::make_unique<T>` 或 `std::make_shared<T>`。
- 数组优先 `std::vector<T>`、`std::array<T, N>` 或 `std::unique_ptr<T[]>`。
- C API 返回的资源用带自定义删除器的 `unique_ptr` 封装。
- 只有在明确的 ABI、对象池或底层分配器边界上才直接操作裸指针，并写清所有权和释放方。

### 3. 三类智能指针如何选择

| 类型 | 所有权 | 常见用途 | 关键风险 |
| --- | --- | --- | --- |
| `unique_ptr<T>` | 独占 | 默认的堆对象所有权、向下转移 | 不可拷贝，需要 `std::move` |
| `shared_ptr<T>` | 共享 | 多个组件共同持有对象 | 循环引用、引用计数和控制块开销 |
| `weak_ptr<T>` | 不拥有 | 观察对象、打破循环引用 | 使用前必须 `lock()` 检查有效性 |

`unique_ptr` 通常只有一个裸指针大小；空删除器可以通过 EBO 或 `[[no_unique_address]]` 优化，但有状态删除器会增加对象大小。`shared_ptr<T>(new T)` 通常需要分别分配对象和控制块，`make_shared<T>` 通常可以合并分配，减少一次分配并改善局部性，但控制块仍可能因为 `weak_ptr` 存活而继续存在。

`shared_ptr` 的控制块引用计数支持多个 `shared_ptr` 实例并发增减，但这不等于被管理对象的成员访问线程安全，也不等于同一个 `shared_ptr` 变量可以被一个线程写、另一个线程读而不加同步。需要保护的是对象状态和 `shared_ptr` 变量本身。`enable_shared_from_this` 只能在对象已经被某个 `shared_ptr` 正确托管后使用，不能在裸 `new` 对象上直接安全地产生共享所有权。

## 三、STL 容器、值类别与性能

### 1. `vector` 的布局、扩容与迭代器失效

典型实现会保存三个指针或等价信息：当前元素起点、当前元素末尾、已分配存储末尾，也就是 `size` 和 `capacity`。扩容时申请更大的连续空间，移动或拷贝旧元素，再销毁旧元素并释放旧空间。

单次扩容是 `O(n)`，但如果容量按固定比例增长，连续插入 `n` 个元素的扩容总搬移量是几何级数，总成本为 `O(n)`，所以 `push_back` 的均摊复杂度为 `O(1)`，不是每一次操作都严格 `O(1)`。已知元素数量时使用 `reserve` 可以减少扩容；`resize` 改变元素数量，`reserve` 只改变容量。

扩容会使指向旧存储的迭代器、指针和引用失效；即使没有扩容，在中间位置插入或删除也可能使被移动元素的迭代器和引用失效。面试中要把“容量变化”和“元素移动”分开回答。

### 2. 移动语义和完美转发

左值有稳定身份，右值通常代表可被转移资源的临时对象。移动构造/移动赋值可以窃取缓冲区而不是深拷贝，但移动后对象必须仍处于有效、可析构的状态。移动操作若不应抛异常，通常声明 `noexcept`；例如 `vector` 扩容时会优先移动 `noexcept` 的元素，否则为保证异常安全可能选择拷贝。

转发引用 `T&&` 在模板参数推导场景下既可以绑定左值也可以绑定右值，配合 `std::forward<T>` 才能保留原始值类别。不要把所有参数都写成 `const T&`，否则会失去移动机会；也不要无条件 `std::move` 一个之后还要继续使用的对象。

### 3. 限价订单簿作为容器综合题

可以用按价格排序的 `std::map<price, PriceLevel>` 保存买卖盘，用每个价格层级的双向链表维护时间优先级，再用 `std::unordered_map<order_id, Order*>` 做撤单索引：

- 插入价格层级：`O(log P)`，同价位尾插为 `O(1)`。
- 按订单号撤单：哈希查找平均 `O(1)`，链表摘除 `O(1)`。
- 查询 BBO：买盘取最大价，卖盘取最小价。
- 撮合：遵循价格优先、时间优先；成交后同步更新订单索引、价格层级总量和空层级。

这里最容易追问的是所有权：订单节点由谁创建和释放？哈希表中的指针何时失效？如果需要低延迟，是否使用对象池、稳定地址容器或侵入式链表？这些问题比单纯写出两个 `map` 更关键。

## 四、模板与现代 C++

### 1. 三种 `auto` 语法不要混淆

- `void f(auto x)` 是 C++20 的 abbreviated function template，本质上会为不同参数类型生成不同模板实例，不是“一个普通函数在运行时改变参数类型”。
- `auto f(...)` 是函数返回值推导，编译器根据函数体中的 `return` 推导一个确定的返回类型；多个返回路径必须推导出兼容类型。
- `template<auto N> struct X` 是 C++17 的非类型模板参数类型推导，`N` 必须是满足规则的编译期常量。

如果需要保留返回表达式的引用属性，使用 `decltype(auto)`；普通 `auto` 返回值会丢弃顶层引用。模板参数推导、`decltype` 的值类别规则和 `std::forward` 是一条连续的知识链。

### 2. SFINAE、concept 和反射替代方案

C++ 没有标准化的通用运行时反射。常见方案包括手写元数据注册表、宏生成字段描述、模板元编程，以及使用 `__PRETTY_FUNCTION__`/`__FUNCSIG__` 的编译器扩展。扩展方案可用于枚举转字符串等工具，但依赖编译器格式，不能当作标准语言能力。

C++20 concept 更适合表达模板约束：

```cpp
template <typename T>
concept Drawable = requires(const T& value) {
    value.draw();
};

template <Drawable T>
void render(const T& value) {
    value.draw();
}
```

相比传统 SFINAE，concept 的约束更接近接口声明，错误信息通常也更易读。反射题还要说明复杂成员、访问权限、继承成员和运行时修改值时的元数据设计，而不只是列出一个宏。

## 五、并发与 C++ 内存模型

### 1. 锁和死锁

死锁通常需要同时满足互斥、持有并等待、不可抢占、循环等待四个条件。工程上最可靠的方式是统一锁顺序，或使用 `std::scoped_lock` 一次性获取多个互斥量；RAII 锁守卫可以避免异常路径忘记解锁。`timed_mutex` 可以用于超时和故障诊断，但超时本身不能证明系统不存在死锁。

排查应结合线程转储、锁依赖记录、`gdb` 调用栈、ThreadSanitizer 和线上指标。银行家算法是理论上的死锁避免方法，通常不是普通 C++ 服务的首选实现。

### 2. 原子性、可见性和内存序

`std::atomic<T>` 保证特定对象上的原子访问，但不自动让一组普通变量形成业务事务，也不自动解决对象生命周期问题：

- `relaxed`：只保证原子性，适合无同步依赖的计数器。
- `release`/`acquire`：建立发布-获取同步，用一个原子标志发布之前的普通写入。
- `acq_rel`：用于需要同时获取和发布语义的读改写操作。
- `seq_cst`：在顺序一致性模型下为所有顺序一致原子操作提供单一全局顺序，容易理解但可能有额外代价。

经典的“两个线程分别写 `x`、`y`，两个观察线程以相反顺序读取”可以说明为什么需要顺序一致性。但在交易系统中，`seq_cst` 不能凭空建立订单业务顺序：订单必须有单调序列号、单线程事件循环或明确的同步协议。一个原子变量被先写成 1 再写成 2，也不能让观察者可靠地知道中间发生了哪些事件。

### 3. `volatile`、无锁队列和缓存

`volatile` 主要用于内存映射寄存器、某些信号处理场景，禁止编译器把访问完全优化掉；它不保证原子性，不建立线程间 happens-before，也不能替代 `std::atomic`。无锁队列需要同时证明原子操作、内存回收、ABA 问题和生产者/消费者数量约束，不能只把 `mutex` 删除就称为无锁。

低延迟场景还要考虑连续内存、缓存局部性、缓存行伪共享、分配器和对象池。`alignas(std::hardware_destructive_interference_size)` 等手段只能解决特定布局问题，必须用基准测试确认收益。

### 4. ABA 问题：CAS 成功不代表状态仍然正确

ABA 是基于 CAS 的无锁算法中的一种状态判断错误。线程 A 读取共享状态为 `A` 后暂停；线程 B 把状态从 `A` 改成 `B`，完成操作后又改回 `A`；线程 A 恢复执行时，看到的值仍然是 `A`，于是 `compare_exchange` 成功。但这个 `A` 已经不是线程 A 之前观察到的那一个状态，中间发生的变化可能已经破坏了线程 A 依赖的链表关系、计数或对象生命周期。

以无锁栈为例：

```text
初始：head -> node A -> node B

线程 T1：读取 head=A，保存 next=B，然后暂停
线程 T2：弹出 A，再弹出 B，最后把 A 重新压回栈顶
现在：head=A，但 A 的 next 或关联状态可能已经变化
线程 T1：CAS(head, A, B) 成功
结果：T1 使用了过期的 next=B，可能跳过仍然有效的节点，甚至访问已经回收的节点
```

ABA 有两个相关但不同的风险：

- **逻辑 ABA**：地址或数值回到了原值，但中间的业务状态已经变化。即使对象尚未释放，也可能破坏链表、计数器或队列状态。
- **内存回收风险**：线程 T1 仍保存着旧指针时，线程 T2 已经删除并回收对象；分配器随后把同一地址复用给新对象，T1 看到的“相同地址”可能指向完全不同的对象。此时除了 ABA，还可能发生 use-after-free。

常见处理方案需要根据数据结构选择：

1. **指针加版本号（tagged pointer）**：CAS 不只比较指针，还比较版本号；每次状态变化都递增版本。即使指针从 `A` 变成 `B` 再回到 `A`，版本号也不同，旧 CAS 会失败。版本号位数有限时仍需考虑回绕。
2. **Hazard pointer**：线程在解引用节点前，把正在访问的节点发布到自己的 hazard pointer 中；删除方只有在确认没有线程保护该节点后才能回收。它主要解决安全回收，也能阻止地址复用造成的 ABA，但需要严格遵守“发布保护指针后重新检查”的流程。
3. **Epoch-based reclamation / RCU**：延迟节点回收，直到所有可能访问旧节点的线程离开对应 epoch。吞吐量较好，但线程长期不退出临界区会延迟回收并增加内存占用。
4. **有界环形队列的槽位序号**：每个槽位保存代数或序列号，生产者和消费者比较的是“槽位 + 当前代数”，而不只是一个裸指针。这是 bounded MPMC 队列常见的做法，但它是针对该队列布局设计的协议，不是所有无锁结构的通用修复。
5. **互斥锁或所有权模型**：如果无锁设计的证明和回收成本超过收益，使用锁、单线程事件循环或拥有明确生命周期的消息传递，往往更容易保证正确性。

仅改变 `memory_order` 不能消除 ABA；`acquire/release` 解决的是可见性和 happens-before，`seq_cst` 提供更强的原子操作顺序，但二者都不会自动记录对象版本，也不会替线程完成内存回收。`std::atomic<T*>` 只保证指针本身的原子读写，同样不负责指针指向对象的生命周期。

## 六、编译、链接、ABI 与 FFI

### 1. C++ ABI 为什么容易出问题

ABI 包括调用约定、符号修饰、对象布局、虚函数相关布局、异常处理、标准库类型布局等。C++ 标准保证源代码语义，不保证跨编译器、跨标准库、跨编译选项的二进制兼容。不要把 `extern "C"` 误解成“C++ ABI 稳定”：它主要关闭 C++ 名字修饰并使用 C 风格函数接口，不能直接安全地暴露任意 C++ 类、模板或 `std::string`。

GCC 的 dual ABI 是为了在升级 `libstdc++` 时兼顾旧二进制代码，主要涉及 `std::string`、`std::list` 等实现变化。混用 `_GLIBCXX_USE_CXX11_ABI`、编译器版本或标准库时，可能出现链接错误或更隐蔽的数据布局不一致。排查时要核对编译器、标准库、宏、编译选项和依赖库构建方式。

### 2. C++/Rust FFI 的边界

稳定的 FFI 边界应优先使用 C ABI 和显式所有权协议：固定宽度整数、`#[repr(C)]`/标准布局结构体、指针加长度、创建/释放函数成对出现。不要直接跨边界传递 `std::vector`、`std::string`、异常、含虚函数的对象或依赖编译器布局的复杂类。

需要回答清楚：

- 指针是否为空，谁拥有它，使用期限到哪里结束。
- 哪一侧分配，哪一侧释放，释放函数是否来自同一个运行库。
- 回调发生在哪个线程，异步回调期间对象是否仍然存活。
- 数据是借用还是转移所有权；零拷贝是否真的满足生命周期和并发约束。

在券商 SDK 或交易网关中，常见做法是在 C++ 适配层把私有结构映射成稳定的 POD 接口，把链表或 SDK 内部临时指针复制成连续缓冲区，再跨到 Rust；宁可有一次可量化的拷贝，也不要把悬空指针和非稳定 C++ 布局泄露到另一种语言。

## 七、工程排障与低延迟实践

### 1. CPU 或内存异常如何定位

先保留现场并区分 CPU、RSS、虚拟地址空间、文件映射和线程数，再逐层定位：

```bash
top -Hp <PID>
perf top -p <PID> -g
perf record -g -p <PID> sleep 10
perf report
gdb -p <PID>
(gdb) info threads
(gdb) thread <thread-id>
(gdb) bt full
```

开发和测试阶段配合 `-fsanitize=address,undefined,leak` 检查越界、释放后使用、未定义行为和泄漏；并发问题使用 ThreadSanitizer。工具结果要结合符号表、编译优化级别和复现用例解释，不能只贴一段 `top` 输出。

### 2. 动态数组和无锁队列题

手写动态数组需要覆盖：容量和大小的区分、扩容时的异常安全、拷贝构造、移动构造、拷贝/移动赋值、析构、越界检查、元素非平凡构造析构以及 `reserve`/`clear` 的语义。若元素类型不是平凡可复制类型，不能简单使用 `memcpy`；需要通过 allocator、placement new、移动构造和显式析构管理对象。

“实现类似 Go channel 的无锁队列”应先澄清单生产者/多生产者、是否有界、是否需要阻塞、是否允许丢弃、内存回收策略和关闭语义。一个可工作的 bounded MPMC 队列通常需要槽位序号、CAS、acquire/release 和安全回收；这是并发算法题，不应只给出 `std::queue` 加原子索引。

### 3. 交易系统中的设计回答框架

面对订单簿、交易网关或行情接入题，可以按以下顺序回答：数据结构和复杂度、所有权与生命周期、线程模型、异常与重连、延迟测量、压力测试、故障恢复。低延迟不是“所有地方都无锁”，而是减少不必要的共享状态、分配和拷贝，并通过端到端延迟拆解确认瓶颈。

## 八、复习时需要特别纠正的几个结论

1. `volatile` 不是线程同步原语；多线程通信使用原子变量或锁。
2. `shared_ptr` 的引用计数并发安全，不代表被管理对象的读写安全。
3. `seq_cst` 提供原子操作的全局顺序，不等于业务事件自动拥有全局顺序。
4. 虚表、虚指针和 `std::string` 的内部布局是实现/ABI 细节，不能直接跨编译器或 FFI 使用。
5. `new[]` 必须匹配 `delete[]`；“字符数组混用后没崩”仍然是未定义行为。
6. CRTP 能实现静态多态，但不能替代需要运行时扩展、插件或动态库隔离的动态多态。
## 九、重点问题的原理拆解

这一节专门回答“为什么”，用于把前面的题目从结论提升到可以推导的程度。

### 1. 为什么虚函数有运行时成本

非虚成员函数的目标通常在编译期确定；虚函数调用需要先从对象取得动态类型相关的虚表，再读取目标函数地址，因此多了一次或多次间接访问。它的实际成本还取决于虚表是否命中缓存、调用目标是否可预测，以及编译器是否能够去虚化。不能简单地把“虚函数一定很慢”当作结论：在网络、系统调用或缓存未命中主导的路径上，这个间接调用可能不是主要成本；在极短的热循环中才值得通过基准测试评估 CRTP、函数指针、`variant` 或数据布局优化。

虚函数表不是为了保存对象的全部状态，而是保存运行时多态所需的函数和相关 ABI 信息。对象仍然存放自己的非静态数据成员，派生对象还包含基类子对象。多继承时，转换到不同基类可能需要调整指针，这也是不能手写假定对象布局的原因。

### 2. 为什么 `shared_ptr` 需要控制块

`shared_ptr` 本身通常包含“对象指针”和“控制块指针”。控制块保存强引用计数、弱引用计数、删除器和分配器。复制 `shared_ptr` 只增加强引用计数；销毁最后一个强引用时销毁对象，但只要还有 `weak_ptr`，控制块仍不能释放。`weak_ptr::lock()` 是一个原子地检查强引用是否仍存在并尝试增加强引用的过程，避免“先检查、后构造”之间的竞态。

这也解释了几个常见追问：

- `make_shared` 通常减少一次分配，但一个大对象被 `weak_ptr` 长期观察时，控制块和对象所在的大块内存可能一起保留。
- 从同一个裸指针分别构造两个 `shared_ptr` 会产生两个控制块，最终可能重复释放，是错误的所有权建模。
- `shared_ptr` 只负责对象存活时间；对象内部状态仍需要锁、原子变量或线程封闭。

### 3. 为什么 `vector` 扩容后指针会失效

`vector` 要求元素连续存储。当旧容量不足时，它不能在原地址后面保证有连续空间，于是申请新缓冲区，把旧元素构造到新地址，再销毁旧元素。原来的元素地址因此全部失效；如果元素是非平凡类型，搬移过程还可能调用移动构造或拷贝构造。

扩容时的异常安全依赖元素类型：如果移动构造是 `noexcept`，实现可以放心移动；如果移动可能抛异常而拷贝可用，实现可能选择拷贝，以便保留原容器。对于手写动态数组，必须在新缓冲区全部构造成功后再提交新状态，否则异常会造成部分对象泄漏或双重析构。

### 4. 为什么 acquire/release 可以发布普通数据

生产者先写普通数据，再对原子标志执行 `store(..., release)`；消费者对同一标志执行 `load(..., acquire)` 并读到该值后，生产者在 release 前的写入就与消费者后续读取建立 happens-before。这里同步的是一整段发布前的内存操作，而不是只同步标志变量本身。

```cpp
struct Message {
    int value;
};

Message message;
std::atomic<bool> ready{false};

void producer() {
    message.value = 42;
    ready.store(true, std::memory_order_release);
}

void consumer() {
    while (!ready.load(std::memory_order_acquire)) {
    }
    // 读到 true 后，message.value 的写入已经被发布。
    assert(message.value == 42);
}
```

如果使用 `relaxed`，只能保证 `ready` 的原子读写，不保证消费者可以看到 `message.value` 的正确发布结果。另一方面，如果业务需要记录多个事件，单个布尔标志也不够，仍需要序列号、队列或锁来表达事件本身。

### 5. 为什么 FFI 更适合传递“指针 + 长度 + 释放函数”

跨语言边界时，双方必须对布局和生命周期有同一份定义。C++ 的 `std::string` 可能包含指针、长度、容量，`std::vector` 还涉及分配器和元素析构；这些都不是稳定的 C ABI 数据。使用固定宽度整数、明确对齐的结构体、裸指针和长度，可以把协议压缩成双方都能验证的内存契约。

一个完整的接口还要定义释放方向，例如 `create_buffer()` 由 C++ 分配、`destroy_buffer()` 必须由 C++ 释放；Rust 只在借用期间读取，或接管所有权后在 `Drop` 中调用释放函数。异步回调必须额外定义关闭顺序，否则即使数据布局正确，回调仍可能访问已经析构的对象。
