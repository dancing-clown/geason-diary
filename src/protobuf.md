# protobuf in Rust

build-dependencies采用`protoc-rust`，dependencies的crate是`protobuf`。

```toml
[package]
name = "protobuf_test"
version = "0.1.0"
edition = "2024"

[dependencies]
protobuf = "2.28.0"
serde = { version = "1.0.228", features = ["derive"] }

[features]
with-serde = []

[build-dependencies]
protoc-rust = "2.28.0"
```

[`protoc-rust`](https://crates.io/crates/protoc-rust)只用用于根据proto文件生成对应的Rust代码。替代crate为`protobuf-codegen-pure`。

build.rs代码如下

```rust,edition2024
use protoc_rust::Customize;
use std::process::Command;

fn main() {
    protoc_rust::Codegen::new()
        .out_dir("src")
        .inputs(["proto/hello.proto"])
        .include("proto")
        .customize(Customize {
            expose_oneof: Some(true),
            serde_derive: Some(true),
            ..Default::default()
        })
        .run()
        .expect("protoc");
    let output = Command::new("git")
        .args(&["describe", "--tags"])
        .output()
        .unwrap();
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    println!("cargo:rustc-env=VERSION={}", version);
}
```

会生成对应的hello.rs。对应的协议定义如下。

```proto
syntax = "proto3";
import "google/protobuf/empty.proto";
package hello;

enum MessageType {
    none = 0;
    login_request = 1;
    logout_request = 2;
}

message Login {
    string username = 1;
    string password = 2;
};

message Logout {
    string username = 1;
}

message Msg {
    MessageType type = 1;
    int64 request_id = 2;
    oneof Data {
        Login login = 3;
        Logout logout = 4;
    };
}
```

使用hello.rs的demo代码如下：

```rust,edition2024
use protobuf_test::hello::Login;
use protobuf_test::hello::MessageType;
use protobuf_test::hello::Msg;
use protobuf_test::hello::Msg_oneof_Data;

fn main() {
    let _login_request = Msg {
        // message fields
        field_type: MessageType::login_request,
        request_id: 0,
        // message oneof groups
        Data: Some(Msg_oneof_Data::login(Login {
            username: "".to_string(),
            password: "".to_string(),
            unknown_fields: Default::default(),
            cached_size: Default::default(),
        })),
        unknown_fields: Default::default(),
        cached_size: Default::default(),
    };
}
```

实际开发时需要注意，尽量不使用`..Default::default()`语法，因为协议升级时可能会添加新的字段，而使用`..Default::default()`语法会导致新字段的默认值，这不是我们希望看到的。
