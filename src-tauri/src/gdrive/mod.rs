//! Google Drive — an optional integration.
//!
//! `parse` is the only part the app depends on unconditionally: it needs no
//! account, no API key and no network, and it is what makes Link Mode work.
//! `client` and `oauth` are inert until the user explicitly connects.

pub mod client;
pub mod oauth;
pub mod parse;
