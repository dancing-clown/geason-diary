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

## gRPC with Tonic

使用 tonic 构建 gRPC 服务时，需要使用 `tonic-build` 来生成客户端和服务端代码。

### 依赖配置

```toml
[package]
name = "grpc_example"
version = "0.1.0"
edition = "2021"

[dependencies]
tonic = "0.10"
prost = "0.12"
tokio = { version = "1.0", features = ["macros", "rt-multi-thread"] }
serde = { version = "1.0", features = ["derive"] }

[build-dependencies]
tonic-build = "0.10"
```

### build.rs 配置

关键在于正确配置 `tonic-build` 以保留 oneof 类型：

```rust
fn main() -> Result<(), Box<dyn std::error::Error>> {
    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        // 生成的代码输出目录
        .out_dir("src/generated")
        // 保留 oneof 字段的原始形式
        .type_attribute(".", "#[derive(serde::Serialize, serde::Deserialize)]")
        // 确保 oneof 枚举也被正确处理
        .field_attribute(".", "#[serde(flatten)]")
        .compile(
            &["proto/service.proto"],
            &["proto"],
        )?;
    Ok(())
}
```

### Proto 文件示例

```proto
syntax = "proto3";
package example;

service ExampleService {
    rpc HandleMessage(MessageRequest) returns (MessageResponse);
}

message MessageRequest {
    int64 request_id = 1;
    oneof data {
        LoginData login = 2;
        LogoutData logout = 3;
        QueryData query = 4;
    }
}

message LoginData {
    string username = 1;
    string password = 2;
}

message LogoutData {
    string session_id = 1;
}

message QueryData {
    string query_string = 1;
}

message MessageResponse {
    int64 request_id = 1;
    bool success = 2;
    string message = 3;
}
```

### 生成的 Oneof 类型

tonic-build 会为 oneof 字段生成一个独立的枚举类型：

```rust
// 生成的代码结构(简化版)
#[derive(Clone, PartialEq, ::prost::Message)]
pub struct MessageRequest {
    #[prost(int64, tag = "1")]
    pub request_id: i64,
    #[prost(oneof = "message_request::Data", tags = "2, 3, 4")]
    pub data: ::core::option::Option<message_request::Data>,
}

pub mod message_request {
    #[derive(Clone, PartialEq, ::prost::Oneof)]
    pub enum Data {
        #[prost(message, tag = "2")]
        Login(super::LoginData),
        #[prost(message, tag = "3")]
        Logout(super::LogoutData),
        #[prost(message, tag = "4")]
        Query(super::QueryData),
    }
}
```

### 服务端实现

```rust
use tonic::{transport::Server, Request, Response, Status};
use example::example_service_server::{ExampleService, ExampleServiceServer};
use example::{MessageRequest, MessageResponse, message_request};

pub struct MyExampleService;

#[tonic::async_trait]
impl ExampleService for MyExampleService {
    async fn handle_message(
        &self,
        request: Request<MessageRequest>,
    ) -> Result<Response<MessageResponse>, Status> {
        let req = request.into_inner();

        // 模式匹配处理 oneof 类型
        let result = match req.data {
            Some(message_request::Data::Login(login_data)) => {
                println!("Login: user={}", login_data.username);
                "Login successful"
            }
            Some(message_request::Data::Logout(logout_data)) => {
                println!("Logout: session={}", logout_data.session_id);
                "Logout successful"
            }
            Some(message_request::Data::Query(query_data)) => {
                println!("Query: {}", query_data.query_string);
                "Query processed"
            }
            None => {
                return Err(Status::invalid_argument("No data provided"));
            }
        };

        let response = MessageResponse {
            request_id: req.request_id,
            success: true,
            message: result.to_string(),
        };

        Ok(Response::new(response))
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let addr = "[::1]:50051".parse()?;
    let service = MyExampleService;

    Server::builder()
        .add_service(ExampleServiceServer::new(service))
        .serve(addr)
        .await?;

    Ok(())
}
```

### 客户端实现

```rust
use example::example_service_client::ExampleServiceClient;
use example::{MessageRequest, LoginData, message_request};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut client = ExampleServiceClient::connect("http://[::1]:50051").await?;

    // 构造带有 oneof 字段的请求
    let request = tonic::Request::new(MessageRequest {
        request_id: 123,
        data: Some(message_request::Data::Login(LoginData {
            username: "alice".to_string(),
            password: "secret123".to_string(),
        })),
    });

    let response = client.handle_message(request).await?;
    println!("Response: {:?}", response.into_inner());

    Ok(())
}
```

### Oneof 类型的最佳实践

1. **类型安全的模式匹配**：使用 match 表达式处理所有可能的 oneof 变体
2. **避免 unwrap**：总是检查 `Option<T>` 是否为 None
3. **辅助函数**：为常见的 oneof 构造创建辅助函数

```rust
impl MessageRequest {
    pub fn new_login(request_id: i64, username: String, password: String) -> Self {
        Self {
            request_id,
            data: Some(message_request::Data::Login(LoginData {
                username,
                password,
            })),
        }
    }

    pub fn new_logout(request_id: i64, session_id: String) -> Self {
        Self {
            request_id,
            data: Some(message_request::Data::Logout(LogoutData {
                session_id,
            })),
        }
    }
}
```

### 为什么需要实现 Service Trait

tonic-build 会为 proto 文件中定义的每个 service 生成两个主要组件：

1. **Server Trait**：定义了服务端需要实现的接口
   - 命名规则：`{ServiceName}` (例如 `ExampleService`)
   - 包含所有 rpc 方法的 async trait 定义

2. **Server 实现**：用于将你的服务注册到 tonic Server
   - 命名规则：`{ServiceName}Server` (例如 `ExampleServiceServer`)
   - 负责处理网络通信、序列化/反序列化等底层细节

```rust
// tonic-build 生成的代码结构（简化版）
#[async_trait]
pub trait ExampleService: Send + Sync + 'static {
    async fn handle_message(
        &self,
        request: Request<MessageRequest>,
    ) -> Result<Response<MessageResponse>, Status>;
}

pub struct ExampleServiceServer<T: ExampleService> {
    inner: Arc<T>,
}

impl<T: ExampleService> ExampleServiceServer<T> {
    pub fn new(inner: T) -> Self {
        Self {
            inner: Arc::new(inner),
        }
    }
}
```

实现流程：

```rust
// 1. 定义你的服务结构体
pub struct MyExampleService {
    // 可以包含数据库连接、配置等
    db: Database,
}

// 2. 实现 tonic 生成的 trait
#[tonic::async_trait]
impl ExampleService for MyExampleService {
    // 实现具体的业务逻辑
    async fn handle_message(&self, request: Request<MessageRequest>)
        -> Result<Response<MessageResponse>, Status> {
        // 你的实现
    }
}

// 3. 使用 Server wrapper 注册服务
let service = MyExampleService { db };
Server::builder()
    .add_service(ExampleServiceServer::new(service))  // 包装成 Server
    .serve(addr)
    .await?;
```

**为什么这样设计**：

- **关注点分离**：你只需要关注业务逻辑（实现 trait），tonic 处理网络层
- **类型安全**：编译时确保你实现了所有 rpc 方法
- **灵活性**：可以为同一个 service trait 提供多个不同的实现
- **依赖注入**：你的服务结构体可以包含任意状态（数据库、缓存等）

### 在异步任务中使用 tokio::spawn

在异步任务中可以自由地使用 `tokio::spawn` 来创建新的并发任务。这在 gRPC 服务中非常有用，比如需要并发处理多个操作或后台任务时。

```rust
#[tonic::async_trait]
impl ExampleService for MyExampleService {
    async fn handle_message(
        &self,
        request: Request<MessageRequest>,
    ) -> Result<Response<MessageResponse>, Status> {
        let req = request.into_inner();

        // 在 RPC 处理函数中 spawn 新任务
        match req.data {
            Some(message_request::Data::Login(login_data)) => {
                // 方式1：spawn 后台任务，不等待结果
                let username = login_data.username.clone();
                tokio::spawn(async move {
                    // 记录日志、更新统计等后台操作
                    println!("Background: processing login for {}", username);
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                });

                // 立即返回响应
                Ok(Response::new(MessageResponse {
                    request_id: req.request_id,
                    success: true,
                    message: "Login initiated".to_string(),
                }))
            }
            Some(message_request::Data::Query(query_data)) => {
                // 方式2：spawn 多个并发任务并等待所有结果
                let query1 = query_data.query_string.clone();
                let query2 = query_data.query_string.clone();

                let handle1 = tokio::spawn(async move {
                    // 查询数据库1
                    format!("Result from DB1: {}", query1)
                });

                let handle2 = tokio::spawn(async move {
                    // 查询数据库2
                    format!("Result from DB2: {}", query2)
                });

                // 等待所有任务完成
                let (result1, result2) = tokio::try_join!(handle1, handle2)
                    .map_err(|e| Status::internal(format!("Task join error: {}", e)))?;

                Ok(Response::new(MessageResponse {
                    request_id: req.request_id,
                    success: true,
                    message: format!("{}, {}", result1, result2),
                }))
            }
            _ => Err(Status::unimplemented("Not implemented")),
        }
    }
}
```

**使用 tokio::spawn 的注意事项**：

1. **生命周期要求**：spawn 的闭包必须是 `'static`，这意味着：
   - 不能直接借用外部变量，需要使用 `move` 或 `clone`
   - 不能借用 `&self`，如需访问 self 的数据，要先 clone 或使用 `Arc`

```rust
// ❌ 错误：不能借用 self
tokio::spawn(async {
    self.db.query().await  // 编译错误：borrowed data escapes
});

// ✅ 正确：clone 需要的数据
let db = self.db.clone();  // 假设 db 是 Arc<Database>
tokio::spawn(async move {
    db.query().await
});
```

2. **错误处理**：spawn 返回 `JoinHandle<T>`
   - 如果不 await，任务在后台运行，错误会被忽略
   - 如果 await，需要处理 `JoinError`（任务 panic）和任务本身的返回值

```rust
let handle = tokio::spawn(async {
    // 可能 panic 或返回 Result
    some_fallible_operation().await
});

// 处理两层错误
match handle.await {
    Ok(Ok(result)) => println!("Success: {:?}", result),
    Ok(Err(e)) => println!("Task error: {:?}", e),
    Err(e) => println!("Join error (panic): {:?}", e),
}
```

3. **使用场景**：
   - **后台任务**：日志记录、指标上报、清理工作
   - **并发处理**：同时查询多个数据源
   - **超时控制**：配合 `tokio::select!` 实现超时

```rust
// 超时控制示例
let timeout = tokio::time::sleep(tokio::time::Duration::from_secs(5));
tokio::select! {
    result = some_async_operation() => {
        println!("Completed: {:?}", result);
    }
    _ = timeout => {
        println!("Timeout!");
    }
}
```

4. **避免过度 spawn**：
   - tokio 已经是多线程运行时，不需要为每个小操作都 spawn
   - spawn 有开销（分配、调度），过度使用会降低性能
   - 只在真正需要并发或后台执行时使用

### 注意事项

- tonic 使用 `prost` 作为底层的 protobuf 实现，而不是 `rust-protobuf`
- oneof 字段会生成为 `Option<enum>` 类型，其中 enum 包含所有可能的变体
- 生成的 oneof 枚举位于消息的子模块中，命名规则为 `message_name::FieldName`
- 使用 `type_attribute` 和 `field_attribute` 可以为生成的类型添加自定义的 derive 宏
- Service trait 定义接口，ServiceServer 负责网络层实现，两者配合完成 RPC 调用
