# 设计模式

设计模式通常是解决特定问题的一种通用解决方案，它可以帮助开发人员编写可维护、可扩展的代码。下面对于代码中常见的设计模式通过C++和Rust来实现。

## 设计原则

SOLID五大基础原则：

- 单一职责：一个函数方法只做一件事。
- 开放封闭原则：对扩展开放，对修改封闭。
- 里氏替换原则：强调子类必须能完全替代基类而不改变系统原有功能，即子类执行父类的业务逻辑仍然能得到正确的结果。
- 接口隔离原则：最小接口暴露原则。
- 依赖反转原则：即高层模块应该依赖抽象而非具体的实现，这里我理解是不应该出现调用dynamic_cast向下转换的使用场景。

## 单例模式

确保一个类仅有一个实例，并提供全局进行访问。例如我们的配置TradeConfig或总线BusGateway为全局对象，这样确保内部状态不会多实例化后不一致。下面以TradeConfig为例。

```cpp
struct TradeConfig {
    std::string broker_id;
    std::string address;
    std::string username;
    std::string password;
};
```

C++的线程安全懒汉式，从C++11起，局部静态变量的初始化时线程安全的，无需手动加锁，是最优懒汉式实现。

```cpp
#include <string>
#include <string_view>
#include <fstream>
#include <nlohmann/json.hpp>

class TradeConfig {
private:
    // 私有构造/析构/拷贝，防止外部创建/复制
    TradeConfig() = default;
    ~TradeConfig() = default;
    TradeConfig(const TradeConfig&) = delete;
    TradeConfig& operator=(const TradeConfig&) = delete;
    std::string broker_id_;
    std::string address_;
    std::string username_;
    std::string password_;
public:
    static TradeConfig &get_trade_config() {
        static TradeConfig config;
        return config;
    }

    bool init(std::string file_path) {
        std::ifstream in(file_path);
        if (!in) return false;
        nlohmann::json j;
        in >> j;
        if (!j.is_object()) return false;
        auto iter = j.find("broker_id");
        if (iter == j.end() || !iter->is_string()) return false;
        broker_id_ = iter->get<std::string>();
        iter = j.find("address");
        if (iter == j.end() || !iter->is_string()) return false;
        address_ = iter->get<std::string>();
        iter = j.find("username");
        if (iter == j.end() || !iter->is_string()) return false;
        username_ = iter->get<std::string>();
        iter = j.find("password");
        if (iter == j.end() || !iter->is_string()) return false;
        password_ = iter->get<std::string>();
        return true;
    }

    std::string broker_id() const { return broker_id_; }
    std::string address() const { return address_; }
    std::string username() const { return username_; }
    std::string password() const { return password_; }
};
```

Rust需要使用OnceLock来实现安全懒汉单例

```rust
use std::{fs, path::Path};
use std::sync::OnceLock;
use serde::Deserialize;

pub struct TradeConfig {
    pub broker_id: String,
    pub address: String,
    pub username: String,
    pub password: String,
}

// 全局静态单例存储
pub static CONFIG: OnceLock<TradeConfig> = OnceLock::new();

// 初始化配置从文件
fn init_from_file(path: impl AsRef<Path>) -> Result<&'static TradeConfig, Box<dyn std::error::Error>> {
    let s = fs::read_to_string(path)?;
    let cfg: TradeConfig = serde_json::from_str(&s)?;
    let r = CONFIG.get_or_try_init(|| Ok(cfg))?;
    Ok(r)
}

// 调用处直接调用获取全局配置即可
// let cfg = CONFIG.get()?;
```

## 工厂模式

在我看来，工厂模式的核心在于组装，即初始化非常复杂的对象，通过工厂组装之后返回给调用者一个可用的`产品`。

例如不同的网关：

- ctp期货是先加载dll，然后设置前置机，然后初始化；
- crypto会先配置API密钥，然后初始化对应WS客户端，然后订阅对应的交易对；
- IB会先配置API密钥，然后初始化对应TCP客户端，然后订阅对应的交易对。

每一个网关可能有自己的初始化流程，但是初始化的流程又是可以共用的，这个时候就可以使用工厂模式来组装不同的流程，生产出一个可用的网关。

```cpp
// 1. 抽象产品：统一交易网关接口
class TradingGateway {
public:
    virtual void login() = 0;
    virtual void place_order(const Order& order) = 0;
    virtual ~TradingGateway() = default;
};

// 2. 具体产品：各交易所网关
class CTPGateway : public TradingGateway { /* 实现CTP创建/登录逻辑 */ };
class BinanceGateway : public TradingGateway { /* 实现Binance逻辑 */ };
class TigerGateway : public TradingGateway { /* 实现Tiger逻辑 */ };

// 3. 抽象工厂：网关创建接口
class GatewayFactory {
public:
    virtual unique_ptr<TradingGateway> create_gateway(const Config& cfg) = 0;
};

// 4. 具体工厂：各交易所网关工厂（封装创建逻辑）
class CTPGatewayFactory : public GatewayFactory {
public:
    unique_ptr<TradingGateway> create_gateway(const Config& cfg) override {
        auto gateway = make_unique<CTPGateway>();
        gateway->load_dll(cfg.ctp_dll_path);
        gateway->set_front(cfg.ctp_front);
        gateway->set_username(cfg.user);
        gateway->set_password(cfg.pass);
        gateway->set_broker_id(cfg.broker_id);
        gateway->login();
        return gateway;
    }
};

class BinanceGatewayFactory : public GatewayFactory {
public:
    unique_ptr<TradingGateway> create_gateway(const Config& cfg) override {
        auto gateway = make_unique<BinanceGateway>();
        gateway->set_api_key(cfg.binance_api_key);
        gateway->set_api_secret(cfg.binance_api_secret);
        gateway->connect(cfg.binance_ws_url);
        gateway->subscribe(cfg.binance_symbols);
        return gateway;
    }
};

class TigerGatewayFactory : public GatewayFactory {
public:
    unique_ptr<TradingGateway> create_gateway(const Config& cfg) override {
        auto gateway = make_unique<TigerGateway>();
        gateway->set_api_key(cfg.tiger_api_key);
        gateway->set_api_secret(cfg.tiger_api_secret);
        gateway->connect(cfg.tiger_tcp_url);
        gateway->subscribe(cfg.tiger_symbols);
        return gateway;
    }
};

// 上层业务使用：无需关心创建细节
void run_strategy(GatewayFactory& factory, const Config& cfg, const Order& order) {
    auto gateway = factory->create_gateway(cfg);
    gateway->place_order(order);
}
```

Rust则主要是基于`Trait`和`Box<dyn>`实现上述功能。

```rust
// 1. 抽象产品：统一交易网关接口
pub trait TradingGateway {
    fn login(&mut self);
    fn place_order(&mut self, order: &Order);
}

pub struct CTPGateway {}

impl TradingGateway for CTPGateway {
    fn login(&mut self) {
        // 实现CTP登录逻辑
    }

    fn place_order(&mut self, order: &Order) {
        // 实现CTP下单逻辑
    }
}

pub trait GatewayFactory {
    fn create_gateway(&self, cfg: &Config) -> Box<dyn TradingGateway>;
}

pub struct CTPGatewayFactory {}

impl GatewayFactory for CTPGatewayFactory {
    fn create_gateway(&self, cfg: &Config) -> Box<dyn TradingGateway> {
        let mut gateway = CTPGateway::default();
        gateway.load_dll(cfg.ctp_dll_path);
        gateway.set_front(cfg.ctp_front);
        gateway.set_username(cfg.user);
        gateway.set_password(cfg.pass);
        gateway.set_broker_id(cfg.broker_id);
        gateway.login();
        Box::new(gateway)
    }
}

// 上层业务使用：无需关心创建细节
fn run_strategy(factory: &impl GatewayFactory, cfg: &Config, order: &Order) {
    let gateway = factory.create_gateway(cfg);
    gateway.place_order(order);
}
```

以上例子其实还没有复杂到一定需要使用工厂模式；但是如果初始化流程可抽象和拆分，例如可能还设计到redis的初始化，数据库初始化，那么工厂就可以根据配置去完成特定gateway的创建时，使用工厂就可以事半功倍。

## 观察者模式

观察者模式通常在消息更新时使用。例如kafka消息推送成交数据，我们的推送并不会发送给每个Gateway进行处理，而只发送给订阅了该类消息的订阅者。

```cpp
#include <iostream>
#include <vector>
#include <memory>
#include <string>

class TradeEventBus;

class TradeSubscriber {
protected:
    std::string gateway_id_;
    std::shared_ptr<TradeEventBus> topic_;

public:
    TradeSubscriber(const std::string& gateway_id, std::shared_ptr<TradeEventBus> topic)
        : gateway_id_(gateway_id), topic_(topic) {}
    virtual ~TradeSubscriber() = default;
    virtual void update(const std::string& msg) = 0;
};

class TradeEventBus {
private:
    std::vector<std::unique_ptr<TradeSubscriber>> subscribers_;
    std::string payload_;

public:
    void attach(std::unique_ptr<TradeSubscriber> subscriber) {
        subscribers_.push_back(std::move(subscriber));
    }

    void detach(const std::string& name) {
        for (auto it = subscribers_.begin(); it != subscribers_.end(); ++it) {
            if ((*it)->gateway_id_ == name) {
                subscribers_.erase(it);
                break;
            }
        }
    }

    void notify() {
        for (auto& subscriber : subscribers_) {
            subscriber->update(payload_);
        }
    }

    void set_payload(const std::string& payload) {
        payload_ = payload;
        notify();
    }

    std::string payload() const { return payload_; }
};

class GatewaySubscriber : public TradeSubscriber {
public:
    using TradeSubscriber::TradeSubscriber;

    void update(const std::string& msg) override {
        std::cout << "Gateway [" << gateway_id_ << "] received: " << msg << std::endl;
    }
};

int main() {
    auto topic = std::make_unique<TradeEventBus>();

    topic->attach(std::make_unique<GatewaySubscriber>("north-gw", topic.get()));
    topic->attach(std::make_unique<GatewaySubscriber>("east-gw", topic.get()));

    topic->set_payload("TradeFilled: order=123 qty=10");

    topic->detach("east-gw");
    topic->set_payload("TradeCancelled: order=456");

    return 0;
}
```

Rust的通道

```rust
use std::sync::{Arc, Mutex};
use std::fmt::Display;

// 观察者Trait
trait TradeSubscriber: Display {
    fn update(&self, msg: &str);
}

// 具体观察者（用户）
#[derive(Debug, Clone)]
struct User {
    name: String,
}

impl Display for User {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.name)
    }
}

impl TradeSubscriber for User {
    fn update(&self, msg: &str) {
        println!("User [{}] received: {}", self.name, msg);
    }
}

// 主题（消息中心）
struct Subject {
    observers: Arc<Mutex<Vec<Arc<dyn Observer>>>>,  // 线程安全的观察者列表
    payload: String,
}

impl Subject {
    fn new() -> Self {
        Self {
            observers: Arc::new(Mutex::new(Vec::new())),
            payload: String::new(),
        }
    }

    // 附加观察者
    fn attach(&self, observer: Arc<dyn Observer>) {
        let mut observers = self.observers.lock().unwrap();
        observers.push(observer);
    }

    // 移除观察者（按名称）
    fn detach(&self, name: &str) {
        let mut observers = self.observers.lock().unwrap();
        observers.retain(|obs| obs.to_string() != name);
    }

    // 通知所有观察者
    fn notify(&self) {
        let observers = self.observers.lock().unwrap();
        for obs in observers.iter() {
            obs.update(&self.payload);
        }
    }

    // 设置状态并通知
    fn set_state(&mut self, payload: &str) {
        self.payload = payload.to_string();
        self.notify();
    }
}

// 测试
fn main() {
    let mut subject = Subject::new();

    // 添加观察者
    let alice = Arc::new(User { name: "Alice".to_string() });
    let bob = Arc::new(User { name: "Bob".to_string() });
    subject.attach(alice);
    subject.attach(bob);

    // 发布消息
    subject.set_payload("New product released!");
    // 输出：
    // User [Alice] received: New product released!
    // User [Bob] received: New product released!

    // 移除Bob
    subject.detach("Bob");
    subject.set_state("Price discount!");
    // 输出：
    // User [Alice] received: Price discount!
}
```

## 适配器模式

适配器模式主要是将原本由于接口不兼容而不能一起工作的那些类可以一起工作；这种模式通常在于以前其实已经有一套接口了，然后想要快速集成到新的系统，新的系统的集成接口和以前的接口不兼容，一次需要适配器来做对应适配。

```cpp
class NewSystem {
public:
    virtual void request() = 0;
};

class OldSystem {
public: 
    void specificRequest() {
        std::cout << "OldSystem specificRequest" << std::endl;
    }
};

class Adapter : public NewSystem {
private:
    OldSystem old_system_;
public:
    Adapter(OldSystem* old_system) : old_system_(old_system) {}
    void request() override {
        old_system_.specificRequest();
    }
};
```

## 组合模式

对于模块化设计的利器，开发者需要明确`高内聚、低耦合`设计，再最终提供的服务中就会组合的概念。例如我们的Gateway实际会涉及SdkApi, CachceStorage, StateMachine，这些模块之间的组合就会形成一个完整的Gateway服务。那么可以通过组合模式来实现。

```cpp
class SdkApi {
private:
        Api *api_;
public:
        bool new_order(Order& req) { return api_->login(req); }
};

class StateMachine {
public:
    virtual void transition(const std::string& event) = 0;
    virtual std::string state() = 0;
};

class CacheStorage {
public:
    virtual void set(const std::string& key, const Order& order) = 0;
    virtual Order& get(const std::string& key) = 0;
};

class Gateway {
private:
    SdkApi *sdk_api_;
    unordered_map<std::string, StateMachine> state_machine_;
    CacheStorage *cache_storage_;
}
```

## 类型状态模式

它是一种API设计模式，将对象的运行时状态信息编码到对象的编译器类别中：

- 对对象执行的操作，只在对象的特定状态下才能使用
- 一种在类型级别对这些状态进行编码的方法，使得在错误状态下尝试使用这些操作将无法编译
- 状态转换操作除了改变运行状态外，还会改变对象的类型级状态，使得先前状态下的操作不再可能。

优势在于：

- 将某些类型的错误从运行时转移到编译时，从而听过更快的反馈
- 与IDE的交互效果很好，可以避免建议在特定状态下非法的操作
- 可以消除运行时检查，使代码运行速度更快/提及更小

其本质就是通过状态机实现类级别的状态转移。

参考代码：[Type-Dirven API Design in Rust](https://willcrichton.net/rust-api-type-patterns/typestate.html)

```rust
struct ReadingFile { inner: File }
struct EofFile { inner: File }

enum ReadResult {
    Read(ReadingFile, Vec<u8>),
    Eof(EofFile)
}

impl ReadingFile {
    pub fn open(path: String) -> Option<ReadingFile> {}
    pub fn read(self) -> ReadResult {
        match self.inner.read() {
            Some(bytes) => ReadResult::Read(self, bytes),
            None => ReadResult::Eof(EofFile { inner: self.inner }),
        }
    }
    pub fn close(self) {
        self.inner.close();
    }
}

impl EofFile {
    pub fn close(self) {
        self.inner.close();
    }
}

fn main() {
    let mut file = ReadingFile::open("test.txt".to_owned()).unwrap();
    loop {
        match file.read() {
            ReadResult::Read(f, bytes) => {
                println!("bytes: {bytes:?}");
                file = f;
            }
            ReadResult::Eof(f) => {
                f.close();
                break;
            }
        }
    }
}
```

我们更希望handle的是一个类型`file`对象，因此可以将状态编码到类型中。

```rust
struct Reading;
struct Eof;

struct File2<State> {
    inner: File,
    _state: PhantomData<State>,
}

enum ReadResult {
    Read(File2<Reading>, Vec<u8>),
    Eof(File2<Eof>),
}

impl File2<Reading> {
    pub fn open(path: String) -> Option<File2<Reading>> {}
    pub fn read(self) -> ReadResult {
        match self.inner.read() {
            Some(bytes) => ReadResult::Read(self, bytes),
            None => ReadResult::Eof(File2 { inner: self.inner, _state: PhantomData }),
        }
    }
    pub fn close(self) {
        self.inner.close();
    }
}

impl File2<Eof> {
    pub fn close(self) {
        self.inner.close();
    }
}

```
