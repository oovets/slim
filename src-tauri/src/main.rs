#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::SocketAddr;

// Spotify only accepts `https://` or `http://127.0.0.1:<port>` redirect URIs, so the
// frontend can't be served from tauri://localhost. In release builds we serve the
// embedded assets on this fixed loopback address instead. (In `tauri dev`, the
// python server from beforeDevCommand listens here.)
#[cfg(not(debug_assertions))]
const UI_ADDR: &str = "127.0.0.1:5173";
const UI_ORIGIN: &str = "http://127.0.0.1:5173";

// The optional fallback sign-in uses an app registration whose redirect URI is fixed to
// this address and path, so something has to listen there. See `spawn_login_redirect`.
const LOGIN_REDIRECT_ADDR: &str = "127.0.0.1:8989";

#[cfg(not(debug_assertions))]
fn serve_assets(app: &tauri::App) {
    let resolver = app.asset_resolver();
    let server = match tiny_http::Server::http(UI_ADDR) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("slim: could not bind {UI_ADDR} ({e}); assuming something already serves the UI");
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

/// Listens on `addr` and forwards `GET /login?<query>` to `<target>/?fb=1&<query>`.
///
/// The fallback app's OAuth callback lands on a different origin (port 8989) than the page
/// that started the login (port 5173), so the code can't be read there. Bouncing it to the
/// main origin lets the page finish the PKCE exchange with its own stored verifier. Anything
/// other than `/login` gets a 404. Returns the bound address, or None if binding failed
/// (e.g. another app already uses the port).
fn spawn_login_redirect(addr: &str, target: &str) -> Option<SocketAddr> {
    let server = match tiny_http::Server::http(addr) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("slim: could not bind {addr} ({e}); fallback sign-in will be unavailable");
            return None;
        }
    };
    let bound = server.server_addr().to_ip()?;
    let target = target.to_string();
    std::thread::spawn(move || {
        for req in server.incoming_requests() {
            let (path, query) = req.url().split_once('?').unwrap_or((req.url(), ""));
            let _ = if path == "/login" {
                let location = format!("{target}/?fb=1&{query}");
                let header = tiny_http::Header::from_bytes("Location", location.as_bytes()).expect("valid header");
                req.respond(tiny_http::Response::empty(302).with_header(header))
            } else {
                req.respond(tiny_http::Response::from_string("not found").with_status_code(404))
            };
        }
    });
    Some(bound)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(not(debug_assertions))]
            serve_assets(app);
            spawn_login_redirect(LOGIN_REDIRECT_ADDR, UI_ORIGIN);

            // The window is declared in tauri.conf.json with `create: false` so it is
            // only opened once the servers above are listening.
            let cfg = app.config().app.windows[0].clone();
            tauri::WebviewWindowBuilder::from_config(app.handle(), &cfg)?.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running slim");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;

    fn get(addr: SocketAddr, path: &str) -> String {
        let mut s = TcpStream::connect(addr).unwrap();
        write!(s, "GET {path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn login_callback_is_forwarded_with_its_query() {
        let addr = spawn_login_redirect("127.0.0.1:0", "http://127.0.0.1:5173").unwrap();
        let res = get(addr, "/login?code=abc123&state=xyz");
        assert!(res.starts_with("HTTP/1.1 302"), "{res}");
        assert!(
            res.to_lowercase().contains("location: http://127.0.0.1:5173/?fb=1&code=abc123&state=xyz"),
            "{res}"
        );
    }

    #[test]
    fn denied_login_error_is_forwarded_too() {
        let addr = spawn_login_redirect("127.0.0.1:0", "http://127.0.0.1:5173").unwrap();
        let res = get(addr, "/login?error=access_denied&state=xyz");
        assert!(res.to_lowercase().contains("location: http://127.0.0.1:5173/?fb=1&error=access_denied&state=xyz"), "{res}");
    }

    #[test]
    fn other_paths_are_not_found() {
        let addr = spawn_login_redirect("127.0.0.1:0", "http://127.0.0.1:5173").unwrap();
        assert!(get(addr, "/favicon.ico").starts_with("HTTP/1.1 404"));
        assert!(get(addr, "/").starts_with("HTTP/1.1 404"));
    }
}
