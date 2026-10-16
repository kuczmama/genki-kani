//! genki-kani progress server.
//!
//! A deliberately tiny backend: it stores one JSON document (your SRS progress)
//! on disk and serves the built frontend. Items are merged per-id by their
//! `updatedAt` timestamp, so several devices can sync without clobbering each
//! other.
//!
//! Env vars:
//!   PORT              (default 3002)
//!   DATA_FILE         (default ./genki-kani-progress.json)
//!   STATIC_DIR        (default ../frontend/dist)
//!   GENKI_KANI_TOKEN  (optional; if set, API requests need `Authorization: Bearer <token>`)

use std::{net::SocketAddr, path::PathBuf, sync::Arc};

use axum::{
    extract::{Request, State},
    http::{header, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tokio::sync::Mutex;
use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
};

#[derive(Default, Serialize, Deserialize, Clone)]
struct Doc {
    #[serde(default)]
    items: Map<String, Value>,
    #[serde(default)]
    settings: Option<Value>,
}

struct AppState {
    doc: Mutex<Doc>,
    path: PathBuf,
    token: Option<String>,
}

type Shared = Arc<AppState>;

fn updated_at(v: &Value) -> f64 {
    v.get("updatedAt").and_then(Value::as_f64).unwrap_or(0.0)
}

fn merge(doc: &mut Doc, incoming: Doc) {
    for (id, item) in incoming.items {
        let newer = doc
            .items
            .get(&id)
            .map_or(true, |cur| updated_at(&item) >= updated_at(cur));
        if newer {
            doc.items.insert(id, item);
        }
    }
    if let Some(s) = incoming.settings {
        let newer = doc
            .settings
            .as_ref()
            .map_or(true, |cur| updated_at(&s) >= updated_at(cur));
        if newer {
            doc.settings = Some(s);
        }
    }
}

async fn persist(state: &AppState, doc: &Doc) -> Result<(), Response> {
    let body = serde_json::to_vec(doc).map_err(internal)?;
    let tmp = state.path.with_extension("json.tmp");
    tokio::fs::write(&tmp, body).await.map_err(internal)?;
    tokio::fs::rename(&tmp, &state.path).await.map_err(internal)?;
    Ok(())
}

fn internal<E: std::fmt::Display>(e: E) -> Response {
    eprintln!("error: {e}");
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
}

async fn get_state(State(st): State<Shared>) -> Json<Doc> {
    Json(st.doc.lock().await.clone())
}

async fn sync_state(State(st): State<Shared>, Json(incoming): Json<Doc>) -> Result<Json<Doc>, Response> {
    let mut doc = st.doc.lock().await;
    merge(&mut doc, incoming);
    persist(&st, &doc).await?;
    Ok(Json(doc.clone()))
}

async fn reset_state(State(st): State<Shared>) -> Result<StatusCode, Response> {
    let mut doc = st.doc.lock().await;
    *doc = Doc::default();
    persist(&st, &doc).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn require_token(State(st): State<Shared>, req: Request, next: Next) -> Response {
    if let Some(token) = &st.token {
        let ok = req
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|h| h.to_str().ok())
            .and_then(|h| h.strip_prefix("Bearer "))
            .is_some_and(|t| t == token);
        if !ok {
            return (StatusCode::UNAUTHORIZED, "bad or missing token").into_response();
        }
    }
    next.run(req).await
}

#[tokio::main]
async fn main() {
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3002);
    let path = PathBuf::from(std::env::var("DATA_FILE").unwrap_or_else(|_| "genki-kani-progress.json".into()));
    let static_dir = PathBuf::from(std::env::var("STATIC_DIR").unwrap_or_else(|_| "../frontend/dist".into()));
    let token = std::env::var("GENKI_KANI_TOKEN").ok().filter(|t| !t.is_empty());

    let doc = match std::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|e| {
            panic!("{} is not valid progress JSON: {e}", path.display());
        }),
        Err(_) => Doc::default(),
    };
    println!("loaded {} item(s) from {}", doc.items.len(), path.display());

    let state = Arc::new(AppState { doc: Mutex::new(doc), path, token });

    let api = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/state", get(get_state).post(sync_state).delete(reset_state))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_token))
        .with_state(state);

    let index = static_dir.join("index.html");
    // Generated audio rarely changes; let browsers keep it for a week.
    let audio = Router::new()
        .fallback_service(ServeDir::new(static_dir.join("audio")))
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=604800"),
        ));
    let app = Router::new()
        .nest("/api", api)
        .nest("/audio", audio)
        .fallback_service(ServeDir::new(&static_dir).fallback(ServeFile::new(index)))
        .layer(CorsLayer::permissive());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("genki-kani listening on http://localhost:{port} (static: {})", static_dir.display());
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .expect("server");
}
