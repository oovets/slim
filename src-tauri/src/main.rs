#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Spotify only accepts `https://` or `http://127.0.0.1:<port>` redirect URIs, so the
// frontend can't be served from tauri://localhost. In release builds we serve the
// embedded assets on this fixed loopback address instead. (In `tauri dev`, the
// python server from beforeDevCommand listens here.)
#[cfg(not(debug_assertions))]
const ADDR: &str = "127.0.0.1:5173";

#[cfg(not(debug_assertions))]
fn serve_assets(app: &tauri::App) {
    let resolver = app.asset_resolver();
    let server = match tiny_http::Server::http(ADDR) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("slim: could not bind {ADDR} ({e}); assuming something already serves the UI");
            return;
        }
    };
    std::thread::spawn(move || {
        for req in server.incoming_requests() {
            let path = req.url().split('?').next().unwrap_or("/");
            let path = match path.trim_start_matches('/') {
                "" => "index.html",
                p => p,
            };
            let _ = match resolver.get(path.to_string()) {
                Some(asset) => {
                    let header = tiny_http::Header::from_bytes("Content-Type", asset.mime_type.as_bytes())
                        .expect("valid header");
                    req.respond(tiny_http::Response::from_data(asset.bytes).with_header(header))
                }
                None => req.respond(tiny_http::Response::from_string("not found").with_status_code(404)),
            };
        }
    });
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(not(debug_assertions))]
            serve_assets(app);

            // The window is declared in tauri.conf.json with `create: false` so it is
            // only opened once the server above is listening.
            let cfg = app.config().app.windows[0].clone();
            tauri::WebviewWindowBuilder::from_config(app.handle(), &cfg)?.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running slim");
}
