//! Login / logout / me, the session cookie, the `AuthUser` extractor and the CSRF guard.

use axum::extract::{FromRequestParts, Request, State};
use axum::http::{request::Parts, HeaderMap, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use rgcs_core::Operator;
use rgcs_store::audit::AuditInput;
use serde::{Deserialize, Serialize};

use crate::api::{err, ok};
use crate::app::AppState;

pub const SESSION_COOKIE: &str = "rgcs_session";
pub const CSRF_HEADER: &str = "x-requested-with";
pub const CSRF_VALUE: &str = "rgcs";

#[derive(Deserialize)]
pub struct LoginBody {
    pub username: String,
    pub password: String,
}

/// `GET /api/auth/me` and the login reply; exported to TypeScript as `Me`.
#[derive(Serialize, ts_rs::TS)]
#[ts(export)]
pub struct Me {
    pub username: String,
    pub role: rgcs_core::operator::Role,
    pub dev_mode: bool,
    pub hostname: String,
}

/// An admin session: `AuthUser` plus the role check (403 otherwise).
pub struct AdminUser(pub Operator);

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, app: &AppState) -> Result<Self, Self::Rejection> {
        let AuthUser(op) = AuthUser::from_request_parts(parts, app).await?;
        if op.role != rgcs_core::operator::Role::Admin {
            return Err(err(StatusCode::FORBIDDEN, "forbidden", "admin role required"));
        }
        Ok(AdminUser(op))
    }
}

/// The signed-in operator, resolved from the session cookie. Missing / expired → 401.
#[derive(Debug, Clone)]
pub struct AuthUser(pub Operator);

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, app: &AppState) -> Result<Self, Self::Rejection> {
        let jar = CookieJar::from_headers(&parts.headers);
        let Some(token) = jar.get(SESSION_COOKIE).map(|c| c.value().to_string()) else {
            return Err(err(StatusCode::UNAUTHORIZED, "unauthorized", "sign in first"));
        };
        match app.store.session_user(&token).await {
            Ok(Some(user)) => Ok(AuthUser(Operator {
                username: user.username,
                role: user.role,
                dev_mode: app.dev_mode(),
            })),
            Ok(None) => Err(err(StatusCode::UNAUTHORIZED, "unauthorized", "session expired")),
            Err(e) => Err(err(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string())),
        }
    }
}

/// State-changing requests must carry `X-Requested-With: rgcs` (blocks cross-site form posts).
pub async fn csrf_guard(req: Request, next: Next) -> Response {
    let safe = matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS);
    if safe || has_csrf_header(req.headers()) {
        next.run(req).await
    } else {
        err(
            StatusCode::FORBIDDEN,
            "forbidden",
            "missing X-Requested-With: rgcs header",
        )
    }
}

pub fn has_csrf_header(headers: &HeaderMap) -> bool {
    headers
        .get(CSRF_HEADER)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case(CSRF_VALUE))
}

fn session_cookie(token: String, secure: bool) -> Cookie<'static> {
    Cookie::build((SESSION_COOKIE, token))
        .http_only(true)
        .same_site(SameSite::Strict)
        .secure(secure)
        .path("/")
        .build()
}

pub async fn login(State(app): State<AppState>, jar: CookieJar, Json(body): Json<LoginBody>) -> Response {
    let username = body.username.trim().to_string();
    if !valid_username(&username) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "validation",
            "username must be 1-32 of [A-Za-z0-9_.-]",
        );
    }
    let guard = app.login_guard(&username);
    let _serialized = guard.lock().await;
    if let Some(secs) = app.locked_for(&username) {
        return err(
            StatusCode::TOO_MANY_REQUESTS,
            "locked",
            format!("try again in {secs} s"),
        );
    }
    let user = match app.store.verify_login(&username, &body.password).await {
        Ok(u) => u,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string()),
    };
    let Some(user) = user else {
        app.login_failed(&username);
        audit_auth(&app, &username, "login", "rejected", Some("bad_credentials")).await;
        return err(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "wrong username or password",
        );
    };
    app.login_succeeded(&username);
    let token = match app.store.create_session(&user.username).await {
        Ok(t) => t,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string()),
    };
    audit_auth(&app, &user.username, "login", "ok", None).await;
    let me = Me {
        username: user.username,
        role: user.role,
        dev_mode: app.dev_mode(),
        hostname: app.hostname.clone(),
    };
    (jar.add(session_cookie(token, app.secure_cookies)), ok(me)).into_response()
}

pub async fn logout(State(app): State<AppState>, AuthUser(op): AuthUser, jar: CookieJar) -> Response {
    if let Some(token) = jar.get(SESSION_COOKIE).map(|c| c.value().to_string()) {
        let _ = app.store.delete_session(&token).await;
    }
    audit_auth(&app, &op.username, "logout", "ok", None).await;
    (jar.remove(Cookie::from(SESSION_COOKIE)), ok(())).into_response()
}

pub async fn me(State(app): State<AppState>, AuthUser(op): AuthUser) -> Response {
    ok(Me {
        username: op.username,
        role: op.role,
        dev_mode: op.dev_mode,
        hostname: app.hostname.clone(),
    })
}

pub fn valid_username(s: &str) -> bool {
    (1..=32).contains(&s.len())
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
}

async fn audit_auth(app: &AppState, operator: &str, command: &str, result: &str, reason: Option<&str>) {
    let entry = AuditInput {
        operator,
        sysid: None,
        target: "auth",
        command,
        args: None,
        result,
        reason: reason.map(str::to_string),
    };
    if let Err(e) = app.store.record_audit(entry).await {
        tracing::error!(error = %e, "audit write failed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn username_rules() {
        assert!(valid_username("admin"));
        assert!(valid_username("op.01-x_y"));
        assert!(!valid_username(""));
        assert!(!valid_username("a b"));
        assert!(!valid_username(&"a".repeat(33)));
    }

    #[test]
    fn csrf_header_is_case_insensitive_on_value() {
        let mut h = HeaderMap::new();
        assert!(!has_csrf_header(&h));
        h.insert(CSRF_HEADER, "RGCS".parse().unwrap());
        assert!(has_csrf_header(&h));
        h.insert(CSRF_HEADER, "XMLHttpRequest".parse().unwrap());
        assert!(!has_csrf_header(&h));
    }
}
