# Revision `{{ revision_id }}` [{{ status }}]{% if stale %} (STALE){% endif %}
- Commit: {{ commit_message }}
- Tokens: +{{ token_added }} / -{{ token_removed }} (total {{ total_tokens }})
{%- if let Some(r) = reviewer %}
- Reviewer: {{ r }}
{%- endif %}
{%- if let Some(c) = comment %}
- Comment: {{ c }}
{%- endif %}
{%- if !conflicts.is_empty() %}
## Conflicts ({{ conflicts.len() }})
{%- for c in conflicts %}
- `{{ c.path }}` ({{ c.hunks }} hunks @ lines {{ c.lines_csv() }})
{%- endfor %}
{%- endif %}
{%- if !conflict_previews.is_empty() %}
## Conflict Hunks
{%- for p in conflict_previews %}
### `{{ p.path }}`
```diff
{{ p.hunk_text }}
```
{%- endfor %}
{%- endif %}
