# Async in Rust/C++

## Rust

### 1. Futures

Futures are a way to represent values that may not be available yet, but will be in the future. They are used extensively in asynchronous programming in Rust for handling non-blocking operations and managing concurrency.

```rust
use futures::executor::block_on;
use futures::future::ready;

fn main() {
    let future = ready(42); // A simple Future that immediately returns 42
    println!("The value is: {}", block_on(future));
}
```

### 2. Async/Await

Async functions allow you to write code as if it were synchronous while still allowing for true async behavior under the hood.

```rust
async fn fetch_url() -> Result<String, Box<dyn std::error::Error>> {
    // Simulate an async operation like fetching data from a URL
    Ok("https://example.com".to_string())
}

#[tokio::main]
async fn main() {
    match fetch_url().await {
        Ok(data) => println!("Data fetched successfully: {:?}", data),
        Err(err) => println!("Error: {:?}", err),
    }
}
```
