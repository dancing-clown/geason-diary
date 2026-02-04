# 第六章 Rust/C++ 智能指针

智能指针是相对于普通指针，实现高级内存管理模式的一种工具，通常由原子计数和RAII共同实现。

## C++ 智能指针

对于笔者来说，C++ 的智能指针主要有`std::unique_ptr<T>`、`std::shared_ptr<T>`、`std::weak_ptr<T>`，分别对应了独占式智能指针、共享式智能指针、弱引用智能指针。其使用场景可以大概分为如下三类：

独占式智能指针：`std::unique_ptr<T>`，其指向的对象在任何时候只能有一个智能指针指向它，当智能指针被销毁时，其所指向的对象也会被销毁。通常用于通信，资源向下传递，上次函数调用不再使用，通常搭配`std::move`一起使用。

共享式智能指针：`std::shared_ptr<T>`，其指向的对象可以有多个智能指针指向它，当最后一个智能指针被销毁时，其所指向的对象也会被销毁。通常用于资源共享，例如多个线程共享同一份资源。配合`std::lock_guard<T>`等一起使用。

弱引用智能指针：`std::weak_ptr<T>`，其指向的对象可以有多个智能指针指向它，但是当最后一个智能指针被销毁时，其所指向的对象不会被销毁。通常用于解决循环引用问题，例如两个对象相互引用，导致它们的引用计数永远不会为0；还有就是线程循环执行时，收到的指针为weak_ptr，调用`lock()`升级为`std::shared_ptr<T>`时的指针有效性检查，若指针过期，则返回空指针，避免了空指针解引用的问题。

## Rust 智能指针

相较于C++，Rust的智能指针更多有`Box<T>`、`Rc<T>`、`Arc<T>`、`RefCell<T>`。下面对其进行表格归纳。

|类型|所有权|线程安全|运行时开销|使用场景|
|---|---|---|---|---|
|`&T`|借用|是|零|默认选择|
|`Box<T>`|独占|是|堆分配|递归类型|
|`Rc<T>`|共享|否|引用计数|单线程共享|
|`Arc<T>`|共享|是|原子计数|多线程共享|
|`RefCell<T>`|独占|否|运行时检查|内部可变性|

### `Box<T>`

```rust,edition2024
// 堆分配值
let b = Box::new(1);
println!("b = {}", b);

// 堆分配String
let x = Box::new(String::from("hello"));

let boxed = Box::new(2);
let value = *boxed + 2;
println!("value = {}", value);

// 递归类型使用
// 例：单链表实现
// ❌ 编译错误：无限大小
// enum List {
//     Cons(i32, List),
//     Nil,
//}

// ✅ 使用 Box 解决
enum List {
    Cons(i32, Box<List>),
    Nil,
}

impl std::fmt::Display for List {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            List::Cons(val, next) => {
                f.write_str(format!("Cons({}, {})", val, next).as_str())
            }
            List::Nil => {
                f.write_str("Nil")
            }
        }
    }
}

// 实现类似于C++的虚函数动态多态
// 暂没有方法支持C++的函数模板和函数重载的静态多态
trait Human {
    fn eat(&self) -> &str;
}

struct Vegetarian;
struct Meatatarian;

impl Human for Vegetarian {
    fn eat(&self) -> &str {
        "vegetable"
    }
}

impl Human for Meatatarian {
    fn eat(&self) -> &str {
        "meat"
    }
}


fn main() {
    let list = List::Cons(1, Box::new(List::Cons(2, Box::new(List::Nil))));
    println!("{}", list);
    let humans = vec![
        Box::new(Vegetarian),
        Box::new(Meatatarian),
    ];
    for human in humans {
        println!("{}", human.eat());
    }
}
```

### `Rc<T>`

单线程引用计数，实际编码中没有使用过。

```rust,edition2024
use std::rc::Rc;

// 共享数据结构,例如二叉树，多叉树，节点通常需要被多个子节点引用，这个时候使用Rc<T>可以方便的共享数据节点而不是复制整个节点
struct Node {
    value: i32,
    children: Vec<Rc<Node>>,
}

fn main() {
    let leaf = Rc::new(Node {
        value: 1,
        children: vec![],
    });
    let branch = Rc::new(Node {
        value: 2,
        children: vec![Rc::clone(&leaf)],
    });
}
```

### `RefCell<T>`

通过`UnsafeCell<T>` + 两个计数器(borrow_flag)用于记录当前是不可变借用还是可变借用，运行时检查计数是否为0；
冲突会panic以此来模拟编译期的借用检查。通常用于惰性缓存、内部状态机。

```rust,edition2024
use std::cell::RefCell;

fn main() {
    let data = RefCell::new(5);

    // 不可变借用
    let r1 = data1.borrow();
    let r2 = data2.borrow();
    println!("r1 = {}, r2 = {}", r1, r2);
    drop(r1);
    drop(r2);

    // 可变借用
    let mut r3 = data.borrow_mut();
    *r3 += 1;
    println!("r3 = {}", r3);
    drop(r3);

    let r4 = data.borrow();
    // ❌ 运行时panic
    // let r5 = data.borrow_mut(); // panic
    let r5 = data.try_borrow_mut();
    match r5 {
        Ok(mut r5) => {
            *r5 += 1;
            println!("r5 = {}", r5);
        }
        Err(_) => {
            println!("r5 borrow_mut failed");
        }
    }
}

```

## 如何选择

可以参考该图选择合适的智能指针。
![智能指针选择图](./images/decision_tree.png)
资料参考[Smart Pointers](https://doc.rust-lang.org/book/ch15-00-smart-pointers.html)

## 其他

### `Cow<T>`

作为Rust性能优化工具箱，`Cow<'a, T>`(Clone-on-Write写时复制)来优化可能需要被修改，但大部分情况下不需要修改，避免不必要的内存分配。存在两种状态：

Borrowed(&'a, T)：以不可变借用的形式持有数据。

Owned(T: Owned)：以拥有所有权的形式持有数据。

例如，我们需要一个函数，它接受一个字符串，移除其中所有不必要的空格。

如何输入是"hello world"，它没有任何不必要的空格，我们不应该执行任何分配，直接返回&str；

如果输入是" hello world ",它需要被修改，必须返回新的String来存储处理后的结果。

```rust
use std::borrow::Cow;
fn santitize_whitespace(input: &'static str) -> Cow<'static, str> {
    if input.starts_with(' ') || input.ends_with(' ') {
        // 需要修改，分配新的String, 然后返回Owned
        Cow::Owned(input.trim().to_string())
    } else {
        // 无需修改：零分配，直接返回Borrowed
        Cow::Borrowed(input)
    }
}
```

如果有明显的只读路径才使用；对于实现了Copy trait的类型，其实是没必要用`Cow<T>`的。主要用于避免String,Vec等拷贝产生的开销。

### `Pin<T>`

看了官网描述大致了解是解决自引用，细节参考[读懂 Pin，一次搞清 Rust 最难的指针](https://blog.csdn.net/taishanduba/article/details/154617263)。

`Pin<T>`的实现其实就是`!Unpin`类型，表示类型不能随意移动，少数类型(自引用, `Future`, `PhantomPinned`)就是`!Unpin`的。

例如SelfRef

```rust
struct SelfRef {
    data: String,
    ptr: *const String,
    _pin: PhantomPinned,
}

fn main() {
    let x = Box::new(42);
    let px = Pin::new(x);
    let moved_px = px;  // ✅ 可以移动

    let y = Box::pin(SelfRef {
        data: "hello".to_string(),
        ptr: std::ptr::null(),
        _pin: PhantomPinned,
    });
    // let move_y = y; // ❌ 编译告警
}
```

对于Unpin类型，即使使用了Box::pin也可以移动，但是!Unpin类型，被钉住了就无法搬。

那么为什么我们需要自引用呢？

方法访问和内部引用对比

```rust
struct MyStruct {
    data: String,
}
impl MyStruct {
    fn slice(&self) -> &str {
        &self.data
    }
}

struct SelfRef {
    data: String,
    slice: *const str, // 内部指针
}

impl SelfRef {
    fn new(data: &str) -> Self {
        let mut s = SelfRef {
            data: data.to_string(),
            slice: std::ptr::null(),
        };
        s.slice = s.data[0..2].as_ptr() as *const str;
        s
    }

    fn get_slice(&self) -> &str {
        unsafe {&*self.slice}
    }
}

fn main() {
    let s = MyStruct {data: "Hello World".into()};
    println!("{}", s.slice());
}
```

以上可以通过Rust borrow checker安全，没有悬挂、简单、可维护。但是每次调用都会生成一个切片，这在高性能/大量数据场景存在overhead。
而预切片的方式，访问时不需要每次切分，可用于异步/自引用结构，避免在Future状态机poll时重复生成切片。缺点就是使用裸指针，需要unsafe，跳过borrow checker的检查,存在悬挂风险。

总结如下：

- 当使用`async`时,Rust编译器会把它转成一个状态及struct，其字段包括局部变量、状态标记、可能的Waker等。
- 如果这个状态机在await之后还持有对自身结构体内部字段的引用，那么它就是一个自引用Future。也就是说，它存储了指向自身内容的引用。
- 若这种Future被移动，那么这些内部引用可能变成了悬挂指针。
- 因此，为了安全，Rust要求Future必须***先固定地址***,再被`poll`,所以`poll(self: Pin<&mut Self>, ...)`而不是`&mut Self`。
- 在`Pin<&mut Self>`的约束下，类型系统禁止你再偷偷将Self移动。只有当Self类型实现了`Unpin`时，才允许解除固定操作。

### `std::move`

将左值转换为右值引用，用于移动语义。

### `std::forward`

完美转发，用于将参数的右值属性传递给下一个函数。

关于智能指针，C++里会经常见到`std::move`, `std::forward`等操作。

### 引入规则

#### 规则1(引用折叠原则)：如果间接的创建一个引用的引用，则这些引用会折叠

- 一般情况下，引用折叠成一个普通的左值引用类型
  - `X& &`\ `X& &&`\ `X&& &` 转换为`X&`（带引用就是左值）
  - `X&& &&` 转换为`X&&`

#### 规则2(值类别转换原则)：当将一个左值传递给一个参数是右值引用的函数，且此右值引用指向模板类型参数(`T&&`)时，编译器推断该模板参数类型为实参的左值引用

```C++
template<typename T>
void f(T&&);
int i = 42;
f(i);
```

上述模板参数类型T推断为int&类型，而非int。

#### 规则3：可通过static_cast显示转换左值到右值

`move`函数就是将对应参数转为右值，标准库中`move`定义如下：

```C++
template<typename T>
// 根据规则2，可以接受左值和右值
typename remove_reference<T>::type &&move(T&& t) {
    // 如果是右值，则直接返回右值引用
    // 根据规则3，如果是左值，则通过static_cast转换为右值引用
    return static_cast<typename remove_reference<T>::type &&>(t);
}
```

`forward`又叫完美转发，因为在参数传递的时候，虽然传递是右值引用，但是函数入参会自动转换为左值引用，因此需要完美转发来保持参数的右值属性。标准库中`foward`（完美转发）实现如下：

```C++
template<typename _Tp>
    constexpr _Tp&&
    // 这里就是只接受左值引用
    forward(typename std::remove_reference<_Tp>::type& __t) noexcept
    // 左值引用&&推导最终还是左值
    { return static_cast<_Tp&&>(__t); }

template<typename _Tp>
    constexpr _Tp&&
    // 这里就只接受右值
    forward(typename std::remove_reference<_Tp>::type&& __t) noexcept
    {
        // 如果收到了左值，会编译期报错
        static_assert(!std::is_lvalue_reference<_Tp>::value, "template argument substituting _Tp is an lvalue reference type");
        return static_cast<_Tp&&>(__t);
    }

```
