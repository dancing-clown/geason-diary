# C++

本文章主要收录一些比较有趣的C++问题和解法，加深对C/C++的理解

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

首先要知道虚表的大致内存布局；可以参考上述链接。

```C
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
d1.derive1 = 1;

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
    Derived d;
    d.interface();
}
```

这里再区分下static_cast和dynamic_cast的区别吧；总而言之就是dynamic_cast 有 RTTI 查表开销，但是可以保证多态场景下的转换正确（返回nullptr or bad_cast异常抛错），而static_cast用户保证，如果写错了会有ub行为。

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

实际会使用ADL在shared_ptr构造时为_weak_this赋值，具体可以参考对应C++标准，对应赋值逻辑判断逻辑可简化为如下代码：

```C++
if constexpr (std::is_base_of_v<enable_shared_from_this<_Tp>, _Tp>)
{
    auto __base = static_cast<enable_shared_from_this<_Tp>*>(__p);
    __base->_M_weak_this = *this;
}
```

既然说了虚函数表，还有虚基类表，其主要是解决菱形继承（钻石继承）的数据冗余、二义性问题，其存储的是偏移量数组。

## 内存分配

malloc: 申请指定字节数的内存。申请到的内存中的初始值不确定。

calloc: 为指定长度的对象，分配能容纳其指定个数的内存。申请到的内存的每一位（bit）都初始化为 0。

realloc: 更改以前分配的内存长度（增加或减少）。当增加长度时，可能需将以前分配区的内容移到另一个足够大的区域，而新增区域内的初始值则不确定。

alloca: 在栈上申请内存。程序在出栈的时候，会自动释放内存。但是需要注意的是，alloca 不具可移植性, 而且在没有传统堆栈的机器上很难实现。alloca 不宜使用在必须广泛移植的程序中。C99 中支持变长数组 (VLA)，可以用来替代 alloca。

new: 调用分配器分配一块内存，只存放 1 个 T 对象。调用 T::T() 构造 1 次。

new T []（数组）:编译器会额外分配一段头部内存，存放数组元素数量 count，用于 delete [] 时知道要调用多少次析构函数。

delete: 调用 1 次～T () 析构。将整块内存归还堆。

delete [] ptr（数组释放）:往 ptr 往前偏移，读出头部存储的元素数量 count。循环调用 count 次析构函数。释放整块内存（头部 + 所有元素）。

会有比较经典的问题：混用会造成哪些问题；哪种场景下混用没有问题？如果避免？

经典错误代码
```C++
char* create_buf(bool is_array) {
    if(is_array) return new char[128];
    else return new char;
}
// 调用方分不清，统一写 delete p; 混用出错

char* buffer = new char[1024];
delete buffer; // 写法错误，只是碰巧不崩溃

// 通常使用智能指针避免；但是遇到异步接口或C接口，需要传递裸指针的话，需要谨慎此部分写法
std::unique_ptr<string[]> arr = std::make_unique<string[]>(5);
```

既然说到了智能指针，这里展开提一下shared_ptr。

如果使用的是 shared_ptr<T>(new T),那么将会出现两块堆内存

1. 堆内存A: 你的业务对象T；

2. 堆内存B: 独立的控制块ControlBlock;

```markdown
栈上 shared_ptr
├─ T*        → 堆A(T对象)
└─ ControlBlock* → 堆B(控制块)

堆B 控制块结构：
[vptr] [atomic use_count] [atomic weak_count] [deleter] [allocator]

shared_ptr（栈）
├─ 裸指针 → T对象(堆)
└─ 控制块指针 → 堆控制块：
   ├ vptr
   ├ atomic use_count
   ├ atomic weak_count
   ├ deleter
   └ allocator
```

make_shared<T>(Args...) 合并分配（整块连续内存）

把 T 对象 + 控制块 分配在同一块连续堆内存中，只调用一次堆分配：

```markdown
整块堆内存布局：
[控制块区域][T 对象区域]
```

use_count、weak_count 完整销毁时序（最容易考）

设初始 use_count = 2，weak_count = 1

1. 第一个 shared_ptr 析构：use_count-- → 1，无事；

2. 第二个 shared_ptr 析构：use_count-- → 0
    执行 _M_dispose()：调用 T 的析构函数，销毁业务对象；
    此时控制块还保留，因为 weak_count=1；

3. 后续所有 weak_ptr 析构：weak_count--，直到 weak_count == 0；

4. 执行 _M_destroy()：释放整块控制块内存。

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