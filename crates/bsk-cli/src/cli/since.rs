//! `--since` parsing for buffered-read commands (`console`, `network`).

use bsk_protocol::tools::SinceCursor;

/// Parse a `--since` value: an absolute sequence or the `last_action` marker.
pub fn parse_since(value: &str) -> Result<SinceCursor, String> {
    let trimmed = value.trim();
    if trimmed.eq_ignore_ascii_case("last_action") {
        return Ok(SinceCursor::LastAction);
    }
    if trimmed.is_empty() {
        return Err("since must be a non-negative integer or `last_action`".to_string());
    }
    trimmed
        .parse::<u64>()
        .map(SinceCursor::Sequence)
        .map_err(|_| {
            format!("invalid since `{value}`: expected a non-negative integer or `last_action`")
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_absolute_and_relative() {
        assert_eq!(parse_since("42").unwrap(), SinceCursor::Sequence(42));
        assert_eq!(
            parse_since(" last_action ").unwrap(),
            SinceCursor::LastAction
        );
        assert_eq!(parse_since("LAST_ACTION").unwrap(), SinceCursor::LastAction);
    }

    #[test]
    fn rejects_garbage() {
        for bad in ["", "  ", "-1", "abc", "1.5", "last action"] {
            assert!(parse_since(bad).is_err(), "{bad} should be rejected");
        }
    }
}
