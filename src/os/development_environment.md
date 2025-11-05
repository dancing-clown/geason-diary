# 清华 rCore OS 环境准备

## 应用程序执行环境

如下图所示，现在操作系统上的应用程序需要下面多层次的执行环境栈支持，才可以运行。越往下就越接近硬件，黑色块表示相邻两层执行环境间的接口。我们平时编写的应用，通过调用编译语言提供的标准库货其他第三方库对外提供的函数接口，使得只需要少量的源代码就可以实现复杂的功能。例如我们最常见的 打印 `hello world` 就可以通过调用标准库提供的 `println!` 函数实现,而该宏是由std提供。而通过操作系统提供的`系统调用`(System Call)来实现，因此系统调用充当了用户和内核之间的边界。内核作为应用态软件的执行环境，既要提供系统调用接口，又要对用户态软件的执行进行监控和管理。

![应用程序执行环境栈](../images/app_software_stack.png "应用程序执行环境栈")

我们通常可以通过`strace`来监控当前程序所涉及的系统调用。我们需要实现的是操作系统，因此需要考虑不使用std标准库来实现我们的操作系统，而是使用`core`库实现，它是rust语言核心库，不需要任何操作系统支持的，相应的功能也比较受限，但也能满足我们的大部分功能需求。

## 实现思路

1.首先需要解决硬件平台的问题，整个例子是运行在riscv64架构的虚拟机上的,因此需要搭建qemu-riscv64环境

2.使用rust交叉编译出riscv64的内核镜像

3.由`qemu-system-riscv64`模拟加载对应内核镜像，即用rust实现的操作系统，启动成功后将权限交给用户态的shell

## C开发环境配置

实验环境安装基于C语言的开发，可以安装基本的本机开发环境和交叉开发环境。

```shell
sudo apt-get update && sudo apt-get upgrade
sudo apt-get install git build-essential gdb-multiarch qemu-system-misc gcc-riscv64-linux-gnu buildutils-riscv64-linux-gnu
```

## rust相关软件包

除了之前的环境搭建，rust还有相关软件包需要安装和部署

```shell
rustup target add riscv64gc-unknown-none-elf
cargo install cargo-binutils
rustup component add llvm-tools-preview
rustup component add rust-src
```

## QEMU模拟器安装

使用QEMU 7.0 版本进行实验。很多Linux发行版的软件管理器默认软件源中的QEMU版本过低，需要手动编译安装QEMU模拟器软件。

```shell
# 安装编译所需依赖包
sudo apt install autoconf automake autotools-dev curl libmpc-dev libmpfr-dev libgmp-dev \
gawk build-essential bison flex texinfo gperf libtool patchutils bc \
zlib1g-dev libexpat-dev pkg-config libglib2.0-dev libpixman-1-dev libsdl1.2-dev libslirp git tmux python3 python3-pip ninja-build
# 下载源码
wget https://download.qemu.org/qemu-7.0.0.tar.xz
tar xvJf qemu-7.0.0.tar.xz
cd qemu-7.0.0
./configure --target-list=riscv64-softmmu,riscv64-linux-user
make -j$(nproc)
```

在MacOS上，直接使用`brew install qemu`即可安装qemu10。本例均可通过该方法完成。

strip为os镜像，目的是删除前置的metadata，如果包含可能会导致qemu将metadata当作了内核的第一条指令从而执行错误。

```shell
rust-objcopy --strip-all target/riscv64gc-unknown-none-elf/release/rust_test -O binary target/riscv64gc-unknown-none-elf/release/os.bin
```

运行qemu

```shell
qemu-system-riscv64 \
-machine virt \
-nographic \
-bios ./bootloader/rustsbi-qemu.bin \
-device loader,file=target/riscv64gc-unknown-none-elf/release/os.bin,addr=0x80200000 \
-s -S # 若不带则直接执行
```

运行gdb客户端

```shell
~/riscv64-unknown-elf-gcc-8.3.0-2020.04.1-x86_64-apple-darwin/bin/riscv64-unknown-elf-gdb \
    -ex 'file target/riscv64gc-unknown-none-elf/release/rust_test' \
    -ex 'set arch riscv:rv64' \
    -ex 'target remote localhost:1234'
```

```shell
x/10i $pc
b *0x80200000
x/5i $pc
```

题目2，打印调用栈

因为我们通过`.cargo/config.toml`配置的`rustflags`包含了`-Cforce-frame-pointers=yes`，因此可以获取到对应的frame-pointer，由此来恢复对应的调用栈信息。

```rust

```
