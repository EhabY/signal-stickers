fn main() {
    // Windows draws modern, DPI-aware menus only for programs that declare them in a manifest.
    if std::env::var_os("CARGO_CFG_WINDOWS").is_some() {
        embed_manifest::embed_manifest(embed_manifest::new_manifest("SignalStickers.Tray"))
            .expect("the manifest embeds");
    }
    println!("cargo:rerun-if-changed=build.rs");
}
