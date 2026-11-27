use std::panic::{AssertUnwindSafe, catch_unwind};

use tiktoken_rs::CoreBPE;

/// The single tokenizer used for every token number in the registry. Keeping
/// all counting behind this module is what makes ingest, diff, outline and
/// read responses agree.
pub fn tokenizer() -> &'static CoreBPE {
    tiktoken_rs::o200k_base_singleton()
}

pub fn count_tokens(text: &str) -> usize {
    tokenizer().encode_ordinary(text).len()
}

/// Count tokens while recording failures instead of aborting ingest. A failed
/// count is persisted with its error so operators can inspect and retry.
pub fn try_count_tokens(text: &str) -> Result<usize, String> {
    let owned = text.to_string();
    match catch_unwind(AssertUnwindSafe(move || count_tokens(&owned))) {
        Ok(count) => Ok(count),
        Err(payload) => {
            let detail = payload
                .downcast_ref::<&str>()
                .map(|s| (*s).to_string())
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "tokenizer panicked".to_string());
            Err(detail)
        }
    }
}

/// Truncate to at most `max_tokens` using the same tokenizer. Returns the
/// truncated text and the number of tokens actually returned.
pub fn truncate_to_tokens(text: &str, max_tokens: usize) -> (String, usize) {
    if max_tokens == 0 {
        return (String::new(), 0);
    }
    let encoded = tokenizer().encode_ordinary(text);
    if encoded.len() <= max_tokens {
        return (text.to_string(), encoded.len());
    }
    let truncated_tokens = &encoded[..max_tokens];
    match tokenizer().decode(truncated_tokens.to_vec()) {
        Ok(decoded) => (decoded, max_tokens),
        Err(_) => {
            // Decoding a prefix of valid tokens should not fail; fall back to
            // a character-safe prefix rather than returning invalid UTF-8.
            let mut end = text.len();
            while end > 0 && !text.is_char_boundary(end) {
                end -= 1;
            }
            (text[..end].to_string(), max_tokens)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_are_deterministic_and_repeatable() {
        let text = "The registry serves project-scoped skills.\n";
        let first = count_tokens(text);
        let second = count_tokens(text);
        assert_eq!(first, second);
        assert!(first > 0);
    }

    #[test]
    fn truncation_never_exceeds_the_limit_and_preserves_text() {
        let text = (0..500)
            .map(|i| format!("line {i} with a few words\n"))
            .collect::<String>();
        let total = count_tokens(&text);
        let (truncated, returned) = truncate_to_tokens(&text, 50);
        assert_eq!(returned, 50);
        assert!(returned < total);
        assert_eq!(count_tokens(&truncated), 50);
    }

    #[test]
    fn short_text_is_not_truncated() {
        let text = "short";
        let (out, returned) = truncate_to_tokens(text, 100);
        assert_eq!(out, text);
        assert_eq!(returned, count_tokens(text));
    }
}
