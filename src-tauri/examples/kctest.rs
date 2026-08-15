fn main() {
    let e = keyring::Entry::new("app.stash.footage", "google-client-secret").unwrap();
    println!("set: {:?}", e.set_password("hello"));
    println!("get: {:?}", e.get_password());
}
