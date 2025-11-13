# FFI

当前对接很多外部sdk时，均使用C++接口编写，如果Rust调用或向C/C++注册回调，需要使用FFI来进行交互。而涉及到FFI。

## Unsafe

为了能够实现外部调用，Rust提供了[`unsafe`](file:///Users/gaoyicheng/.rustup/toolchains/nightly-aarch64-apple-darwin/share/doc/rust/html/book/ch20-01-unsafe-rust.html)关键字，用于标记可能会有内存访问问题的代码块。unsafe具有如下能力:

- 解引用裸指针
- 调用unsafe函数方法
- 访问或修改可变静态变量
- 实现unsafe trait
- 访问`union`字段

Rust在创建裸指针是安全的，例如如下代码:

```rust,edition2024
let mut num = 5;

let r1 = &raw const num;
// 可变和不可变共存
let r2 = &raw mut num;

// 裸指针解引用
unsafe {
    println!("r1 is: {}", *r1);
    println!("r2 is: {}", *r2);
}
```

而我们用的最多的就是调用unsafe代码块来调用C++代码；如果想要C/C++调用rust的代码，还需要使用`extern "C"`来声明函数签名和`#[unsafe(no_mangle)]`防止命名混淆，例如如下代码:

```rust,edition2024
use std::os::raw::c_int;

#[unsafe(no_mangle)]
pub extern "C" fn call_from_c() {
    println!("Just called a Rust function from C!");
}

extern "C" {
    fn add(a: c_int, b: c_int) -> c_int;
}

fn main() {
    let a = 5;
    let b = 10;

    // 调用C++代码
    let result = unsafe { add(a, b) };

    println!("Result: {}", result);
}
```

如果也希望Rust检查unsafe代码，可以使用`Miri`进行检查。

另外，对于C/C++调用Rust代码，更多的是需要在对应回调函数中使用相应函数，可以使用`bindgen`对C代码接口生成相应的Rust接口binding.rs,然后填写对应的参数。

对应C++的回调函数如下。

```C++
typedef int32_t (*callback_t)(int32_t);
void add_callback(callback_t callback);
```


```Rust,edition20424
pub type CALLBACK_T = std::option::Option<
    unsafe extern "C" fn(a: i32) -> i32
>;

unsafe extern "C" {
    pub fn add_callback(callback: CALLBACK_T);
}
// 实现
pub unsafe extern "C" fn callback_impl(a_impl: i32) -> i32 {
    a_impl + 1
}

int main() {
    add_callback(Some(callback_impl));
}
```
