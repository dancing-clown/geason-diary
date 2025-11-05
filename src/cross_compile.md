# 交叉编译

平时我们开发工作是在mac完成，实际生产存在windows运行环境，调试阶段可以用此种方式快速验证修改代码

```shell
export https_proxy=http://xxx http_proxy=http://xxx all_proxy=socks5://xxx
brew install mingw-w64
rustup target add x86_64-pc-windows-gnu
cargo build --target x86_64-pc-windows-gnu
```

另外个Visual Studio环境执行

```shell
cargo install cargo-xwin
brew install llvm
rustup target add x86_64-pc-windows-msvc
cargo xwin build --release --target x86_64-pc-windows-msvc
```

编译机为linux

```shell
apt install mingw-w64
# 另外个Visual Studio环境执行 cargo target add x86_64-pc-windows-msvc
cargo build --target x86_64-pc-windows-gnu
```

也可以选用docker方式的```cross```工具简化跨平台编译流程

```shell
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

```shell
cross build -r --target x86_64-pc-windows-gnu
```