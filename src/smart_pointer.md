# 第六章 Rust/C++ 智能指针

智能指针是相对于普通指针，实现高级内存管理模式的一种工具，通常由原子计数和RAII共同实现。

## C++ 智能指针

对于笔者来说，C++ 的智能指针主要有`std::unique_ptr<T>`、`std::shared_ptr<T>`、`std::weak_ptr<T>`，分别对应了独占式智能指针、共享式智能指针、弱引用智能指针。其使用场景可以大概分为如下三类：

独占式智能指针：`std::unique_ptr<T>`，其指向的对象在任何时候只能有一个智能指针指向它，当智能指针被销毁时，其所指向的对象也会被销毁。通常用于通信，资源向下传递，上次函数调用不再使用，通常搭配`std::move`一起使用。

共享式智能指针：`std::shared_ptr<T>`，其指向的对象可以有多个智能指针指向它，当最后一个智能指针被销毁时，其所指向的对象也会被销毁。通常用于资源共享，例如多个线程共享同一份资源。配合`std::lock_guard<T>`等一起使用。

弱引用智能指针：`std::weak_ptr<T>`，其指向的对象可以有多个智能指针指向它，但是当最后一个智能指针被销毁时，其所指向的对象不会被销毁。通常用于解决循环引用问题，例如两个对象相互引用，导致它们的引用计数永远不会为0；还有就是线程循环执行时，收到的指针为weak_ptr，调用`lock()`升级为`std::shared_ptr<T>`时的指针有效性检查，若指针过期，则返回空指针，避免了空指针解引用的问题。

## Rust 智能指针

相较于C++，Rust的智能指针更多有`Box<T>`、`Rc<T>`、`Arc<T>`、`RefCell<T>`。下面对其进行表格归纳。

|类型|所有权|线程安全｜运行时开销｜使用场景｜
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

```rust,edition2024
use std::rc::Rc;

// 共享数据结构,例如二叉树，多叉树，节点通常需要被多个子节点引用，这个时候使用Rc<T>可以方便的共享数据节点而不是复制整个节点
struct Node {
    value: i32,
    children: Vec<Rc<Node>>,
}

fn main() {
    let leaf = Rc::new
}
```
