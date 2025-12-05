# 交叉编译

## 交叉编译windows

平时我们开发工作是在mac完成，实际生产存在windows运行环境，调试阶段可以用此种方式快速验证修改代码

```bash
export https_proxy=http://xxx http_proxy=http://xxx all_proxy=socks5://xxx
brew install mingw-w64
rustup target add x86_64-pc-windows-gnu
cargo build --target x86_64-pc-windows-gnu
```

另外个Visual Studio环境执行

```bash
cargo install cargo-xwin
brew install llvm
rustup target add x86_64-pc-windows-msvc
cargo xwin build --release --target x86_64-pc-windows-msvc
```

编译机为linux/macos

```bash
apt install mingw-w64
# 另外个Visual Studio环境执行 cargo target add x86_64-pc-windows-msvc
cargo build --target x86_64-pc-windows-gnu
```

也可以选用docker方式的```cross```工具简化跨平台编译流程

```bash
cargo install cross
```

然后在项目根目录下配置Cross.toml,考虑国内网络问题，可以自定义镜像地址

```toml
[target.x86_64-unknown-linux-gnu]
xargo = false
image = "togettoyou/ghcr.io.cross-rs.x86_64-unknown-linux-gnu:main"

[target.x86_64-pc-windows-gnu]
xargo = false
image = "togettoyou/ghcr.io.cross-rs.x86_64-pc-windows-gnu:main"
```

最后运行cross命令编译Windows版本应用

```bash
cross build -r --target x86_64-pc-windows-gnu
```

## 交叉编译linux

大部分工作也需要linux编译，例如在mac上编译linux版本应用,直接运行交叉编译，经常会遇到OpenSSL的编译问题或x86_64-unknown-linux-gnu-gcc未找到的问题。

步骤如下

```bash
rustup target add x86_64-unknown-linux-gnu
export HOMEBREW_BREW_GIT_REMOTE="https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/brew.git"
export HOMEBREW_CORE_GIT_REMOTE="https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/homebrew-core.git"
export HOMEBREW_BOTTLE_DOMAIN="https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles"
brew update
# 实际这里安装就OK了
brew tap messense/macos-cross-toolchains
brew install -s messense/macos-cross-toolchains/x86_64-unknown-linux-gnu
# 但是建议是使用musl的libc静态版本，很多编译问题都可以解决
brew tap filosottile/musl-cross
brew install filosottile/musl-cross/musl-cross
# 执行编译
cargo build  --release --target x86_64-unknown-linux-gnu
```

实际运行中还需要配置Cargo.toml以支持`openssl-sys`的编译

```toml
# 以下为部分截取配置
[lints.clippy]
unwrap_used = "deny"
expect_used = "deny"

[target.x86_64-unknown-linux-gnu.dependencies]
openssl-sys = { version = "0.9", features = ["vendored"] }

[profile.release]
opt-level = 3         # 保持优化
debug = true          # 保留调试符号
split-debuginfo = 'unpacked'  # Linux 下生成独立符号文件
```
