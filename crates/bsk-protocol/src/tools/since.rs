//! Cursor for buffered-read tools (`console`, `network`).

use schemars::JsonSchema;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Where a buffered read should start from.
///
/// Buffered reads are cursor-paginated: each entry carries a per-tab monotonic
/// `sequence`, and `since` asks for entries strictly greater than a cursor.
/// Remembering that number is busywork for the common question — "what did the
/// action I just take produce?" — so a relative marker is accepted as well.
///
/// Serialized as a bare number for the absolute form and as the string
/// `"last_action"` for the marker, so an existing client sending `"since": 42`
/// keeps working unchanged. (An `#[serde(untagged)]` enum cannot express this:
/// the numeric arm always wins the string case.)
#[derive(Debug, Clone, Copy, PartialEq, Eq, JsonSchema)]
pub enum SinceCursor {
    /// An absolute sequence: return entries with `sequence > value`.
    Sequence(u64),
    /// Start after the last agent-initiated action on this tab.
    ///
    /// Resolved by the extension from its per-tab action watermark; a tab with
    /// no recorded action behaves like "from the beginning".
    LastAction,
}

impl SinceCursor {
    /// Absolute sequence when this cursor is not the relative marker.
    pub fn as_sequence(self) -> Option<u64> {
        match self {
            Self::Sequence(value) => Some(value),
            Self::LastAction => None,
        }
    }

    pub fn is_last_action(self) -> bool {
        matches!(self, Self::LastAction)
    }
}

impl From<u64> for SinceCursor {
    fn from(value: u64) -> Self {
        Self::Sequence(value)
    }
}

impl Serialize for SinceCursor {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Sequence(value) => serializer.serialize_u64(*value),
            Self::LastAction => serializer.serialize_str("last_action"),
        }
    }
}

impl<'de> Deserialize<'de> for SinceCursor {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(deserializer)?;
        match value {
            serde_json::Value::String(text) if text == "last_action" => Ok(Self::LastAction),
            serde_json::Value::Number(number) => number
                .as_u64()
                .map(Self::Sequence)
                .ok_or_else(|| serde::de::Error::custom("since must be a non-negative integer")),
            other => Err(serde::de::Error::custom(format!(
                "since must be a non-negative integer or `last_action`, got {other}"
            ))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absolute_cursor_stays_a_plain_number() {
        let value: SinceCursor = serde_json::from_value(serde_json::json!(42)).unwrap();
        assert_eq!(value, SinceCursor::Sequence(42));
        assert_eq!(value.as_sequence(), Some(42));
        assert_eq!(serde_json::to_value(value).unwrap(), serde_json::json!(42));
    }

    #[test]
    fn relative_marker_is_a_string() {
        let value: SinceCursor = serde_json::from_value(serde_json::json!("last_action")).unwrap();
        assert_eq!(value, SinceCursor::LastAction);
        assert!(value.is_last_action());
        assert_eq!(value.as_sequence(), None);
        assert_eq!(
            serde_json::to_value(value).unwrap(),
            serde_json::json!("last_action")
        );
    }

    #[test]
    fn unknown_values_are_rejected() {
        for bad in [
            serde_json::json!("yesterday"),
            serde_json::json!(-1),
            serde_json::json!(null),
            serde_json::json!(true),
        ] {
            assert!(
                serde_json::from_value::<SinceCursor>(bad.clone()).is_err(),
                "{bad} should be rejected"
            );
        }
    }

    #[test]
    fn round_trip_through_params() {
        // The shape a real client sends must survive a params round-trip.
        let raw = serde_json::json!({"session_id": "aa11", "since": "last_action"});
        let params: crate::tools::ConsoleParams = serde_json::from_value(raw).unwrap();
        assert_eq!(params.since, Some(SinceCursor::LastAction));

        let raw = serde_json::json!({"session_id": "aa11", "since": 7});
        let params: crate::tools::NetworkParams = serde_json::from_value(raw).unwrap();
        assert_eq!(params.since, Some(SinceCursor::Sequence(7)));
    }
}
