//! Link URL as written in `config.toml` / the settings UI.
//!
//! Accepted: `udpin|udpout|udp|tcp:<host>:<port>` or `/dev/tty*[,baud]`.
//! Listening TCP (`tcpin`) is deliberately not allowed (same rule as the Python app).

use std::fmt;
use std::str::FromStr;

const DEFAULT_BAUD: u32 = 57_600;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkUrl {
    UdpIn { host: String, port: u16 },
    UdpOut { host: String, port: u16 },
    Tcp { host: String, port: u16 },
    Serial { path: String, baud: u32 },
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum LinkUrlError {
    #[error("link url must be udpin|udpout|udp|tcp:<host>:<port> or /dev/tty*[,baud]")]
    Format,
    #[error("port must be 1..=65535")]
    Port,
    #[error("baud rate must be 3 to 7 digits")]
    Baud,
    #[error("listening tcp (tcpin) is not allowed")]
    TcpIn,
}

impl LinkUrl {
    /// Address string understood by the `mavlink` crate.
    pub fn mavlink_address(&self) -> String {
        match self {
            Self::UdpIn { host, port } => format!("udpin:{host}:{port}"),
            Self::UdpOut { host, port } => format!("udpout:{host}:{port}"),
            Self::Tcp { host, port } => format!("tcpout:{host}:{port}"),
            Self::Serial { path, baud } => format!("serial:{path}:{baud}"),
        }
    }
}

fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

fn parse_net(scheme: &str, rest: &str) -> Result<LinkUrl, LinkUrlError> {
    let (host, port) = rest.rsplit_once(':').ok_or(LinkUrlError::Format)?;
    if !valid_host(host) || port.is_empty() || !port.chars().all(|c| c.is_ascii_digit()) {
        return Err(LinkUrlError::Format);
    }
    let port: u16 = port.parse().map_err(|_| LinkUrlError::Port)?;
    if port == 0 {
        return Err(LinkUrlError::Port);
    }
    let host = host.to_string();
    Ok(match scheme {
        "udpin" => LinkUrl::UdpIn { host, port },
        "udpout" | "udp" => LinkUrl::UdpOut { host, port },
        "tcp" => LinkUrl::Tcp { host, port },
        _ => return Err(LinkUrlError::Format),
    })
}

fn parse_serial(s: &str) -> Result<LinkUrl, LinkUrlError> {
    let (path, baud) = match s.split_once(',') {
        Some((p, b)) => (p, Some(b)),
        None => (s, None),
    };
    let name = path.strip_prefix("/dev/").ok_or(LinkUrlError::Format)?;
    let ok_prefix = name.starts_with("tty") || name.starts_with("serial");
    if !ok_prefix
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(LinkUrlError::Format);
    }
    let baud = match baud {
        None => DEFAULT_BAUD,
        Some(b) if (3..=7).contains(&b.len()) && b.chars().all(|c| c.is_ascii_digit()) => {
            b.parse().map_err(|_| LinkUrlError::Baud)?
        }
        Some(_) => return Err(LinkUrlError::Baud),
    };
    Ok(LinkUrl::Serial {
        path: path.to_string(),
        baud,
    })
}

impl FromStr for LinkUrl {
    type Err = LinkUrlError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let s = s.trim();
        if s.starts_with("/dev/") {
            return parse_serial(s);
        }
        let (scheme, rest) = s.split_once(':').ok_or(LinkUrlError::Format)?;
        if scheme == "tcpin" {
            return Err(LinkUrlError::TcpIn);
        }
        parse_net(scheme, rest)
    }
}

impl fmt::Display for LinkUrl {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UdpIn { host, port } => write!(f, "udpin:{host}:{port}"),
            Self::UdpOut { host, port } => write!(f, "udpout:{host}:{port}"),
            Self::Tcp { host, port } => write!(f, "tcp:{host}:{port}"),
            Self::Serial { path, baud } => write!(f, "{path},{baud}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_udp_and_tcp_forms() {
        assert_eq!(
            "udpin:127.0.0.1:15555".parse::<LinkUrl>().unwrap(),
            LinkUrl::UdpIn {
                host: "127.0.0.1".into(),
                port: 15555
            }
        );
        assert_eq!(
            "udp:pi.local:14550".parse::<LinkUrl>().unwrap(),
            LinkUrl::UdpOut {
                host: "pi.local".into(),
                port: 14550
            }
        );
        assert_eq!(
            "tcp:192.168.144.1:5760"
                .parse::<LinkUrl>()
                .unwrap()
                .mavlink_address(),
            "tcpout:192.168.144.1:5760"
        );
    }

    #[test]
    fn parses_serial_with_and_without_baud() {
        assert_eq!(
            "/dev/ttyACM0".parse::<LinkUrl>().unwrap(),
            LinkUrl::Serial {
                path: "/dev/ttyACM0".into(),
                baud: 57_600
            }
        );
        assert_eq!(
            "/dev/serial0,921600"
                .parse::<LinkUrl>()
                .unwrap()
                .mavlink_address(),
            "serial:/dev/serial0:921600"
        );
    }

    #[test]
    fn rejects_invalid_urls() {
        assert_eq!("tcpin:0.0.0.0:5760".parse::<LinkUrl>(), Err(LinkUrlError::TcpIn));
        assert_eq!("udpin:127.0.0.1:0".parse::<LinkUrl>(), Err(LinkUrlError::Port));
        assert_eq!(
            "udpin:127.0.0.1:70000".parse::<LinkUrl>(),
            Err(LinkUrlError::Port)
        );
        assert_eq!("http://x".parse::<LinkUrl>(), Err(LinkUrlError::Format));
        assert_eq!("udpin:bad host:1".parse::<LinkUrl>(), Err(LinkUrlError::Format));
        assert_eq!("/dev/ttyACM0,12".parse::<LinkUrl>(), Err(LinkUrlError::Baud));
        assert_eq!("/etc/passwd".parse::<LinkUrl>(), Err(LinkUrlError::Format));
    }

    #[test]
    fn display_round_trips() {
        for s in ["udpin:127.0.0.1:15555", "tcp:h:1", "/dev/ttyACM0,57600"] {
            assert_eq!(s.parse::<LinkUrl>().unwrap().to_string(), s);
        }
    }
}
