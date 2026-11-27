use crate::error::ToolError;

pub fn paginate<T: Clone>(
    items: &[T],
    cursor: Option<&str>,
    page_size: usize,
) -> Result<(Vec<T>, Option<String>), ToolError> {
    let offset = match cursor {
        None => 0,
        Some(cursor) => {
            use base64::Engine;
            let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(cursor)
                .map_err(|_| ToolError::bad_request("invalid cursor"))?;
            std::str::from_utf8(&decoded)
                .ok()
                .and_then(|s| s.parse::<usize>().ok())
                .ok_or_else(|| ToolError::bad_request("invalid cursor"))?
        }
    };
    if offset > items.len() {
        return Err(ToolError::bad_request("cursor is out of range"));
    }
    let end = (offset + page_size).min(items.len());
    let page = items[offset..end].to_vec();
    let next = if end < items.len() {
        use base64::Engine;
        Some(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(end.to_string().as_bytes()))
    } else {
        None
    };
    Ok((page, next))
}
