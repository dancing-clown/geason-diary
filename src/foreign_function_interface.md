# FFI

当前对接很多外部sdk时，均使用C++接口编写，如果Rust调用或向C/C++注册回调，需要使用FFI来进行交互。而涉及到FFI。

## Unsafe

为了能够实现外部调用，Rust提供了[`unsafe`](https://doc.rust-lang.org/book/ch20-01-unsafe-rust.html)关键字，用于标记可能会有内存访问问题的代码块。unsafe具有如下能力:

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

## 生产应用

目前以OES SDK封装和CTP SDK封装为例，对实际生产封装对应的FFI接口实践进行介绍。

### OesApiWrapper(C封装)

目前的整体想法是，先将对应的wrapper，联合对应发布件，组织成一个crate进行发布，这里参考实现的是[rdkafka](https://github.com/fede1024/rust-rdkafka)的实现方式，将对应的c接口函数封装为`rdkafka-sys`，然后再基于该crate实现无unsafe的函数方法。

[oes_api_wrapper](http://code.non-convex.com:18118/gateway/counter_sdk_swapper/oes_api_wrapper)对应的SDK也是C接口，所以这里实现主要是将对应头文件生成对应的bindings.rs即可。

大致的目录结构如下

```bash
.
├── Cargo.lock
├── Cargo.toml
├── ci
├── oes_api_client
├── oes_api_sys
│   ├── Cargo.toml
│   ├── bindings.hpp
│   ├── build.rs
│   ├── oes_libs
│   │   ├── include
│   │   │   ├── mds_api
│   │   │   │   ├── CHANGELOG.md
│   │   │   │   ├── ErrorCode.md
│   │   │   │   ├── MulticastGuide.md
│   │   │   │   ├── README.md
│   │   │   │   ├── UpdateGuide.md
│   │   │   │   ├── UpdateNotice.md
│   │   │   │   ├── _mds_private_broker_api.inc
│   │   │   │   ├── errors
│   │   │   │   │   └── mds_errors.h
│   │   │   │   ├── mds_api.h
│   │   │   │   ├── mds_async_api.h
│   │   │   │   └── parser
│   │   │   │       ├── csv_parser
│   │   │   │       │   └── mds_csv_parser.h
│   │   │   │       ├── json_parser
│   │   │   │       │   └── mds_json_parser.h
│   │   │   │       ├── mds_protocol_parser.h
│   │   │   │       └── poc_encoder
│   │   │   │           └── mds_poc_encoder.h
│   │   │   ├── mds_global
│   │   │   │   ├── mds_base_model.h
│   │   │   │   ├── mds_mkt_packets.h
│   │   │   │   └── mds_qry_packets.h
│   │   │   ├── oes_api
│   │   │   │   ├── CHANGELOG.md
│   │   │   │   ├── ErrorCode.md
│   │   │   │   ├── README.md
│   │   │   │   ├── UpdateGuide.md
│   │   │   │   ├── UpdateNotice.md
│   │   │   │   ├── _oes_private_broker_api.inc
│   │   │   │   ├── _oes_private_broker_async_api.inc
│   │   │   │   ├── errors
│   │   │   │   │   └── oes_errors.h
│   │   │   │   ├── oes_api.h
│   │   │   │   ├── oes_async_api.h
│   │   │   │   └── parser
│   │   │   │       ├── json_parser
│   │   │   │       │   ├── oes_json_parser.h
│   │   │   │       │   └── oes_query_json_parser.h
│   │   │   │       └── oes_protocol_parser.h
│   │   │   ├── oes_global
│   │   │   │   ├── oes_base_constants.h
│   │   │   │   ├── oes_base_model.h
│   │   │   │   ├── oes_base_model_credit.h
│   │   │   │   ├── oes_base_model_option.h
│   │   │   │   ├── oes_packets.h
│   │   │   │   ├── oes_qry_packets.h
│   │   │   │   ├── oes_qry_packets_credit.h
│   │   │   │   └── oes_qry_packets_option.h
│   │   │   ├── oes_private
│   │   │   │   └── oes_agw_packets.h
│   │   │   └── sutil
│   │   │       ├── cmnlib.h
│   │   │       ├── compiler.h
│   │   │       ├── logger
│   │   │       │   ├── _spk_log.h
│   │   │       │   ├── spk_console_masked_log.h
│   │   │       │   ├── spk_log.h
│   │   │       │   ├── spk_log_config.h
│   │   │       │   ├── spk_log_instance.h
│   │   │       │   ├── spk_log_level.h
│   │   │       │   ├── spk_log_mode.h
│   │   │       │   └── spk_log_type.h
│   │   │       ├── net
│   │   │       │   ├── spk_data_buffer_define.h
│   │   │       │   ├── spk_errmsg_base_define.h
│   │   │       │   ├── spk_general_client_define.h
│   │   │       │   ├── spk_general_endpoint_define.h
│   │   │       │   ├── spk_global_packet.h
│   │   │       │   └── spk_socket_base_define.h
│   │   │       ├── platform
│   │   │       │   ├── spk_errno.h
│   │   │       │   └── spk_platforms.h
│   │   │       ├── stdc.h
│   │   │       ├── string
│   │   │       │   ├── spk_fixed_snprintf.h
│   │   │       │   ├── spk_multi_field_string.h
│   │   │       │   ├── spk_safe_libc_strings.h
│   │   │       │   ├── spk_string_convert.h
│   │   │       │   ├── spk_string_var.h
│   │   │       │   ├── spk_strings.h
│   │   │       │   └── spk_strverscmp.h
│   │   │       ├── time
│   │   │       │   └── spk_times.h
│   │   │       └── types.h
│   │   └── lib
│   │       ├── linux64
│   │       │   ├── dll
│   │       │   │   └── liboes_api.so
│   │       │   ├── liboes_api.a
│   │       │   ├── pic
│   │       │   │   └── liboes_api.pic.a
│   │       │   └── tls
│   │       │       └── liboes_api.so
│   │       ├── macos_arm
│   │       │   ├── dll
│   │       │   │   └── liboes_api.so
│   │       │   ├── liboes_api.a
│   │       │   ├── pic
│   │       │   │   └── liboes_api.pic.a
│   │       │   └── tls
│   │       │       └── liboes_api.so
│   │       ├── macos_x86
│   │       │   ├── dll
│   │       │   │   └── liboes_api.so
│   │       │   ├── liboes_api.a
│   │       │   ├── pic
│   │       │   │   └── liboes_api.pic.a
│   │       │   └── tls
│   │       │       └── liboes_api.so
│   │       ├── samples
│   │       │   ├── mds_sample
│   │       │   │   ├── 01_mds_async_tcp_sample.c
│   │       │   │   ├── 02_mds_async_tcp_sample.minimal.c
│   │       │   │   ├── 03_mds_async_udp_sample.c
│   │       │   │   ├── 04_mds_sync_tcp_sample.c
│   │       │   │   ├── 05_mds_sync_udp_sample.c
│   │       │   │   ├── 06_mds_query_sample.c
│   │       │   │   ├── 07_mds_strerror_sample.c
│   │       │   │   ├── 08_mds_subscribe_by_query_detail_sample.c
│   │       │   │   ├── 09_mds_tick_resend_sample.c
│   │       │   │   ├── 10_mds_generate_ciphertext_password_sample.c
│   │       │   │   ├── 11_mds_binfile_restore_sample.c
│   │       │   │   ├── Makefile.sample
│   │       │   │   └── mds_client_sample.conf
│   │       │   ├── oes_sample_c
│   │       │   │   ├── 01_oes_async_stk_trade_sample.c
│   │       │   │   ├── 02_oes_async_stk_query_sample.c
│   │       │   │   ├── 03_oes_async_opt_trade_sample.c
│   │       │   │   ├── 04_oes_async_opt_query_sample.c
│   │       │   │   ├── 05_oes_async_crd_trade_sample.c
│   │       │   │   ├── 06_oes_async_crd_query_sample.c
│   │       │   │   ├── 07_oes_sync_stk_trade_sample.c
│   │       │   │   ├── 08_oes_sync_stk_query_sample.c
│   │       │   │   ├── 09_oes_sync_opt_trade_sample.c
│   │       │   │   ├── 10_oes_sync_opt_query_sample.c
│   │       │   │   ├── 11_oes_sync_crd_trade_sample.c
│   │       │   │   ├── 12_oes_sync_crd_query_sample.c
│   │       │   │   ├── 13_oes_tick_to_order_sample.c
│   │       │   │   ├── 14_oes_strerror_sample.c
│   │       │   │   ├── 15_oes_clear_stk_holding_sample.c
│   │       │   │   ├── 16_oes_generate_ciphertext_password_sample.c
│   │       │   │   ├── Makefile.sample
│   │       │   │   └── oes_client_sample.conf
│   │       │   ├── oes_sample_cpp
│   │       │   │   ├── 01_oes_client_stock_sample.cpp
│   │       │   │   ├── 02_oes_client_option_sample.cpp
│   │       │   │   ├── 03_oes_client_credit_sample.cpp
│   │       │   │   ├── Makefile.sample
│   │       │   │   ├── oes_client_my_spi_sample.cpp
│   │       │   │   ├── oes_client_my_spi_sample.h
│   │       │   │   ├── oes_client_sample.conf
│   │       │   │   ├── oes_client_sample.cpp
│   │       │   │   └── oes_client_sample.h
│   │       │   ├── oes_sample_unified
│   │       │   │   ├── 01_oes_async_stk_unified_sample.c
│   │       │   │   ├── Makefile.sample
│   │       │   │   └── oes_client_sample.conf
│   │       │   └── vs2015_project
│   │       │       ├── README.md
│   │       │       ├── mdsapi_test
│   │       │       │   ├── main.cpp
│   │       │       │   ├── mdsapi_test.vcxproj
│   │       │       │   └── mdsapi_test.vcxproj.filters
│   │       │       ├── oesapi_test
│   │       │       │   ├── main.cpp
│   │       │       │   ├── oesapi_test.vcxproj
│   │       │       │   └── oesapi_test.vcxproj.filters
│   │       │       └── oesapi_test2015.sln
│   │       ├── win32
│   │       │   ├── mingw
│   │       │   │   ├── liboes_api.a
│   │       │   │   └── pic
│   │       │   │       └── liboes_api.pic.a
│   │       │   ├── oes_api.dll
│   │       │   ├── oes_api.lib
│   │       │   └── tls
│   │       │       ├── libwinpthread-1.dll
│   │       │       ├── oes_api.dll
│   │       │       └── oes_api.lib
│   │       └── win64
│   │           ├── mingw
│   │           │   ├── liboes_api.a
│   │           │   └── pic
│   │           │       └── liboes_api.pic.a
│   │           ├── oes_api.dll
│   │           ├── oes_api.lib
│   │           └── tls
│   │               ├── libwinpthread-1.dll
│   │               ├── oes_api.dll
│   │               └── oes_api.lib
│   └── src
│       ├── bindings.rs
│       └── lib.rs
├── oes_api_test
├── oes_api_trade
└── rust-toolchain.toml
```

其中主要讨论的实现在oes_api_sys中。

oes_api_sys下主要有oes_libs目录（用于存放各个版本的sdk的lib和headers），src目录（用于存放该crates对外暴露的bindings.rs和声明mod bindings的lib.rs），build.rs通过features控制对应编译的版本（features控制oes_libs二级目录的version从而控制整个path）和binding.hpp的编译宏（可以做到一个binding.hpp生成多种不同版本对应的binding.rs），binding.hpp用于控制所暴露出来的extern "C" 的接口。

整个业务的实现核心在于"如何通过build.rs生成多版本binding.rs的同时，对于依赖他的crate无感知so，即将对应版本的发布件.so或.a作为发布件一起发布"。这里用到的是`cargo:rustc-link-search=native={}`来告知调用的crate构建，对应链接的时候，应该去这个目录查找对应的so;解决完编译问题，还有发布件的发布问题，通过std::file::copy将其拷贝到对应发布路径下目录；不建议指定特殊目录，破坏了cargo的目录发布件原则。

除了以上问题外，构建bindings.rs的同学应该遵循"最小使用原则"，明确需要使用到的函数名(`allowlist_function`)，需要使用到的类型(`allowlist_type`)，需要使用到的变量名(`allowlist_var`，暴露源文件的常量)。最终生成一个合理大小的bindings.rs。

实际操作过程中。也会出现部分函数是使用了C的宏构造函数，函数名中会携带对应的版本信息，因此bindings.hpp 也有一定的函数二次封装的作用，解决此类问题。

### CtpApiWrapper(C++封装)

相较于C封装，C++的封装难度会大很多。参考项目[ctp_api_wrapper](http://code.non-convex.com:18118/gateway/counter_sdk_swapper/ctp_api_wrapper)。

目录大致如下

```bash
.
├── Cargo.lock
├── Cargo.toml
├── README.md
└── ctp_api_sys
    ├── Cargo.toml
    ├── bindings.hpp
    ├── build.rs
    ├── ctp_libs
    │   ├── v6.7.2_CP_tradeapi_20230810
    │   │   ├── linux64
    │   │   │   ├── include
    │   │   │   │   ├── ThostFtdcMdApi.h
    │   │   │   │   ├── ThostFtdcTraderApi.h
    │   │   │   │   ├── ThostFtdcUserApiDataType.h
    │   │   │   │   ├── ThostFtdcUserApiStruct.h
    │   │   │   │   ├── error.dtd
    │   │   │   │   └── error.xml
    │   │   │   └── lib
    │   │   │       └── thosttraderapi_se.so
    │   │   ├── win32
    │   │   │   ├── include
    │   │   │   │   ├── ThostFtdcMdApi.h
    │   │   │   │   ├── ThostFtdcTraderApi.h
    │   │   │   │   ├── ThostFtdcUserApiDataType.h
    │   │   │   │   ├── ThostFtdcUserApiStruct.h
    │   │   │   │   ├── error.dtd
    │   │   │   │   └── error.xml
    │   │   │   └── lib
    │   │   │       ├── thosttraderapi_se.dll
    │   │   │       └── thosttraderapi_se.lib
    │   │   └── win64
    │   │       ├── include
    │   │       │   ├── ThostFtdcMdApi.h
    │   │       │   ├── ThostFtdcTraderApi.h
    │   │       │   ├── ThostFtdcUserApiDataType.h
    │   │       │   ├── ThostFtdcUserApiStruct.h
    │   │       │   ├── error.dtd
    │   │       │   └── error.xml
    │   │       └── lib
    │   │           ├── thosttraderapi_se.dll
    │   │           └── thosttraderapi_se.lib
    │   └── v6.7.2_traderapi_20230913
    │       ├── linux64
    │       │   ├── include
    │       │   │   ├── ThostFtdcMdApi.h
    │       │   │   ├── ThostFtdcTraderApi.h
    │       │   │   ├── ThostFtdcUserApiDataType.h
    │       │   │   ├── ThostFtdcUserApiStruct.h
    │       │   │   ├── error.dtd
    │       │   │   └── error.xml
    │       │   └── lib
    │       │       └── thosttraderapi_se.so
    │       ├── win32
    │       │   ├── include
    │       │   │   ├── ThostFtdcMdApi.h
    │       │   │   ├── ThostFtdcTraderApi.h
    │       │   │   ├── ThostFtdcUserApiDataType.h
    │       │   │   ├── ThostFtdcUserApiStruct.h
    │       │   │   ├── error.dtd
    │       │   │   └── error.xml
    │       │   └── lib
    │       │       ├── thosttraderapi_se.dll
    │       │       └── thosttraderapi_se.lib
    │       └── win64
    │           ├── include
    │           │   ├── ThostFtdcMdApi.h
    │           │   ├── ThostFtdcTraderApi.h
    │           │   ├── ThostFtdcUserApiDataType.h
    │           │   ├── ThostFtdcUserApiStruct.h
    │           │   ├── error.dtd
    │           │   └── error.xml
    │           └── lib
    │               ├── thosttraderapi_se.dll
    │               └── thosttraderapi_se.lib
    ├── src
    │   ├── bindings.rs
    │   ├── lib.rs
    │   └── utils.rs
    └── wrappers
        ├── cxx
        │   └── wrapper.cpp
        └── hxx
            ├── ctp_spi_wrapper.hpp
            ├── rust_wrapper.hpp
            └── sdk_wrapper.hpp
```

该crates下只有ctp_api_sys目录，其下包含了ctp_libs目录(关于ctp sdk的多版本多操作系统支持的动态库和头文件，因为CTP还有windows版本发布)，src目录（对应生成的bindings.rs,lib.rs），wrapper(封装了C++接口C函数sdk_wrapper.hpp， rust回调声明函数rust_wrapper.hpp，和内部C++ class转C指针的相关函数头文件及对应实现cxx/wrapper.cpp)。

和之前不同的是，这里的bings.hpp只需要去包含`wrappers/hxx/sdk_wrapper.hpp`(Rust调用C的接口声明)和`wrappers/hxx/rust_wrapper.hpp`（C调用Rust回调的函数声明）即可。

构建build.rs中，主要适用了`println!("cargo:rustc-link-lib=dylib=thosttraderapi_se");`，而通过`cc::Build`编译出来的`ctp_wrapper.a`则可以直接被依赖直接链接到发布的`order_engine`中即可。

实践中需要注意实现细节:

- 1.如果是POD结构的，C++自然可以信手拈来；如果是非POD的，C++的binding的大量工作将会集中于非POD结构转POD结构的工作：例如stl的`std::string`需要转换为C中的 `char[]`，并且注意对应的生命周期管理；复杂的`std::vector<std::string>`则需要考虑用更复杂的结构体来转换。
- 2.指针周期管理。Rust的`unsafe`就是程序员向Rust保证，我的资源管理是清楚的，我们这里使用C++中的对象指针做管理，需要自定义实现drop方法，避免指针悬挂；并且使用了指针之后，对于`Send`和`Sync`的trait也需要考虑是否要实现。我这里实现比较偷懒，使用了`std::sync::Mutex`的锁来锁这个指针的持有者，进行的资源保护；大家如果有更好的Rust写法也可以提出。
